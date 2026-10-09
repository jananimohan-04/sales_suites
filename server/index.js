try { process.loadEnvFile(require('path').join(__dirname, '..', '.env')); } catch { /* no .env file */ }
const express = require('express');
const path = require('path');
const store = require('./db');
const sec = require('./security');
const mail = require('./mail');
const google = require('./google');
const { distance, validCoord, euclid } = require('./geo');

const app = express();
const PORT = process.env.PORT || 3000;
const ALLOW_SIM = process.env.ALLOW_SIMULATION !== 'false';
const BASE = () => process.env.PUBLIC_URL || `http://localhost:${PORT}`;
const D = () => store.db;
const now = () => Date.now();

app.post('/api/emp/visits/:id/site-photo', express.json({ limit: '4mb' }));
app.use(express.json({ limit: '200kb' }));
const fs = require('fs');
const UPLOADS = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Permissions-Policy': 'camera=(self), geolocation=(self)' });
  next();
});

// ---------- helpers ----------
class HttpError extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; } }
const bad = (m, extra) => new HttpError(400, m, extra);
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[0-9 ()-]{7,18}$/;
const str = (v, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const OPEN = ['travelling', 'at_site', 'active'];

function notify(type, title, body, userId = null, visitId = null) {
  D().notifications.push({ id: store.id(), type, title, body, userId, visitId, at: now(), read: false });
  if (D().notifications.length > 1000) D().notifications.splice(0, D().notifications.length - 1000);
  store.save();
}

function userStatus(u) {
  if (u.role !== 'employee') return 'admin';
  if (!u.registeredAt) return 'invited';
  if (!u.faceRegisteredAt) return 'registered';
  return D().visits.some((v) => v.userId === u.id) ? 'active' : 'face_registered';
}
const pubUser = (u) => u && ({
  id: u.id, role: u.role, name: u.name, email: u.email, phone: u.phone, empId: u.empId, designation: u.designation,
  status: userStatus(u), hasFace: !!u.faceTemplate, faceRegisteredAt: u.faceRegisteredAt || null,
  faceResetAllowed: !!u.faceReset, invitedAt: u.invitedAt || null, registeredAt: u.registeredAt || null, createdAt: u.createdAt,
  lastLocation: u.lastLocation || null, disabled: !!u.disabled,
});
const brief = (u) => u && ({ id: u.id, name: u.name, empId: u.empId, designation: u.designation });

function visitView(v, withRoute = false) {
  const t = now();
  const site = D().sites.find((s) => s.id === v.siteId);
  const user = D().users.find((u) => u.id === v.userId);
  const travelEnd = v.arrival ? v.arrival.t : (v.status === 'cancelled' && v.cancelledAt ? v.cancelledAt : t);
  const travelSec = Math.max(0, Math.round((travelEnd - v.travelStart.t) / 1000));
  const visitSec = v.verifiedStart ? Math.max(0, Math.round(((v.end ? v.end.t : t) - v.verifiedStart.t) / 1000)) : 0;
  const out = {
    id: v.id, status: v.status, userId: v.userId, user: brief(user), siteId: v.siteId,
    site: site && { id: site.id, name: site.name, address: site.address, lat: site.lat, lng: site.lng, radius: site.radius },
    travelStart: v.travelStart, arrival: v.arrival, verifiedStart: v.verifiedStart, end: v.end, lastLocation: v.lastLocation,
    simulated: !!v.simulated, failedAttempts: v.failedAttempts || 0, leftGeofence: !!v.leftGeofence,
    travelSec, visitSec,
    verificationGapSec: v.arrival && v.verifiedStart ? Math.round((v.verifiedStart.t - v.arrival.t) / 1000) : null,
    sitePhoto: v.sitePhoto ? { t: v.sitePhoto.t } : null, meeting: v.meeting || null,
    routePoints: (v.route || []).length, createdAt: v.travelStart.t, now: t,
  };
  if (withRoute) out.route = v.route || [];
  return out;
}

function auth(role) {
  return (req, res, next) => {
    const tok = (req.headers.authorization || '').replace(/^Bearer /, '');
    const p = sec.readToken(tok);
    const u = p && D().users.find((x) => x.id === p.uid);
    if (!u || u.disabled || !u.registeredAt) return next(new HttpError(401, 'Please sign in again'));
    if (role && u.role !== role) return next(new HttpError(403, 'Not allowed'));
    req.user = u; next();
  };
}

// ---------- public ----------
app.get('/api/config', (req, res) => res.json({
  orgName: D().settings.orgName, allowSimulation: ALLOW_SIM, emailConfigured: mail.configured, googleClientId: process.env.GOOGLE_CLIENT_ID || null,
  
  tileUrl: process.env.TILE_URL || 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
  tileAttribution: process.env.TILE_ATTRIBUTION || 'Tiles &copy; Esri',
}));

// Google is the only way in. Sign-in works only for accounts that already registered through an invitation
// (the admin account is created at first start).
async function googleIdentity(credential) {
  try { return await google.verify(credential); } catch (e) { throw new HttpError(e.status || 401, e.message); }
}
app.post('/api/auth/google', wrap(async (req, res) => {
  const g = await googleIdentity(req.body.credential);
  const u = D().users.find((x) => x.email === g.email);
  if (!u || u.disabled) throw new HttpError(403, `${g.email} has not been invited. Ask your admin to invite this Google account.`);
  if (!u.registeredAt) {
    // Invited but hasn't used the email link yet: signing in with the invited Google account completes registration.
    if (u.inviteExpires && u.inviteExpires < now()) throw new HttpError(410, 'Your invitation has expired. Ask your admin to resend it.');
    u.registeredAt = now(); u.inviteHash = null; u.inviteExpires = null;
    notify('registration', 'Registration completed', `${u.name} (${u.empId}) joined with Google`, null);
    store.save();
  }
  res.json({ token: sec.signToken({ uid: u.id }), user: pubUser(u) });
}));

app.get('/api/invite/:token', (req, res) => {
  const h = sec.sha(req.params.token);
  const u = D().users.find((x) => x.inviteHash === h);
  if (!u || u.registeredAt) throw new HttpError(404, 'This invitation link is invalid or has already been used');
  if (u.inviteExpires < now()) throw new HttpError(410, 'This invitation has expired. Ask your admin to resend it.');
  res.json({ name: u.name, email: u.email, phone: u.phone, empId: u.empId, designation: u.designation, org: D().settings.orgName });
});

app.post('/api/invite/:token/register', wrap(async (req, res) => {
  const h = sec.sha(req.params.token);
  const u = D().users.find((x) => x.inviteHash === h);
  if (!u || u.registeredAt) throw new HttpError(404, 'This invitation link is invalid or has already been used');
  if (u.inviteExpires < now()) throw new HttpError(410, 'This invitation has expired');
  const name = str(req.body.name), phone = str(req.body.phone, 20);
  if (name.length < 2) throw bad('Enter your full name');
  if (!PHONE_RE.test(phone)) throw bad('Enter a valid phone number');
  const g = await googleIdentity(req.body.credential);
  if (g.email !== u.email) throw new HttpError(403, `Sign in with ${u.email} — the Google account your invitation was sent to (you used ${g.email}).`);
  u.name = name; u.phone = phone; u.registeredAt = now(); u.inviteHash = null; u.inviteExpires = null;
  notify('registration', 'Registration completed', `${u.name} (${u.empId}) created their account`, null);
  store.save();
  res.json({ token: sec.signToken({ uid: u.id }), user: pubUser(u) });
}));

// ---------- authenticated (any role) ----------
app.get('/api/me', auth(), (req, res) => res.json({ user: pubUser(req.user) }));

const validDescriptor = (d) => Array.isArray(d) && d.length === 128 && d.every((n) => typeof n === 'number' && Number.isFinite(n));

app.post('/api/me/face', auth('employee'), (req, res) => {
  const u = req.user;
  if (u.faceTemplate && !u.faceReset) throw new HttpError(409, 'A face is already registered. Ask your admin to reset it.');
  const s = req.body.samples;
  if (!Array.isArray(s) || s.length < 3 || s.length > 9 || !s.every(validDescriptor)) throw bad('Capture all three face angles and try again');
  for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) {
    if (euclid(s[i], s[j]) > 0.62) throw bad('The captured frames do not look like the same person. Please retry in good light.');
  }
  const mean = s[0].map((_, k) => s.reduce((a, d) => a + d[k], 0) / s.length);
  u.faceTemplate = sec.encryptFace(mean); u.faceRegisteredAt = now(); u.faceReset = false;
  notify('face_registered', 'Face registration completed', `${u.name} (${u.empId}) registered their face`, null);
  store.save();
  res.json({ user: pubUser(u) });
});

