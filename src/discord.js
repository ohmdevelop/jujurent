const { getAll } = require('./settings');

const API = 'https://discord.com/api/v10';
const FRIENDLY = {
  401: 'Discord Bot Token ไม่ถูกต้อง',
  403: 'บอทไม่มีสิทธิ์เข้าห้องนี้ (กรุณาแจ้งแอดมินให้ตรวจสิทธิ์บอทในหมวด ticket)',
  404: 'ไม่พบห้องหรือข้อความ (ticket อาจถูกปิดหรือลบไปแล้ว)',
};

async function api(method, route, body, retry = true) {
  const token = process.env.DISCORD_BOT_TOKEN || getAll().discord_bot_token;
  if (!token) throw new Error('ร้านยังไม่ได้ตั้งค่า Discord Bot Token');
  const r = await fetch(API + route, {
    method,
    headers: { Authorization: `Bot ${token}`, ...(body && { 'Content-Type': 'application/json' }) },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (r.status === 429 && retry) {
    const j = await r.json().catch(() => ({}));
    await new Promise((ok) => setTimeout(ok, Math.min(5000, (j.retry_after || 1) * 1000)));
    return api(method, route, body, false);
  }
  if (r.status === 204) return null;
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(FRIENDLY[r.status] || `Discord ${r.status}: ${data?.message || 'unknown error'}`);
  return data;
}

const ticketCategories = () => getAll().discord_ticket_categories.split(',').map((x) => x.trim()).filter(Boolean);

async function resolveTicket(input) {
  const s = getAll();
  const cats = ticketCategories();
  if (!s.discord_guild_id || !cats.length) throw new Error('ร้านยังไม่ได้ตั้งค่า Discord (Server ID / หมวด ticket)');
  const raw = String(input || '').trim();
  if (!raw) throw new Error('กรุณาใส่ชื่อห้อง ticket');

  const isTicket = (ch) => ch && ch.type === 0 && ch.guild_id === s.discord_guild_id && cats.includes(ch.parent_id);

  const m = raw.match(/channels\/\d+\/(\d{17,20})/) || raw.match(/^<?#?(\d{17,20})>?$/);
  if (m) {
    const ch = await api('GET', `/channels/${m[1]}`).catch(() => null);
    if (!isTicket(ch)) throw new Error('ไม่พบห้องนี้ในหมวด ticket ของร้าน');
    return ch;
  }

  const name = raw.toLowerCase().replace(/^#/, '').replace(/\s+/g, '-');
  const list = (await api('GET', `/guilds/${s.discord_guild_id}/channels`))
    .map((ch) => ({ ...ch, guild_id: s.discord_guild_id }))
    .filter(isTicket);
  let found = list.filter((ch) => ch.name === name);
  if (!found.length && name.length >= 3) found = list.filter((ch) => ch.name.endsWith(name));
  if (!found.length) throw new Error(`ไม่พบห้อง "${name}" ในหมวด ticket (ตรวจชื่อให้ตรง หรือวางลิงก์ห้องแทน)`);
  if (found.length > 1) throw new Error('พบหลายห้องที่ชื่อคล้ายกัน กรุณาวางลิงก์ห้องแทน (คลิกขวาที่ห้อง > คัดลอกลิงก์)');
  return found[0];
}

const send = (channelId, payload) => api('POST', `/channels/${channelId}/messages`, { allowed_mentions: { parse: [] }, ...payload });
const edit = (channelId, msgId, payload) => api('PATCH', `/channels/${channelId}/messages/${msgId}`, payload);
const remove = (channelId, msgId) => api('DELETE', `/channels/${channelId}/messages/${msgId}`);

const color = () => parseInt(String(getAll().primary_color).slice(1), 16) || 0xff4655;
const block = (v) => '```\n' + String(v).replace(/```/g, '`\u200b``') + '\n```';
const ts = (ms, f) => `<t:${Math.floor(ms / 1000)}:${f}>`;

const msg = {
  verify: (code, username) => ({
    content: `🔐 **รหัสยืนยันจากเว็บ ${getAll().site_name}**`,
    embeds: [{
      color: color(),
      description: `ผู้ใช้เว็บ **${username}** ขอเชื่อมห้องนี้เพื่อรับรหัสไอดี\n\n# ${code}\n\nนำรหัสนี้ไปกรอกบนหน้าเว็บภายใน 10 นาที\n*ถ้าคุณไม่ได้ขอรหัสนี้ ไม่ต้องสนใจข้อความนี้*`,
    }],
  }),
  linked: (username) => ({
    content: `✅ เชื่อมห้องนี้กับบัญชีเว็บ **${username}** แล้ว\nรหัสไอดีจะถูกส่งมาที่ห้องนี้หลังแอดมินอนุมัติสลิป **กรุณาอย่าปิด ticket จนกว่าจะหมดเวลาเช่า**`,
    embeds: [],
  }),
  creds: (o, c) => ({
    content: '🎮 **รหัสไอดีของคุณพร้อมใช้งานแล้ว**',
    embeds: [{
      title: `ออเดอร์ #${o.code} · ${o.title}`,
      color: color(),
      fields: [
        { name: 'Username', value: block(c.user) },
        { name: 'Password', value: block(c.pass) },
        { name: 'เริ่มเช่า', value: ts(o.start_at, 'f'), inline: true },
        { name: 'หมดเวลา', value: `${ts(o.end_at, 'f')}\n(${ts(o.end_at, 'R')})`, inline: true },
      ],
      footer: { text: `⚠️ ห้ามเปลี่ยนรหัสผ่าน อีเมล หรือข้อมูลใดๆ ของไอดี · ${getAll().site_name}` },
    }],
  }),
  expired: (o) => ({
    content: '⌛ **หมดเวลาเช่าแล้ว**',
    embeds: [{ title: `ออเดอร์ #${o.code}`, color: 0x64748b, description: 'ลบรหัสออกจากข้อความนี้แล้ว ขอบคุณที่ใช้บริการ 🙏' }],
  }),
  rejected: (o, reason) => ({
    content: '❌ **ออเดอร์ไม่ผ่านการตรวจสอบ**',
    embeds: [{ title: `ออเดอร์ #${o.code}`, color: 0xe11d48, description: `เหตุผล: ${reason || 'ไม่ระบุ'}\nหากโอนเงินแล้ว กรุณาแจ้งแอดมินในห้องนี้` }],
  }),
};

function expire(o) {
  if (!o.ticket_channel_id || !o.discord_msg_id) return;
  edit(o.ticket_channel_id, o.discord_msg_id, msg.expired(o)).catch((e) => console.error('[discord]', e.message));
}

module.exports = { api, resolveTicket, send, edit, remove, expire, msg, ticketCategories };
