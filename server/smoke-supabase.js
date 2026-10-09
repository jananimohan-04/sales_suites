// Live check of the Supabase driver + photo storage using throwaway rows (all removed afterwards). Run: npm run smoke
try { process.loadEnvFile(require('path').join(__dirname, '..', '.env')); } catch { /* env from shell */ }
const assert = require('assert');
const store = require('./db');
const files = require('./files');

(async () => {
  assert.equal(store.driver.name, 'supabase', 'SUPABASE_URL / SUPABASE_SECRET_KEY not set');
  const sb = store.driver.client;
  const ids = { u: 'smoke-u', s: 'smoke-s', v: 'smoke-v' };
  const ok = (m) => console.log('  ok -', m);
  try {
    await store.run(async () => {
      store.add('users', { id: ids.u, role: 'employee', email: 'smoke@test.invalid', inviteHash: 'smoke-hash', name: 'Smoke' });
      store.add('sites', { id: ids.s, name: 'Smoke Site', lat: 1, lng: 2, radius: 100, ownerId: ids.u });
      store.add('visits', { id: ids.v, userId: ids.u, siteId: ids.s, status: 'travelling', travelStart: { t: 1000 }, route: [{ t: 1, lat: 1, lng: 2 }, { t: 2, lat: 1, lng: 2 }], routeCount: 2 });
    });
    ok('rows written (users, sites, visits with route)');

    await store.run(async () => {
      const [u] = await store.q('users', { eq: { invite_hash: 'smoke-hash' }, limit: 1 });
      assert.equal(u.email, 'smoke@test.invalid'); ok('lookup by invite_hash');
      assert.equal((await store.q('sites', { or: [{ eq: { owner_id: null } }, { eq: { owner_id: ids.u } }] })).some((x) => x.id === ids.s), true); ok('or + owner filter');
      const list = await store.q('visits', { eq: { user_id: ids.u }, order: ['started_at', 'desc'], limit: 5 });
      assert.equal(list[0].route, undefined, 'list queries must not load routes'); ok('list query omits route');
      const [v] = await store.q('visits', { eq: { id: ids.v }, in: { status: ['travelling', 'at_site'] } }, { route: true });
      assert.equal(v.route.length, 2); ok('route loaded on demand');
    });

    await store.run(async () => {   // update WITHOUT loading the route: the stored route must survive
      const [v] = await store.q('visits', { eq: { id: ids.v } });
      v.status = 'at_site';
    });
    await store.run(async () => {
      const [v] = await store.q('visits', { eq: { id: ids.v } }, { route: true });
      assert.equal(v.status, 'at_site'); assert.equal(v.route.length, 2); ok('partial update keeps the route');
      v.route.push({ t: 3, lat: 1, lng: 2 }); v.routeCount = 3;
    });
    await store.run(async () => {
      const [v] = await store.q('visits', { eq: { id: ids.v } }, { route: true });
      assert.equal(v.route.length, 3); ok('route append persisted');
    });

    await store.run(async () => { const s = await store.loadSettings(); assert.equal(typeof s.orgName, 'string'); }); ok('settings load (defaults)');

    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7)]);
    await files.put('smoke-photo.jpg', jpg, 'image/jpeg');
    const back = await files.get('smoke-photo.jpg');
    assert(back && back.equals(jpg)); ok('photo upload + download (private bucket)');
    console.log('\nSupabase smoke test passed');
  } finally {
    for (const [t, id] of [['visits', ids.v], ['sites', ids.s], ['users', ids.u]]) await sb.from(t).delete().eq('id', id);
    await sb.storage.from('visit-photos').remove(['smoke-photo.jpg']).catch(() => {});
  }
})().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });
