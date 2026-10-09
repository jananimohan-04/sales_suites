import { get, post, put, patch, del, session, setToken } from './api.js';
import { $, $$, esc, icon, toast, modal, confirmDialog, withBusy, fmtTime, fmtDur, fmtClock, fmtDist, fmtDate, fmtDateShort, fmtWeekday, ago,
  startOfDay, avatar, liveChip, inviteChip, visitChip, verifyChip, empty, skeletonRows, formData, fieldErr, download, csvCell, LIVE_COLOR, colorFor, initials } from './ui.js';
import { createMap, personMarker, siteMarker, geofence, routeLine, dotMarker, fit, haversine } from './map.js';
import { meetingBlock, mountPhotos } from './extras.js';

const NAV = [['dashboard', 'grid', 'Dashboard'], ['live', 'map', 'Live Tracking'], ['employees', 'users', 'Employees'], ['visits', 'clock', 'Visits'], ['reports', 'chart', 'Reports'], ['settings', 'cog', 'Settings']];
const TITLES = { dashboard: 'Dashboard', live: 'Live Tracking', employees: 'Sales Employees', employee: 'Employee Details', visits: 'Visit History', visit: 'Visit Details', reports: 'Reports', settings: 'Settings', invite: 'Sales Employees' };
const NOTE_ICON = { invite_sent: ['send', 'brand'], registration: ['user', 'blue'], site_photo: ['camera', 'teal'], face_registered: ['scan', 'brand'], travel_started: ['nav', 'blue'], reached_site: ['flag', 'orange'], visit_started: ['check', 'green'], visit_completed: ['shield', 'teal'], face_failed: ['alert', 'red'] };
const cityOf = (a = '') => a.split(',').pop().trim() || '—';
const EXTRA = { blue: 'var(--blue-soft)', orange: 'var(--orange-soft)', green: 'var(--green-soft)', brand: 'var(--brand-soft)', teal: 'var(--teal-soft)', red: 'var(--red-soft)' };
const FG = { blue: 'var(--blue)', orange: 'var(--orange)', green: 'var(--green)', brand: 'var(--brand)', teal: 'var(--teal)', red: 'var(--red)' };

/* ============================ shell ============================ */
let notif = { list: [], seen: 0, first: true, timer: null };

export async function adminRoute(root, parts) {
  const [page, a] = parts.length ? parts : ['dashboard'];
  if (!$('.admin', root)) buildShell(root);
  $$('.nav a', root).forEach((l) => l.classList.toggle('on', l.dataset.k === (page === 'employee' || page === 'invite' ? 'employees' : page === 'visit' ? 'visits' : page)));
  $('#ptitle', root).textContent = TITLES[page] || 'Dashboard';
  const host = $('#page', root);
  host.className = 'page'; void host.offsetWidth;
  const ctx = { host, root };
  const fn = { dashboard, live, employees, employee, visits, visit, reports, settings, invite: (c) => employees(c, true) }[page] || dashboard;
  host.innerHTML = '';
  return fn(ctx, a);
}

function buildShell(root) {
  const u = session.user;
  root.innerHTML = `<div class="admin"><aside class="side"><div class="lockup"><div class="logo">${icon('pin')}</div><span>${esc(session.config.orgName)}</span></div>
    <nav class="nav">${NAV.map(([k, i, l]) => `<a href="#/a/${k}" data-k="${k}">${icon(i)}<span>${l}</span></a>`).join('')}</nav>
    <div class="foot"><div class="row">${avatar(u)}<div class="grow"><b style="display:block;font-size:13px">${esc(u.name)}</b><span class="muted" style="font-size:12px">Administrator</span></div><button class="x" id="out" title="Sign out">${icon('logout')}</button></div></div></aside>
    <div class="main"><header class="top"><h2 id="ptitle" class="grow"></h2><span class="livedot hide" id="lv"><i></i>Live</span>
      <div style="position:relative"><button class="iconbtn" id="bell" aria-label="Notifications">${icon('bell')}<span class="badge hide" id="bn">0</span></button><div class="pop hide" id="np"></div></div></header>
      <main id="page" class="page"></main></div></div>`;
  $('#out', root).addEventListener('click', () => { setToken(null); session.user = null; clearInterval(notif.timer); location.hash = '#/login'; });
  $('#bell', root).addEventListener('click', (e) => { e.stopPropagation(); const p = $('#np', root); p.classList.toggle('hide'); if (!p.classList.contains('hide')) { notif.seen = Date.now(); renderNotifs(); updateBadge(); } });
  document.addEventListener('click', (e) => { const p = $('#np'); if (p && !e.target.closest('#np')) p.classList.add('hide'); });
  try { notif.seen = +localStorage.getItem('argus.seen') || 0; } catch { notif.seen = 0; }
  notif.first = true; clearInterval(notif.timer);
  pollNotifs(); notif.timer = setInterval(() => { if (!$('.admin')) return clearInterval(notif.timer); pollNotifs(); }, 6000);
}

async function pollNotifs() {
  try {
    const { notifications } = await get('/admin/notifications');
    if (!notif.first) {
      const known = new Set(notif.list.map((n) => n.id));
      notifications.filter((n) => !known.has(n.id)).reverse().forEach((n) => toast(n.body, n.type === 'face_failed' ? 'error' : 'info', n.title));
    }
    notif.list = notifications; notif.first = false; updateBadge();
    if (!$('#np').classList.contains('hide')) renderNotifs();
  } catch { /* offline */ }
}
function updateBadge() {
  const c = notif.list.filter((n) => n.at > notif.seen).length, b = $('#bn');
  if (!b) return; b.textContent = c > 9 ? '9+' : c; b.classList.toggle('hide', !c);
  try { if (!$('#np').classList.contains('hide')) localStorage.setItem('argus.seen', String(Date.now())); } catch { /* ignore */ }
}
function feedHtml(list) {
  return list.length ? `<div class="feed">${list.map((n) => { const [ic, c] = NOTE_ICON[n.type] || ['bell', 'brand']; return `<div class="it"><div class="ic" style="background:${EXTRA[c]};color:${FG[c]}">${icon(ic)}</div><div class="grow"><b style="font-size:13.5px">${esc(n.title)}</b><div class="sub" style="font-size:13px">${esc(n.body)}</div><small>${ago(n.at)}</small></div></div>`; }).join('')}</div>` : empty('bell', 'All quiet', 'Activity will show up here.');
}
function renderNotifs() { const p = $('#np'); p.innerHTML = `<div class="row between" style="padding:6px 0 4px"><h3>Notifications</h3><span class="muted" style="font-size:12px">${notif.list.length} recent</span></div>${feedHtml(notif.list.slice(0, 25))}`; }

const setLive = (on) => { const l = $('#lv'); l && l.classList.toggle('hide', !on); };
const poll = (fn, ms) => { const t = setInterval(() => { if (document.visibilityState === 'visible') fn().catch(() => {}); }, ms); return () => clearInterval(t); };
const tickers = (fn) => { const t = setInterval(fn, 1000); return () => clearInterval(t); };

