const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const generatePayload = require('promptpay-qr');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { getAll } = require('../settings');
const { requireLogin, imageUpload } = require('../middleware');
const { calcPrice, imageExt, money } = require('../helpers');
const { decrypt } = require('../crypto');
const notify = require('../notify');
const discord = require('../discord');

const SLIP_DIR = path.join(__dirname, '..', '..', 'storage', 'slips');
fs.mkdirSync(SLIP_DIR, { recursive: true });
const PUBLIC_COLS = 'id, title, rank, level, region, agents_count, skins, description, image_url, price_per_hour, status';

const TICKET_TTL = 12 * 3600000;
const verifiedTicket = (req) => {
  const t = req.session.ticket;
  return t && t.verified && Date.now() - t.verifiedAt < TICKET_TTL ? t : null;
};

router.get('/', (req, res) => {
  const { q = '', rank = '', sort = '', onlyFree = '' } = req.query;
  let sql = `SELECT ${PUBLIC_COLS} FROM accounts WHERE is_visible = 1`;
  const p = [];
  if (q) { sql += ' AND (title LIKE ? OR skins LIKE ?)'; p.push(`%${q}%`, `%${q}%`); }
  if (rank) { sql += ' AND rank LIKE ?'; p.push(`${rank}%`); }
  if (onlyFree) sql += ` AND status = 'available'`;
  sql += {
    price_asc: ' ORDER BY price_per_hour ASC',
    price_desc: ' ORDER BY price_per_hour DESC',
    newest: ' ORDER BY id DESC',
  }[sort] || ` ORDER BY (status = 'available') DESC, sort_order DESC, id DESC`;
  const stats = db.prepare(`SELECT COUNT(*) total, COALESCE(SUM(status='available'),0) free FROM accounts WHERE is_visible=1`).get();
  res.render('index', { accounts: db.prepare(sql).all(...p), query: req.query, stats });
});

router.get('/rules', (req, res) => res.render('rules', { title: 'กติกาการเช่า' }));

router.get('/account/:id', (req, res, next) => {
  const a = db.prepare(`SELECT ${PUBLIC_COLS} FROM accounts WHERE id = ? AND is_visible = 1`).get(req.params.id);
  if (!a) return next();
  const t = verifiedTicket(req);
  const anydeskId = req.session.anydesk_id || null;
  res.render('account', { a, title: a.title, ticket: t ? { name: t.name } : null, session: { anydesk_id: anydeskId } });
});

router.get('/qr', async (req, res) => {
  const s = getAll();
  const amount = Math.round(Number(req.query.amount) * 100) / 100;
  if (!s.promptpay_id || !(amount > 0) || amount > 1e6) return res.sendStatus(400);
  const payload = generatePayload(s.promptpay_id.replace(/\D/g, ''), { amount });
  const png = await QRCode.toBuffer(payload, { width: 360, margin: 1 });
  res.type('png').set('Cache-Control', 'public, max-age=3600').send(png);
});

const ticketLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, limit: 6,
  keyGenerator: (req) => 'u' + req.user.id,
  handler: (req, res) => res.status(429).json({ error: 'ขอรหัสบ่อยเกินไป กรุณารอสักครู่' }),
});