// ---------- employee: visits ----------
const emp = auth('employee');
const openVisit = (uid) => D().visits.find((v) => v.userId === uid && OPEN.includes(v.status));
const ownVisit = (req) => {
  const v = D().visits.find((x) => x.id === req.params.id && x.userId === req.user.id);
  if (!v) throw new HttpError(404, 'Visit not found');
  return v;
};
function readPos(body) {
  const lat = Number(body.lat), lng = Number(body.lng), acc = Number(body.acc);
  if (!validCoord(lat, lng)) throw bad('Location unavailable. Turn on GPS and allow location access.');
  if (!Number.isFinite(acc) || acc < 0) throw bad('Location accuracy unavailable');
  const simulated = !!body.simulated;
  if (simulated && !ALLOW_SIM) throw new HttpError(403, 'Simulated locations are disabled on this server');
  return { lat, lng, acc: Math.round(acc), simulated };
}
function needAccuracy(pos) {
  const max = D().settings.maxAccuracy;
  if (pos.acc > max) throw bad(`GPS accuracy is too low (±${pos.acc} m). Move to an open area — need ±${max} m or better.`, { code: 'LOW_ACCURACY' });
}
const pt = (pos) => ({ t: now(), lat: pos.lat, lng: pos.lng, acc: pos.acc });