/* ============================ dashboard ============================ */
async function dashboard({ host }) {
  host.innerHTML = `<div class="page-h"><div><h1>Field overview</h1><p>${new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })} · who’s where, and who’s really on site</p></div>
    <a class="btn primary" href="#/a/employees">${icon('plus')} Invite employee</a></div>
    <div class="kpis">${Array.from({ length: 6 }, () => '<div class="card kpi"><div class="skel" style="height:90px"></div></div>').join('')}</div>
    <div class="grid-2"><div class="card"><div class="skel" style="height:300px"></div></div><div class="card"><div class="skel" style="height:300px"></div></div></div>`;
  let chartKey = 'visits', summary, mini, minLayers = [];
  const stops = [];

  const KPI = (k, ic, color, v, l, s = '') => `<div class="card kpi"><div class="ic" style="background:${EXTRA[color]};color:${FG[color]}">${icon(ic)}</div><div class="v">${v}</div><div class="l">${l}</div><div class="s">${s}</div></div>`;
  const rank = { on_visit: 0, reached: 1, travelling: 2, completed: 3, not_started: 4 };

  const sortedLive = () => summary.live.slice().sort((a, b) => rank[a.state] - rank[b.state]);
  const kpiHtml = (k) => `
        ${KPI('t', 'users', 'brand', k.totalEmployees, 'Total Sales Employees')}
        ${KPI('a', 'shield', 'teal', k.activeEmployees, 'Active Employees', 'face registered & visiting')}
        ${KPI('o', 'pin', 'green', k.onVisit, 'Currently On Visit', 'face-verified on site')}
        ${KPI('v', 'calendar', 'blue', k.visitsToday, 'Visits Today')}
        ${KPI('c', 'check', 'orange', k.completedToday, 'Completed Visits', 'today')}
        ${KPI('h', 'hourglass', 'brand', `${k.visitHoursToday.toFixed(1)}<span style="font-size:15px;color:var(--ink-3)"> h</span>`, 'Total Visit Hours', 'official on-site time')}`;
  const liveBody = (live) => live.length ? live.map((r) => liveRow(r)).join('') : `<tr><td colspan="6">${empty('users', 'No employees yet', 'Invite your sales team to get started.')}</td></tr>`;
  const barsHtml = () => { const maxV = Math.max(1, ...summary.days.map((d) => d[chartKey])); return summary.days.map((d, i) => `<div class="bar"><span class="val">${chartKey === 'hours' ? d.hours.toFixed(1) : d.visits}</span><div class="fill ${i === 6 ? 'today' : ''}" style="height:${Math.max(3, (d[chartKey] / maxV) * 100)}%"></div><span class="lab">${i === 6 ? 'Today' : fmtWeekday(d.date)}</span></div>`).join(''); };
  const bindRows = () => $$('tr[data-id]', host).forEach((tr) => tr.addEventListener('click', () => { location.hash = `#/a/employee/${tr.dataset.id}`; }));

  function draw() {
    const k = summary.kpi, live = sortedLive();
    host.innerHTML = `<div class="page-h"><div><h1>Field overview</h1><p>${new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })} · who’s where, and who’s really on site</p></div>
      <div class="row"><span class="livedot"><i></i>Live</span><a class="btn primary" href="#/a/invite">${icon('plus')} Invite employee</a></div></div>
      <div class="kpis">${kpiHtml(k)}</div>
      <div class="grid-2"><div class="card"><div class="card-h"><div><h2>Live field team</h2><p class="muted" style="font-size:13px">Updates every few seconds</p></div><a class="btn sm" href="#/a/live">${icon('map')} Open map</a></div>
        <div class="table-wrap"><table class="t"><thead><tr><th>Employee</th><th>Status</th><th>Location</th><th>Site</th><th>Start</th><th>Duration</th></tr></thead><tbody id="livebody">${liveBody(live)}</tbody></table></div></div>
        <div class="card"><div class="card-h"><div><h2>Last 7 days</h2><p class="muted" style="font-size:13px">Completed, face-verified visits</p></div>
          <div class="seg" id="seg"><button data-k="visits" class="${chartKey === 'visits' ? 'on' : ''}">Visits</button><button data-k="hours" class="${chartKey === 'hours' ? 'on' : ''}">Hours</button></div></div>
          <div class="bars" id="bars">${barsHtml()}</div></div></div>
      <div class="grid-2"><div class="card"><div class="card-h"><h2>Field map</h2><div class="legend">${[['on_visit', 'On visit'], ['reached', 'Reached'], ['travelling', 'Travelling']].map(([s, l]) => `<span><i style="background:${LIVE_COLOR[s]}"></i>${l}</span>`).join('')}</div></div><div style="height:320px"><div id="mini" class="map"></div></div></div>
        <div class="card"><div class="card-h"><h2>Recent activity</h2></div><div id="feed">${feedHtml(notif.list.slice(0, 6))}</div></div></div>`;
    $$('#seg button', host).forEach((b) => b.addEventListener('click', () => { chartKey = b.dataset.k; draw(); }));
    bindRows();
    mini = null; paintMini(live);
  }
  function liveRow(r) {
    const v = r.visit, loc = !v ? '—' : r.state === 'travelling' && v.lastLocation ? `En route · ${fmtDist(haversine(v.lastLocation, v.site))} away` : r.state === 'not_started' ? '—' : cityOf(v.site.address);
    const dur = r.state === 'on_visit' ? `<span class="mono" data-since="${v.verifiedStart.t}">${fmtDur((Date.now() - v.verifiedStart.t) / 1000)}</span>` : r.state === 'completed' ? fmtDur(v.visitSec) : '—';
    return `<tr class="click" data-id="${r.user.id}"><td><div class="person">${avatar(r.user)}<div><b>${esc(r.user.name)}</b><span>${esc(r.user.designation)}</span></div></div></td><td>${liveChip(r.state)}</td>
      <td>${esc(loc)}</td><td>${v && r.state !== 'not_started' ? esc(v.site.name) : '—'}</td><td>${v && v.verifiedStart && r.state !== 'not_started' ? fmtTime(v.verifiedStart.t) : '—'}</td><td><b>${dur}</b></td></tr>`;
  }
  function paintMini(live) {
    const el = $('#mini', host); if (!el) return;
    const first = !mini;
    if (first) mini = createMap(el, { zoomControl: false });
    minLayers.forEach((l) => l.remove()); minLayers = [];
    live.forEach((r) => { const loc = r.user.lastLocation; if (!loc || r.state === 'not_started' || r.state === 'completed') return;
      minLayers.push(personMarker([loc.lat, loc.lng], LIVE_COLOR[r.state], initials(r.user.name)[0]).addTo(mini).bindTooltip(`${r.user.name} · ${r.visit.site.name}`)); });
    if (first && minLayers.length) fit(mini, minLayers, 40);
  }
  async function refresh() {
    summary = await get(`/admin/summary?since=${startOfDay()}`);
    if (!$('#mini', host)) return draw();
    const k = summary.kpi, live = sortedLive();
    $('.kpis', host).innerHTML = kpiHtml(k);
    $('#livebody', host).innerHTML = liveBody(live);
    bindRows();
    $('#bars', host).innerHTML = barsHtml();
    $('#feed', host).innerHTML = feedHtml(notif.list.slice(0, 6));
    paintMini(live);
  }
  try { summary = await get(`/admin/summary?since=${startOfDay()}`); draw(); } catch (e) { host.innerHTML = empty('alert', 'Couldn’t load dashboard', e.message); return; }
  stops.push(poll(refresh, 8000), tickers(() => $$('[data-since]', host).forEach((e) => { e.textContent = fmtDur((Date.now() - +e.dataset.since) / 1000); })));
  return () => { stops.forEach((s) => s()); mini && mini.remove(); };
}

