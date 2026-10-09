// Data layer. Each API request gets its own context: handlers load only the rows they need (async queries), mutate the
// plain objects as before, and the changed rows are written back — row by row — just before the response is sent.
// Two interchangeable drivers: Supabase Postgres (production) and an in-process JSON file (tests / offline dev).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();
const id = () => crypto.randomBytes(6).toString('hex');
const DEFAULT_SETTINGS = { orgName: 'Argus Field', geofenceDefault: 150, faceThreshold: 0.5, maxAccuracy: 100, inviteHours: 72 };

// Indexed columns kept next to each document (everything else lives in the `data` jsonb column).
const COLUMNS = {
  users: (u) => ({ email: u.email, role: u.role, invite_hash: u.inviteHash || null }),
  sites: (s) => ({ owner_id: s.ownerId || null }),
  visits: (v) => ({ user_id: v.userId, site_id: v.siteId, status: v.status, started_at: v.travelStart.t }),
  notifications: (n) => ({ at: n.at }),
};
const TABLES = Object.keys(COLUMNS);

/* ---------------- query spec ----------------
   { eq:{col:val|null}, in:{col:[..]}, gte:{col:n}, lte:{col:n}, or:[spec,...], order:[col,'asc'|'desc'], limit:n } */
function matches(row, s) {
  for (const [k, v] of Object.entries(s.eq || {})) if (v === null ? row[k] != null : row[k] !== v) return false;
  for (const [k, v] of Object.entries(s.in || {})) if (!v.includes(row[k])) return false;
  for (const [k, v] of Object.entries(s.gte || {})) if (!(row[k] >= v)) return false;
  for (const [k, v] of Object.entries(s.lte || {})) if (!(row[k] <= v)) return false;
  if (s.or && !s.or.some((sub) => matches(row, sub))) return false;
  return true;
}
const sortRows = (rows, order) => {
  if (!order) return rows;
  const [col, dir] = order, k = dir === 'asc' ? 1 : -1;
  return rows.sort((a, b) => (a[col] > b[col] ? k : a[col] < b[col] ? -k : 0));
};

/* ---------------- memory driver ---------------- */
function memoryDriver() {
  const DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  const FILE = path.join(DIR, 'db.json');
  const blank = () => ({ users: [], sites: [], visits: [], notifications: [], settings: [] });
  let mem = blank();
  try {
    fs.mkdirSync(DIR, { recursive: true });
    if (fs.existsSync(FILE)) {
      const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      const ok = TABLES.every((t) => !j[t] || !j[t].length || 'data' in j[t][0]);
      if (ok) mem = { ...mem, ...j };
    }
  } catch (e) { console.error('db.json unreadable, starting empty:', e.message); }
  let timer = null;
  const flush = () => { clearTimeout(timer); timer = null; try { fs.writeFileSync(FILE + '.tmp', JSON.stringify(mem)); fs.renameSync(FILE + '.tmp', FILE); } catch { /* read-only disk */ } };
  const save = () => { if (!timer) { timer = setTimeout(flush, 150); timer.unref && timer.unref(); } };
  process.on('exit', () => { if (timer) flush(); });
  const clone = (x) => JSON.parse(JSON.stringify(x));
  return {
    name: 'memory',
    async select(table, spec, { route } = {}) {
      let rows = mem[table].filter((r) => matches(r, spec));
      rows = sortRows(rows, spec.order);
      if (spec.limit) rows = rows.slice(0, spec.limit);
      return rows.map((r) => { const c = clone(r); if (!route) delete c.route; return c; });
    },
    async upsert(table, rows) {
      for (const r of rows) {
        const i = mem[table].findIndex((x) => x.id === r.id);
        const c = clone(r);
        if (i >= 0) mem[table][i] = { ...mem[table][i], ...c }; else mem[table].push(c);
      }
      save();
    },
    async clearAll() { mem = blank(); flush(); },
  };
}