function recordPing(v, user, pos) {
  const last = v.route[v.route.length - 1];
  if (!last || distance(last, pos) > 8 || now() - last.t > 20000) {
    v.route.push(pt(pos));
    if (v.route.length > 3000) v.route.splice(1, 1);
  }
  v.lastLocation = pt(pos);
  user.lastLocation = { ...pt(pos), visitId: v.id };
}

function checkArrival(v, u, site, pos) {
  const d = distance(pos, site);
  // Arrival is detected server-side from the reported position — the client cannot declare it.
  if (v.status === 'travelling' && d <= site.radius && pos.acc <= D().settings.maxAccuracy) {
    v.status = 'at_site'; v.arrival = pt(pos);
    notify('reached_site', 'Reached site', `${u.name} reached ${site.name}. Awaiting face verification.`, u.id, v.id);
  }
  if (v.status === 'active' && d > site.radius * 1.5) v.leftGeofence = true;
  return d;
}

const mySites = (u) => D().sites.filter((s) => !s.archived && (!s.ownerId || s.ownerId === u.id));

app.get('/api/emp/today', emp, (req, res) => {
  const since = Number(req.query.since) || new Date().setHours(0, 0, 0, 0);
  const mine = D().visits.filter((v) => v.userId === req.user.id);
  const open = mine.find((v) => OPEN.includes(v.status));
  const today = mine.filter((v) => v.travelStart.t >= since && !OPEN.includes(v.status) && v.status !== 'cancelled').sort((a, b) => b.travelStart.t - a.travelStart.t);
  res.json({
    user: pubUser(req.user),
    open: open ? visitView(open, true) : null,
    today: today.map((v) => visitView(v)),
    sites: mySites(req.user),
    settings: { maxAccuracy: D().settings.maxAccuracy },
  });
});

app.get('/api/emp/visits', emp, (req, res) => {
  const list = D().visits.filter((v) => v.userId === req.user.id).sort((a, b) => b.travelStart.t - a.travelStart.t).slice(0, 200);
  res.json({ visits: list.map((v) => visitView(v)) });
});
app.get('/api/emp/visits/:id', emp, (req, res) => res.json({ visit: visitView(ownVisit(req), true) }));

