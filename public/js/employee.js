import { get, post, del, setToken, session, ApiError } from './api.js';
import { $, $$, esc, icon, toast, modal, confirmDialog, withBusy, fmtTime, fmtTimeS, fmtDur, fmtClock, fmtDist, fmtDate, fmtDateShort,
  startOfDay, greeting, avatar, visitChip, empty, skeletonRows, successCheck, confetti, formData, fieldErr } from './ui.js';
import { createMap, personMarker, siteMarker, geofence, routeLine, dotMarker, fit, haversine } from './map.js';
import { mountVerify } from './face.js';
import { notify, clearNotify, ensurePermission, nativePlugin } from './notify.js';
import { getRoute, navLink, pickPlace, shrinkImage, photoBlock, mountPhotos, meetingBlock, OUTCOMES } from './extras.js';

/* ======================================================================
   Location tracker — module-level so tracking continues while the employee
   moves between screens. Location tracking is deliberately separate from
   face verification: it only reports *where* the phone is; the server
   decides arrival and only a verified face starts the official visit.
   ====================================================================== */
const simKey = 'argus.sim';
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* storage unavailable */ } };

const tracker = {
  visit: null, site: null, last: null, watchId: null, nativeWatch: null, nativeStopped: false, ann: null, offAnnounced: false, pushTimer: null, simTimer: null, lastPush: 0, listeners: new Set(), denied: false, error: null,
  get simulated() { return !!this.visit && lsGet(simKey) === this.visit.id; },
};

function emit() { tracker.listeners.forEach((fn) => fn()); }

function onFix(pos, simulated = false) {
  tracker.last = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, t: Date.now(), simulated };
  tracker.denied = false; tracker.error = null; trackerRecovered();
  emit();
  if (Date.now() - tracker.lastPush > 4500) push();
}

async function push() {
  if (!tracker.visit || !tracker.last) return;
  tracker.lastPush = Date.now();
  const f = tracker.last;
  try {
    const r = await post(`/emp/visits/${tracker.visit.id}/location`, { lat: f.lat, lng: f.lng, acc: f.acc, simulated: f.simulated });
    announce(r.visit);
    tracker.onVisit && tracker.onVisit(r.visit);
  } catch (e) {
    if (e.status === 409) { stopTracking(); tracker.onVisit && tracker.onVisit(null); }
  }
}

// Status-bar / browser notifications for every milestone. `tracker.ann` remembers what was already announced so
// each change fires once, whichever screen the employee is on.
const hm = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function announce(v) {
  if (!v || !tracker.ann || tracker.ann.id !== v.id) return;
  const a = tracker.ann, name = v.site.name;
  if (v.status !== a.status) {
    a.status = v.status;
    if (v.status === 'at_site') notify('📍 Reached the site', `You’re at ${name}. Take the company photo, then verify your face to start the meeting.`, { tag: 'visit-event' });
    else if (v.status === 'active') notify('✅ Meeting started', `${name} · started ${hm(v.verifiedStart ? v.verifiedStart.t : Date.now())}. Location tracking stays on.`, { tag: 'visit-event' });
    else if (v.status === 'completed') notify('🏁 Meeting ended', `${name} · ${fmtDur(v.visitSec)} on site. Your visit has been recorded.`, { tag: 'visit-event' });
    else if (v.status === 'cancelled') notify('Visit cancelled', `Your visit to ${name} was cancelled.`, { tag: 'visit-event' });
  }
  if (v.leftGeofence && !a.left) { a.left = true; notify('⚠️ You moved away from the site', `You left the ${name} area during an active meeting.`, { tag: 'visit-warn' }); }
}
function trackerProblem(msg) {
  if (tracker.offAnnounced) return;
  tracker.offAnnounced = true;
  notify('📵 Location is OFF', msg || 'Tracking paused. Turn location back on to continue your visit.', { tag: 'visit-warn' });
}
function trackerRecovered() {
  if (!tracker.offAnnounced) return;
  tracker.offAnnounced = false; clearNotify('visit-warn');
  notify('📡 Location is back on', 'Tracking has resumed.', { tag: 'visit-warn' });
}

export function stopTracking() {
  if (tracker.visit) { clearNotify('tracking'); }
  const nbg = nativePlugin('BackgroundGeolocation');
  if (nbg && tracker.nativeWatch != null) nbg.removeWatcher({ id: tracker.nativeWatch }).catch(() => {});
  tracker.nativeStopped = true; tracker.nativeWatch = null; tracker.ann = null; tracker.offAnnounced = false;
  if (tracker.watchId != null) navigator.geolocation.clearWatch(tracker.watchId);
  clearInterval(tracker.pushTimer); clearInterval(tracker.simTimer);
  Object.assign(tracker, { visit: null, site: null, watchId: null, pushTimer: null, simTimer: null, last: null });
}

