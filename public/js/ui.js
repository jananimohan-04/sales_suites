// Shared UI helpers: formatting, icons, toasts, modals, status chips.
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const P = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.5a3.5 3.5 0 010 7M18 14.4c2.2.6 3.5 2.4 3.5 5.6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
  map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0114 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  nav: '<path d="M3 11l18-8-8 18-2-8-8-2z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  bell: '<path d="M6 8a6 6 0 1112 0c0 7 3 8 3 8H3s3-1 3-8z"/><path d="M10.3 21a2 2 0 003.4 0"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 7l9 6 9-6"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"/>',
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  scan: '<path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3"/><circle cx="12" cy="11" r="3"/><path d="M6.5 18c.8-2.5 2.8-3.5 5.5-3.5s4.7 1 5.5 3.5"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5L16 9.5"/>',
  logout: '<path d="M9 4H5a1 1 0 00-1 1v14a1 1 0 001 1h4M16 8l4 4-4 4M20 12H9"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  route: '<circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H15a3.5 3.5 0 000-7H9a3.5 3.5 0 010-7h6.5"/>',
  building: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h2M13 8h2M9 12h2M13 12h2M10 21v-4h4v4"/>',
  hourglass: '<path d="M6 3h12M6 21h12M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M4 20h16"/>',
  refresh: '<path d="M20 11a8 8 0 10-2.3 6.3M20 4v7h-7"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18.5v.1"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".6"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 00-4-4L4 16z"/>',
  dots: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 018 0v3"/>',
  wifi: '<path d="M2 9a15 15 0 0120 0M5.5 12.5a10 10 0 0113 0M9 16a5 5 0 016 0M12 19.5v.1"/>',
};
export const icon = (n, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[n] || ''}</svg>`;

// ---- time formatting ----
const pad = (n) => String(n).padStart(2, '0');
export const fmtTime = (t) => (t ? new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—');
export const fmtTimeS = (t) => (t ? new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '—');
export const fmtDate = (t) => (t ? new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const fmtDateShort = (t) => new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' });
export const fmtWeekday = (t) => new Date(t).toLocaleDateString([], { weekday: 'short' });
export function fmtDur(sec) {
  if (sec == null || !Number.isFinite(sec)) return '—';
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${sec}s`;
}
export const fmtClock = (sec) => { sec = Math.max(0, Math.floor(sec)); return `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`; };
export const fmtDist = (m) => (m == null ? '—' : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
export const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return +x; };
export const ago = (t) => { const s = (Date.now() - t) / 1000; if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return fmtDateShort(t); };
export const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : 'Good Evening'; };
export const initials = (n = '') => n.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
const COLORS = ['#4f46e5', '#0ea5a4', '#db2777', '#ea7b0c', '#2563eb', '#7c3aed', '#16a34a', '#be123c'];
export const colorFor = (s = '') => COLORS[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
export const avatar = (u, cls = '') => `<div class="avatar ${cls}" style="background:${colorFor(u.name)}">${esc(initials(u.name))}</div>`;

// ---- status chips ----
const LIVE = {
  on_visit: ['green', 'On Visit', '🟢'], travelling: ['blue', 'Travelling', '🔵'], reached: ['orange', 'Reached Site', '🟠'],
  not_started: ['gray', 'Not Started', '⚪'], completed: ['teal', 'Completed', '✓'],
};
export const LIVE_COLOR = { on_visit: '#12a150', travelling: '#2563eb', reached: '#ea7b0c', not_started: '#8b8fa8', completed: '#0d9488' };
export const liveChip = (s) => { const [c, l] = LIVE[s] || LIVE.not_started; return `<span class="chip ${c}">${s === 'completed' ? icon('check') : '<span class="dot"></span>'}${l}</span>`; };
const INV = { invited: ['orange', 'Invited'], registered: ['blue', 'Registered'], face_registered: ['brand', 'Face Registered'], active: ['green', 'Active'], admin: ['green', 'Registered'] };
export const inviteChip = (s) => { const [c, l] = INV[s] || ['gray', s]; return `<span class="chip ${c}"><span class="dot"></span>${l}</span>`; };
const VS = { travelling: ['blue', 'Travelling'], at_site: ['orange', 'Reached Site'], active: ['green', 'On Visit'], completed: ['teal', 'Completed'], cancelled: ['gray', 'Cancelled'] };
export const visitChip = (s) => { const [c, l] = VS[s] || ['gray', s]; return `<span class="chip ${c}">${s === 'completed' ? icon('check') : '<span class="dot"></span>'}${l}</span>`; };
export const verifyChip = (v) => {
  if (v.end) return `<span class="chip green">${icon('shield')}Verified · Start &amp; End</span>`;
  if (v.verifiedStart) return `<span class="chip blue">${icon('shield')}Start verified</span>`;
  return `<span class="chip gray">Not verified</span>`;
};

// ---- feedback ----
export function toast(msg, type = 'info', title) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${icon(type === 'success' ? 'check' : type === 'error' ? 'alert' : 'bell')}<div>${title ? `<b>${esc(title)}</b>` : ''}${esc(msg)}</div>`;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, type === 'error' ? 5500 : 3800);
}

export function modal({ title, sub = '', body, footer = '', wide = false, onMount }) {
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.innerHTML = `<div class="modal" role="dialog" aria-modal="true" ${wide ? 'style="max-width:760px"' : ''}>
    <div class="modal-h"><div><h2>${esc(title)}</h2>${sub ? `<p class="muted" style="margin-top:4px">${esc(sub)}</p>` : ''}</div><button class="x" data-close aria-label="Close">${icon('x')}</button></div>
    <div class="modal-b">${body}</div>${footer ? `<div class="modal-f">${footer}</div>` : ''}</div>`;
  document.body.appendChild(scrim);
  const close = () => { scrim.remove(); document.removeEventListener('keydown', esc_); };
  const esc_ = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc_);
  scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) close(); });
  $$('[data-close]', scrim).forEach((b) => b.addEventListener('click', close));
  onMount && onMount(scrim, close);
  return { el: scrim, close };
}

export function confirmDialog({ title, text, confirm = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const m = modal({ title, body: `<p class="sub" style="padding-bottom:8px">${esc(text)}</p>`,
      footer: `<button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" id="cf-ok">${esc(confirm)}</button>`,
      onMount: (el) => $('#cf-ok', el).addEventListener('click', () => { resolve(true); el.remove(); }) });
    m.el.addEventListener('click', (e) => { if (e.target === m.el || e.target.closest('[data-close]')) resolve(false); });
  });
}