app.post('/api/emp/visits', emp, (req, res) => {
  const u = req.user;
  if (!u.faceTemplate) throw bad('Register your face before starting a visit', { code: 'NO_FACE' });
  if (openVisit(u.id)) throw new HttpError(409, 'You already have a visit in progress. Finish or cancel it first.', { code: 'DUPLICATE' });
  const site = mySites(u).find((s) => s.id === req.body.siteId);
  if (!site) throw bad('Choose a customer site');
  const pos = readPos(req.body); needAccuracy(pos);
  const v = {
    id: store.id(), userId: u.id, siteId: site.id, status: 'travelling', travelStart: pt(pos), arrival: null, verifiedStart: null,
    end: null, route: [pt(pos)], lastLocation: pt(pos), simulated: pos.simulated, failedAttempts: 0, lockUntil: 0,
  };
  D().visits.push(v);
  u.lastLocation = { ...pt(pos), visitId: v.id };
  notify('travel_started', 'Started travelling', `${u.name} is heading to ${site.name}`, u.id, v.id);
  checkArrival(v, u, site, pos);
  store.save();
  res.status(201).json({ visit: visitView(v, true) });
});

app.post('/api/emp/visits/:id/location', emp, (req, res) => {
  const v = ownVisit(req);
  if (!OPEN.includes(v.status)) throw new HttpError(409, 'This visit is no longer active');
  const pos = readPos(req.body);
  v.simulated = v.simulated || pos.simulated;
  const site = D().sites.find((s) => s.id === v.siteId);
  recordPing(v, req.user, pos);
  const d = checkArrival(v, req.user, site, pos);
  store.save();
  res.json({ visit: visitView(v), distance: Math.round(d) });
});

// ---- Day plan: employees add the places they will visit today ----
app.post('/api/emp/sites', emp, (req, res) => {
  const name = str(req.body.name, 80), address = str(req.body.address, 160), lat = Number(req.body.lat), lng = Number(req.body.lng);
  if (name.length < 2) throw bad('Enter the company or place name');
  if (!validCoord(lat, lng)) throw bad('Pick the location on the map');
  const mine = D().sites.filter((x) => x.ownerId === req.user.id && !x.archived);
  if (mine.length >= 100) throw bad('Too many saved stops. Remove some first.');
  const site = { id: store.id(), name, address, lat, lng, radius: D().settings.geofenceDefault, ownerId: req.user.id, createdAt: now() };
  D().sites.push(site); store.save();
  res.status(201).json({ site });
});
app.delete('/api/emp/sites/:id', emp, (req, res) => {
  const site = D().sites.find((x) => x.id === req.params.id && x.ownerId === req.user.id);
  if (!site) throw new HttpError(404, 'Stop not found');
  if (D().visits.some((v) => v.siteId === site.id && OPEN.includes(v.status))) throw new HttpError(409, 'A visit to this stop is in progress');
  site.archived = true; store.save(); res.json({ ok: true });
});