function startTracking(visit) {
  if (tracker.visit && tracker.visit.id === visit.id) { tracker.visit = visit; return; }
  stopTracking();
  tracker.visit = visit; tracker.site = visit.site; tracker.nativeStopped = false;
  tracker.ann = { id: visit.id, status: visit.status, left: !!visit.leftGeofence };
  const nbg = nativePlugin('BackgroundGeolocation');
  if (!nbg) notify('📍 Location tracking is ON', `Tracking your visit to ${visit.site.name}`, { tag: 'tracking', ongoing: true });
  const sim = lsGet(simKey) === visit.id;
  if (sim) {
    const from = visit.lastLocation || visit.travelStart;
    let cur = { lat: from.lat, lng: from.lng };
    const total = Math.max(haversine(cur, visit.site), 1), step = Math.max(total / 16, 25);
    const move = () => {
      const d = haversine(cur, visit.site);
      if (visit.status === 'travelling' || visit.status === 'at_site') {
        const stopAt = visit.site.radius * 0.35;
        if (d > stopAt) { const k = Math.min(1, step / d); cur = { lat: cur.lat + (visit.site.lat - cur.lat) * k, lng: cur.lng + (visit.site.lng - cur.lng) * k }; }
      }
      onFix({ coords: { latitude: cur.lat, longitude: cur.lng, accuracy: 8 } }, true);
    };
    move(); tracker.simTimer = setInterval(move, 1000);
  } else if (nbg) {
    // Android app: a foreground service keeps GPS running with the screen off, and shows the pinned "location on" notification.
    nbg.addWatcher({ backgroundTitle: 'Argus Field — Location is ON', backgroundMessage: `Tracking your visit to ${visit.site.name}`, requestPermissions: true, stale: false, distanceFilter: 5 }, (loc, err) => {
      if (err) { tracker.denied = err.code === 'NOT_AUTHORIZED'; tracker.error = tracker.denied ? 'Location permission is off' : 'Waiting for GPS signal…'; if (tracker.denied) trackerProblem('Location permission is off. Allow location for Argus Field to continue.'); emit(); return; }
      if (loc) onFix({ coords: { latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy } });
    }).then((id) => { if (tracker.nativeStopped || !tracker.visit) nbg.removeWatcher({ id }).catch(() => {}); else tracker.nativeWatch = id; });
  } else if (navigator.geolocation) {
    tracker.watchId = navigator.geolocation.watchPosition((p) => onFix(p), (err) => {
      tracker.denied = err.code === 1; tracker.error = err.code === 1 ? 'Location permission is off' : 'Waiting for GPS signal…';
      if (err.code === 1) trackerProblem('Location permission is off. Enable it in your browser/site settings to continue.');
      emit();
    }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  }
  tracker.pushTimer = setInterval(push, 5000);
}

function currentFix() {
  if (tracker.last && Date.now() - tracker.last.t < 20000) return Promise.resolve(tracker.last);
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('Location is not supported on this device'));
    navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, simulated: false }),
      (e) => rej(new Error(e.code === 1 ? 'Location permission is off. Enable it to continue.' : 'Could not get your location. Move to an open area and try again.')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });
}

/* ============================ helpers ============================ */
const STEPS = ['Not Started', 'On the Way', 'At Site', 'Completed'];
function stepper(i) {
  return `<div class="steps">${STEPS.map((s, k) => `<div class="s ${k < i ? 'done' : ''} ${k === i ? 'cur' : ''}"><i>${k < i ? icon('check') : ''}</i>${s}</div>`).join('')}</div>`;
}
function etaOf(dist, visit) {
  const pts = (visit.route || []).slice(-6);
  let v = 0;
  if (pts.length > 2 && !tracker.simulated) { const dt = (pts[pts.length - 1].t - pts[0].t) / 1000; if (dt > 5) v = haversine(pts[0], pts[pts.length - 1]) / dt; }
  if (v < 1.5) v = 7; // ≈25 km/h urban default
  const sec = dist / v;
  return { sec, at: Date.now() + sec * 1000 };
}
const posOf = (visit) => tracker.last || visit.lastLocation || visit.travelStart;

function shell(root, active, inner, { nav = true } = {}) {
  root.innerHTML = `<div class="emp">${inner}${nav ? `<nav class="nav-b">
    <a href="#/e" class="${active === 'home' ? 'on' : ''}">${icon('home')}Home</a>
    <a href="#/e/history" class="${active === 'history' ? 'on' : ''}">${icon('clock')}History</a>
    <a href="#/e/profile" class="${active === 'profile' ? 'on' : ''}">${icon('user')}Profile</a></nav>` : ''}</div>`;
}

function summaryCard(v, title) {
  const done = v.status === 'completed';
  return `<div class="summary"><div class="hd"><p style="opacity:.8;font-size:12.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase">${esc(title || (done ? 'Visit summary' : 'Visit'))}</p><h2>${esc(v.site.name)}</h2><p style="opacity:.8;font-size:13px;margin-top:2px">${esc(v.site.address || '')}</p></div>
    <dl>
      <div><dt>Travel started</dt><dd>${fmtTime(v.travelStart.t)}</dd></div>
      <div><dt>Arrival</dt><dd>${fmtTime(v.arrival && v.arrival.t)}</dd></div>
      <div><dt>Visit started <span class="muted" style="font-weight:500">(face verified)</span></dt><dd>${fmtTime(v.verifiedStart && v.verifiedStart.t)}</dd></div>
      <div><dt>Visit ended</dt><dd>${fmtTime(v.end && v.end.t)}</dd></div>
      <div><dt>Travel time</dt><dd>${fmtDur(v.travelSec)}</dd></div>
      <div><dt>Visit duration</dt><dd style="color:var(--brand);font-size:18px">${fmtDur(v.visitSec)}</dd></div>
      <div><dt>Status</dt><dd>${visitChip(v.status)}</dd></div>
    </dl></div>`;
}

function permissionHelp() {
  modal({ title: 'Turn on location', sub: 'Argus needs your location to confirm you reached the customer site.',
    body: `<div class="col" style="gap:10px;padding-bottom:10px"><div class="alert warn">${icon('alert')}<span>Location access is blocked for this site.</span></div>
      <ol class="sub" style="margin:0;padding-left:20px;line-height:1.8"><li>Tap the lock icon in your browser’s address bar</li><li>Set <b>Location</b> to <b>Allow</b></li><li>Reload and start your visit again</li></ol></div>`,
    footer: `<button class="btn primary" data-close>Got it</button>` });
}