/* ---------------- supabase driver ---------------- */
function supabaseDriver() {
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const COLS = { users: 'id,email,role,data', sites: 'id,owner_id,data', visits: 'id,user_id,site_id,status,started_at,data', notifications: 'id,at,data', settings: 'id,data' };
  const PAGE = 1000, IN_CHUNK = 120;
  const fail = (table, error) => { const e = new Error(`Database error (${table}): ${error.message}`); e.cause = error; throw e; };

  // Long `in` lists would overflow the request URL, so split them into a union of smaller queries.
  function expand(spec) {
    const big = Object.entries(spec.in || {}).find(([, v]) => v.length > IN_CHUNK);
    if (!big) return [spec];
    const [col, list] = big, out = [];
    for (let i = 0; i < list.length; i += IN_CHUNK) out.push(...expand({ ...spec, in: { ...spec.in, [col]: list.slice(i, i + IN_CHUNK) } }));
    return out;
  }
  async function run(table, spec, route) {
    const cols = COLS[table] + (route && table === 'visits' ? ',route' : '');
    const page = async (from, to) => {
      let q = sb.from(table).select(cols);
      for (const [k, v] of Object.entries(spec.eq || {})) q = v === null ? q.is(k, null) : q.eq(k, v);
      for (const [k, v] of Object.entries(spec.in || {})) q = q.in(k, v);
      for (const [k, v] of Object.entries(spec.gte || {})) q = q.gte(k, v);
      for (const [k, v] of Object.entries(spec.lte || {})) q = q.lte(k, v);
      if (spec.order) q = q.order(spec.order[0], { ascending: spec.order[1] === 'asc' });
      q = q.range(from, to);
      const { data, error } = await q; if (error) fail(table, error); return data;
    };
    if (spec.limit && spec.limit <= PAGE) return page(0, spec.limit - 1);
    const all = [];
    for (let from = 0; ; from += PAGE) {
      const rows = await page(from, from + PAGE - 1); all.push(...rows);
      if (rows.length < PAGE || (spec.limit && all.length >= spec.limit)) break;
    }
    return spec.limit ? all.slice(0, spec.limit) : all;
  }
  return {
    name: 'supabase',
    async select(table, spec, { route } = {}) {
      const { or, ...base } = spec;
      const specs = (or || [{}]).flatMap((sub) => expand({ ...base, eq: { ...base.eq, ...sub.eq }, in: { ...base.in, ...sub.in }, gte: { ...base.gte, ...sub.gte }, lte: { ...base.lte, ...sub.lte } }));
      if (specs.length === 1) return run(table, specs[0], route);
      const seen = new Map();
      for (const rows of await Promise.all(specs.map((s) => run(table, s, route)))) for (const r of rows) if (!seen.has(r.id)) seen.set(r.id, r);
      let rows = sortRows([...seen.values()], spec.order);
      if (spec.limit) rows = rows.slice(0, spec.limit);
      return rows;
    },
    async upsert(table, rows) {
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await sb.from(table).upsert(rows.slice(i, i + 200), { onConflict: 'id', defaultToNull: false });
        if (error) fail(table, error);
      }
    },
    async clearAll() {
      if (process.env.ALLOW_DB_RESET !== 'yes') throw new Error('Refusing to wipe the Supabase database. Set ALLOW_DB_RESET=yes to confirm.');
      for (const t of [...TABLES, 'settings']) { const { error } = await sb.from(t).delete().neq('id', ''); if (error) fail(t, error); }
    },
    client: sb,
  };
}

const useSupabase = () => process.env.DB_DRIVER !== 'memory' && process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY;
let driver = null;
const getDriver = () => (driver ||= (useSupabase() ? supabaseDriver() : memoryDriver()));

/* ---------------- request context ---------------- */
function newCtx() {
  const c = { users: [], sites: [], visits: [], notifications: [], settings: null, _idx: {}, _orig: {}, _routeOrig: new Map(), _settingsOrig: null };
  for (const t of TABLES) { c._idx[t] = new Map(); c._orig[t] = new Map(); }
  return c;
}
const current = () => { const c = als.getStore(); if (!c) throw new Error('No data context (call inside store.run or a request)'); return c; };