// ---- Proof photo (company logo / visiting card) taken on arrival ----
const IMG_TYPES = { jpeg: [0xff, 0xd8, 0xff], png: [0x89, 0x50, 0x4e, 0x47], webp: [0x52, 0x49, 0x46, 0x46] };
app.post('/api/emp/visits/:id/site-photo', emp, (req, res) => {
  const v = ownVisit(req);
  if (v.status !== 'at_site') throw new HttpError(409, 'Take the photo after you reach the site and before starting the visit', { code: 'NOT_AT_SITE' });
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(typeof req.body.image === 'string' ? req.body.image : '');
  if (!m) throw bad('Upload a JPEG, PNG or WebP photo');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length < 1000 || buf.length > 3 * 1024 * 1024) throw bad('Photo must be under 3 MB');
  if (!IMG_TYPES[m[1]].every((b, i) => buf[i] === b)) throw bad('That file is not a valid image');
  const file = `${v.id}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  fs.writeFileSync(path.join(UPLOADS, file), buf);
  v.sitePhoto = { t: now(), file, type: m[1] };
  notify('site_photo', 'Site photo captured', `${req.user.name} uploaded the proof photo at ${D().sites.find((x) => x.id === v.siteId).name}`, req.user.id, v.id);
  store.save();
  res.json({ visit: visitView(v) });
});
app.get('/api/visits/:id/site-photo', auth(), (req, res) => {
  const v = D().visits.find((x) => x.id === req.params.id);
  if (!v || !v.sitePhoto || (req.user.role !== 'admin' && v.userId !== req.user.id)) throw new HttpError(404, 'No photo');
  res.set('Cache-Control', 'private, max-age=3600'); res.type(v.sitePhoto.type);
  res.sendFile(path.join(UPLOADS, v.sitePhoto.file));
});

function faceCheck(req, v) {
  if (v.lockUntil > now()) throw new HttpError(429, `Too many failed attempts. Try again in ${Math.ceil((v.lockUntil - now()) / 1000)}s`, { code: 'LOCKED' });
  if (!validDescriptor(req.body.descriptor)) throw bad('No face captured. Look at the camera and try again.', { code: 'NO_FACE_CAPTURED' });
  const stored = sec.decryptFace(req.user.faceTemplate);
  const dist = euclid(stored, req.body.descriptor);
  const thr = D().settings.faceThreshold;
  const confidence = Math.max(0, Math.min(99, Math.round(100 * (1 - (dist / thr) * 0.4))));
  return { ok: dist <= thr, dist, confidence };
}
function failFace(v, u, site, kind, r) {
  v.failedAttempts = (v.failedAttempts || 0) + 1;
  if (v.failedAttempts % 5 === 0) v.lockUntil = now() + 2 * 60000;
  notify('face_failed', 'Face verification failed', `${u.name} failed face verification (${kind === 'start' ? 'arrival' : 'end of visit'}) at ${site.name} — attempt ${v.failedAttempts}`, u.id, v.id);
  store.save();
  throw new HttpError(422, 'Face verification failed', { code: 'FACE_MISMATCH', attemptsLeft: 5 - (v.failedAttempts % 5), confidence: r.confidence });
}

app.post('/api/emp/visits/:id/verify-start', emp, (req, res) => {
  const v = ownVisit(req), u = req.user;
  const site = D().sites.find((s) => s.id === v.siteId);
  if (v.status === 'active') throw new HttpError(409, 'Visit already started');
  if (v.status !== 'at_site') throw new HttpError(409, 'You must reach the site before verifying', { code: 'NOT_AT_SITE' });
  if (!v.sitePhoto) throw bad('Take or upload a photo of the company logo or visiting card first', { code: 'NO_PHOTO' });
  const pos = readPos(req.body); needAccuracy(pos);
  const d = distance(pos, site);
  if (d > site.radius) throw bad(`You are ${Math.round(d)} m from the site. Move within ${site.radius} m to verify.`, { code: 'OUTSIDE_GEOFENCE' });
  const r = faceCheck(req, v);
  if (!r.ok) failFace(v, u, site, 'start', r);
  v.status = 'active'; v.verifiedStart = { ...pt(pos), confidence: r.confidence };
  recordPing(v, u, pos);
  notify('visit_started', 'Visit started', `${u.name} verified at ${site.name}`, u.id, v.id);
  store.save();
  res.json({ visit: visitView(v, true), confidence: r.confidence });
});

const OUTCOMES = ['interested', 'follow_up', 'order_placed', 'not_interested'];
function readMeeting(m) {
  if (!m || typeof m !== 'object') throw bad('Enter the meeting details before ending the visit', { code: 'NO_MEETING' });
  const products = (Array.isArray(m.products) ? m.products : []).map((p) => str(p, 80)).filter(Boolean).slice(0, 30);
  const notes = str(m.notes, 2000);
  if (notes.length < 5) throw bad('Write a short summary of the meeting', { code: 'NO_MEETING' });
  if (!products.length) throw bad('Add at least one product you discussed', { code: 'NO_MEETING' });
  return { contact: str(m.contact, 80), notes, products, outcome: OUTCOMES.includes(m.outcome) ? m.outcome : 'follow_up', nextAction: str(m.nextAction, 300) };
}
app.post('/api/emp/visits/:id/verify-end', emp, (req, res) => {
  const v = ownVisit(req), u = req.user;
  const site = D().sites.find((s) => s.id === v.siteId);
  if (v.status === 'completed') throw new HttpError(409, 'Visit already completed');
  if (v.status !== 'active') throw new HttpError(409, 'This visit has not been started with face verification', { code: 'NOT_ACTIVE' });
  const meeting = readMeeting(req.body.meeting);
  const pos = readPos(req.body); needAccuracy(pos);
  const r = faceCheck(req, v);
  if (!r.ok) failFace(v, u, site, 'end', r);
  v.meeting = meeting;
  const d = distance(pos, site);
  v.status = 'completed'; v.end = { ...pt(pos), confidence: r.confidence, insideGeofence: d <= site.radius * 1.5 };
  recordPing(v, u, pos);
  store.save();
  const view = visitView(v, true);
  notify('visit_completed', 'Visit completed', `${u.name} completed ${site.name} — ${Math.floor(view.visitSec / 60)} min on site`, u.id, v.id);
  res.json({ visit: view, confidence: r.confidence });
});

app.post('/api/emp/visits/:id/cancel', emp, (req, res) => {
  const v = ownVisit(req);
  if (v.status === 'active') throw new HttpError(409, 'A started visit can only be ended with face verification');
  if (!['travelling', 'at_site'].includes(v.status)) throw new HttpError(409, 'Visit cannot be cancelled');
  v.status = 'cancelled'; v.cancelledAt = now();
  store.save(); res.json({ visit: visitView(v) });
});

// ---------- admin ----------
const adm = auth('admin');

function visitFilter(q) {
  const from = Number(q.from) || 0, to = Number(q.to) || Infinity;
  return D().visits.filter((v) =>
    v.travelStart.t >= from && v.travelStart.t <= to &&
    (!q.employee || v.userId === q.employee) && (!q.site || v.siteId === q.site) && (!q.status || v.status === q.status));
}

function liveState(u, since) {
  const v = D().visits.filter((x) => x.userId === u.id && (OPEN.includes(x.status) || x.travelStart.t >= since))
    .sort((a, b) => (OPEN.includes(b.status) - OPEN.includes(a.status)) || b.travelStart.t - a.travelStart.t)[0];
  let state = 'not_started';
  if (v) state = { travelling: 'travelling', at_site: 'reached', active: 'on_visit', completed: 'completed', cancelled: 'not_started' }[v.status];
  return { user: pubUser(u), state, visit: v ? visitView(v) : null };
}

app.get('/api/admin/summary', adm, (req, res) => {
  const since = Number(req.query.since) || new Date().setHours(0, 0, 0, 0);
  const emps = D().users.filter((u) => u.role === 'employee');
  const today = D().visits.filter((v) => v.travelStart.t >= since && v.status !== 'cancelled');
  const views = today.map((v) => visitView(v));
  const live = emps.filter((u) => u.registeredAt && !u.disabled).map((u) => liveState(u, since));
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const s = new Date(since); s.setDate(s.getDate() - i); const e = new Date(s); e.setDate(e.getDate() + 1);
    const vs = D().visits.filter((v) => v.travelStart.t >= +s && v.travelStart.t < +e && v.status === 'completed').map((v) => visitView(v));
    days.push({ date: +s, visits: vs.length, hours: +(vs.reduce((a, v) => a + v.visitSec, 0) / 3600).toFixed(2) });
  }
  res.json({
    kpi: {
      totalEmployees: emps.length,
      activeEmployees: emps.filter((u) => userStatus(u) === 'active').length,
      onVisit: live.filter((l) => l.state === 'on_visit').length,
      visitsToday: today.length,
      completedToday: today.filter((v) => v.status === 'completed').length,
      visitHoursToday: +(views.reduce((a, v) => a + v.visitSec, 0) / 3600).toFixed(2),
    },
    live, days, now: now(),
  });
});

app.get('/api/admin/employees', adm, (req, res) => {
  const since = Number(req.query.since) || new Date().setHours(0, 0, 0, 0);
  const list = D().users.filter((u) => u.role === 'employee').map((u) => {
    const mine = D().visits.filter((v) => v.userId === u.id && v.status === 'completed');
    return { ...pubUser(u), live: liveState(u, since).state, completedVisits: mine.length, totalVisitSec: mine.reduce((a, v) => a + visitView(v).visitSec, 0) };
  });
  res.json({ employees: list });
});

async function issueInvite(u) {
  const token = sec.randomToken();
  u.inviteHash = sec.sha(token); u.inviteExpires = now() + D().settings.inviteHours * 3600000; u.invitedAt = now();
  const link = `${BASE()}/#/register/${token}`;
  let sent = false, mailError = null;
  try { sent = (await mail.sendInvite(u, link, D().settings)).sent; } catch (e) { mailError = e.message; console.error('[mail] failed:', e.message); }
  notify('invite_sent', 'Invitation sent', `Invitation for ${u.name} (${u.email})`, null);
  store.save();
  return { emailSent: sent, mailError, devLink: sent ? undefined : link };
}