/* ============================ router ============================ */
export async function employeeRoute(root, parts) {
  const [page, a, b] = parts;
  if (page === 'history') return historyPage(root);
  if (page === 'visit') return visitPage(root, a);
  if (page === 'profile') return profilePage(root);
  if (page === 'verify') return verifyPage(root, a, b);
  if (page === 'meeting') return meetingPage(root, a);
  if (page === 'done') return donePage(root, a);
  return homePage(root);
}

/* ============================ Home (state-driven) ============================ */
async function homePage(root) {
  const user = session.user;
  shell(root, 'home', `<div class="emp-hero"><div class="row between"><div class="row" style="gap:10px"><div class="lockup" style="color:#fff"><div class="logo" style="background:rgba(255,255,255,.2);box-shadow:none">${icon('pin')}</div></div><span style="font-weight:700;opacity:.9">${esc(session.config.orgName)}</span></div>${avatar(user).replace('class="avatar"', 'class="avatar" ')}</div>
    <h1>${greeting()}, ${esc(user.name.split(' ')[0])}</h1><p>${new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</p></div>
    <div class="emp-body"><div class="card">${skeletonRows(3, 54)}</div></div>`);

  let data, map, layers = {}, timers = [], destroyed = false, selectedSite = null, road = null, roadAt = 0, roadBusy = false, roadFitted = false;
  const body = () => $('.emp-body', root);

  async function load() {
    data = await get(`/emp/today?since=${startOfDay()}`);
    if (data.open) startTracking(data.open); else stopTracking();
    render();
  }

  function render() {
    if (destroyed) return;
    if (map) { map.remove(); map = null; layers = {}; }
    const v = data.open;
    if (!v) return renderIdle();
    if (v.status === 'travelling') return renderTravelling();
    if (v.status === 'at_site') return renderAtSite();
    return renderActive();
  }

  const todayList = () => data.today.length ? `<div class="col" style="gap:10px"><p class="cap" style="text-align:left">Today’s visits</p>${data.today.map((v) =>
    `<a class="vcard" href="#/e/visit/${v.id}" style="color:inherit"><div class="avatar" style="background:var(--teal-soft);color:var(--teal)">${icon('check')}</div><div class="grow"><b>${esc(v.site.name)}</b><div class="muted" style="font-size:12.5px">${fmtTime(v.verifiedStart && v.verifiedStart.t)} – ${fmtTime(v.end && v.end.t)}</div></div><b>${fmtDur(v.visitSec)}</b></a>`).join('')}</div>` : '';

  /* ---- day plan ---- */
  const doneIds = () => new Set((data.today || []).map((v) => v.siteId));
  function stopRow(x, done) {
    return `<button class="site-opt ${x.id === selectedSite ? 'on' : ''}" data-id="${x.id}"><span class="pin">${icon(x.ownerId ? 'pin' : 'building')}</span><span class="grow"><b style="display:block">${esc(x.name)}</b><span class="muted" style="font-size:12.5px">${esc((x.address || '').slice(0, 70))}</span></span>
      ${done ? '<span class="chip green">Visited</span>' : ''}${x.ownerId && !done ? `<span class="x" role="button" tabindex="0" data-del="${x.id}" aria-label="Remove stop">${icon('trash')}</span>` : ''}</button>`;
  }
  function planCard() {
    const done = doneIds(), mine = data.sites.filter((x) => x.ownerId), shared = data.sites.filter((x) => !x.ownerId);
    return `<div class="col" style="gap:10px"><div class="row between"><p class="cap" style="text-align:left">Today’s plan <span class="muted">· ${mine.length} stop${mine.length === 1 ? '' : 's'}</span></p>
        <button class="btn sm" id="addstop" type="button">${icon('plus')} Add stop</button></div>
      ${mine.length ? `<div class="site-pick">${mine.map((x) => stopRow(x, done.has(x.id))).join('')}</div>` : `<div class="alert info">${icon('pin')}<span>Add the places you’ll visit today. Tap <b>Add stop</b>, search the company or drop a pin on the map.</span></div>`}
      ${shared.length ? `<p class="cap" style="text-align:left;margin-top:6px">Company sites</p><div class="site-pick">${shared.map((x) => stopRow(x, false)).join('')}</div>` : ''}</div>`;
  }

  /* ---- before visit / completed ---- */
  function renderIdle() {
    const last = data.today[0];
    const justDone = last && Date.now() - last.end.t < 10 * 60000 ? last : null;
    if (!data.sites.some((x) => x.id === selectedSite)) selectedSite = null;
    selectedSite = selectedSite || (data.sites.find((x) => x.ownerId && !doneIds().has(x.id)) || data.sites[0] || {}).id || null;
    const sim = session.config.allowSimulation;
    body().innerHTML = `
      <div class="card col" style="gap:18px">${stepper(justDone ? 3 : 0)}
        ${justDone ? `<div class="bignote"><div style="color:var(--teal);margin-bottom:6px">${icon('check')}</div><h2>Visit completed successfully ✓</h2><p>${esc(justDone.site.name)} · ${fmtDur(justDone.visitSec)} on site</p></div>`
          : `<div class="bignote"><h2>Ready for your next visit</h2><p>No active visit</p></div>`}
        ${planCard()}
        <div id="startmsg"></div>
        <button class="btn primary start-btn block" id="start" ${data.sites.length ? '' : 'disabled'}>START SITE VISIT</button>
        ${sim ? `<label class="row" style="gap:10px;font-size:13px;color:var(--ink-2);cursor:pointer"><input type="checkbox" id="sim" ${lsGet('argus.simMode') === '1' ? 'checked' : ''}><span><b>Demo mode</b> — simulate GPS (no need to travel)</span></label>` : ''}
      </div>${justDone ? summaryCard(justDone, 'Last visit') : ''}${todayList()}`;

    $$('.site-opt', root).forEach((el) => el.addEventListener('click', (e) => {
      if (e.target.closest('[data-del]')) return;
      selectedSite = el.dataset.id; $$('.site-opt', root).forEach((x) => x.classList.toggle('on', x === el));
    }));
    $$('[data-del]', root).forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!(await confirmDialog({ title: 'Remove this stop?', text: 'It will be removed from your plan.', confirm: 'Remove', danger: true }))) return;
      try { await del(`/emp/sites/${b.dataset.del}`); if (selectedSite === b.dataset.del) selectedSite = null; await load(); } catch (err) { toast(err.message, 'error'); }
    }));
    const addBtn = $('#addstop', root);
    addBtn && addBtn.addEventListener('click', async () => {
      const here = tracker.last || await currentFix().catch(() => null);
      const saved = await pickPlace({ start: here, onSave: async (p) => { const r = await post('/emp/sites', p); selectedSite = r.site.id; } });
      if (saved) { toast('Stop added to your plan', 'success'); await load(); }
    });
    const simBox = $('#sim', root); simBox && simBox.addEventListener('change', () => lsSet('argus.simMode', simBox.checked ? '1' : null));
    $('#start', root).addEventListener('click', (e) => startVisit(e.currentTarget));
  }

  async function startVisit(btn) {
    const msg = $('#startmsg', root); msg.innerHTML = '';
    const site = data.sites.find((s) => s.id === selectedSite);
    if (!site) { msg.innerHTML = `<div class="alert warn">${icon('alert')}<span>Pick a stop from your plan first.</span></div>`; return; }
    const simulate = session.config.allowSimulation && lsGet('argus.simMode') === '1';
    ensurePermission(); // lets the browser/app show status-bar notifications
    try {
      await withBusy(btn, async () => {
        let pos;
        if (simulate) pos = { lat: site.lat - 0.027, lng: site.lng - 0.012, acc: 8, simulated: true };
        else {
          msg.innerHTML = `<div class="alert info">${icon('target')}<span>Getting your location… allow access if prompted.</span></div>`;
          pos = await currentFix();
        }
        const r = await post('/emp/visits', { siteId: site.id, lat: pos.lat, lng: pos.lng, acc: pos.acc, simulated: !!pos.simulated });
        if (simulate) lsSet(simKey, r.visit.id); else lsSet(simKey, null);
        data.open = r.visit; startTracking(r.visit); toast(`Heading to ${site.name}`, 'success', 'Visit started');
        notify('🚗 Visit started', `Heading to ${site.name}. Location tracking is ON.`, { tag: 'visit-event' });
        if (r.visit.status === 'at_site') announce(r.visit);
        render();
      });
    } catch (e) {
      if (/permission/i.test(e.message)) permissionHelp();
      msg.innerHTML = `<div class="alert err">${icon('alert')}<span>${esc(e.message)}</span></div>`;
      if (e.code === 'DUPLICATE') load();
    }
  }

  /* ---- shared live map ---- */
  function mountMap(height) {
    const v = data.open;
    const host = $('#map', root); if (!host) return;
    map = createMap(host, { zoomControl: false });
    layers.fence = geofence(v.site).addTo(map);
    layers.site = siteMarker([v.site.lat, v.site.lng]).addTo(map).bindTooltip(v.site.name, { permanent: true, direction: 'top', offset: [0, -30] });
    layers.line = L.polyline([], { color: '#4f46e5', weight: 3, dashArray: '2 8', opacity: .9 }).addTo(map);
    layers.trail = routeLine(v.route || [], '#2563eb').addTo(map);
    layers.road = L.polyline(road ? road.points : [], { color: '#4f46e5', weight: 5, opacity: .85 }).addTo(map);
    const p = posOf(v);
    layers.me = personMarker([p.lat, p.lng], '#2563eb', '').addTo(map);
    updateMap(true);
  }
  function updateMap(refit) {
    const v = data.open; if (!map || !v) return;
    const p = posOf(v);
    layers.me.setLatLng([p.lat, p.lng]);
    layers.line.setLatLngs(road ? [] : [[p.lat, p.lng], [v.site.lat, v.site.lng]]);
    if (layers.road && road) layers.road.setLatLngs(road.points);
    const trail = (v.route || []).map((r) => [r.lat, r.lng]); trail.push([p.lat, p.lng]); layers.trail.setLatLngs(trail);
    if (refit) fit(map, [layers.me, layers.fence, road && road.points.length ? layers.road : null], 60);
  }

  // Road route from the live position to the site (refreshed every ~30 s or after moving ~300 m).
  async function refreshRoad() {
    const v = data && data.open; if (!v || v.status !== 'travelling' || roadBusy) return;
    const p = posOf(v);
    if (road && Date.now() - roadAt < 30000 && haversine(p, road.from) < 300) return;
    roadBusy = true;
    try {
      const r = await getRoute(p, v.site);
      if (r && !destroyed) { road = { ...r, from: { lat: p.lat, lng: p.lng } }; roadAt = Date.now(); updateMap(!roadFitted); roadFitted = true; tickTravel(); }
    } finally { roadBusy = false; }
  }

  /* ---- travelling ---- */
  function renderTravelling() {
    const v = data.open, p = posOf(v), d = haversine(p, v.site);
    body().innerHTML = `
      <div class="card col" style="gap:16px">${stepper(1)}
        <div class="bignote"><h2>You’re on the way</h2><p><b id="d-rem">${fmtDist(d)}</b> <span id="d-how">to go</span> · arrive about <b id="d-eta"></b></p></div>
        <div id="gpsnote"></div>
        <div class="stat"><div><small>Destination</small><b>${esc(v.site.name)}</b></div><div><small>Distance to site</small><b id="s-dist">${fmtDist(d)}</b></div>
          <div><small>Started</small><b>${fmtTime(v.travelStart.t)}</b></div><div><small>Current time</small><b class="mono" data-live="now"></b></div></div>
        <div class="row between"><span class="sub">Visit status</span>${visitChip('travelling')}</div></div>
      <div class="emp-map"><div id="map" class="map"></div></div>
      <div class="row"><button class="btn grow" id="route">${icon('route')} View Route</button><a class="btn grow" id="navgo" target="_blank" rel="noopener" href="${navLink(v.site)}">${icon('nav')} Navigate</a>${tracker.simulated ? `<span class="chip brand">Simulated GPS</span>` : ''}</div>
      <p class="muted" style="text-align:center;font-size:12.5px">Arrival is detected automatically when you’re within ${v.site.radius} m of the site. Face verification comes next.</p>
      <button class="btn ghost sm" id="cancel" style="align-self:center">Cancel this visit</button>`;
    mountMap();
    $('#route', root).addEventListener('click', () => fit(map, [layers.me, layers.site, layers.fence, road ? layers.road : null], 70));
    refreshRoad();
    $('#cancel', root).addEventListener('click', cancelVisit);
    tickTravel();
  }
  function tickTravel() {
    const v = data.open; if (!v || v.status !== 'travelling') return;
    const p = posOf(v), straight = haversine(p, v.site);
    const left = road ? Math.max(straight, road.meters - haversine(road.from, p)) : straight, d = left;
    const eta = road ? { sec: road.seconds * (d / Math.max(road.meters, 1)), at: Date.now() + road.seconds * 1000 * (d / Math.max(road.meters, 1)) } : etaOf(d, v);
    const set = (id, t) => { const el = $(id, root); if (el) el.textContent = t; };
    set('#d-rem', fmtDist(d)); set('#s-dist', fmtDist(d)); set('#d-how', road ? 'by road' : 'to go'); set('#d-eta', `${fmtTime(eta.at)} (${Math.max(1, Math.round(eta.sec / 60))} min)`);
    const note = $('#gpsnote', root);
    if (note) note.innerHTML = tracker.denied ? `<div class="alert err">${icon('alert')}<span>Location is off — tracking paused. <a href="#" id="help">How to fix</a></span></div>`
      : tracker.last && tracker.last.acc > data_max() ? `<div class="alert warn">${icon('alert')}<span>Weak GPS (±${Math.round(tracker.last.acc)} m). Move to an open area.</span></div>` : tracker.error ? `<div class="alert warn">${icon('wifi')}<span>${esc(tracker.error)}</span></div>` : '';
    const h = $('#help', root); h && (h.onclick = (e) => { e.preventDefault(); permissionHelp(); });
  }
  const data_max = () => (data && data.settings ? data.settings.maxAccuracy : 100);

  async function cancelVisit() {
    if (!(await confirmDialog({ title: 'Cancel this visit?', text: 'Travel will stop and nothing is recorded as attendance.', confirm: 'Cancel visit', danger: true }))) return;
    try { const nm = data.open.site.name; await post(`/emp/visits/${data.open.id}/cancel`); stopTracking(); notify('Visit cancelled', `Your visit to ${nm} was cancelled.`, { tag: 'visit-event' }); lsSet(simKey, null); toast('Visit cancelled'); await load(); } catch (e) { toast(e.message, 'error'); }
  }

  /* ---- at site ---- */
  function renderAtSite() {
    const v = data.open, has = !!v.sitePhoto;
    body().innerHTML = `
      <div class="card col" style="gap:16px">${stepper(2)}
        <div class="bignote"><div style="width:64px;height:64px;border-radius:22px;background:var(--orange-soft);color:var(--orange);display:grid;place-items:center;margin:0 auto 10px">${icon('flag')}</div>
          <h2>You’ve reached the site</h2><p>${has ? 'Photo saved — now verify your face to start the visit' : 'First, capture the company logo or visiting card'}</p></div>
        <div class="stat"><div><small>Customer</small><b>${esc(v.site.name)}</b></div><div><small>Arrived</small><b>${fmtTime(v.arrival.t)}</b></div></div>
        <div class="col" style="gap:10px"><div class="row between"><p class="cap" style="text-align:left">1 · Company logo / visiting card</p>${has ? '<span class="chip green">Done</span>' : '<span class="chip orange">Required</span>'}</div>
          ${has ? `<div data-photo-wrap><img class="proof hide" alt="Company logo or visiting card" data-photo="${v.id}"></div>` : ''}
          <div id="photomsg"></div>
          <div class="row" style="gap:10px"><label class="btn grow ${has ? '' : 'primary'}" style="cursor:pointer">${icon('camera')} ${has ? 'Retake' : 'Take photo'}<input type="file" accept="image/*" capture="environment" id="pcam" hidden></label>
            <label class="btn grow" style="cursor:pointer">${icon('download')} Upload<input type="file" accept="image/*" id="pfile" hidden></label></div></div>
        <div class="alert warn">${icon('shield')}<span>Your visit isn’t recorded yet. Attendance starts only after face verification.</span></div>
        <div class="col" style="gap:8px"><p class="cap" style="text-align:left">2 · Verify your face</p>
        ${has ? `<a class="btn primary lg block" href="#/e/verify/start/${v.id}">${icon('scan')} VERIFY FACE</a>` : `<button class="btn lg block" disabled>${icon('scan')} VERIFY FACE</button>`}</div></div>
      <div class="emp-map"><div id="map" class="map"></div></div>
      <button class="btn ghost sm" id="cancel" style="align-self:center">Cancel this visit</button>`;
    mountMap(); mountPhotos(root); $('#cancel', root).addEventListener('click', cancelVisit);
    const onPick = async (e) => {
      const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
      const msg = $('#photomsg', root); msg.innerHTML = `<div class="alert info">${icon('camera')}<span>Uploading photo…</span></div>`;
      try {
        const image = await shrinkImage(f);
        const r = await post(`/emp/visits/${v.id}/site-photo`, { image });
        data.open = { ...data.open, ...r.visit, route: data.open.route };
        toast('Photo saved', 'success'); notify('📸 Site photo saved', `Now verify your face to start the meeting at ${v.site.name}.`, { tag: 'visit-event' }); render();
      } catch (err) { msg.innerHTML = `<div class="alert err">${icon('alert')}<span>${esc(err.message)}</span></div>`; }
    };
    $('#pcam', root).addEventListener('change', onPick); $('#pfile', root).addEventListener('change', onPick);
  }

  /* ---- active ---- */
  function renderActive() {
    const v = data.open, p = posOf(v);
    body().innerHTML = `
      <div class="card col" style="gap:16px">${stepper(2)}
        <div class="row between"><span class="chip green"><span class="dot"></span>SITE VISIT ACTIVE</span><span class="muted" style="font-size:12.5px">${tracker.simulated ? 'Simulated GPS' : 'Live tracking on'}</span></div>
        <div><p class="cap">Visit duration</p><div class="big-time" data-live="duration">00:00:00</div></div>
        <div class="stat"><div><small>Customer / Site</small><b>${esc(v.site.name)}</b></div><div><small>Employee</small><b>${esc(session.user.name)}</b></div>
          <div><small>Arrival</small><b>${fmtTime(v.arrival.t)}</b></div><div><small>Visit started</small><b>${fmtTime(v.verifiedStart.t)}</b></div></div>
        <div class="row between sub"><span>${icon('pin')} <span id="loc" class="mono">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</span></span>${visitChip('active')}</div>
        <a class="btn danger lg block" href="#/e/meeting/${v.id}">${icon('flag')} END VISIT</a></div>
      <div class="emp-map"><div id="map" class="map"></div></div>`;
    mountMap();
    tickActive();
  }
  function tickActive() {
    const v = data.open; if (!v || v.status !== 'active') return;
    const el = $('[data-live="duration"]', root); if (el) el.textContent = fmtClock((Date.now() - v.verifiedStart.t) / 1000);
  }

  /* ---- live updates ---- */
  function onTrackerUpdate() {
    if (destroyed || !data || !data.open) return;
    updateMap(false);
    const p = posOf(data.open); const loc = $('#loc', root); if (loc) loc.textContent = `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
    tickTravel(); refreshRoad();
  }
  tracker.listeners.add(onTrackerUpdate);
  tracker.onVisit = (nv) => {
    if (destroyed) return;
    if (!nv) { load(); return; }
    const prev = data.open && data.open.status;
    data.open = { ...data.open, ...nv, route: (tracker.visit && tracker.visit.route) || data.open.route };
    if (prev !== nv.status) { if (nv.status === 'at_site') toast(`You’ve reached ${nv.site.name}. Verify your face to start.`, 'success', 'Arrived'); load(); }
  };
  timers.push(setInterval(() => { $$('[data-live="now"]', root).forEach((e) => { e.textContent = fmtTimeS(Date.now()); }); tickActive(); if (data.open && data.open.status === 'travelling') tickTravel(); }, 1000));
  timers.push(setInterval(() => { if (!destroyed) load().catch(() => {}); }, 20000));

  try { await load(); } catch (e) { body().innerHTML = `<div class="card">${empty('alert', 'Couldn’t load', e.message, '<button class="btn" onclick="location.reload()">Retry</button>')}</div>`; }
  return () => { destroyed = true; timers.forEach(clearInterval); tracker.listeners.delete(onTrackerUpdate); tracker.onVisit = null; if (map) map.remove(); };
}

/* ============================ Meeting details (before ending a visit) ============================ */
async function meetingPage(root, id) {
  document.body.classList.add('is-emp');
  let visit;
  try { visit = (await get(`/emp/visits/${id}`)).visit; } catch { location.hash = '#/e'; return; }
  if (visit.status !== 'active') { location.hash = '#/e'; return; }
  let saved = {}; try { saved = JSON.parse(sessionStorage.getItem('argus.meeting.' + id)) || {}; } catch { /* none */ }
  const products = [...(saved.products || [])]; let outcome = saved.outcome || 'follow_up';
  shell(root, 'home', `<div class="emp-hero" style="padding-bottom:60px"><a href="#/e" class="row" style="color:#fff;font-weight:600">${icon('back')} Back to visit</a><h1>Meeting details</h1><p>${esc(visit.site.name)} · tell us how it went</p></div>
    <div class="emp-body"><form class="card col" id="mf" style="gap:16px" novalidate>
      <div class="field"><label>Who did you meet? <span class="muted">(optional)</span></label><input class="input" name="contact" maxlength="80" value="${esc(saved.contact || '')}" placeholder="Name and role"></div>
      <div class="field"><label>What was discussed?</label><textarea class="input" name="notes" rows="4" maxlength="2000" placeholder="Summary of the meeting, requirements, objections…">${esc(saved.notes || '')}</textarea></div>
      <div class="field"><label>Products discussed</label>
        <div class="row" style="gap:8px"><input class="input" id="pin" maxlength="80" placeholder="Type a product and press Add" enterkeyhint="done"><button class="btn" type="button" id="padd">${icon('plus')} Add</button></div>
        <div class="row wrap" id="plist" style="gap:6px;margin-top:6px"></div></div>
      <div class="field"><label>Outcome</label><div class="seg wrapseg" id="oc">${Object.entries(OUTCOMES).map(([k, l]) => `<button type="button" data-o="${k}" class="${k === outcome ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="field"><label>Next step <span class="muted">(optional)</span></label><input class="input" name="nextAction" maxlength="300" value="${esc(saved.nextAction || '')}" placeholder="e.g. Send quotation by Friday"></div>
      <div id="err"></div>
      <button class="btn danger lg block" type="submit">${icon('scan')} Continue — verify face to end visit</button></form></div>`, { nav: false });
  const f = $('#mf', root);
  const drawProducts = () => {
    $('#plist', root).innerHTML = products.length ? products.map((p, i) => `<span class="chip brand">${esc(p)} <button type="button" data-rm="${i}" aria-label="Remove" style="border:0;background:none;color:inherit;padding:0 0 0 4px;font-size:15px;line-height:1">×</button></span>`).join('') : '<span class="muted" style="font-size:12.5px">No products added yet</span>';
    $$('[data-rm]', root).forEach((b) => b.addEventListener('click', () => { products.splice(+b.dataset.rm, 1); drawProducts(); }));
  };
  const addProduct = () => { const inp = $('#pin', root); inp.value.split(',').map((x) => x.trim()).filter(Boolean).forEach((x) => { if (!products.includes(x) && products.length < 30) products.push(x); }); inp.value = ''; drawProducts(); };
  $('#padd', root).addEventListener('click', () => { addProduct(); $('#pin', root).focus(); });
  $('#pin', root).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addProduct(); } });
  $$('#oc [data-o]', root).forEach((b) => b.addEventListener('click', () => { outcome = b.dataset.o; $$('#oc [data-o]', root).forEach((x) => x.classList.toggle('on', x === b)); }));
  drawProducts();
  f.addEventListener('submit', (e) => {
    e.preventDefault(); addProduct();
    const d = formData(f); const err = $('#err', root);
    if (d.notes.trim().length < 5) { err.innerHTML = `<div class="alert err">${icon('alert')}<span>Write a short summary of the meeting.</span></div>`; return; }
    if (!products.length) { err.innerHTML = `<div class="alert err">${icon('alert')}<span>Add at least one product you discussed.</span></div>`; return; }
    try { sessionStorage.setItem('argus.meeting.' + id, JSON.stringify({ contact: d.contact.trim(), notes: d.notes.trim(), products, outcome, nextAction: d.nextAction.trim() })); } catch { /* private mode */ }
    location.hash = `#/e/verify/end/${id}`;
  });
}

