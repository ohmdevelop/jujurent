const ORDER_STATUS = {
  pending_review: { label: 'รอตรวจสอบ', cls: 'bg-amber-500/15 text-amber-300 ring-amber-500/30' },
  active:         { label: 'กำลังเช่า', cls: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30' },
  completed:      { label: 'หมดเวลาแล้ว', cls: 'bg-slate-500/15 text-slate-300 ring-slate-500/30' },
  rejected:       { label: 'ไม่อนุมัติ', cls: 'bg-rose-500/15 text-rose-300 ring-rose-500/30' },
  cancelled:      { label: 'ยกเลิก', cls: 'bg-slate-600/15 text-slate-400 ring-slate-600/30' },
};
const ACC_STATUS = {
  available:   { label: 'ว่าง', cls: 'bg-emerald-500/90 text-white ring-emerald-400/40' },
  reserved:    { label: 'มีคนจองแล้ว', cls: 'bg-amber-500/90 text-black ring-amber-400/40' },
  rented:      { label: 'ถูกเช่าอยู่', cls: 'bg-rose-500/90 text-white ring-rose-400/40' },
  maintenance: { label: 'ปิดปรับปรุง', cls: 'bg-slate-600/90 text-white ring-slate-400/40' },
};
const money = (n) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const dt = (ms) => (ms ? new Date(ms).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '-');

function calcPrice(pph, hours, s) {
  const sub = pph * hours;
  const pct = Number(s.discount_percent) || 0;
  const disc = pct > 0 && hours >= Number(s.discount_hours) ? Math.round(sub * pct) / 100 : 0;
  return { sub, disc, total: Math.round((sub - disc) * 100) / 100 };
}

function imageExt(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  return null;
}

module.exports = { ORDER_STATUS, ACC_STATUS, money, dt, calcPrice, imageExt };
