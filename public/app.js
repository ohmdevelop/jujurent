const toast = document.getElementById('toast');
if (toast) setTimeout(() => { toast.style.transition = 'opacity .4s'; toast.style.opacity = '0'; setTimeout(() => toast.remove(), 400); }, 4500);

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-copy]');
  if (!b) return;
  navigator.clipboard.writeText(b.dataset.copy).then(() => {
    const old = b.innerHTML; b.innerHTML = '✓ คัดลอกแล้ว'; setTimeout(() => (b.innerHTML = old), 1200);
  });
});

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-reveal]');
  if (!b) return;
  const el = document.getElementById(b.dataset.reveal);
  const show = el.dataset.hidden !== '0';
  el.textContent = show ? el.dataset.value : '••••••••';
  el.dataset.hidden = show ? '0' : '1';
});

const pad = (n) => String(n).padStart(2, '0');
function tick() {
  const now = Date.now() + (window.__skew || 0);
  document.querySelectorAll('[data-end]').forEach((el) => {
    const end = +el.dataset.end, start = +el.dataset.start || 0, left = end - now;
    if (left <= 0) {
      el.textContent = 'หมดเวลา';
      if (!el.dataset.done) { el.dataset.done = 1; setTimeout(() => location.reload(), 2000); }
      return;
    }
    const h = Math.floor(left / 3600000), m = Math.floor((left % 3600000) / 60000), s = Math.floor((left % 60000) / 1000);
    el.textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
    const bar = el.id && document.querySelector(`[data-bar="${el.id}"]`);
    if (bar && start) bar.style.width = Math.max(0, Math.min(100, (left / (end - start)) * 100)) + '%';
  });
}
tick(); setInterval(tick, 1000);
