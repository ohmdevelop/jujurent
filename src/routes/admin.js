const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const { SCHEMA, getAll, saveAll } = require('../settings');
const { requireAdmin, imageUpload } = require('../middleware');
const { encrypt, decrypt } = require('../crypto');
const { imageExt } = require('../helpers');
const { releaseStatus } = require('../jobs');
const notify = require('../notify');
const discord = require('../discord');

const SLIP_DIR = path.join(__dirname, '..', '..', 'storage', 'slips');
const IMG_DIR = path.join(__dirname, '..', '..', 'public', 'uploads');
fs.mkdirSync(IMG_DIR, { recursive: true });
const HOUR = 3600000;
const ORDER_SQL = `SELECT o.*, u.username, u.contact, a.title, a.image_url
  FROM orders o JOIN users u ON u.id = o.user_id JOIN accounts a ON a.id = o.account_id`;
const DELIVERY_SQL = `SELECT o.*, a.title, a.riot_username, a.riot_password_enc
  FROM orders o JOIN accounts a ON o.account_id = a.id WHERE o.id = ?`;
const credsOf = (o) => ({ user: o.riot_username, pass: decrypt(o.riot_password_enc) });
const logErr = (e) => console.error('[discord]', e.message);

async function refreshCredMessage(id) {
  const o = db.prepare(DELIVERY_SQL).get(id);
  if (o?.status === 'active' && o.discord_msg_id) {
    await discord.edit(o.ticket_channel_id, o.discord_msg_id, discord.msg.creds(o, credsOf(o)));
  }
}

router.use(requireAdmin);
router.use((req, res, next) => {
  res.locals.pendingCount = db.prepare(`SELECT COUNT(*) c FROM orders WHERE status='pending_review'`).get().c;
  next();
});
const R = (res, view, data = {}) => res.render('admin/' + view, { layout: 'admin/layout', ...data });
const back = (req, res, msg, type = 'success') => { req.flash(type, msg); res.redirect(req.get('Referer') || '/admin'); };

