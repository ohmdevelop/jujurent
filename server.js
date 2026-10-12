require('dotenv').config();
process.env.TZ ||= 'Asia/Bangkok';
const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);
const layouts = require('express-ejs-layouts');
const bcrypt = require('bcryptjs');
const db = require('./src/db');
const { getAll } = require('./src/settings');
const mw = require('./src/middleware');
const helpers = require('./src/helpers');
const { startJobs } = require('./src/jobs');

if (!process.env.SESSION_SECRET) throw new Error('กรุณาตั้งค่า SESSION_SECRET ใน .env');

const app = express();
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layout');
app.use(layouts);
Object.assign(app.locals, helpers);

const isProd = process.env.NODE_ENV === 'production';
app.use('/public', express.static(path.join(__dirname, 'public'), { maxAge: isProd ? '7d' : 0 }));

try {
  app.locals.assetV = Math.round(fs.statSync(path.join(__dirname, 'public', 'app.css')).mtimeMs).toString(36);
} catch {
  app.locals.assetV = Date.now().toString(36);
}

app.use(express.urlencoded({ extended: false, limit: '200kb' }));
app.use(session({
  store: new SqliteStore({ client: db, expired: { clear: true, intervalMs: 15 * 60 * 1000 } }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 864e5 },
}));
app.use(mw.flash);
app.use(mw.loadUser);
app.use(mw.csrf);
app.use((req, res, next) => {
  res.locals.s = getAll();
  res.locals.path = req.path;
  const isAdmin = req.user && req.user.role === 'admin';
  if (res.locals.s.maintenance_mode === '1' && !isAdmin && !['/login', '/logout'].includes(req.path)) {
    return res.status(503).render('message', { title: 'ปิดปรับปรุง', icon: '🛠️', heading: 'ปิดปรับปรุงชั่วคราว', msg: 'ขออภัยในความไม่สะดวก กรุณากลับมาใหม่ภายหลัง' });
  }
  next();
});

app.use(require('./src/routes/auth'));
app.use(require('./src/routes/shop'));
app.use('/admin', require('./src/routes/admin'));

app.use((req, res) => res.status(404).render('message', { title: '404', icon: '🔍', heading: 'ไม่พบหน้าที่ต้องการ', msg: 'ลิงก์อาจไม่ถูกต้องหรือถูกลบไปแล้ว' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('message', { title: 'Error', icon: '⚠️', heading: 'เกิดข้อผิดพลาด', msg: 'กรุณาลองใหม่อีกครั้ง' });
});

if (!db.prepare(`SELECT 1 FROM users WHERE role='admin'`).get()) {
  const u = process.env.ADMIN_USERNAME || 'admin';
  const p = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
  db.prepare(`INSERT INTO users (username, password_hash, role, created_at) VALUES (?,?, 'admin', ?)`)
    .run(u, bcrypt.hashSync(p, 10), Date.now());
  console.log(`✔ สร้างแอดมิน: ${u} / ${p}  (เปลี่ยนรหัสด่วน!)`);
}

startJobs();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => console.log(`🚀 http://${HOST}:${PORT}`));
