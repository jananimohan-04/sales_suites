// End-to-end API test of the visit state machine & business rules (temp data dir, no camera needed).
process.env.SMTP_HOST = ''; process.env.SMTP_USER = ''; process.env.GOOGLE_CLIENT_ID = 'test'; // never send real mail from tests
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'argus-'));
const assert = require('assert');
const app = require('./index');
const { ensureSeed } = require('./seed');
const google = require('./google');
// Stub Google verification: credential 'g:<email>' means a verified Google account with that email.
google.verify = async (c) => { if (!String(c).startsWith('g:')) { const e = new Error('Google sign-in could not be verified'); e.status = 401; throw e; } return { email: c.slice(2), name: '' }; };

(async () => {
  await ensureSeed(true, true);
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const call = async (m, p, body, tok) => {
    const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { s: r.status, b: await r.json().catch(() => ({})) };
  };
  const ok = (n) => console.log('  ok -', n);
  const rnd = () => Array.from({ length: 128 }, () => Math.random() * 0.2 - 0.1);
  const jitter = (d, e = 0.01) => d.map((x) => x + (Math.random() - 0.5) * e);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const admin = (await call('POST', '/api/auth/google', { credential: 'g:argushexadoc2021@gmail.com' })).b.token; assert(admin);
  assert.equal((await call('POST', '/api/auth/google', { credential: 'junk' })).s, 401);
  assert.equal((await call('POST', '/api/auth/google', { credential: 'g:stranger@gmail.com' })).s, 403); ok('google sign-in: admin ok, bad token + unknown account rejected');
  assert.equal((await call('POST', '/api/auth/login', { email: 'a@b.co', password: 'x' })).s, 404); ok('password login removed')

  assert.equal((await call('POST', '/api/admin/employees', { name: 'T', email: 'x', empId: '1', phone: '1', designation: '' }, admin)).s, 400); ok('invite validation');
  const person = { name: 'Test User', email: 'test@x.com', empId: 'T-1', phone: '+91 9999999999', designation: 'Exec' };
  const inv = await call('POST', '/api/admin/employees', person, admin);
  assert.equal(inv.s, 201); assert(inv.b.devLink);
  assert.equal((await call('POST', '/api/admin/employees', { ...person, empId: 'T-2' }, admin)).s, 409); ok('duplicate email blocked');
  const token = inv.b.devLink.split('/register/')[1];
  const reg0 = { name: 'Test User', email: 'test@x.com', empId: 'T-1', phone: '+91 9999999999', credential: 'g:test@x.com' };
  assert.equal((await call('POST', `/api/invite/${token}/register`, { ...reg0, phone: 'x' })).s, 400);
  assert.equal((await call('POST', `/api/invite/${token}/register`, { ...reg0, credential: 'g:other@x.com' })).s, 403); ok('register rejects a different Google account');
  const reg = await call('POST', `/api/invite/${token}/register`, reg0);
  assert.equal(reg.s, 200); const t = reg.b.token;
  assert.equal((await call('GET', `/api/invite/${token}`)).s, 404); ok('registration + single-use invite');

  const site = (await call('GET', '/api/emp/today', null, t)).b.sites[0];
  const at = { lat: site.lat, lng: site.lng, acc: 10 }, far = { lat: site.lat + 0.05, lng: site.lng, acc: 10 };
  assert.equal((await call('POST', '/api/emp/visits', { siteId: site.id, ...far }, t)).b.code, 'NO_FACE'); ok('cannot start without face');

  const face = rnd();
  assert.equal((await call('POST', '/api/me/face', { samples: [face, rnd(), rnd()] }, t)).s, 400);
  assert.equal((await call('POST', '/api/me/face', { samples: [face, jitter(face), jitter(face)] }, t)).s, 200);
  assert.equal((await call('POST', '/api/me/face', { samples: [face, jitter(face), jitter(face)] }, t)).s, 409); ok('face registered once; re-enrol blocked');

  assert.equal((await call('POST', '/api/emp/visits', { siteId: site.id, ...far, acc: 900 }, t)).b.code, 'LOW_ACCURACY'); ok('low GPS accuracy rejected');
  const start = await call('POST', '/api/emp/visits', { siteId: site.id, ...far }, t);
  assert.equal(start.s, 201); assert.equal(start.b.visit.status, 'travelling'); const vid = start.b.visit.id;
  assert.equal((await call('POST', '/api/emp/visits', { siteId: site.id, ...far }, t)).b.code, 'DUPLICATE'); ok('duplicate active visit blocked');
  assert.equal((await call('POST', `/api/emp/visits/${vid}/verify-start`, { descriptor: face, ...at }, t)).b.code, 'NOT_AT_SITE'); ok('cannot verify before reaching site');
  assert.equal((await call('POST', `/api/emp/visits/${vid}/verify-end`, { descriptor: face, ...at }, t)).b.code, 'NOT_ACTIVE'); ok('cannot end without starting');
  assert.equal((await call('POST', `/api/emp/visits/${vid}/location`, far, t)).b.visit.status, 'travelling');
  const arr = await call('POST', `/api/emp/visits/${vid}/location`, at, t);
  assert.equal(arr.b.visit.status, 'at_site'); assert(arr.b.visit.arrival); ok('geofence arrival detected server-side');
  const wrong = await call('POST', `/api/emp/visits/${vid}/verify-start`, { descriptor: rnd(), ...at }, t);
  assert.equal(wrong.s, 422); assert.equal(wrong.b.code, 'FACE_MISMATCH'); ok('wrong face rejected');
  assert.equal((await call('POST', `/api/emp/visits/${vid}/verify-start`, { descriptor: jitter(face, 0.02), ...far }, t)).b.code, 'OUTSIDE_GEOFENCE'); ok('verify outside geofence rejected');
  await sleep(1100);
  const vs = await call('POST', `/api/emp/visits/${vid}/verify-start`, { descriptor: jitter(face, 0.02), ...at }, t);
  assert.equal(vs.s, 200); assert.equal(vs.b.visit.status, 'active'); assert(vs.b.visit.verifiedStart.t > vs.b.visit.arrival.t); ok('face-verified visit start');
  assert.equal((await call('POST', `/api/emp/visits/${vid}/cancel`, {}, t)).s, 409); ok('active visit cannot be cancelled');
  assert.equal((await call('POST', `/api/emp/visits/${vid}/verify-end`, { descriptor: rnd(), ...at }, t)).s, 422);
  await sleep(1100);
  const end = await call('POST', `/api/emp/visits/${vid}/verify-end`, { descriptor: jitter(face, 0.02), ...at }, t);
  assert.equal(end.s, 200); const v = end.b.visit; assert.equal(v.status, 'completed');
  assert(v.visitSec >= 1 && v.visitSec < 60);
  assert.equal(v.visitSec, Math.round((v.end.t - v.verifiedStart.t) / 1000));
  assert.equal(v.travelSec, Math.round((v.arrival.t - v.travelStart.t) / 1000)); ok(`travel (${v.travelSec}s) and visit (${v.visitSec}s) durations separated`);
  assert.equal((await call('POST', `/api/emp/visits/${vid}/verify-end`, { descriptor: face, ...at }, t)).s, 409); ok('cannot complete twice');
  assert.equal((await call('GET', '/api/admin/summary', null, t)).s, 403); ok('employee blocked from admin API');
  assert.equal((await call('GET', '/api/admin/summary', null, admin)).b.kpi.totalEmployees >= 7, true);
  const n = (await call('GET', '/api/admin/notifications', null, admin)).b.notifications.map((x) => x.type);
  for (const k of ['invite_sent', 'registration', 'face_registered', 'travel_started', 'reached_site', 'face_failed', 'visit_started', 'visit_completed']) assert(n.includes(k), 'missing notification ' + k);
  ok('all notification types emitted');
  console.log('\nAll checks passed'); srv.close(); process.exit(0);
})().catch((e) => { console.error('\nFAILED:', e); process.exit(1); });
