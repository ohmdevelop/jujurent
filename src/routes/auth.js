const router = require('express').Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { getAll } = require('../settings');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 30,
  handler: (req, res) => { req.flash('error', 'ลองหลายครั้งเกินไป กรุณารอ 15 นาที'); res.redirect(req.path); },
});
const safeNext = (n) => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') ? n : '/');

function signIn(req, res, u, to) {
  req.session.regenerate((err) => {
    if (err) return res.redirect('/login');
    req.session.uid = u.id;
    req.session.flash = { type: 'success', msg: `ยินดีต้อนรับ ${u.username}` };
    res.redirect(to);
  });
}

router.get('/login', (req, res) =>
  req.user ? res.redirect('/') : res.render('login', { title: 'เข้าสู่ระบบ', nextUrl: safeNext(req.query.next) }));

router.post('/login', limiter, (req, res) => {
  const username = (req.body.username || '').trim();
  const nextUrl = safeNext(req.body.next);
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!u || !bcrypt.compareSync(req.body.password || '', u.password_hash)) {
    req.flash('error', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    return res.redirect('/login?next=' + encodeURIComponent(nextUrl));
  }
  if (u.banned) { req.flash('error', 'บัญชีนี้ถูกระงับ กรุณาติดต่อแอดมิน'); return res.redirect('/login'); }
  signIn(req, res, u, u.role === 'admin' && nextUrl === '/' ? '/admin' : nextUrl);
});

router.get('/register', (req, res) => {
  if (getAll().allow_register !== '1') { req.flash('error', 'ปิดรับสมัครชั่วคราว'); return res.redirect('/login'); }
  res.render('register', { title: 'สมัครสมาชิก' });
});

router.post('/register', limiter, (req, res) => {
  if (getAll().allow_register !== '1') return res.redirect('/login');
  const username = (req.body.username || '').trim();
  const contact = (req.body.contact || '').trim().slice(0, 100);
  const { password = '', confirm = '' } = req.body;
  const fail = (m) => { req.flash('error', m); res.redirect('/register'); };
  if (!/^[a-zA-Z0-9_]{4,20}$/.test(username)) return fail('ชื่อผู้ใช้ต้องเป็น a-z, 0-9, _ ความยาว 4-20 ตัว');
  if (password.length < 8) return fail('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
  if (password !== confirm) return fail('ยืนยันรหัสผ่านไม่ตรงกัน');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return fail('ชื่อผู้ใช้นี้ถูกใช้แล้ว');
  const r = db.prepare('INSERT INTO users (username, contact, password_hash, created_at) VALUES (?,?,?,?)')
    .run(username, contact, bcrypt.hashSync(password, 10), Date.now());
  signIn(req, res, { id: r.lastInsertRowid, username }, '/');
});

router.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

module.exports = router;
