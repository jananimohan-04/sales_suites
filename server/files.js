// Proof-photo storage: a private Supabase Storage bucket in production, a local folder for tests / offline dev.
const fs = require('fs');
const path = require('path');

const BUCKET = 'visit-photos';
const useSupabase = () => process.env.DB_DRIVER !== 'memory' && process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY;

let bucketReady = null;
function client() { return require('./db').driver.client; }
function ensureBucket() {
  return (bucketReady ||= (async () => {
    const { error } = await client().storage.createBucket(BUCKET, { public: false, fileSizeLimit: 4 * 1024 * 1024 });
    if (error && !/already exists|duplicate/i.test(error.message)) { bucketReady = null; throw new Error('Could not prepare photo storage: ' + error.message); }
  })());
}

const localDir = () => {
  const d = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'uploads');
  fs.mkdirSync(d, { recursive: true });
  return d;
};

async function put(name, buf, contentType) {
  if (!useSupabase()) { fs.writeFileSync(path.join(localDir(), name), buf); return; }
  await ensureBucket();
  const { error } = await client().storage.from(BUCKET).upload(name, buf, { contentType, upsert: true });
  if (error) throw new Error('Could not save the photo: ' + error.message);
}

async function get(name) {
  if (!useSupabase()) {
    const p = path.join(localDir(), name);
    return fs.existsSync(p) ? fs.readFileSync(p) : null;
  }
  const { data, error } = await client().storage.from(BUCKET).download(name);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

module.exports = { put, get };