export async function withBusy(btn, fn) {
  const html = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spin"></span>`;
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = html; }
}

export const empty = (ic, title, text, action = '') => `<div class="empty"><div class="ill">${icon(ic)}</div><h3>${esc(title)}</h3><p>${esc(text)}</p>${action ? `<div style="margin-top:16px">${action}</div>` : ''}</div>`;
export const skeletonRows = (n = 5, h = 46) => Array.from({ length: n }, () => `<div class="skel" style="height:${h}px;margin-bottom:10px"></div>`).join('');
export const successCheck = (fail = false) => `<svg class="success-ring ${fail ? 'fail' : ''}" viewBox="0 0 108 108"><circle cx="54" cy="54" r="47"/><path d="${fail ? 'M38 38l32 32M70 38L38 70' : 'M32 56l15 15 29-32'}"/></svg>`;
export function confetti(host) {
  const c = document.createElement('div'); c.className = 'confetti';
  const cols = ['#4f46e5', '#7c3aed', '#12a150', '#ea7b0c', '#2563eb', '#db2777'];
  c.innerHTML = Array.from({ length: 36 }, () => `<i style="left:${Math.random() * 100}%;background:${cols[Math.floor(Math.random() * cols.length)]};animation-delay:${Math.random() * .5}s;animation-duration:${1.3 + Math.random()}s"></i>`).join('');
  host.appendChild(c); setTimeout(() => c.remove(), 3200);
}

export function formData(root) {
  const o = {}; $$('[name]', root).forEach((i) => { o[i.name] = i.value; }); return o;
}
export function fieldErr(root, name, msg) {
  const i = $(`[name="${name}"]`, root); if (!i) return;
  i.classList.toggle('err', !!msg);
  const f = i.closest('.field'); let e = $('.errmsg', f);
  if (msg) { if (!e) { e = document.createElement('div'); e.className = 'errmsg'; f.appendChild(e); } e.textContent = msg; } else if (e) e.remove();
}
export function download(filename, text, type = 'text/csv') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
