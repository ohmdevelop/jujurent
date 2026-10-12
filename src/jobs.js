const db = require('./db');
const { getAll } = require('./settings');
const discord = require('./discord');

const releaseStatus = () => (getAll().auto_maintenance_after_rent === '1' ? 'maintenance' : 'available');

function tick() {
  const expired = db.prepare(`SELECT id, code, account_id, ticket_channel_id, discord_msg_id
    FROM orders WHERE status='active' AND end_at <= ?`).all(Date.now());
  if (!expired.length) return;
  const st = releaseStatus();
  db.transaction(() => {
    for (const o of expired) {
      db.prepare(`UPDATE orders SET status='completed' WHERE id=?`).run(o.id);
      db.prepare(`UPDATE accounts SET status=? WHERE id=? AND status='rented'`).run(st, o.account_id);
    }
  })();
  expired.forEach(discord.expire);
  console.log(`⏱ ปิดการเช่าที่หมดเวลา ${expired.length} รายการ`);
}

exports.releaseStatus = releaseStatus;
exports.startJobs = () => { tick(); setInterval(tick, 15000); };
