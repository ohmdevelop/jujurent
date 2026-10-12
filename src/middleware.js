const crypto = require('crypto');
const multer = require('multer');
const db = require('./db');

exports.flash = (req, res, next) => {
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  req.flash = (type, msg) => { req.session.flash = { type, msg }; };
  next();
};

exports.loadUser = (req, res, next) => {
  if (req.session.uid) {
    const u = db.prepare('SELECT id, username, role, banned FROM users WHERE id = ?').get(req.session.uid);
    if (u && !u.banned) req.user = u;
    else delete req.session.uid;
  }
  res.locals.user = req.user || null;
  next();
};

exports.csrf = (req, res, next) => {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrf = req.session.csrf;
  if (req.method === 'POST') {
    const token = (req.body && req.body._csrf) || req.query._csrf || req.get('x-csrf-token');
    if (token !== req.session.csrf) return res.status(403).send('CSRF token ไม่ถูกต้อง กรุณารีเฟรชหน้าแล้วลองใหม่');
  }
  next();
};

exports.requireLogin = (req, res, next) => {
  if (req.user) return next();
  req.flash('error', 'กรุณาเข้าสู่ระบบก่อน');
  res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
};

exports.requireAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') return next();
  res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
};

exports.imageUpload = (field, getMb) => (req, res, next) => {
  const mb = Number(getMb()) || 5;
  multer({ storage: multer.memoryStorage(), limits: { fileSize: mb * 1024 * 1024, files: 1, fields: 50 } })
    .single(field)(req, res, (err) => {
      if (err) req.uploadError = err.code === 'LIMIT_FILE_SIZE' ? `ไฟล์ใหญ่เกิน ${mb}MB` : 'อัปโหลดไฟล์ไม่สำเร็จ';
      next();
    });
};