/* ============================ employees ============================ */
async function employees({ host }, openInvite = false) {
  let list = [], filter = 'all', q = '';
  host.innerHTML = `<div class="page-h"><div><h1>Sales employees</h1><p>Invite, track onboarding and see who’s in the field</p></div><button class="btn primary" id="inv">${icon('plus')} Invite Employee</button></div>
    <div class="card"><div class="filters"><div class="seg" id="seg">${[['all', 'All'], ['invited', 'Invited'], ['registered', 'Registered'], ['face_registered', 'Face Registered'], ['active', 'Active']].map(([k, l]) => `<button data-k="${k}" class="${k === 'all' ? 'on' : ''}">${l}</button>`).join('')}</div>
      <input class="input right" id="q" placeholder="Search name, email, ID…" style="min-width:240px"></div><div id="tbl">${skeletonRows(6, 56)}</div></div>`;
  const render = () => {
    const rows = list.filter((e) => (filter === 'all' || e.status === filter) && (!q || `${e.name} ${e.email} ${e.empId}`.toLowerCase().includes(q)));
    $('#tbl', host).innerHTML = rows.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Employee</th><th>Employee ID</th><th>Designation</th><th>Invitation</th><th>Today</th><th>Visits</th><th>Visit hours</th><th></th></tr></thead><tbody>
      ${rows.map((e) => `<tr class="click" data-id="${e.id}"><td><div class="person">${avatar(e)}<div><b>${esc(e.name)}</b><span>${esc(e.email)}</span></div></div></td><td class="mono">${esc(e.empId)}</td><td>${esc(e.designation)}</td>
        <td>${inviteChip(e.status)}${e.disabled ? ' <span class="chip red">Disabled</span>' : ''}</td><td>${e.status === 'invited' ? '<span class="muted">—</span>' : liveChip(e.live)}</td><td>${e.completedVisits}</td><td>${(e.totalVisitSec / 3600).toFixed(1)} h</td>
        <td style="text-align:right">${e.status === 'invited' ? `<button class="btn sm" data-resend="${e.id}">${icon('send')} Resend</button>` : `<span class="muted">${icon('chev')}</span>`}</td></tr>`).join('')}</tbody></table></div>`
      : empty('users', list.length ? 'No matches' : 'No employees yet', list.length ? 'Try another filter or search.' : 'Invite your first sales employee to begin tracking visits.', list.length ? '' : `<button class="btn primary" id="inv2">${icon('plus')} Invite Employee</button>`);
    $$('tr[data-id]', host).forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('[data-resend]')) location.hash = `#/a/employee/${tr.dataset.id}`; }));
    $$('[data-resend]', host).forEach((b) => b.addEventListener('click', async () => { try { const r = await withBusy(b, () => post(`/admin/employees/${b.dataset.resend}/resend`)); inviteResult(r, 'Invitation re-sent'); } catch (e) { toast(e.message, 'error'); } }));
    const i2 = $('#inv2', host); i2 && i2.addEventListener('click', () => inviteModal(load));
  };
  async function load() { list = (await get(`/admin/employees?since=${startOfDay()}`)).employees; render(); }
  $$('#seg button', host).forEach((b) => b.addEventListener('click', () => { filter = b.dataset.k; $$('#seg button', host).forEach((x) => x.classList.toggle('on', x === b)); render(); }));
  $('#q', host).addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); render(); });
  $('#inv', host).addEventListener('click', () => inviteModal(load));
  try { await load(); } catch (e) { $('#tbl', host).innerHTML = empty('alert', 'Couldn’t load employees', e.message); }
  if (openInvite) inviteModal(load);
  return poll(load, 15000);
}

function inviteResult(r, title) {
  if (r.emailSent) toast('Invitation email delivered', 'success', title);
  else showDevLink(r);
}
function showDevLink(r) {
  modal({ title: 'Invitation created', sub: r.mailError ? 'Email delivery failed — share this link manually.' : 'Email (SMTP) isn’t configured on this server, so no email was sent.',
    body: `<div class="col" style="gap:12px;padding-bottom:8px"><div class="alert warn">${icon('mail')}<span>Set <code>SMTP_HOST</code>, <code>SMTP_USER</code> and <code>SMTP_PASS</code> to send real emails. Until then, copy the secure link below and send it to the employee.</span></div>
      ${r.mailError ? `<div class="alert err">${icon('alert')}<span>${esc(r.mailError)}</span></div>` : ''}
      <div class="field"><label>Secure registration link (single use)</label><div class="row"><input class="input" readonly value="${esc(r.devLink)}" id="lnk"><button class="btn" id="cp">Copy</button></div></div></div>`,
    footer: `<button class="btn primary" data-close>Done</button>`,
    onMount: (el) => $('#cp', el).addEventListener('click', async () => { try { await navigator.clipboard.writeText(r.devLink); } catch { $('#lnk', el).select(); document.execCommand('copy'); } toast('Link copied', 'success'); }) });
}

