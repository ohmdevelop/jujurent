const path = require('path');
const { getAll } = require('./settings');

const TIMEOUT = 8000;
const MIME = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const MAX_DISCORD_FILE = 8 * 1024 * 1024;

const baseUrl = (s) => (s.site_url || '').trim().replace(/\/+$/, '');
const colorOf = (hex) => parseInt(String(hex || '#ff4655').slice(1), 16) || 0xff4655;

async function check(r, name) {
  if (!r.ok) throw new Error(`${name} ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

async function toDiscord(s, msg, link) {
  if (s.notify_discord !== '1' || !s.discord_webhook_url) return false;
  const embed = {
    title: msg.title,
    url: link || undefined,
    color: msg.color ?? colorOf(s.primary_color),
    fields: (msg.fields || []).map(([name, value]) => ({ name, value: String(value).slice(0, 1024), inline: true })),
    timestamp: new Date().toISOString(),
    footer: { text: s.site_name },
  };
  const payload = { username: s.site_name, content: s.discord_mention || undefined, embeds: [embed] };
  const opts = { method: 'POST', signal: AbortSignal.timeout(TIMEOUT) };

  const img = msg.image;
  if (img && img.buffer.length <= MAX_DISCORD_FILE) {
    embed.image = { url: `attachment://${img.name}` };
    const form = new FormData();
    form.append('payload_json', JSON.stringify(payload));
    form.append('files[0]', new Blob([img.buffer], { type: MIME[path.extname(img.name)] || 'application/octet-stream' }), img.name);
    opts.body = form;
  } else {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(payload);
  }
  await check(await fetch(s.discord_webhook_url, opts), 'Discord');
  return true;
}

async function toLine(s, msg, link) {
  if (s.notify_line !== '1' || !s.line_channel_token || !s.line_to) return false;
  const text = [msg.title, ...(msg.fields || []).map(([k, v]) => `${k}: ${v}`), link]
    .filter(Boolean).join('\n').slice(0, 4900);
  const ids = s.line_to.split(',').map((x) => x.trim()).filter(Boolean);
  await Promise.all(ids.map(async (to) => {
    const r = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.line_channel_token}` },
      body: JSON.stringify({ to, messages: [{ type: 'text', text }] }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    await check(r, 'LINE');
  }));
  return true;
}

async function send(msg) {
  try {
    const s = getAll();
    const link = msg.path && baseUrl(s) ? baseUrl(s) + msg.path : '';
    const results = await Promise.allSettled([toDiscord(s, msg, link), toLine(s, msg, link)]);
    const errors = results.filter((r) => r.status === 'rejected').map((r) => r.reason?.message || String(r.reason));
    errors.forEach((e) => console.error('[notify]', e));
    return { sent: results.filter((r) => r.value === true).length, errors };
  } catch (e) {
    console.error('[notify]', e);
    return { sent: 0, errors: [e.message] };
  }
}

module.exports = { send };