app.post('/api/admin/employees', adm, wrap(async (req, res) => {
  const name = str(req.body.name), email = str(req.body.email).toLowerCase(), empId = str(req.body.empId, 20),
    phone = str(req.body.phone, 20), designation = str(req.body.designation, 60);
  if (name.length < 2) throw bad('Enter the employee name');
  if (!EMAIL_RE.test(email)) throw bad('Enter a valid email address');
  if (!/^[A-Za-z0-9_-]{2,20}$/.test(empId)) throw bad('Employee ID: 2–20 letters, numbers, - or _');
  if (!PHONE_RE.test(phone)) throw bad('Enter a valid phone number');
  if (!designation) throw bad('Enter a designation');
  if (D().users.some((u) => u.email === email)) throw new HttpError(409, 'An employee with this email already exists');
  if (D().users.some((u) => u.empId && u.empId.toLowerCase() === empId.toLowerCase())) throw new HttpError(409, 'This employee ID is already in use');
  const u = { id: store.id(), role: 'employee', name, email, empId, phone, designation, createdAt: now() };
  D().users.push(u);
  const r = await issueInvite(u);
  res.status(201).json({ employee: pubUser(u), ...r });
}));

app.post('/api/admin/employees/:id/resend', adm, wrap(async (req, res) => {
  const u = D().users.find((x) => x.id === req.params.id && x.role === 'employee');
  if (!u) throw new HttpError(404, 'Employee not found');
  if (u.registeredAt) throw bad('This employee has already registered');
  res.json(await issueInvite(u));
}));