// Document -> string used for change detection. A visit's route is stored in its own column and tracked separately.
const ser = (table, e) => { if (table === 'visits') { const { route, ...rest } = e; return JSON.stringify(rest); } return JSON.stringify(e); };

function absorb(c, table, rows, route) {
  const out = [];
  for (const row of rows) {
    let e = c._idx[table].get(row.id);
    if (!e) { e = row.data || {}; c[table].push(e); c._idx[table].set(row.id, e); c._orig[table].set(row.id, ser(table, e)); }
    if (table === 'visits' && route && e.route === undefined && row.route != null) { e.route = row.route; c._routeOrig.set(row.id, JSON.stringify(row.route)); }
    out.push(e);
  }
  return out;
}

async function q(table, spec = {}, { route = false } = {}) {
  const c = current();
  return absorb(c, table, await getDriver().select(table, spec, { route }), route);
}
// Make sure routes are loaded for these visits (they are omitted from list queries to keep them light).
async function routes(visits) {
  const c = current();
  const need = visits.filter((v) => v.route === undefined);
  if (!need.length) return visits;
  const rows = await getDriver().select('visits', { in: { id: need.map((v) => v.id) } }, { route: true });
  for (const r of rows) { const v = c._idx.visits.get(r.id); if (v && r.route != null) { v.route = r.route; c._routeOrig.set(r.id, JSON.stringify(r.route)); } }
  for (const v of need) if (v.route === undefined) v.route = [];
  return visits;
}
const has = (table, rowId) => current()._idx[table].has(rowId);
function add(table, entity) {
  const c = current();
  if (!entity.id) entity.id = id();
  c[table].push(entity); c._idx[table].set(entity.id, entity);
  return entity;
}

let settingsCache = null;
async function loadSettings() {
  const c = current();
  if (!settingsCache || Date.now() - settingsCache.at > 10000) {
    const rows = await getDriver().select('settings', { eq: { id: 'main' } });
    settingsCache = { at: Date.now(), data: rows[0] ? rows[0].data : {} };
  }
  c.settings = { ...DEFAULT_SETTINGS, ...settingsCache.data };
  c._settingsOrig = JSON.stringify(c.settings);
  return c.settings;
}

async function flush(c = current()) {
  const drv = getDriver();
  for (const table of TABLES) {
    const plain = [], withRoute = [];
    for (const e of c[table]) {
      const s = ser(table, e);
      const dataChanged = c._orig[table].get(e.id) !== s;
      const routeChanged = table === 'visits' && e.route !== undefined && c._routeOrig.get(e.id) !== JSON.stringify(e.route);
      if (!dataChanged && !routeChanged) continue;
      const row = { id: e.id, ...COLUMNS[table](e), data: JSON.parse(s) };
      if (routeChanged) { row.route = e.route; withRoute.push(row); } else plain.push(row);
      c._orig[table].set(e.id, s);
      if (routeChanged) c._routeOrig.set(e.id, JSON.stringify(e.route));
    }
    // Rows with and without a `route` key are sent separately so a partial update never blanks a stored route.
    if (plain.length) await drv.upsert(table, plain);
    if (withRoute.length) await drv.upsert(table, withRoute);
  }
  if (c.settings && JSON.stringify(c.settings) !== c._settingsOrig) {
    await drv.upsert('settings', [{ id: 'main', data: c.settings }]);
    c._settingsOrig = JSON.stringify(c.settings); settingsCache = null;
  }
}

// Run fn inside a fresh context and persist whatever it changed (used by seed + boot code; requests use the middleware).
async function run(fn) {
  const c = newCtx();
  return als.run(c, async () => { await loadSettings(); const r = await fn(c); await flush(c); return r; });
}
async function reset() { await getDriver().clearAll(); settingsCache = null; }

module.exports = {
  id, als, newCtx, run, q, routes, has, add, flush, loadSettings, reset, DEFAULT_SETTINGS,
  get db() { return current(); },
  get driver() { return getDriver(); },
};