/* ============================ Face verification ============================ */
async function verifyPage(root, kind, id) {
  document.body.classList.add('is-emp');
  let visit;
  try { visit = (await get(`/emp/visits/${id}`)).visit; } catch { location.hash = '#/e'; return; }
  const starting = kind === 'start';
  if ((starting && visit.status !== 'at_site') || (!starting && visit.status !== 'active')) { location.hash = '#/e'; return; }
  if (tracker.visit && tracker.visit.id !== id) startTracking(visit); else if (!tracker.visit) startTracking(visit);
  let meeting = null;
  if (!starting) { try { meeting = JSON.parse(sessionStorage.getItem('argus.meeting.' + id)); } catch { /* none */ } if (!meeting) { location.hash = `#/e/meeting/${id}`; return; } }

  root.innerHTML = `<div class="facepage"><header><a class="x" href="#/e" aria-label="Back">${icon('back')}</a><div><h2>${starting ? 'Verify Your Identity' : 'Verify Face to End Visit'}</h2>
      <p style="opacity:.65;font-size:13px">${esc(visit.site.name)} · ${starting ? 'Confirms your arrival' : 'Confirms you’re leaving'}</p></div></header>
    <div id="stage"></div><div class="foot" id="gps">${icon('pin')} Checking location…</div></div>`;
  const gps = () => { const el = $('#gps', root); if (!el) return; const f = tracker.last; el.innerHTML = f ? `${icon('pin')} Location locked · ±${Math.round(f.acc)} m` : `${icon('pin')} Waiting for location…`; };
  tracker.listeners.add(gps); gps();

  const h = mountVerify($('#stage', root), {
    successText: starting ? 'Face Verified' : 'Identity Verified',
    submit: async (descriptor) => {
      let fix;
      try { fix = await currentFix(); } catch (e) { throw new ApiError(e.message, 0); }
      return post(`/emp/visits/${id}/${starting ? 'verify-start' : 'verify-end'}`, { descriptor, lat: fix.lat, lng: fix.lng, acc: fix.acc, simulated: !!fix.simulated, ...(meeting ? { meeting } : {}) });
    },
    onSuccess: (r) => {
      if (r && r.visit) announce(r.visit);
      if (starting) { toast('Your visit is now recorded', 'success', 'Visit started'); location.hash = '#/e'; }
      else { stopTracking(); lsSet(simKey, null); try { sessionStorage.removeItem('argus.meeting.' + id); } catch { /* ok */ } location.hash = `#/e/done/${id}`; }
    },
  });
  return () => { h.destroy(); tracker.listeners.delete(gps); };
}

