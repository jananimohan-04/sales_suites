// Tiny JSON-file document store (atomic writes, debounced). Swap for a real DB in production.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DIR, 'db.json');
fs.mkdirSync(DIR, { recursive: true });

const empty = () => ({
  users: [], sites: [], visits: [], notifications: [],
  settings: { orgName: 'Argus Field', geofenceDefault: 150, faceThreshold: 0.5, maxAccuracy: 100, inviteHours: 72 },
});

let data = empty();
if (fs.existsSync(FILE)) {
  try { data = { ...empty(), ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch (e) { console.error('db.json unreadable, starting empty', e.message); }
}

let timer = null;
function flush() {
  clearTimeout(timer); timer = null;
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, FILE);
}
function save() { if (!timer) timer = setTimeout(flush, 150); }
process.on('exit', () => { if (timer) flush(); });
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => process.exit(0));

const id = () => crypto.randomBytes(6).toString('hex');
const replace = (d) => { data = { ...empty(), ...d }; module.exports.data = data; flush(); };

module.exports = { data, save, flush, id, replace, get db() { return data; } };