router.post('/ticket/request', requireLogin, ticketLimiter, async (req, res) => {
  if (getAll().discord_delivery !== '1') return res.status(400).json({ error: 'ระบบส่งรหัสผ่าน Discord ปิดอยู่' });
  try {
    const ch = await discord.resolveTicket(req.body.channel);
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    const m = await discord.send(ch.id, discord.msg.verify(code, req.user.username));
    req.session.ticket = { id: ch.id, name: ch.name, code, exp: Date.now() + 10 * 60000, tries: 0, msgId: m.id, verified: false };
    res.json({ name: ch.name });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/ticket/verify', requireLogin, (req, res) => {
  const t = req.session.ticket;
  if (!t || t.verified || !t.code) return res.status(400).json({ error: 'กรุณากด "ส่งรหัสยืนยัน" ก่อน' });
  if (Date.now() > t.exp) { delete req.session.ticket; return res.status(400).json({ error: 'รหัสหมดอายุ กรุณาขอรหัสใหม่' }); }
  if (++t.tries > 5) { delete req.session.ticket; return res.status(400).json({ error: 'กรอกผิดเกินกำหนด กรุณาขอรหัสใหม่' }); }
  const input = String(req.body.code || '').replace(/\D/g, '');
  if (input.length !== 6 || !crypto.timingSafeEqual(Buffer.from(input), Buffer.from(t.code))) {
    return res.status(400).json({ error: `รหัสไม่ถูกต้อง (เหลือ ${5 - t.tries} ครั้ง)` });
  }
  Object.assign(t, { verified: true, verifiedAt: Date.now(), code: null });
  discord.edit(t.id, t.msgId, discord.msg.linked(req.user.username)).catch(() => {});
  res.json({ name: t.name });
});

router.post('/ticket/reset', requireLogin, (req, res) => {
  delete req.session.ticket;
  res.json({ ok: true });
});

router.post('/anydesk/save', requireLogin, (req, res) => {
  const s = getAll();
  if (s.anydesk_delivery !== '1') return res.status(400).json({ error: 'ระบบ Remote Login ปิดอยู่' });
  const anydesk = String(req.body.anydesk_id || '').trim();
  if (!/^\d{9}$/.test(anydesk)) return res.status(400).json({ error: 'เลข AnyDesk ต้องเป็นตัวเลข 9 หลัก' });
  req.session.anydesk_id = anydesk;
  res.json({ ok: true, anydesk_id: anydesk });
});

router.post('/account/:id/rent', requireLogin, imageUpload('slip', () => getAll().max_slip_mb), (req, res) => {
  const s = getAll();
  const id = Number(req.params.id);
  const back = `/account/${id}`;
  const fail = (m) => { req.flash('error', m); res.redirect(back); };

  if (req.uploadError) return fail(req.uploadError);
  const hours = parseInt(req.body.hours, 10);
  if (!Number.isInteger(hours) || hours < +s.min_hours || hours > +s.max_hours)
    return fail(`จำนวนชั่วโมงต้องอยู่ระหว่าง ${s.min_hours}-${s.max_hours}`);
  const ext = req.file && imageExt(req.file.buffer);
  if (!ext) return fail('กรุณาแนบสลิปเป็นไฟล์รูป JPG / PNG / WEBP');

  // เช็คว่าใช้วิธีการส่งมอบแบบไหน
  let ticket = null, anydeskId = null;
  if (s.discord_delivery === '1') {
    ticket = verifiedTicket(req);
    if (!ticket) return fail('กรุณายืนยันห้อง Discord ticket ก่อนสั่งเช่า');
  } else if (s.anydesk_delivery === '1') {
    anydeskId = req.session.anydesk_id;
    if (!anydeskId || !/^\d{9}$/.test(anydeskId)) return fail('กรุณาใส่เลข AnyDesk 9 หลักก่อนสั่งเช่า');
  }

  const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
  if (db.prepare(`SELECT 1 FROM orders WHERE slip_hash = ? AND status != 'cancelled'`).get(hash))
    return fail('สลิปนี้เคยถูกใช้แล้ว');
  const open = db.prepare(`SELECT COUNT(*) c FROM orders WHERE user_id = ? AND status IN ('pending_review','active')`).get(req.user.id).c;
  if (open >= +s.max_active_per_user) return fail(`มีออเดอร์ค้าง/กำลังเช่าได้สูงสุด ${s.max_active_per_user} รายการ`);

  const code = 'VR' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase();
  const filename = code + ext;
  fs.writeFileSync(path.join(SLIP_DIR, filename), req.file.buffer);

  let order;
  try {
    order = db.transaction(() => {
      const a = db.prepare('SELECT id, title, price_per_hour, status FROM accounts WHERE id = ? AND is_visible = 1').get(id);
      if (!a) throw new Error('ไม่พบไอดีนี้');
      if (a.status !== 'available') throw new Error('ไอดีนี้เพิ่งถูกจองไป กรุณาเลือกไอดีอื่น');
      const { disc, total } = calcPrice(a.price_per_hour, hours, s);
      db.prepare(`UPDATE accounts SET status = 'reserved' WHERE id = ?`).run(id);
      const info = db.prepare(`INSERT INTO orders (code, user_id, account_id, hours, price_per_hour, discount, total, slip_path, slip_hash, created_at, ticket_channel_id, ticket_channel_name, anydesk_id, remote_status)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(code, req.user.id, id, hours, a.price_per_hour, disc, total, filename, hash, Date.now(), ticket?.id || null, ticket?.name || null, anydeskId || null, anydeskId ? 'waiting' : null);
      return { id: info.lastInsertRowid, title: a.title, total };
    })();
  } catch (e) {
    fs.unlink(path.join(SLIP_DIR, filename), () => {});
    return fail(e.message);
  }

  notify.send({
    title: `🧾 ออเดอร์ใหม่ #${code}`,
    fields: [['ผู้เช่า', req.user.username], ['ไอดี', order.title], ['จำนวน', `${hours} ชม.`], ['ยอดที่ต้องได้รับ', `฿${money(order.total)}`], ...(anydeskId ? [['AnyDesk ID', anydeskId]] : [])],
    path: `/admin/orders/${order.id}`,
    image: { buffer: req.file.buffer, name: filename },
  });

  req.flash('success', `ส่งคำสั่งเช่า #${code} แล้ว รอแอดมินตรวจสอบสลิป`);
  res.redirect('/orders');
});

router.get('/orders', requireLogin, (req, res) => {
  const now = Date.now();
  const s = getAll();
  const webCreds = s.anydesk_delivery !== '1' && (s.discord_delivery !== '1' || s.show_creds_on_web === '1');
  const rows = db.prepare(`
    SELECT o.*, a.title, a.image_url, a.riot_username, a.riot_password_enc
    FROM orders o JOIN accounts a ON a.id = o.account_id
    WHERE o.user_id = ? ORDER BY o.id DESC LIMIT 100`).all(req.user.id);
  const orders = rows.map(({ riot_username, riot_password_enc, ...o }) => ({
    ...o,
    cred: webCreds && o.status === 'active' && o.end_at > now ? { user: riot_username, pass: decrypt(riot_password_enc) } : null,
  }));
  res.render('orders', { orders, title: 'ประวัติการเช่า' });
});

router.get('/orders/poll', requireLogin, (req, res) => {
  res.json({ pending: db.prepare(`SELECT COUNT(*) c FROM orders WHERE user_id=? AND status='pending_review'`).get(req.user.id).c });
});

router.post('/orders/:code/cancel', requireLogin, (req, res) => {
  if (getAll().allow_user_cancel !== '1') return res.redirect('/orders');
  const ok = db.transaction(() => {
    const o = db.prepare(`SELECT * FROM orders WHERE code=? AND user_id=? AND status='pending_review'`).get(req.params.code, req.user.id);
    if (!o) return false;
    db.prepare(`UPDATE orders SET status='cancelled' WHERE id=?`).run(o.id);
    db.prepare(`UPDATE accounts SET status='available' WHERE id=? AND status='reserved'`).run(o.account_id);
    return true;
  })();
  if (ok && getAll().notify_on_cancel === '1') {
    notify.send({
      title: `↩️ ลูกค้ายกเลิกออเดอร์ #${req.params.code}`,
      color: 0x64748b,
      fields: [['ผู้เช่า', req.user.username]],
      path: '/admin/orders?status=cancelled',
    });
  }
  req.flash(ok ? 'success' : 'error', ok ? 'ยกเลิกคำสั่งเช่าแล้ว' : 'ไม่สามารถยกเลิกได้');
  res.redirect('/orders');
});

module.exports = router;