/* ============================ Visit completed ============================ */
async function donePage(root, id) {
  shell(root, 'home', `<div class="emp-hero" style="padding-bottom:54px;text-align:center"><div style="position:relative">${successCheck()}<h1 style="font-size:26px;margin-top:14px">Visit Completed ✓</h1><p>Great work — your visit has been recorded.</p></div></div><div class="emp-body"><div class="card">${skeletonRows(4)}</div></div>`, { nav: false });
  confetti($('.emp-hero', root));
  try {
    const { visit } = await get(`/emp/visits/${id}`);
    $('.emp-body', root).innerHTML = `${summaryCard(visit)}
      <div class="card flat"><p class="cap" style="text-align:left;margin-bottom:10px">Time breakdown</p>
        <div class="split"><i style="flex:${Math.max(visit.travelSec, 1)};background:#93a4f8"></i><i style="flex:${Math.max(visit.visitSec, 1)};background:var(--brand)"></i></div>
        <div class="row between" style="margin-top:10px;font-size:13px"><span><span class="chip blue">Travel</span> ${fmtDur(visit.travelSec)}</span><span><span class="chip brand">On site</span> ${fmtDur(visit.visitSec)}</span></div>
        <p class="muted" style="font-size:12px;margin-top:10px">Only the face-verified period counts as your official site visit time.</p></div>
      ${meetingBlock(visit.meeting)}${visit.sitePhoto ? `<div class="card">${photoBlock(visit)}</div>` : ''}
      <a class="btn primary lg block" href="#/e">Back to dashboard</a>`;
    mountPhotos(root);
  } catch (e) { $('.emp-body', root).innerHTML = `<div class="card">${empty('alert', 'Couldn’t load visit', e.message)}</div>`; }
}

