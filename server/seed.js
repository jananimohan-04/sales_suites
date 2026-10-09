// Demo data. `npm run seed` resets; the server seeds automatically when the DB is empty.
const store = require('./db');
const sec = require('./security');

const MIN = 60000, HOUR = 3600000, DAY = 24 * HOUR;
const SITES = [
  ['ABC Industries', 'Guindy Industrial Estate, Chennai', 13.0067, 80.2206],
  ['XYZ Ltd', 'Ambattur OT, Chennai', 13.1143, 80.1548],
  ['DEF Corp', 'T. Nagar, Chennai', 13.0418, 80.2341],
  ['Sunrise Textiles', 'Tambaram, Chennai', 12.9249, 80.1],
  ['Orion Pharma', 'Sholinganallur, Chennai', 12.901, 80.2279],
];
const HOME = [13.0827, 80.2707]; // Chennai central

function route(from, to, t0, t1, n = 14) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const k = i / n, j = i === 0 || i === n ? 0 : (Math.random() - 0.5) * 0.004;
    pts.push({ t: Math.round(t0 + (t1 - t0) * k), lat: from[0] + (to[0] - from[0]) * k + j, lng: from[1] + (to[1] - from[1]) * k - j, acc: 8 + Math.round(Math.random() * 12) });
  }
  return pts;
}

async function ensureSeed(reset = false) {
  const db = store.db;
  if (!reset && db.users.length) return;
  if (reset) { for (const k of ['users', 'sites', 'visits', 'notifications']) db[k].length = 0; }
  const now = Date.now();
  const pass = await sec.hashPassword('Demo@123');

  db.users.push({ id: store.id(), role: 'admin', name: 'Admin', email: 'admin@argus.test', passHash: await sec.hashPassword('Admin@123'), createdAt: now });
  const sites = SITES.map(([name, address, lat, lng]) => ({ id: store.id(), name, address, lat, lng, radius: 150 }));
  db.sites.push(...sites);

  const mk = (name, email, empId, phone, designation, extra = {}) => {
    const u = { id: store.id(), role: 'employee', name, email, empId, phone, designation, passHash: pass, registeredAt: now - 20 * DAY,
      faceRegisteredAt: now - 20 * DAY, createdAt: now - 21 * DAY, invitedAt: now - 21 * DAY, ...extra };
    db.users.push(u); return u;
  };
  const arun = mk('Arun Kumar', 'arun@argus.test', 'EMP-101', '+91 98400 11101', 'Senior Sales Executive');
  const priya = mk('Priya Nair', 'priya@argus.test', 'EMP-102', '+91 98400 11102', 'Sales Executive');
  const rahul = mk('Rahul Mehta', 'rahul@argus.test', 'EMP-103', '+91 98400 11103', 'Territory Manager');
  const divya = mk('Divya Raman', 'divya@argus.test', 'EMP-104', '+91 98400 11104', 'Sales Executive');
  mk('Karthik S', 'karthik@argus.test', 'EMP-105', '+91 98400 11105', 'Sales Associate', { faceRegisteredAt: null });
  mk('Meena Iyer', 'meena@argus.test', 'EMP-106', '+91 98400 11106', 'Sales Executive', { passHash: null, registeredAt: null, faceRegisteredAt: null,
    inviteHash: sec.sha('demo-expired'), inviteExpires: now + 48 * HOUR, invitedAt: now - 5 * HOUR });

  const visit = (u, site, status, ts) => {
    const { travel: tr, arrive: arr, start: vs, end } = ts;
    const s = [site.lat, site.lng];
    const jit = () => (Math.random() - 0.5) * 0.0006;
    const v = {
      id: store.id(), userId: u.id, siteId: site.id, status, failedAttempts: ts.fails || 0, lockUntil: 0, simulated: false,
      travelStart: { t: tr, lat: HOME[0], lng: HOME[1], acc: 12 },
      arrival: arr ? { t: arr, lat: s[0] + jit(), lng: s[1] + jit(), acc: 10 } : null,
      verifiedStart: vs ? { t: vs, lat: s[0] + jit(), lng: s[1] + jit(), acc: 9, confidence: 88 + Math.round(Math.random() * 8) } : null,
      end: end ? { t: end, lat: s[0] + jit(), lng: s[1] + jit(), acc: 9, confidence: 86 + Math.round(Math.random() * 10), insideGeofence: true } : null,
      route: [],
    };
    const to = ts.live || (arr ? [v.arrival.lat, v.arrival.lng] : s);
    v.route = route(HOME, to, tr, arr || now, 16);
    if (vs) v.route.push({ t: vs, lat: v.verifiedStart.lat, lng: v.verifiedStart.lng, acc: 9 });
    if (end) v.route.push({ t: end, lat: v.end.lat, lng: v.end.lng, acc: 9 });
    v.lastLocation = v.route[v.route.length - 1];
    u.lastLocation = { ...v.lastLocation, visitId: v.id };
    db.visits.push(v); return v;
  };

  const team = [arun, priya, rahul, divya];
  for (let d = 6; d >= 1; d--) {
    team.forEach((u, ui) => {
      const count = 1 + ((d + ui) % 3);
      for (let k = 0; k < count; k++) {
        const site = sites[(d + ui + k) % sites.length];
        const day = new Date(now - d * DAY); day.setHours(9 + k * 3, 5 * ui, 0, 0);
        const tr = +day, arr = tr + (18 + ((d * 7 + ui * 5) % 25)) * MIN, vs = arr + (2 + (ui % 4)) * MIN, end = vs + (35 + ((d * 13 + k * 17 + ui * 11) % 70)) * MIN;
        visit(u, site, 'completed', { travel: tr, arrive: arr, start: vs, end, fails: (d + ui + k) % 7 === 0 ? 1 : 0 });
      }
    });
  }
  // today
  visit(rahul, sites[2], 'completed', { travel: now - 3 * HOUR - 20 * MIN, arrive: now - 3 * HOUR, start: now - 3 * HOUR + 4 * MIN, end: now - 2 * HOUR - 6 * MIN });
  visit(arun, sites[0], 'active', { travel: now - 100 * MIN, arrive: now - 72 * MIN, start: now - 69 * MIN });
  visit(priya, sites[1], 'travelling', { travel: now - 22 * MIN, live: [13.0735, 80.2352] });
  visit(divya, sites[3], 'completed', { travel: now - 5 * HOUR, arrive: now - 4 * HOUR - 30 * MIN, start: now - 4 * HOUR - 27 * MIN, end: now - 3 * HOUR - 40 * MIN });

  const n = (type, title, body, ago) => db.notifications.push({ id: store.id(), type, title, body, userId: null, visitId: null, at: now - ago, read: false });
  n('invite_sent', 'Invitation sent', 'Invitation for Meena Iyer (meena@argus.test)', 5 * HOUR);
  n('visit_completed', 'Visit completed', 'Rahul Mehta completed DEF Corp — 56 min on site', 2 * HOUR);
  n('visit_started', 'Visit started', 'Arun Kumar verified at ABC Industries', 69 * MIN);
  n('travel_started', 'Started travelling', 'Priya Nair is heading to XYZ Ltd', 22 * MIN);
  store.flush();
  console.log('Seeded demo data. Employees: arun/priya/rahul/divya/karthik @argus.test (password Demo@123). They register their face on first login.');
}

module.exports = { ensureSeed };
if (require.main === module) ensureSeed(process.argv.includes('--reset')).then(() => process.exit(0));
