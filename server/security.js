const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const KEYFILE = path.join(DIR, 'secret.key');
let SECRET = process.env.APP_SECRET;
if (!SECRET) {
  if (!fs.existsSync(KEYFILE)) { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(KEYFILE, crypto.randomBytes(32).toString('hex'), { mode: 0o600 }); }
  SECRET = fs.readFileSync(KEYFILE, 'utf8').trim();
}
const FACE_KEY = crypto.createHash('sha256').update('face:' + SECRET).digest();

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return salt.toString('hex') + ':' + key.toString('hex');
}
async function verifyPassword(pw, stored) {
  if (!stored) return false;
  const [s, k] = stored.split(':');
  const key = await scrypt(pw, Buffer.from(s, 'hex'), 64);
  return crypto.timingSafeEqual(key, Buffer.from(k, 'hex'));
}

const b64 = (b) => Buffer.from(b).toString('base64url');
function signToken(payload, ttlMs = 12 * 3600 * 1000) {
  const body = b64(JSON.stringify({ ...payload, exp: Date.now() + ttlMs }));
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}
function readToken(tok) {
  if (!tok || !tok.includes('.')) return null;
  const [body, sig] = tok.split('.');
  const good = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}

// Face templates are stored encrypted at rest (AES-256-GCM); no face images are kept.
function encryptFace(arr) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', FACE_KEY, iv);
  const enc = Buffer.concat([c.update(JSON.stringify(arr)), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}
function decryptFace(s) {
  const [iv, tag, enc] = s.split('.').map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', FACE_KEY, iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(enc), d.final()]).toString());
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('hex');

module.exports = { hashPassword, verifyPassword, signToken, readToken, encryptFace, decryptFace, sha, randomToken };