/* ============================ History ============================ */
async function historyPage(root) {
  shell(root, 'history', `<div class="emp-hero" style="padding-bottom:60px"><h1 style="margin-top:6px">Visit history</h1><p>Your recent site visits</p></div><div class="emp-body" id="b"><div class="card">${skeletonRows(4, 60)}</div></div>`);
  try {
    const { visits } = await get('/emp/visits');
    const b = $('#b', root);
    if (!visits.length) { b.innerHTML = `<div class="card">${empty('clock', 'No visits yet', 'Your completed site visits will show up here.')}</div>`; return; }
    const groups = {};
    visits.forEach((v) => { (groups[fmtDate(v.travelStart.t)] ||= []).push(v); });
    b.innerHTML = Object.entries(groups).map(([d, vs]) => `<div class="col" style="gap:10px"><p class="cap" style="text-align:left">${d}</p>${vs.map((v) =>
      `<a class="vcard" href="#/e/visit/${v.id}" style="color:inherit"><div class="grow"><b>${esc(v.site.name)}</b><div class="muted" style="font-size:12.5px">${v.verifiedStart ? `${fmtTime(v.verifiedStart.t)} – ${fmtTime(v.end && v.end.t)}` : `Travel from ${fmtTime(v.travelStart.t)}`}</div></div><div style="text-align:right"><b>${v.verifiedStart ? fmtDur(v.visitSec) : '—'}</b><div style="margin-top:4px">${visitChip(v.status)}</div></div></a>`).join('')}</div>`).join('');
  } catch (e) { $('#b', root).innerHTML = `<div class="card">${empty('alert', 'Couldn’t load history', e.message)}</div>`; }
}