app.get('/api/admin/employees/:id', adm, (req, res) => {
  const u = D().users.find((x) => x.id === req.params.id && x.role === 'employee');
  if (!u) throw new HttpError(404, 'Employee not found');
  const visits = D().visits.filter((v) => v.userId === u.id).sort((a, b) => b.travelStart.t - a.travelStart.t).map((v) => visitView(v));
  const done = visits.filter((v) => v.status === 'completed');
  const sum = (k) => done.reduce((a, v) => a + v[k], 0);
  res.json({
    employee: pubUser(u), visits,
    stats: { visits: done.length, totalVisitSec: sum('visitSec'), totalTravelSec: sum('travelSec'), avgVisitSec: done.length ? Math.round(sum('visitSec') / done.length) : 0,
      failedVerifications: visits.reduce((a, v) => a + v.failedAttempts, 0) },
  });
});

app.patch('/api/admin/employees/:id', adm, (req, res) => {
  const u = D().users.find((x) => x.id === req.params.id && x.role === 'employee');
  if (!u) throw new HttpError(404, 'Employee not found');
  if (typeof req.body.disabled === 'boolean') {
    if (req.body.disabled && openVisit(u.id)) throw bad('Employee has a visit in progress');
    u.disabled = req.body.disabled;
  }
  if (req.body.resetFace === true) u.faceReset = true;
  store.save(); res.json({ employee: pubUser(u) });
});

app.get('/api/admin/visits', adm, (req, res) => {
  const list = visitFilter(req.query).sort((a, b) => b.travelStart.t - a.travelStart.t).slice(0, 500);
  res.json({ visits: list.map((v) => visitView(v)) });
});
app.get('/api/admin/visits/:id', adm, (req, res) => {
  const v = D().visits.find((x) => x.id === req.params.id);
  if (!v) throw new HttpError(404, 'Visit not found');
  res.json({ visit: visitView(v, true) });
});

app.get('/api/admin/live', adm, (req, res) => {
  const since = Number(req.query.since) || new Date().setHours(0, 0, 0, 0);
  const rows = D().users.filter((u) => u.role === 'employee' && u.registeredAt && !u.disabled).map((u) => {
    const l = liveState(u, since);
    const open = openVisit(u.id);
    return { ...l, visit: open ? visitView(open, true) : l.visit };
  });
  res.json({ rows, now: now() });
});