router.get('/', (req, res) => {
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const m0 = new Date(d0); m0.setDate(1);
  const revQ = db.prepare(`SELECT COALESCE(SUM(total),0) sum, COUNT(*) cnt FROM orders
    WHERE status IN ('active','completed') AND reviewed_at >= ? AND reviewed_at < ?`);
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const s = new Date(d0); s.setDate(s.getDate() - i);
    const e = new Date(s); e.setDate(e.getDate() + 1);
    days.push({ label: s.toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric' }), sum: revQ.get(+s, +e).sum });
  }
  R(res, 'dashboard', {
    title: 'ภาพรวม',
    today: revQ.get(+d0, 9e15), month: revQ.get(+m0, 9e15), all: revQ.get(0, 9e15), days,
    acc: Object.fromEntries(db.prepare('SELECT status, COUNT(*) c FROM accounts GROUP BY status').all().map((r) => [r.status, r.c])),
    users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
    pending: db.prepare(`${ORDER_SQL} WHERE o.status='pending_review' ORDER BY o.id`).all(),
    active: db.prepare(`${ORDER_SQL} WHERE o.status='active' ORDER BY o.end_at`).all(),
  });
});
router.get('/api/pending', (req, res) => res.json({ count: res.locals.pendingCount }));

router.get('/orders', (req, res) => {
  const status = req.query.status || 'pending_review';
  const q = (req.query.q || '').trim();
  let sql = ORDER_SQL + ' WHERE 1=1';
  const p = [];
  if (status !== 'all') { sql += ' AND o.status = ?'; p.push(status); }
  if (q) { sql += ' AND (o.code LIKE ? OR u.username LIKE ? OR a.title LIKE ?)'; p.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  R(res, 'orders', {
    title: 'คำสั่งเช่า', status, q,
    orders: db.prepare(sql + ' ORDER BY o.id DESC LIMIT 300').all(...p),
    counts: Object.fromEntries(db.prepare('SELECT status, COUNT(*) c FROM orders GROUP BY status').all().map((r) => [r.status, r.c])),
  });
});

router.get('/orders/:id', (req, res) => {
  const o = db.prepare(ORDER_SQL + ' WHERE o.id = ?').get(req.params.id);
  if (!o) return res.redirect('/admin/orders');
  R(res, 'order', { title: 'ออเดอร์ #' + o.code, o });
});

router.get('/slip/:id', (req, res) => {
  const o = db.prepare('SELECT slip_path FROM orders WHERE id = ?').get(req.params.id);
  if (!o) return res.sendStatus(404);
  res.sendFile(path.join(SLIP_DIR, path.basename(o.slip_path)));
});

router.post('/orders/:id/approve', async (req, res) => {
  const s = getAll();
  const o = db.prepare(DELIVERY_SQL).get(req.params.id);
  if (!o || o.status !== 'pending_review') return back(req, res, 'ออเดอร์นี้ไม่อยู่ในสถานะรอตรวจสอบ', 'error');

  const now = Date.now();
  const end = now + o.hours * HOUR;
  let sent = null;

  // ถ้าใช้ Discord Ticket
  if (s.discord_delivery === '1') {
    if (!o.ticket_channel_id) return back(req, res, 'ออเดอร์นี้ยังไม่มีห้อง ticket ให้ระบุห้องในกล่อง "Discord ticket" ก่อน', 'error');
    try {
      sent = await discord.send(o.ticket_channel_id, discord.msg.creds({ ...o, start_at: now, end_at: end }, credsOf(o)));
    } catch (e) {
      return back(req, res, `ส่งรหัสเข้า Discord ไม่สำเร็จ: ${e.message} (ยังไม่ได้อนุมัติ)`, 'error');
    }
  }
  // ถ้าใช้ AnyDesk Remote Login
  else if (s.anydesk_delivery === '1') {
    if (!o.anydesk_id) return back(req, res, 'ออเดอร์นี้ยังไม่มีเลข AnyDesk', 'error');
    // อนุมัติแล้วเปลี่ยนสถานะเป็น waiting รอแอดมิน remote
  }

  const ok = db.transaction(() => {
    const r = db.prepare(`UPDATE orders SET status='active', start_at=?, end_at=?, reviewed_at=?, reviewed_by=?, discord_msg_id=?, delivered_at=?
      WHERE id=? AND status='pending_review'`).run(now, end, now, req.user.id, sent?.id || null, sent ? now : null, o.id);
    if (!r.changes) return false;
    db.prepare(`UPDATE accounts SET status='rented' WHERE id=?`).run(o.account_id);
    return true;
  })();

  if (!ok && sent) discord.remove(o.ticket_channel_id, sent.id).catch(logErr);

  let msg = 'อนุมัติแล้ว เริ่มนับเวลาเช่า';
  if (sent) msg = `อนุมัติแล้ว ส่งรหัสเข้า #${o.ticket_channel_name} เรียบร้อย`;
  else if (s.anydesk_delivery === '1' && o.anydesk_id) msg = `อนุมัติแล้ว กรุณา Remote เข้า AnyDesk ID: ${o.anydesk_id} เพื่อ Login ให้ลูกค้า`;

  back(req, res, ok ? msg : 'ออเดอร์นี้ถูกดำเนินการไปแล้ว', ok ? 'success' : 'error');
});

router.post('/orders/:id/reject', (req, res) => {
  const note = (req.body.note || '').trim() || null;
  const o = db.transaction(() => {
    const o = db.prepare(`SELECT * FROM orders WHERE id=? AND status='pending_review'`).get(req.params.id);
    if (!o) return null;
    db.prepare(`UPDATE orders SET status='rejected', admin_note=?, reviewed_at=?, reviewed_by=? WHERE id=?`)
      .run(note, Date.now(), req.user.id, o.id);
    db.prepare(`UPDATE accounts SET status='available' WHERE id=? AND status='reserved'`).run(o.account_id);
    return o;
  })();
  if (o?.ticket_channel_id) discord.send(o.ticket_channel_id, discord.msg.rejected(o, note)).catch(logErr);
  back(req, res, o ? 'ไม่อนุมัติออเดอร์แล้ว' : 'ดำเนินการไม่ได้', o ? 'success' : 'error');
});

router.post('/orders/:id/extend', (req, res) => {
  const h = Number(req.body.hours);
  if (!h || Math.abs(h) > 720) return back(req, res, 'จำนวนชั่วโมงไม่ถูกต้อง', 'error');
  const r = db.prepare(`UPDATE orders SET end_at = end_at + ? WHERE id=? AND status='active'`).run(Math.round(h * HOUR), req.params.id);
  if (r.changes) refreshCredMessage(req.params.id).catch(logErr);
  back(req, res, r.changes ? `ปรับเวลา ${h > 0 ? '+' : ''}${h} ชม. แล้ว` : 'ปรับเวลาไม่ได้', r.changes ? 'success' : 'error');
});

router.post('/orders/:id/end', (req, res) => {
  const o = db.prepare(`SELECT * FROM orders WHERE id=? AND status='active'`).get(req.params.id);
  if (!o) return back(req, res, 'ไม่พบออเดอร์ที่กำลังเช่า', 'error');
  db.transaction(() => {
    db.prepare(`UPDATE orders SET status='completed', end_at=? WHERE id=?`).run(Date.now(), o.id);
    db.prepare(`UPDATE accounts SET status=? WHERE id=? AND status='rented'`).run(releaseStatus(), o.account_id);
  })();
  discord.expire(o);
  back(req, res, 'หยุดการเช่าแล้ว');
});

router.post('/orders/:id/ticket', async (req, res) => {
  const o = db.prepare(DELIVERY_SQL).get(req.params.id);
  if (!o || !['pending_review', 'active'].includes(o.status)) return back(req, res, 'ออเดอร์นี้แก้ไขห้อง ticket ไม่ได้', 'error');
  try {
    let chId = o.ticket_channel_id, chName = o.ticket_channel_name;
    if ((req.body.channel || '').trim()) {
      const ch = await discord.resolveTicket(req.body.channel);
      chId = ch.id; chName = ch.name;
    }
    if (!chId) return back(req, res, 'กรุณาระบุห้อง ticket', 'error');

    if (o.status === 'pending_review') {
      db.prepare('UPDATE orders SET ticket_channel_id=?, ticket_channel_name=? WHERE id=?').run(chId, chName, o.id);
      return back(req, res, `บันทึกห้อง #${chName} แล้ว รหัสจะถูกส่งเข้าห้องนี้ตอนอนุมัติ`);
    }
    const sent = await discord.send(chId, discord.msg.creds(o, credsOf(o)));
    if (o.discord_msg_id) discord.remove(o.ticket_channel_id, o.discord_msg_id).catch(() => {});
    db.prepare('UPDATE orders SET ticket_channel_id=?, ticket_channel_name=?, discord_msg_id=?, delivered_at=? WHERE id=?')
      .run(chId, chName, sent.id, Date.now(), o.id);
    back(req, res, `ส่งรหัสเข้า #${chName} แล้ว`);
  } catch (e) {
    back(req, res, e.message, 'error');
  }
});

router.post('/orders/:id/remote-start', (req, res) => {
  const r = db.prepare(`UPDATE orders SET remote_status='in_progress', remote_started_at=? WHERE id=? AND status='active' AND anydesk_id IS NOT NULL`)
    .run(Date.now(), req.params.id);
  back(req, res, r.changes ? 'เปลี่ยนสถานะเป็น "กำลัง Remote" แล้ว' : 'อัปเดตสถานะไม่ได้', r.changes ? 'success' : 'error');
});

router.post('/orders/:id/remote-complete', (req, res) => {
  const r = db.prepare(`UPDATE orders SET remote_status='completed', remote_completed_at=?, delivered_at=? WHERE id=? AND status='active' AND anydesk_id IS NOT NULL`)
    .run(Date.now(), Date.now(), req.params.id);
  back(req, res, r.changes ? 'Login สำเร็จแล้ว! ลูกค้าสามารถเข้าเล่นได้' : 'อัปเดตสถานะไม่ได้', r.changes ? 'success' : 'error');
});

router.post('/orders/:id/remote-fail', (req, res) => {
  const note = (req.body.note || '').trim() || 'ไม่สามารถ Remote Login ได้';
  const r = db.prepare(`UPDATE orders SET remote_status='failed', admin_note=? WHERE id=? AND status='active' AND anydesk_id IS NOT NULL`)
    .run(note, req.params.id);
  back(req, res, r.changes ? 'บันทึกว่า Login ไม่สำเร็จแล้ว' : 'อัปเดตสถานะไม่ได้', r.changes ? 'success' : 'error');
});

function readAccountForm(req, isNew) {
  const b = req.body;
  const data = {
    title: (b.title || '').trim(), rank: (b.rank || '').trim(), level: parseInt(b.level, 10) || 0,
    region: (b.region || 'AP').trim(), agents_count: parseInt(b.agents_count, 10) || 0,
    skins: (b.skins || '').trim(), description: (b.description || '').trim(),
    image_url: (b.image_url || '').trim(), price_per_hour: Number(b.price_per_hour),
    riot_username: (b.riot_username || '').trim(), is_visible: b.is_visible ? 1 : 0,
    sort_order: parseInt(b.sort_order, 10) || 0,
  };
  const errors = [];
  if (req.uploadError) errors.push(req.uploadError);
  if (!data.title) errors.push('กรุณาใส่ชื่อไอดี');
  if (!(data.price_per_hour > 0)) errors.push('ราคาต่อชั่วโมงต้องมากกว่า 0');
  if (!data.riot_username) errors.push('กรุณาใส่ Riot username');
  if (isNew && !b.riot_password) errors.push('กรุณาใส่รหัสผ่านไอดี');
  if (data.image_url && !/^(https?:\/\/|\/public\/)/.test(data.image_url)) errors.push('ลิงก์รูปไม่ถูกต้อง');
  if (req.file && !imageExt(req.file.buffer)) errors.push('ไฟล์รูปไม่ถูกต้อง');
  return { data, errors };
}
function persistImage(req, data) {
  if (!req.file) return;
  const name = crypto.randomBytes(8).toString('hex') + imageExt(req.file.buffer);
  fs.writeFileSync(path.join(IMG_DIR, name), req.file.buffer);
  data.image_url = '/public/uploads/' + name;
}
const imgUp = imageUpload('image', () => 8);

router.get('/accounts', (req, res) => {
  R(res, 'accounts', {
    title: 'จัดการไอดี',
    accounts: db.prepare(`SELECT a.*, (SELECT COUNT(*) FROM orders o WHERE o.account_id=a.id AND o.status IN ('active','completed')) rentals
      FROM accounts a ORDER BY a.sort_order DESC, a.id DESC`).all(),
  });
});

router.get('/accounts/new', (req, res) => R(res, 'account_form', { title: 'เพิ่มไอดีใหม่', a: { is_visible: 1, region: 'AP' }, currentPass: null }));

router.post('/accounts', imgUp, (req, res) => {
  const { data, errors } = readAccountForm(req, true);
  if (errors.length) return R(res, 'account_form', { title: 'เพิ่มไอดีใหม่', a: data, currentPass: null, flash: { type: 'error', msg: errors.join(' • ') } });
  persistImage(req, data);
  db.prepare(`INSERT INTO accounts (title, rank, level, region, agents_count, skins, description, image_url, price_per_hour,
      riot_username, riot_password_enc, is_visible, sort_order, status, created_at)
    VALUES (@title, @rank, @level, @region, @agents_count, @skins, @description, @image_url, @price_per_hour,
      @riot_username, @riot_password_enc, @is_visible, @sort_order, @status, @created_at)`)
    .run({ ...data, riot_password_enc: encrypt(req.body.riot_password), status: req.body.status === 'maintenance' ? 'maintenance' : 'available', created_at: Date.now() });
  req.flash('success', 'เพิ่มไอดีเรียบร้อย');
  res.redirect('/admin/accounts');
});

router.get('/accounts/:id/edit', (req, res) => {
  const a = db.prepare('SELECT * FROM accounts WHERE id=?').get(req.params.id);
  if (!a) return res.redirect('/admin/accounts');
  R(res, 'account_form', { title: 'แก้ไข: ' + a.title, a, currentPass: decrypt(a.riot_password_enc) });
});

router.post('/accounts/:id', imgUp, (req, res) => {
  const cur = db.prepare('SELECT * FROM accounts WHERE id=?').get(req.params.id);
  if (!cur) return res.redirect('/admin/accounts');
  const { data, errors } = readAccountForm(req, false);
  if (errors.length) return R(res, 'account_form', { title: 'แก้ไข: ' + cur.title, a: { ...cur, ...data }, currentPass: decrypt(cur.riot_password_enc), flash: { type: 'error', msg: errors.join(' • ') } });
  persistImage(req, data);
  if (req.body.riot_password) data.riot_password_enc = encrypt(req.body.riot_password);
  if (['available', 'maintenance'].includes(req.body.status) && !['reserved', 'rented'].includes(cur.status)) data.status = req.body.status;
  const sets = Object.keys(data).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE accounts SET ${sets} WHERE id = @id`).run({ ...data, id: cur.id });
  req.flash('success', 'บันทึกเรียบร้อย');
  res.redirect('/admin/accounts');
});

router.post('/accounts/:id/status', (req, res) => {
  const st = req.body.status;
  if (!['available', 'maintenance'].includes(st)) return back(req, res, 'สถานะไม่ถูกต้อง', 'error');
  const r = db.prepare(`UPDATE accounts SET status=? WHERE id=? AND status NOT IN ('reserved','rented')`).run(st, req.params.id);
  back(req, res, r.changes ? 'อัปเดตสถานะแล้ว' : 'ไอดีกำลังถูกจอง/เช่าอยู่ เปลี่ยนสถานะไม่ได้', r.changes ? 'success' : 'error');
});

router.post('/accounts/:id/delete', (req, res) => {
  if (db.prepare('SELECT 1 FROM orders WHERE account_id=?').get(req.params.id))
    return back(req, res, 'ไอดีนี้มีประวัติการเช่า ลบไม่ได้ (ใช้ "ซ่อน" แทน)', 'error');
  db.prepare('DELETE FROM accounts WHERE id=?').run(req.params.id);
  back(req, res, 'ลบไอดีแล้ว');
});

router.get('/users', (req, res) => {
  const q = (req.query.q || '').trim();
  R(res, 'users', {
    title: 'สมาชิก', q,
    users: db.prepare(`SELECT u.*,
        (SELECT COUNT(*) FROM orders o WHERE o.user_id=u.id) orders,
        (SELECT COALESCE(SUM(total),0) FROM orders o WHERE o.user_id=u.id AND o.status IN ('active','completed')) spent
      FROM users u WHERE u.username LIKE ? ORDER BY u.id DESC LIMIT 500`).all(`%${q}%`),
  });
});
router.post('/users/:id/ban', (req, res) => {
  if (+req.params.id === req.user.id) return back(req, res, 'แบนตัวเองไม่ได้', 'error');
  db.prepare('UPDATE users SET banned = 1 - banned WHERE id=?').run(req.params.id);
  back(req, res, 'อัปเดตสถานะสมาชิกแล้ว');
});
router.post('/users/:id/role', (req, res) => {
  if (+req.params.id === req.user.id) return back(req, res, 'เปลี่ยนสิทธิ์ตัวเองไม่ได้', 'error');
  db.prepare(`UPDATE users SET role = CASE role WHEN 'admin' THEN 'user' ELSE 'admin' END WHERE id=?`).run(req.params.id);
  back(req, res, 'เปลี่ยนสิทธิ์แล้ว');
});
router.post('/users/:id/password', (req, res) => {
  const pw = req.body.password || '';
  if (pw.length < 8) return back(req, res, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัว', 'error');
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(require('bcryptjs').hashSync(pw, 10), req.params.id);
  back(req, res, 'รีเซ็ตรหัสผ่านแล้ว');
});

router.get('/settings', (req, res) => {
  const groups = {};
  for (const f of SCHEMA) (groups[f.group] ||= []).push(f);
  R(res, 'settings', { title: 'ตั้งค่าระบบ', groups, values: getAll() });
});

router.post('/settings', (req, res) => {
  const out = {};
  const current = getAll();
  for (const f of SCHEMA) {
    let v = req.body[f.key];
    if (f.type === 'bool') v = v ? '1' : '0';
    else if (f.type === 'number') {
      v = Number(v);
      if (!Number.isFinite(v)) v = Number(f.def);
      if (f.min !== undefined) v = Math.max(f.min, v);
      if (f.max !== undefined) v = Math.min(f.max, v);
      v = String(v);
    } else if (f.type === 'color') v = /^#[0-9a-fA-F]{6}$/.test(v || '') ? v : f.def;
    else if (f.type === 'password') v = String(v ?? '').trim() || current[f.key];
    else v = String(v ?? '').trim();
    out[f.key] = v;
  }
  if (+out.min_hours > +out.max_hours) return back(req, res, 'ชั่วโมงขั้นต่ำต้องไม่มากกว่าชั่วโมงสูงสุด', 'error');
  saveAll(out);
  back(req, res, 'บันทึกการตั้งค่าเรียบร้อย');
});

router.post('/settings/test-notify', async (req, res) => {
  const { sent, errors } = await notify.send({
    title: '🔔 ทดสอบการแจ้งเตือน',
    fields: [['สถานะ', 'เชื่อมต่อสำเร็จ'], ['ส่งโดย', req.user.username]],
    path: '/admin',
  });
  if (errors.length) return back(req, res, 'ส่งไม่สำเร็จ: ' + errors.join(' | '), 'error');
  if (!sent) return back(req, res, 'ยังไม่ได้เปิดช่องทางแจ้งเตือน (เปิดสวิตช์ ใส่ข้อมูล แล้วกดบันทึกก่อน)', 'error');
  back(req, res, `ส่งข้อความทดสอบแล้ว ${sent} ช่องทาง`);
});

router.post('/settings/test-discord-bot', async (req, res) => {
  try {
    const s = getAll();
    const me = await discord.api('GET', '/users/@me');
    const guild = await discord.api('GET', `/guilds/${s.discord_guild_id}`);
    const channels = await discord.api('GET', `/guilds/${s.discord_guild_id}/channels`);
    const cats = discord.ticketCategories();
    if (!cats.length) throw new Error('ยังไม่ได้ใส่ Category ID ของห้อง ticket');
    const names = cats.map((id) => {
      const c = channels.find((ch) => ch.id === id && ch.type === 4);
      if (!c) throw new Error(`ไม่พบหมวด ID ${id} ในเซิร์ฟเวอร์`);
      return c.name;
    });
    back(req, res, `✅ บอท ${me.username} เชื่อมต่อเซิร์ฟเวอร์ "${guild.name}" แล้ว · หมวด ticket: ${names.join(', ')}`);
  } catch (e) {
    back(req, res, 'ทดสอบไม่ผ่าน: ' + e.message, 'error');
  }
});

module.exports = router;