async function visitPage(root, id) {
  shell(root, 'history', `<div class="emp-hero" style="padding-bottom:60px"><a href="#/e/history" class="row" style="color:#fff;font-weight:600">${icon('back')} History</a><h1>Visit details</h1></div><div class="emp-body" id="b"><div class="card">${skeletonRows(4)}</div></div>`);
  let map;
  try {
    const { visit: v } = await get(`/emp/visits/${id}`);
    $('#b', root).innerHTML = `${summaryCard(v)}<div class="emp-map"><div id="map" class="map"></div></div>
      <div class="card flat col" style="gap:8px"><div class="row between"><span class="sub">Face verification</span>${v.end ? '<span class="chip green">Start &amp; End verified</span>' : v.verifiedStart ? '<span class="chip blue">Start verified</span>' : '<span class="chip gray">Not verified</span>'}</div>
      ${v.failedAttempts ? `<div class="row between"><span class="sub">Failed attempts</span><b>${v.failedAttempts}</b></div>` : ''}</div>
      ${meetingBlock(v.meeting)}${v.sitePhoto ? `<div class="card">${photoBlock(v)}</div>` : ''}`;
    mountPhotos(root);
    map = createMap($('#map', root), { zoomControl: false });
    const ls = [geofence(v.site).addTo(map), siteMarker([v.site.lat, v.site.lng]).addTo(map)];
    if (v.route && v.route.length > 1) ls.push(routeLine(v.route).addTo(map));
    fit(map, ls, 40);
  } catch (e) { $('#b', root).innerHTML = `<div class="card">${empty('alert', 'Visit not found', e.message)}</div>`; }
  return () => map && map.remove();
}

