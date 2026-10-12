const crypto = require('crypto');
const KEY = Buffer.from(process.env.ENC_KEY || '', 'hex');
if (KEY.length !== 32) throw new Error('ENC_KEY ต้องเป็น hex 64 ตัวอักษร (32 bytes)');

exports.encrypt = (text) => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
};

exports.decrypt = (payload) => {
  const [iv, tag, enc] = payload.split('.').map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
};