function inviteModal(onDone) {
  modal({ title: 'Invite employee', sub: 'They’ll get a secure link to create an account and register their face.',
    body: `<form id="f" class="form-grid" style="padding:6px 0 8px" novalidate>
      <div class="field"><label>Employee name</label><input class="input" name="name" placeholder="Arun Kumar" autocomplete="off"></div>
      <div class="field"><label>Employee ID</label><input class="input" name="empId" placeholder="EMP-107" autocomplete="off"></div>
      <div class="field full"><label>Email address</label><input class="input" name="email" type="email" placeholder="arun@company.com" autocomplete="off"></div>
      <div class="field"><label>Phone number</label><input class="input" name="phone" placeholder="+91 98400 00000" autocomplete="off"></div>
      <div class="field"><label>Designation</label><input class="input" name="designation" placeholder="Sales Executive" autocomplete="off"></div></form><div id="err"></div>`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="send">${icon('send')} Send Invitation</button>`,
    onMount: (el, close) => {
      const f = $('#f', el);
      const submit = async (btn) => {
        const d = formData(f); let bad = false; $('#err', el).innerHTML = '';
        ['name', 'empId', 'email', 'phone', 'designation'].forEach((k) => fieldErr(f, k, ''));
        if (d.name.trim().length < 2) { fieldErr(f, 'name', 'Enter the name'); bad = true; }
        if (!/^[A-Za-z0-9_-]{2,20}$/.test(d.empId.trim())) { fieldErr(f, 'empId', '2–20 letters, numbers, - or _'); bad = true; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email.trim())) { fieldErr(f, 'email', 'Enter a valid email'); bad = true; }
        if (!/^\+?[0-9 ()-]{7,18}$/.test(d.phone.trim())) { fieldErr(f, 'phone', 'Enter a valid phone number'); bad = true; }
        if (!d.designation.trim()) { fieldErr(f, 'designation', 'Required'); bad = true; }
        if (bad) return;
        try { const r = await withBusy(btn, () => post('/admin/employees', d)); close(); inviteResult(r, `Invitation sent to ${r.employee.email}`); onDone && onDone(); }
        catch (e) { $('#err', el).innerHTML = `<div class="alert err" style="margin-bottom:8px">${icon('alert')}<span>${esc(e.message)}</span></div>`; }
      };
      $('#send', el).addEventListener('click', (e) => submit(e.currentTarget));
      f.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit($('#send', el)); } });
      $('input', f).focus();
    } });
}

/* ============================ visit table ============================ */
function visitTable(visits, { employee = true } = {}) {
  if (!visits.length) return empty('clock', 'No visits found', 'Try widening the date range or clearing filters.');
  return `<div class="table-wrap"><table class="t"><thead><tr><th>Date</th>${employee ? '<th>Employee</th>' : ''}<th>Customer / Site</th><th>Travel start</th><th>Arrival</th><th>Visit start</th><th>Visit end</th><th>Visit duration</th><th>Location</th><th>Face verification</th><th>Status</th></tr></thead><tbody>
    ${visits.map((v) => `<tr class="click" data-visit="${v.id}"><td>${fmtDate(v.travelStart.t)}</td>${employee ? `<td><div class="person">${avatar(v.user)}<b>${esc(v.user.name)}</b></div></td>` : ''}
      <td><b>${esc(v.site.name)}</b></td><td>${fmtTime(v.travelStart.t)}</td><td>${fmtTime(v.arrival && v.arrival.t)}${v.arrival ? `<div class="muted" style="font-size:11.5px">travel ${fmtDur(v.travelSec)}</div>` : ''}</td>
      <td>${fmtTime(v.verifiedStart && v.verifiedStart.t)}</td><td>${fmtTime(v.end && v.end.t)}</td><td><b>${v.verifiedStart ? fmtDur(v.visitSec) : '—'}</b></td><td>${esc(cityOf(v.site.address))}</td>
      <td>${verifyChip(v)}${v.failedAttempts ? ` <span class="chip red" title="Failed attempts">${v.failedAttempts} failed</span>` : ''}</td><td>${visitChip(v.status)}</td></tr>`).join('')}</tbody></table></div>`;
}
const bindVisitRows = (host) => $$('tr[data-visit]', host).forEach((tr) => tr.addEventListener('click', () => { location.hash = `#/a/visit/${tr.dataset.visit}`; }));

function exportVisits(visits, name) {
  const head = ['Date', 'Employee', 'Employee ID', 'Site', 'Address', 'Travel start', 'Arrival', 'Visit start (face verified)', 'Visit end', 'Travel (min)', 'Visit (min)', 'Start confidence %', 'End confidence %', 'Failed attempts', 'Status'];
  const t = (x) => (x ? new Date(x).toLocaleTimeString() : '');
  const rows = visits.map((v) => [fmtDate(v.travelStart.t), v.user.name, v.user.empId, v.site.name, v.site.address, t(v.travelStart.t), t(v.arrival && v.arrival.t), t(v.verifiedStart && v.verifiedStart.t), t(v.end && v.end.t),
    Math.round(v.travelSec / 60), Math.round(v.visitSec / 60), v.verifiedStart ? v.verifiedStart.confidence : '', v.end ? v.end.confidence : '', v.failedAttempts, v.status]);
  download(name, [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n'));
}

function rangeOf(preset, from, to) {
  const d0 = startOfDay(), day = 86400000;
  if (preset === 'today') return { from: d0, to: d0 + day - 1 };
  if (preset === '7d') return { from: d0 - 6 * day, to: d0 + day - 1 };
  if (preset === '30d') return { from: d0 - 29 * day, to: d0 + day - 1 };
  if (preset === 'custom') return { from: from ? +new Date(from + 'T00:00:00') : 0, to: to ? +new Date(to + 'T23:59:59') : 0 };
  return { from: 0, to: 0 };
}
const qs = (o) => Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

function filterBar({ employees: emps, sites, showEmployee = true, state, onChange }) {
  return `<div class="filters"><select class="input" data-f="preset">${[['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['all', 'All time'], ['custom', 'Custom range']].map(([k, l]) => `<option value="${k}" ${state.preset === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <input class="input ${state.preset === 'custom' ? '' : 'hide'}" type="date" data-f="from" value="${state.from || ''}"><input class="input ${state.preset === 'custom' ? '' : 'hide'}" type="date" data-f="to" value="${state.to || ''}">
    ${showEmployee ? `<select class="input" data-f="employee"><option value="">All employees</option>${emps.map((e) => `<option value="${e.id}" ${state.employee === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>` : ''}
    <select class="input" data-f="site"><option value="">All sites</option>${sites.map((s) => `<option value="${s.id}" ${state.site === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
    <select class="input" data-f="status"><option value="">Any status</option>${[['completed', 'Completed'], ['active', 'On visit'], ['at_site', 'Reached site'], ['travelling', 'Travelling'], ['cancelled', 'Cancelled']].map(([k, l]) => `<option value="${k}" ${state.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
}
function bindFilters(host, state, rerender, reload) {
  $$('[data-f]', host).forEach((el) => el.addEventListener('change', () => { state[el.dataset.f] = el.value; if (el.dataset.f === 'preset') rerender(); else reload(); if (el.dataset.f === 'preset') reload(); }));
}

/* ============================ employee details ============================ */
async function employee({ host }, id) {
  host.innerHTML = `<div class="skel" style="height:200px;margin-bottom:20px"></div><div class="skel" style="height:360px"></div>`;
  let d, sites;
  const state = { preset: 'all', site: '', status: '' };
  try { [d, sites] = await Promise.all([get(`/admin/employees/${id}`), get('/admin/sites')]); sites = sites.sites; } catch (e) { host.innerHTML = empty('alert', 'Employee not found', e.message, '<a class="btn" href="#/a/employees">Back to employees</a>'); return; }
  const render = () => {
    const e = d.employee, s = d.stats;
    const steps = [['invited', 'Invited', e.invitedAt], ['registered', 'Registered', e.registeredAt], ['face_registered', 'Face registered', e.faceRegisteredAt], ['active', 'Active', e.status === 'active' ? (d.visits.length ? d.visits[d.visits.length - 1].travelStart.t : 1) : null]];
    const order = ['invited', 'registered', 'face_registered', 'active'], cur = order.indexOf(e.status);
    host.innerHTML = `<a href="#/a/employees" class="row sub" style="margin-bottom:14px;font-weight:600">${icon('back')} All employees</a>
      <div class="card" style="margin-bottom:20px"><div class="row wrap" style="gap:20px;align-items:flex-start">${avatar(e, 'lg')}
        <div class="grow"><div class="row wrap"><h1 style="font-size:24px">${esc(e.name)}</h1>${inviteChip(e.status)}${e.disabled ? '<span class="chip red">Disabled</span>' : ''}</div>
          <p class="sub">${esc(e.designation)} · <span class="mono">${esc(e.empId)}</span></p>
          <div class="row wrap sub" style="margin-top:10px;gap:20px">${[['mail', e.email], ['phone', e.phone]].map(([i, t]) => `<span class="row" style="gap:6px">${icon(i)}${esc(t)}</span>`).join('')}</div></div>
        <div class="row wrap">${e.status === 'invited' ? `<button class="btn" id="resend">${icon('send')} Resend invite</button>` : ''}
          ${e.hasFace && !e.faceResetAllowed ? `<button class="btn" id="reset">${icon('scan')} Reset face</button>` : ''}${e.faceResetAllowed ? '<span class="chip orange">Face reset pending</span>' : ''}
          <button class="btn ${e.disabled ? '' : 'ghost'}" id="toggle">${e.disabled ? 'Enable account' : 'Disable'}</button></div></div>
        <div class="row" style="margin-top:22px;gap:0">${steps.map(([k, l, t], i) => `<div class="grow" style="position:relative;text-align:center"><div style="height:3px;background:${i <= cur ? 'var(--brand)' : 'var(--line)'};position:absolute;top:13px;left:${i === 0 ? '50%' : '0'};right:${i === 3 ? '50%' : '0'}"></div>
          <div style="position:relative;width:28px;height:28px;border-radius:50%;margin:0 auto;background:${i <= cur ? 'var(--brand)' : 'var(--surface)'};border:3px solid ${i <= cur ? 'var(--brand)' : 'var(--line)'};color:#fff;display:grid;place-items:center">${i <= cur ? icon('check') : ''}</div>
          <div style="font-weight:700;font-size:12.5px;margin-top:6px">${l}</div><div class="muted" style="font-size:11.5px">${t && i <= cur && t > 1 ? fmtDateShort(t) : ''}</div></div>`).join('')}</div></div>
      <div class="kpis" style="grid-template-columns:repeat(5,1fr)">${[['Completed visits', s.visits], ['On-site time', fmtDur(s.totalVisitSec)], ['Avg visit', fmtDur(s.avgVisitSec)], ['Travel time', fmtDur(s.totalTravelSec)], ['Failed verifications', s.failedVerifications]].map(([l, v]) => `<div class="card kpi"><div class="v" style="font-size:24px">${v}</div><div class="l">${l}</div></div>`).join('')}</div>
      <div class="card"><div class="card-h"><h2>Visit history</h2><div class="row">${e.lastLocation ? `<a class="btn sm" href="#/a/live">${icon('map')} Last seen ${ago(e.lastLocation.t)}</a>` : ''}<button class="btn sm" id="csv">${icon('download')} Export</button></div></div>
        ${filterBar({ sites, showEmployee: false, state })}<div id="vt"></div></div>`;
    $('#resend', host) && $('#resend', host).addEventListener('click', async (ev) => { try { inviteResult(await withBusy(ev.currentTarget, () => post(`/admin/employees/${id}/resend`)), 'Invitation re-sent'); } catch (er) { toast(er.message, 'error'); } });
    $('#reset', host) && $('#reset', host).addEventListener('click', async () => { if (await confirmDialog({ title: 'Reset face registration?', text: `${e.name} will be asked to register their face again at next login. Their current face template stays active until they do.`, confirm: 'Allow re-registration' })) { d.employee = (await patch(`/admin/employees/${id}`, { resetFace: true })).employee; toast('Face re-registration allowed', 'success'); render(); } });
    $('#toggle', host).addEventListener('click', async () => { try { d.employee = (await patch(`/admin/employees/${id}`, { disabled: !e.disabled })).employee; toast(e.disabled ? 'Account enabled' : 'Account disabled', 'success'); render(); } catch (er) { toast(er.message, 'error'); } });
    $('#csv', host).addEventListener('click', () => exportVisits(filtered(), `${e.empId}-visits.csv`));
    bindFilters(host, state, render, drawTable);
    drawTable();
  };
  const filtered = () => { const r = rangeOf(state.preset, state.from, state.to); return d.visits.filter((v) => (!r.from || v.travelStart.t >= r.from) && (!r.to || v.travelStart.t <= r.to) && (!state.site || v.siteId === state.site) && (!state.status || v.status === state.status)); };
  const drawTable = () => { const t = $('#vt', host); t.innerHTML = visitTable(filtered().map((v) => ({ ...v, user: v.user || d.employee })), { employee: false }); bindVisitRows(t); };
  render();
}

/* ============================ visits ============================ */
async function visits({ host }) {
  const state = { preset: 'today', employee: '', site: '', status: '' };
  let emps, sites, list = [];
  host.innerHTML = `<div class="page-h"><div><h1>Visit history</h1><p>Every trip, arrival and verified on-site period</p></div><button class="btn" id="csv">${icon('download')} Export CSV</button></div><div class="card"><div id="fb"></div><div id="vt">${skeletonRows(6, 50)}</div></div>`;
  try { [emps, sites] = await Promise.all([get('/admin/employees'), get('/admin/sites')]); emps = emps.employees.filter((e) => e.status !== 'invited'); sites = sites.sites; } catch (e) { host.innerHTML = empty('alert', 'Couldn’t load', e.message); return; }
  const bar = () => { $('#fb', host).innerHTML = filterBar({ employees: emps, sites, state }); bindFilters(host, state, bar, load); };
  async function load() {
    const r = rangeOf(state.preset, state.from, state.to);
    list = (await get('/admin/visits?' + qs({ from: r.from, to: r.to, employee: state.employee, site: state.site, status: state.status }))).visits;
    const t = $('#vt', host); t.innerHTML = `<p class="muted" style="margin-bottom:10px;font-size:13px">${list.length} visit${list.length === 1 ? '' : 's'}</p>` + visitTable(list); bindVisitRows(t);
  }
  $('#csv', host).addEventListener('click', () => exportVisits(list, 'visits.csv'));
  bar(); await load().catch((e) => { $('#vt', host).innerHTML = empty('alert', 'Couldn’t load visits', e.message); });
  return poll(load, 15000);
}

/* ============================ visit details ============================ */
async function visit({ host }, id) {
  host.innerHTML = `<div class="skel" style="height:120px;margin-bottom:20px"></div><div class="skel" style="height:420px"></div>`;
  let map, layers = [], stop;
  async function draw(first) {
    const { visit: v } = await get(`/admin/visits/${id}`);
    const open = ['travelling', 'at_site', 'active'].includes(v.status);
    const tot = Math.max(1, v.travelSec + v.visitSec);
    const step = (cls, ic, title, time, sub) => `<div class="st ${cls}"><div class="pt">${icon(ic)}</div><div><b>${title}</b><div class="mono" style="font-weight:600">${time}</div><small>${sub}</small></div></div>`;
    host.innerHTML = `<a href="#/a/visits" class="row sub" style="margin-bottom:14px;font-weight:600">${icon('back')} Visit history</a>
      <div class="card" style="margin-bottom:20px"><div class="row wrap" style="gap:18px"><div class="grow"><div class="row wrap"><h1 style="font-size:24px">${esc(v.site.name)}</h1>${visitChip(v.status)}${v.simulated ? '<span class="chip brand">Simulated GPS</span>' : ''}${open ? '<span class="livedot"><i></i>Live</span>' : ''}</div>
        <p class="sub">${esc(v.site.address || '')}</p></div><a class="row" href="#/a/employee/${v.user.id}" style="color:inherit">${avatar(v.user)}<div><b>${esc(v.user.name)}</b><div class="muted" style="font-size:12.5px">${esc(v.user.designation)}</div></div></a></div></div>
      <div class="grid-2 start"><div class="card" style="padding:14px"><div style="height:460px"><div id="vm" class="map"></div></div>
        <div class="legend" style="padding:12px 6px 2px">${[['#2563eb', 'Travel start'], ['#ea7b0c', 'Arrival'], ['#12a150', 'Visit start (verified)'], ['#161833', 'Departure']].map(([c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join('')}</div></div>
        <div class="col"><div class="card"><div class="card-h"><h2>Timeline</h2></div><div class="tl">
          ${step('done', 'nav', 'Travel started', fmtTime(v.travelStart.t), 'Location tracking on')}
          ${step(v.arrival ? 'done' : 'now', 'flag', 'Arrived at site', fmtTime(v.arrival && v.arrival.t), v.arrival ? `Geofence ${v.site.radius} m · travel ${fmtDur(v.travelSec)}` : 'Not reached yet')}
          ${step(v.verifiedStart ? 'verified' : v.arrival ? 'now' : '', 'shield', 'Visit started — face verified', fmtTime(v.verifiedStart && v.verifiedStart.t), v.verifiedStart ? `Match ${v.verifiedStart.confidence}% · official attendance begins` : 'Awaiting face verification')}
          ${step(v.end ? 'verified' : v.verifiedStart ? 'now' : '', 'check', 'Visit ended — face verified', fmtTime(v.end && v.end.t), v.end ? `Match ${v.end.confidence}% · on site ${fmtDur(v.visitSec)}` : v.verifiedStart ? `In progress · ${fmtDur(v.visitSec)} so far` : '—')}
        </div></div>
        ${v.sitePhoto ? `<div class="card"><div class="card-h"><h2>Site proof photo</h2><span class="muted" style="font-size:12.5px">${fmtTime(v.sitePhoto.t)}</span></div><div data-photo-wrap><img class="proof hide" data-photo="${v.id}" alt="Company logo or visiting card"></div></div>` : ''}
        ${meetingBlock(v.meeting)}
        <div class="card"><div class="card-h"><h2>Travel vs on-site</h2></div><div class="split"><i style="flex:${v.travelSec || 0.01};background:#93a4f8"></i><i style="flex:${v.visitSec || 0.01};background:var(--brand)"></i></div>
          <div class="row between" style="margin-top:12px"><div><span class="chip blue">Travel</span><div style="font-size:20px;font-weight:800;margin-top:6px">${fmtDur(v.travelSec)}</div><small class="muted">not counted</small></div>
          <div style="text-align:right"><span class="chip brand">Official visit</span><div style="font-size:20px;font-weight:800;margin-top:6px;color:var(--brand)">${v.verifiedStart ? fmtDur(v.visitSec) : '—'}</div><small class="muted">face-verified period</small></div></div>
          ${v.verificationGapSec != null ? `<p class="muted" style="font-size:12.5px;margin-top:10px">${fmtDur(v.verificationGapSec)} between arrival and face verification is excluded from both.</p>` : ''}</div>
        <div class="card"><div class="card-h"><h2>Verification & flags</h2></div><div class="col" style="gap:10px">
          <div class="row between"><span class="sub">Face verification</span>${verifyChip(v)}</div><div class="row between"><span class="sub">Failed attempts</span>${v.failedAttempts ? `<span class="chip red">${v.failedAttempts}</span>` : '<b>0</b>'}</div>
          <div class="row between"><span class="sub">GPS points recorded</span><b>${v.routePoints}</b></div>
          ${v.leftGeofence ? `<div class="alert warn">${icon('alert')}<span>Employee moved well outside the site during the verified period.</span></div>` : ''}
          ${v.end && !v.end.insideGeofence ? `<div class="alert warn">${icon('alert')}<span>Visit was ended away from the site.</span></div>` : ''}</div></div></div></div>`;
    mountPhotos(host);
    if (map) map.remove();
    map = createMap($('#vm', host)); layers = [geofence(v.site).addTo(map), siteMarker([v.site.lat, v.site.lng]).addTo(map).bindTooltip(v.site.name)];
    const route = v.route || []; if (route.length > 1) layers.push(routeLine(route).addTo(map));
    const mk = (p, c, t) => p && layers.push(dotMarker([p.lat, p.lng], c, t).addTo(map).bindTooltip(`${t} · ${fmtTime(p.t)}`));
    mk(v.travelStart, '#2563eb', 'Travel start'); mk(v.arrival, '#ea7b0c', 'Arrival'); mk(v.verifiedStart, '#12a150', 'Visit start'); mk(v.end, '#161833', 'Departure');
    if (open && v.lastLocation) layers.push(personMarker([v.lastLocation.lat, v.lastLocation.lng], '#2563eb', '').addTo(map));
    if (first || !open) fit(map, layers, 50);
    if (!open && stop) { stop(); stop = null; }
  }
  try { await draw(true); } catch (e) { host.innerHTML = empty('alert', 'Visit not found', e.message, '<a class="btn" href="#/a/visits">Back</a>'); return; }
  stop = poll(() => draw(false), 5000);
  return () => { stop && stop(); map && map.remove(); };
}

/* ============================ live tracking ============================ */
async function live({ host }) {
  host.innerHTML = `<div class="page-h"><div><h1>Live tracking</h1><p>Where everyone is right now — GPS position, geofence arrival and verified time on site</p></div>
    <div class="row wrap"><span class="livedot"><i></i><span id="upd">Live</span></span><button class="btn" id="refresh">${icon('refresh')} Refresh</button><button class="btn" id="fitall">${icon('target')} Fit all</button></div></div>
    <div class="live-layout"><div class="card" style="padding:12px;position:relative"><div id="lm" class="map" style="height:100%"></div>
      <div class="map-ctl"><label class="row" style="gap:8px;cursor:pointer"><input type="checkbox" id="showsites"> Show all sites</label></div>
      <div class="map-legend">${[['on_visit', 'On visit'], ['reached', 'Reached site'], ['travelling', 'Travelling'], ['completed', 'Completed']].map(([s, l]) => `<span><i style="background:${LIVE_COLOR[s]}"></i>${l}</span>`).join('')}</div></div>
      <div class="col" style="gap:12px;min-height:0">
        <div class="seg wrapseg" id="flt"></div>
        <input class="input" id="q" placeholder="Search employee or site…">
        <div class="live-list" id="ll">${skeletonRows(4, 90)}</div></div></div>`;
  const map = createMap($('#lm', host));
  let rows = [], sites = [], selected = null, markers = {}, extra = [], siteLayers = [], filter = 'all', q = '', firstFit = true, follow = false, fetchedAt = 0;
  const rank = { on_visit: 0, reached: 1, travelling: 2, completed: 3, not_started: 4 };
  const FILTERS = [['all', 'All'], ['on_visit', 'On visit'], ['reached', 'Reached'], ['travelling', 'Travelling'], ['completed', 'Done'], ['not_started', 'Idle']];
  const pos = (r) => (r.visit && r.visit.lastLocation) || r.user.lastLocation;
  const visible = () => rows.filter((r) => (filter === 'all' || r.state === filter) && (!q || `${r.user.name} ${r.visit ? r.visit.site.name : ''}`.toLowerCase().includes(q)));
  const stale = (r) => ['travelling', 'at_site', 'active'].includes(r.visit && r.visit.status) && pos(r) && Date.now() - pos(r).t > 120000;

  function paintFilters() {
    $('#flt', host).innerHTML = FILTERS.map(([k, l]) => `<button data-k="${k}" class="${filter === k ? 'on' : ''}">${l} <b>${k === 'all' ? rows.length : rows.filter((r) => r.state === k).length}</b></button>`).join('');
    $$('#flt button', host).forEach((b) => b.addEventListener('click', () => { filter = b.dataset.k; paint(); }));
  }
  function detail(r) {
    const v = r.visit; if (!v) return `<div class="muted" style="font-size:13px;margin-top:10px">No visit started today.</div>`;
    const p = pos(r), d = ['travelling', 'at_site'].includes(v.status) && p ? haversine(p, v.site) : null;
    const line = (l, t) => `<div class="row between"><span class="sub">${l}</span><b>${t}</b></div>`;
    return `<div class="col" style="gap:7px;margin-top:12px;padding-top:12px;border-top:1px solid var(--line-2);font-size:13px">
      ${line('Travel started', fmtTime(v.travelStart.t))}${v.arrival ? line('Arrived (geofence)', fmtTime(v.arrival.t)) : d != null ? line('Distance to site', fmtDist(d)) : ''}
      ${v.verifiedStart ? line('Visit started (face verified)', fmtTime(v.verifiedStart.t)) : v.arrival ? line('Face verification', '<span style="color:var(--orange)">Pending</span>') : ''}
      ${v.end ? line('Visit ended', fmtTime(v.end.t)) : ''}
      ${v.status === 'active' ? line('On site', fmtDur((Date.now() - v.verifiedStart.t) / 1000)) : v.end ? line('On site', fmtDur(v.visitSec)) : ''}
      ${p ? line('Last GPS', `${ago(p.t)} · ±${p.acc} m`) : ''}
      ${stale(r) ? `<div class="alert warn">${icon('alert')}<span>No GPS update for ${ago(p.t).replace(' ago', '')} — phone may be offline or location is off.</span></div>` : ''}
      ${v.failedAttempts ? `<div class="alert err">${icon('alert')}<span>${v.failedAttempts} failed face verification${v.failedAttempts > 1 ? 's' : ''}</span></div>` : ''}
      <div class="row" style="margin-top:4px"><a class="btn sm grow" href="#/a/visit/${v.id}">Visit details</a><button class="btn sm ${follow ? 'primary' : ''}" id="follow">${icon('target')} ${follow ? 'Following' : 'Follow'}</button></div></div>`;
  }
  function paint() {
    Object.values(markers).forEach((m) => m.remove()); markers = {}; extra.forEach((l) => l.remove()); extra = [];
    siteLayers.forEach((l) => l.remove()); siteLayers = [];
    if ($('#showsites', host).checked) sites.forEach((s) => siteLayers.push(geofence(s).addTo(map), siteMarker([s.lat, s.lng]).addTo(map).bindTooltip(s.name)));
    const shown = visible();
    shown.filter((r) => pos(r) && r.state !== 'not_started').forEach((r) => {
      const l = pos(r), color = stale(r) ? '#8b8fa8' : LIVE_COLOR[r.state];
      const m = personMarker([l.lat, l.lng], color, initials(r.user.name)[0]).addTo(map).bindTooltip(`${r.user.name}${r.visit ? ' · ' + r.visit.site.name : ''}`, { direction: 'top', offset: [0, -16] });
      m.on('click', () => select(r.user.id)); markers[r.user.id] = m;
    });
    const sel = rows.find((r) => r.user.id === selected);
    if (sel && sel.visit) {
      const v = sel.visit, p = pos(sel);
      extra.push(geofence(v.site).addTo(map), siteMarker([v.site.lat, v.site.lng]).addTo(map).bindTooltip(v.site.name, { permanent: true, direction: 'top', offset: [0, -30] }));
      if (v.route && v.route.length > 1) extra.push(routeLine(v.route, LIVE_COLOR[sel.state]).addTo(map));
      if (['travelling', 'at_site'].includes(v.status) && p) extra.push(L.polyline([[p.lat, p.lng], [v.site.lat, v.site.lng]], { color: '#4f46e5', weight: 2.5, dashArray: '3 8' }).addTo(map));
      extra.push(dotMarker([v.travelStart.lat, v.travelStart.lng], '#2563eb', 'Start').addTo(map).bindTooltip('Travel start ' + fmtTime(v.travelStart.t)));
      if (v.arrival) extra.push(dotMarker([v.arrival.lat, v.arrival.lng], '#ea7b0c', 'Arrival').addTo(map).bindTooltip('Arrival ' + fmtTime(v.arrival.t)));
      if (v.end) extra.push(dotMarker([v.end.lat, v.end.lng], '#161833', 'Departure').addTo(map).bindTooltip('Departure ' + fmtTime(v.end.t)));
      if (follow && p && markers[selected]) map.panTo([p.lat, p.lng], { animate: false });
    }
    paintFilters();
    const list = shown.slice().sort((a, b) => rank[a.state] - rank[b.state]);
    $('#ll', host).innerHTML = list.length ? list.map((r) => {
      const v = r.visit, p = pos(r);
      const sum = v && r.state === 'travelling' && p ? fmtDist(haversine(p, v.site)) + ' to site' : r.state === 'on_visit' ? `On site ${fmtDur((Date.now() - v.verifiedStart.t) / 1000)}` : r.state === 'reached' ? `Arrived ${fmtTime(v.arrival.t)} · awaiting face` : r.state === 'completed' ? `${fmtDur(v.visitSec)} on site` : 'No visit yet';
      return `<div class="live-item ${r.user.id === selected ? 'on' : ''}" data-id="${r.user.id}"><div class="row">${avatar(r.user)}<div class="grow"><b>${esc(r.user.name)}</b><div class="muted" style="font-size:12.5px">${v && r.state !== 'not_started' ? esc(v.site.name) : esc(r.user.designation)}</div></div>${stale(r) ? '<span class="chip gray" title="No recent GPS">Stale</span>' : ''}${liveChip(r.state)}</div>
        ${r.user.id === selected ? detail(r) : `<div class="sub" style="margin-top:8px;font-size:12.5px">${sum}</div>`}</div>`;
    }).join('') : empty('users', 'No matches', 'Change the filter or search.');
    $$('.live-item', host).forEach((el) => el.addEventListener('click', (e) => { if (!e.target.closest('a,button')) select(el.dataset.id); }));
    const fb = $('#follow', host); fb && fb.addEventListener('click', () => { follow = !follow; paint(); });
  }
  function select(id) {
    selected = selected === id ? null : id; follow = false; paint();
    const r = rows.find((x) => x.user.id === id), m = markers[id];
    if (selected && r && r.visit) fit(map, [...(m ? [m] : []), { getLatLng: () => L.latLng(r.visit.site.lat, r.visit.site.lng) }], 90);
  }
  const fitAll = () => { const ls = Object.values(markers); if (ls.length) fit(map, ls, 70); };
  async function load() {
    rows = (await get(`/admin/live?since=${startOfDay()}`)).rows; fetchedAt = Date.now(); paint();
    if (firstFit) { firstFit = false; fitAll(); }
  }
  $('#fitall', host).addEventListener('click', () => { selected = null; follow = false; paint(); fitAll(); });
  $('#refresh', host).addEventListener('click', () => load().catch((e) => toast(e.message, 'error')));
  $('#showsites', host).addEventListener('change', paint);
  $('#q', host).addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); paint(); });
  try { sites = (await get('/admin/sites')).sites; await load(); } catch (e) { $('#ll', host).innerHTML = empty('alert', 'Couldn’t load', e.message); }
  const stop = poll(load, 5000);
  const tick = setInterval(() => { const u = $('#upd', host); if (u && fetchedAt) u.textContent = `Live · updated ${Math.max(0, Math.round((Date.now() - fetchedAt) / 1000))}s ago`; }, 1000);
  return () => { stop(); clearInterval(tick); map.remove(); };
}

/* ============================ reports ============================ */
async function reports({ host }) {
  const state = { preset: '7d', site: '', status: '' };
  let sites, data;
  host.innerHTML = `<div class="page-h"><div><h1>Reports</h1><p>Visit hours, travel time and verification quality</p></div><div class="row"><button class="btn" id="csvE">${icon('download')} Employees CSV</button><button class="btn" id="csvV">${icon('download')} Visits CSV</button></div></div>
    <div class="card" style="margin-bottom:20px"><div id="fb"></div></div><div id="rp">${skeletonRows(4, 90)}</div>`;
  try { sites = (await get('/admin/sites')).sites; } catch (e) { host.innerHTML = empty('alert', 'Couldn’t load', e.message); return; }
  const bar = () => { $('#fb', host).innerHTML = filterBar({ sites, showEmployee: false, state }); bindFilters(host, state, bar, load); };
  const range = () => rangeOf(state.preset, state.from, state.to);
  async function load() {
    const q = qs({ ...range(), site: state.site, status: state.status });
    data = await get('/admin/reports?' + q);
    const t = data.totals, maxV = Math.max(1, ...data.byEmployee.map((e) => e.visitSec + e.travelSec));
    $('#rp', host).innerHTML = `<div class="kpis" style="grid-template-columns:repeat(6,1fr)">${[['Visits', t.visits], ['Completed', t.completed], ['On-site hours', (t.visitSec / 3600).toFixed(1) + ' h'], ['Avg visit', fmtDur(t.avgVisitSec)], ['Travel hours', (t.travelSec / 3600).toFixed(1) + ' h'], ['Failed verifications', t.failedVerifications]].map(([l, v]) => `<div class="card kpi"><div class="v" style="font-size:24px">${v}</div><div class="l">${l}</div></div>`).join('')}</div>
      <div class="card" style="margin-bottom:20px"><div class="card-h"><div><h2>By employee</h2><p class="muted" style="font-size:13px">Official on-site time vs travel time</p></div><div class="legend"><span><i style="background:var(--brand)"></i>On site</span><span><i style="background:#93a4f8"></i>Travel</span></div></div>
        ${data.byEmployee.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Employee</th><th>Visits</th><th>Completed</th><th style="min-width:220px">Time split</th><th>On site</th><th>Avg visit</th><th>Travel</th><th>Failed</th></tr></thead><tbody>${data.byEmployee.map((e) => `<tr class="click" data-e="${e.key}"><td><b>${esc(e.label)}</b></td><td>${e.visits}</td><td>${e.completed}</td>
          <td><div class="split" style="width:${Math.max(8, ((e.visitSec + e.travelSec) / maxV) * 100)}%"><i style="flex:${e.visitSec || 0.01};background:var(--brand)"></i><i style="flex:${e.travelSec || 0.01};background:#93a4f8"></i></div></td><td><b>${fmtDur(e.visitSec)}</b></td><td>${fmtDur(e.avgVisitSec)}</td><td>${fmtDur(e.travelSec)}</td><td>${e.failedVerifications ? `<span class="chip red">${e.failedVerifications}</span>` : '0'}</td></tr>`).join('')}</tbody></table></div>` : empty('chart', 'No data for this range', 'Pick a wider date range.')}</div>
      <div class="card"><div class="card-h"><h2>By customer site</h2></div>${data.bySite.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Site</th><th>Visits</th><th>Completed</th><th>Total on site</th><th>Avg visit</th></tr></thead><tbody>${data.bySite.map((s) => `<tr><td><b>${esc(s.label)}</b></td><td>${s.visits}</td><td>${s.completed}</td><td>${fmtDur(s.visitSec)}</td><td>${fmtDur(s.avgVisitSec)}</td></tr>`).join('')}</tbody></table></div>` : empty('building', 'No site data', 'Nothing in this range.')}</div>`;
    $$('tr[data-e]', host).forEach((tr) => tr.addEventListener('click', () => { location.hash = `#/a/employee/${tr.dataset.e}`; }));
  }
  $('#csvE', host).addEventListener('click', () => { if (!data) return; download('employee-report.csv', [['Employee', 'Visits', 'Completed', 'On-site (min)', 'Avg visit (min)', 'Travel (min)', 'Failed verifications'], ...data.byEmployee.map((e) => [e.label, e.visits, e.completed, Math.round(e.visitSec / 60), Math.round(e.avgVisitSec / 60), Math.round(e.travelSec / 60), e.failedVerifications])].map((r) => r.map(csvCell).join(',')).join('\n')); });
  $('#csvV', host).addEventListener('click', async () => { const r = range(); exportVisits((await get('/admin/visits?' + qs({ ...r, site: state.site, status: state.status }))).visits, 'visits.csv'); });
  bar(); try { await load(); } catch (e) { $('#rp', host).innerHTML = empty('alert', 'Couldn’t load report', e.message); }
}

/* ============================ settings ============================ */
async function settings({ host }) {
  host.innerHTML = `<div class="page-h"><div><h1>Settings</h1><p>Verification rules, customer sites and invitations</p></div></div><div class="skel" style="height:300px"></div>`;
  let s, sites;
  try { [s, sites] = await Promise.all([get('/admin/settings'), get('/admin/sites')]); s = s.settings; sites = sites.sites; } catch (e) { host.innerHTML = empty('alert', 'Couldn’t load settings', e.message); return; }
  const draw = () => {
    host.innerHTML = `<div class="page-h"><div><h1>Settings</h1><p>Verification rules, customer sites and invitations</p></div></div>
      <div class="grid-2" style="grid-template-columns:1fr 1.2fr;align-items:start">
      <form class="card col" id="sf" style="gap:16px" novalidate><div class="card-h" style="margin:0"><h2>Rules</h2></div>
        <div class="field"><label>Organization name</label><input class="input" name="orgName" value="${esc(s.orgName)}"></div>
        <div class="field"><label>Face match strictness <span class="mono" id="thv">${s.faceThreshold}</span></label><input type="range" name="faceThreshold" min="0.3" max="0.6" step="0.01" value="${s.faceThreshold}"><span class="hint">Lower is stricter (fewer false accepts, more retries). 0.50 is a good default.</span></div>
        <div class="form-grid"><div class="field"><label>Max GPS error (m)</label><input class="input" name="maxAccuracy" type="number" value="${s.maxAccuracy}"><span class="hint">Readings worse than this are rejected.</span></div>
          <div class="field"><label>Default geofence (m)</label><input class="input" name="geofenceDefault" type="number" value="${s.geofenceDefault}"></div>
          <div class="field"><label>Invitation validity (h)</label><input class="input" name="inviteHours" type="number" value="${s.inviteHours}"></div></div>
        <div id="serr"></div><button class="btn primary" type="submit">Save settings</button>
        <div class="alert ${session.config.emailConfigured ? 'ok' : 'warn'}">${icon('mail')}<span>${session.config.emailConfigured ? 'Email delivery is configured (SMTP).' : 'Email (SMTP) isn’t configured — invitations return a copyable link instead. See README.'}</span></div></form>
      <div class="card"><div class="card-h"><div><h2>Customer sites</h2><p class="muted" style="font-size:13px">Arrival is detected inside each site’s geofence</p></div><button class="btn primary sm" id="add">${icon('plus')} Add site</button></div>
        ${sites.length ? `<div class="col" style="gap:10px">${sites.map((x) => `<div class="vcard"><div class="avatar" style="background:var(--brand-soft);color:var(--brand)">${icon('building')}</div><div class="grow"><b>${esc(x.name)}</b><div class="muted" style="font-size:12.5px">${esc(x.address || '')} · ${x.radius} m geofence</div></div>
          <button class="btn sm ghost" data-edit="${x.id}">${icon('edit')}</button><button class="btn sm ghost" data-del="${x.id}">${icon('trash')}</button></div>`).join('')}</div>` : empty('building', 'No sites yet', 'Add the customer locations your team visits.')}</div></div>`;
    const f = $('#sf', host); f.faceThreshold.addEventListener('input', () => { $('#thv', host).textContent = f.faceThreshold.value; });
    f.addEventListener('submit', async (e) => { e.preventDefault(); $('#serr', host).innerHTML = ''; try { s = (await withBusy($('button[type=submit]', f), () => put('/admin/settings', formData(f)))).settings; session.config.orgName = s.orgName; toast('Settings saved', 'success'); } catch (er) { $('#serr', host).innerHTML = `<div class="alert err">${icon('alert')}<span>${esc(er.message)}</span></div>`; } });
    $('#add', host).addEventListener('click', () => siteModal(null, s, reload));
    $$('[data-edit]', host).forEach((b) => b.addEventListener('click', () => siteModal(sites.find((x) => x.id === b.dataset.edit), s, reload)));
    $$('[data-del]', host).forEach((b) => b.addEventListener('click', async () => { const x = sites.find((y) => y.id === b.dataset.del); if (await confirmDialog({ title: `Remove ${x.name}?`, text: 'Past visits keep their history. The site will no longer be selectable.', confirm: 'Remove', danger: true })) { try { await del(`/admin/sites/${x.id}`); toast('Site removed', 'success'); reload(); } catch (er) { toast(er.message, 'error'); } } }));
  };
  const reload = async () => { sites = (await get('/admin/sites')).sites; draw(); };
  draw();
}

function siteModal(site, s, done) {
  let map, pin, circle;
  const init = site ? [site.lat, site.lng] : [13.0827, 80.2707];
  modal({ title: site ? 'Edit site' : 'Add customer site', sub: 'Click the map to place the site, then set the geofence radius.', wide: true,
    body: `<form id="f" class="col" style="gap:14px;padding-bottom:8px" novalidate><div class="form-grid"><div class="field"><label>Site name</label><input class="input" name="name" value="${esc(site ? site.name : '')}" placeholder="ABC Industries"></div>
      <div class="field"><label>Address</label><input class="input" name="address" value="${esc(site ? site.address : '')}" placeholder="Guindy, Chennai"></div></div>
      <div style="height:280px;border-radius:16px;overflow:hidden"><div id="pm" class="map"></div></div>
      <div class="form-grid" style="grid-template-columns:1fr 1fr 1fr"><div class="field"><label>Latitude</label><input class="input" name="lat" value="${site ? site.lat : ''}"></div><div class="field"><label>Longitude</label><input class="input" name="lng" value="${site ? site.lng : ''}"></div>
        <div class="field"><label>Geofence radius (m)</label><input class="input" name="radius" type="number" value="${site ? site.radius : s.geofenceDefault}"></div></div><div id="err"></div></form>`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="save">${site ? 'Save changes' : 'Add site'}</button>`,
    onMount: (el, close) => {
      const f = $('#f', el);
      map = createMap($('#pm', el), { center: init, zoom: site ? 15 : 11 });
      const place = (ll, pan) => {
        f.lat.value = (+ll.lat).toFixed(6); f.lng.value = (+ll.lng).toFixed(6);
        if (pin) pin.setLatLng(ll); else pin = siteMarker(ll).addTo(map);
        const r = +f.radius.value || 150; if (circle) circle.setLatLng(ll).setRadius(r); else circle = L.circle(ll, { radius: r, color: '#4f46e5', weight: 1.5, fillOpacity: .1 }).addTo(map);
        if (pan) map.setView(ll, 15);
      };
      if (site) place({ lat: site.lat, lng: site.lng });
      map.on('click', (e) => place(e.latlng));
      f.radius.addEventListener('input', () => circle && circle.setRadius(+f.radius.value || 150));
      [f.lat, f.lng].forEach((i) => i.addEventListener('change', () => { if (isFinite(+f.lat.value) && isFinite(+f.lng.value) && f.lat.value && f.lng.value) place({ lat: +f.lat.value, lng: +f.lng.value }, true); }));
      $('#save', el).addEventListener('click', async (e) => {
        $('#err', el).innerHTML = '';
        try { const d = formData(f); await withBusy(e.currentTarget, () => (site ? put(`/admin/sites/${site.id}`, d) : post('/admin/sites', d))); toast(site ? 'Site updated' : 'Site added', 'success'); close(); done(); }
        catch (er) { $('#err', el).innerHTML = `<div class="alert err">${icon('alert')}<span>${esc(er.message)}</span></div>`; }
      });
    } });
}