app.get('/api/admin/reports', adm, (req, res) => {
  const list = visitFilter(req.query).filter((v) => v.status !== 'cancelled').map((v) => visitView(v));
  const done = list.filter((v) => v.status === 'completed');
  const group = (keyFn, label) => {
    const m = new Map();
    for (const v of list) {
      const k = keyFn(v); if (!k) continue;
      const g = m.get(k) || { key: k, label: label(v), visits: 0, completed: 0, visitSec: 0, travelSec: 0, failedVerifications: 0 };
      g.visits++; g.travelSec += v.travelSec; g.failedVerifications += v.failedAttempts;
      if (v.status === 'completed') { g.completed++; g.visitSec += v.visitSec; }
      m.set(k, g);
    }
    return [...m.values()].map((g) => ({ ...g, avgVisitSec: g.completed ? Math.round(g.visitSec / g.completed) : 0 })).sort((a, b) => b.visitSec - a.visitSec);
  };
  const visitSec = done.reduce((a, v) => a + v.visitSec, 0);
  res.json({
    totals: { visits: list.length, completed: done.length, visitSec, travelSec: list.reduce((a, v) => a + v.travelSec, 0),
      failedVerifications: list.reduce((a, v) => a + v.failedAttempts, 0), avgVisitSec: done.length ? Math.round(visitSec / done.length) : 0 },
    byEmployee: group((v) => v.userId, (v) => v.user && v.user.name), bySite: group((v) => v.siteId, (v) => v.site && v.site.name),
  });
});

app.get('/api/admin/notifications', adm, (req, res) => {
  const list = D().notifications.slice(-80).reverse();
  res.json({ notifications: list });
});

// sites + settings
app.get('/api/admin/sites', adm, (req, res) => res.json({ sites: D().sites.filter((s) => !s.archived && !s.ownerId) }));
function siteBody(b) {
  const name = str(b.name, 80), address = str(b.address, 160), lat = Number(b.lat), lng = Number(b.lng), radius = Math.round(Number(b.radius));
  if (name.length < 2) throw bad('Enter the site name');
  if (!validCoord(lat, lng)) throw bad('Pick a valid location on the map');
  if (!(radius >= 30 && radius <= 2000)) throw bad('Geofence radius must be 30–2000 m');
  return { name, address, lat, lng, radius };
}
app.post('/api/admin/sites', adm, (req, res) => { const s = { id: store.id(), ...siteBody(req.body) }; D().sites.push(s); store.save(); res.status(201).json({ site: s }); });
app.put('/api/admin/sites/:id', adm, (req, res) => {
  const s = D().sites.find((x) => x.id === req.params.id); if (!s) throw new HttpError(404, 'Site not found');
  Object.assign(s, siteBody(req.body)); store.save(); res.json({ site: s });
});
app.delete('/api/admin/sites/:id', adm, (req, res) => {
  const s = D().sites.find((x) => x.id === req.params.id); if (!s) throw new HttpError(404, 'Site not found');
  if (D().visits.some((v) => v.siteId === s.id && OPEN.includes(v.status))) throw bad('A visit is in progress at this site');
  s.archived = true; store.save(); res.json({ ok: true });
});
app.get('/api/admin/settings', adm, (req, res) => res.json({ settings: D().settings }));
app.put('/api/admin/settings', adm, (req, res) => {
  const b = req.body, s = D().settings;
  const orgName = str(b.orgName, 60), th = Number(b.faceThreshold), acc = Math.round(Number(b.maxAccuracy)), gf = Math.round(Number(b.geofenceDefault)), ih = Math.round(Number(b.inviteHours));
  if (orgName.length < 2) throw bad('Enter an organization name');
  if (!(th >= 0.3 && th <= 0.6)) throw bad('Face match threshold must be 0.30–0.60 (lower = stricter)');
  if (!(acc >= 20 && acc <= 500)) throw bad('Max GPS accuracy must be 20–500 m');
  if (!(gf >= 30 && gf <= 2000)) throw bad('Default geofence must be 30–2000 m');
  if (!(ih >= 1 && ih <= 336)) throw bad('Invite validity must be 1–336 hours');
  Object.assign(s, { orgName, faceThreshold: th, maxAccuracy: acc, geofenceDefault: gf, inviteHours: ih });
  store.save(); res.json({ settings: s });
});

// ---------- static + errors ----------
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  console.error(err); res.status(500).json({ error: 'Something went wrong' });
});

if (require.main === module) {
  require('./seed').ensureSeed();
  app.listen(PORT, () => console.log(`\n  Argus Field running -> http://localhost:${PORT}\n  Admin (Google sign-in): ${require('./seed').ADMIN_EMAIL}\n`));
}
module.exports = app;
