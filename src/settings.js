const db = require('./db');

const SCHEMA = [
  { group: 'ทั่วไป', key: 'site_name', label: 'ชื่อเว็บไซต์', type: 'text', def: 'VALO RENT' },
  { group: 'ทั่วไป', key: 'site_tagline', label: 'คำโปรย', type: 'text', def: 'เช่าไอดี Valorant แรงค์สูง สกินเพียบ ได้รหัสไว ปลอดภัย' },
  { group: 'ทั่วไป', key: 'primary_color', label: 'สีหลักของเว็บ', type: 'color', def: '#ff4655' },
  { group: 'ทั่วไป', key: 'announcement', label: 'ประกาศแถบบนสุด', type: 'textarea', def: '', hint: 'เว้นว่าง = ไม่แสดง' },
  { group: 'ทั่วไป', key: 'maintenance_mode', label: 'ปิดปรับปรุงเว็บ', type: 'bool', def: '0', hint: 'แอดมินยังเข้าได้ตามปกติ' },
  { group: 'ทั่วไป', key: 'allow_register', label: 'เปิดรับสมัครสมาชิก', type: 'bool', def: '1' },
  { group: 'การชำระเงิน', key: 'promptpay_id', label: 'พร้อมเพย์ (เบอร์/เลขบัตร)', type: 'text', def: '', hint: 'ใส่แล้วจะสร้าง QR ที่ใส่ยอดเงินให้อัตโนมัติ' },
  { group: 'การชำระเงิน', key: 'bank_name', label: 'ธนาคาร', type: 'text', def: 'กสิกรไทย' },
  { group: 'การชำระเงิน', key: 'bank_account_no', label: 'เลขบัญชี', type: 'text', def: '' },
  { group: 'การชำระเงิน', key: 'bank_account_name', label: 'ชื่อบัญชี', type: 'text', def: '' },
  { group: 'การชำระเงิน', key: 'max_slip_mb', label: 'ขนาดสลิปสูงสุด (MB)', type: 'number', def: '5', min: 1, max: 20 },
  { group: 'การชำระเงิน', key: 'payment_note', label: 'หมายเหตุการโอน', type: 'textarea', def: 'กรุณาโอนตามยอดที่แสดงเท่านั้น ยอดไม่ตรงจะไม่อนุมัติ' },
  { group: 'การเช่า', key: 'min_hours', label: 'เช่าขั้นต่ำ (ชม.)', type: 'number', def: '1', min: 1 },
  { group: 'การเช่า', key: 'max_hours', label: 'เช่าสูงสุด (ชม.)', type: 'number', def: '72', min: 1 },
  { group: 'การเช่า', key: 'quick_hours', label: 'ปุ่มเลือกชั่วโมงด่วน', type: 'text', def: '1,2,3,5,10,24', hint: 'คั่นด้วย ,' },
  { group: 'การเช่า', key: 'max_active_per_user', label: 'ออเดอร์ค้าง/กำลังเช่าสูงสุดต่อคน', type: 'number', def: '2', min: 1 },
  { group: 'การเช่า', key: 'discount_hours', label: 'ส่วนลดเมื่อเช่าตั้งแต่ (ชม.)', type: 'number', def: '10', min: 1 },
  { group: 'การเช่า', key: 'discount_percent', label: 'ส่วนลด (%)', type: 'number', def: '0', min: 0, max: 100, hint: '0 = ไม่มีส่วนลด' },
  { group: 'การเช่า', key: 'allow_user_cancel', label: 'ให้ลูกค้ายกเลิกออเดอร์ที่รอตรวจได้', type: 'bool', def: '1' },
  { group: 'การเช่า', key: 'auto_maintenance_after_rent', label: 'หมดเวลาแล้วปิดไอดีอัตโนมัติ', type: 'bool', def: '1', hint: 'แนะนำ: เปลี่ยนรหัสก่อนเปิดให้เช่าต่อ' },
  { group: 'การเช่า', key: 'rank_list', label: 'รายชื่อแรงค์ (ใช้ในตัวกรอง)', type: 'textarea', def: 'Iron,Bronze,Silver,Gold,Platinum,Diamond,Ascendant,Immortal,Radiant' },
  { group: 'การเช่า', key: 'rules', label: 'กติกาการเช่า', type: 'textarea', rows: 8, def: `1. ห้ามเปลี่ยนรหัสผ่าน อีเมล หรือข้อมูลใดๆ ของไอดีโดยเด็ดขาด\n2. ห้ามใช้โปรแกรมโกง หรือพฤติกรรมที่ทำให้ไอดีถูกแบน\n3. ห้ามซื้อสินค้าหรือใช้ VP / Radianite ในไอดี\n4. เวลาเช่าเริ่มนับเมื่อแอดมินอนุมัติ และนับต่อเนื่องแม้ออฟไลน์\n5. ได้รับรหัสแล้วไม่คืนเงินทุกกรณี\n6. หากฝ่าฝืน ร้านขอสงวนสิทธิ์ยุติการเช่าและแบนบัญชีทันที` },
  { group: 'ช่องทางติดต่อ', key: 'contact_line', label: 'LINE ID', type: 'text', def: '' },
  { group: 'ช่องทางติดต่อ', key: 'contact_facebook', label: 'ลิงก์ Facebook', type: 'text', def: '' },
  { group: 'ช่องทางติดต่อ', key: 'contact_discord', label: 'ลิงก์ Discord', type: 'text', def: '' },
  { group: 'แจ้งเตือน', key: 'site_url', label: 'URL ของเว็บ', type: 'text', def: '', hint: 'เช่น https://valorent.com ใช้ทำลิงก์ในข้อความแจ้งเตือน' },
  { group: 'แจ้งเตือน', key: 'notify_discord', label: 'แจ้งเตือนผ่าน Discord', type: 'bool', def: '0' },
  { group: 'แจ้งเตือน', key: 'discord_webhook_url', label: 'Discord Webhook URL', type: 'password', def: '' },
  { group: 'แจ้งเตือน', key: 'discord_mention', label: 'แท็กตอนแจ้งเตือน', type: 'text', def: '', hint: 'เช่น @here หรือ <@&ROLE_ID> เว้นว่าง = ไม่แท็ก' },
  { group: 'แจ้งเตือน', key: 'notify_line', label: 'แจ้งเตือนผ่าน LINE OA', type: 'bool', def: '0' },
  { group: 'แจ้งเตือน', key: 'line_channel_token', label: 'LINE Channel Access Token', type: 'password', def: '' },
  { group: 'แจ้งเตือน', key: 'line_to', label: 'LINE User ID ผู้รับ', type: 'text', def: '', hint: 'ขึ้นต้นด้วย U… ถ้ามีหลายคนให้คั่นด้วย ,' },
  { group: 'แจ้งเตือน', key: 'notify_on_cancel', label: 'แจ้งเตือนเมื่อลูกค้ายกเลิกออเดอร์', type: 'bool', def: '1' },
  { group: 'Discord ส่งรหัส', key: 'discord_delivery', label: 'ส่งรหัสไอดีผ่าน Discord ticket', type: 'bool', def: '0', hint: 'ตั้งค่าบอทด้านล่างให้ครบและกดทดสอบก่อนเปิด' },
  { group: 'Discord ส่งรหัส', key: 'show_creds_on_web', label: 'แสดงรหัสบนหน้าประวัติด้วย', type: 'bool', def: '0', hint: 'ปิด = ลูกค้าเห็นรหัสใน Discord เท่านั้น' },
  { group: 'Discord ส่งรหัส', key: 'discord_bot_token', label: 'Bot Token', type: 'password', def: '', hint: 'หรือใส่ DISCORD_BOT_TOKEN ใน .env' },
  { group: 'Discord ส่งรหัส', key: 'discord_guild_id', label: 'Server ID', type: 'text', def: '' },
  { group: 'Discord ส่งรหัส', key: 'discord_ticket_categories', label: 'Category ID ของห้อง ticket', type: 'text', def: '', hint: 'ส่งรหัสได้เฉพาะห้องในหมวดนี้ ถ้ามีหลายหมวดให้คั่นด้วย ,' },
  { group: 'Discord ส่งรหัส', key: 'discord_invite_url', label: 'ลิงก์เชิญเข้าเซิร์ฟเวอร์', type: 'text', def: '', hint: 'เช่น https://discord.gg/xxxx' },
  { group: 'Discord ส่งรหัส', key: 'ticket_instructions', label: 'วิธีเปิด ticket (แสดงในหน้าเช่า)', type: 'textarea', rows: 5, def: `1. กดปุ่มด้านล่างเพื่อเข้าเซิร์ฟเวอร์ Discord ของร้าน\n2. ไปที่ห้อง #เปิด-ticket แล้วกดปุ่มเปิด ticket\n3. คัดลอกชื่อห้อง ticket ของคุณ (เช่น ticket-0123) มาใส่ช่องด้านล่าง แล้วกด "ส่งรหัสยืนยัน"\n4. บอทจะส่งรหัส 6 หลักเข้า ticket ให้นำมากรอกเพื่อยืนยัน\n5. กรุณาอย่าปิด ticket จนกว่าจะหมดเวลาเช่า` },
  { group: 'AnyDesk Remote Login', key: 'anydesk_delivery', label: 'ใช้ AnyDesk Remote Login', type: 'bool', def: '0', hint: 'แอดมิน remote เข้าเครื่องลูกค้าเพื่อ login ให้ ลูกค้าไม่รู้รหัส' },
  { group: 'AnyDesk Remote Login', key: 'anydesk_instructions', label: 'คำแนะนำสำหรับลูกค้า', type: 'textarea', rows: 6, def: `1. ดาวน์โหลดและติดตั้ง AnyDesk จาก https://anydesk.com/th\n2. เปิดโปรแกรม AnyDesk แล้วคัดลอกหมายเลข AnyDesk ของคุณ (9 หลัก)\n3. เปิดเกม Valorant แล้วไปที่หน้า Login\n4. คลิก "Continue with QR Code" เพื่อแสดง QR Code\n5. รอแอดมิน remote เข้ามาสแกน QR Code ให้ (ประมาณ 5-10 นาที)\n6. อย่าปิด AnyDesk และหน้าเกมจนกว่าแอดมินจะแจ้งว่าเสร็จสิ้น` },
  { group: 'AnyDesk Remote Login', key: 'anydesk_wait_time', label: 'เวลารอ Remote สูงสุด (นาที)', type: 'number', def: '30', min: 10, max: 120, hint: 'เกินเวลานี้จะยกเลิกออเดอร์อัตโนมัติ' },
];

let cache = null;
function getAll() {
  if (cache) return cache;
  const map = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));
  cache = {};
  for (const f of SCHEMA) cache[f.key] = map[f.key] ?? f.def;
  return cache;
}
function saveAll(obj) {
  const st = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  db.transaction(() => { for (const [k, v] of Object.entries(obj)) st.run(k, String(v)); })();
  cache = null;
}
module.exports = { SCHEMA, getAll, saveAll };