/* ============================ Profile ============================ */
async function profilePage(root) {
  const u = session.user;
  shell(root, 'profile', `<div class="emp-hero" style="padding-bottom:60px"><h1 style="margin-top:6px">Profile</h1><p>Your account</p></div><div class="emp-body">
    <div class="card col" style="gap:16px;align-items:center;text-align:center">${avatar(u, 'lg')}<div><h2>${esc(u.name)}</h2><p class="sub">${esc(u.designation)}</p></div></div>
    <div class="card col" style="gap:14px">
      <div class="row">${icon('mail')}<span class="grow sub">Email</span><b>${esc(u.email)}</b></div>
      <div class="row">${icon('phone')}<span class="grow sub">Phone</span><b>${esc(u.phone)}</b></div>
      <div class="row">${icon('user')}<span class="grow sub">Employee ID</span><b>${esc(u.empId)}</b></div>
      <div class="row">${icon('scan')}<span class="grow sub">Face</span><span class="chip ${u.hasFace ? 'green' : 'orange'}">${u.hasFace ? 'Registered' : 'Not registered'}</span></div></div>
    <button class="btn block danger" id="out">${icon('logout')} Sign out</button></div>`);
  $('#out', root).addEventListener('click', async () => {
    if (tracker.visit && !(await confirmDialog({ title: 'Sign out?', text: 'You have a visit in progress. Location tracking will stop while you’re signed out.', confirm: 'Sign out', danger: true }))) return;
    stopTracking(); setToken(null); session.user = null; location.hash = '#/login';
  });
}
