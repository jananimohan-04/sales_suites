import { get, getToken, session, setToken } from './api.js';
import { $, esc, icon } from './ui.js';
import { loginPage, registerPage, faceSetupPage, home } from './auth.js';
import { adminRoute } from './admin.js';
import { employeeRoute } from './employee.js';
import { initNotifications, armPermissionOnGesture } from './notify.js';

const root = $('#app');
let cleanup = null;
let adminCtx = null;

async function boot() {
  try { session.config = await get('/config'); } catch { session.config = { orgName: 'Argus Field', demo: false }; }
  window.__tiles = { url: session.config.tileUrl, attribution: session.config.tileAttribution, googleKey: session.config.googleMapsKey };
  if (getToken()) { try { session.user = (await get('/me')).user; } catch { setToken(null); } }
  initNotifications(); armPermissionOnGesture();
  window.addEventListener('hashchange', route);
  route();
}

async function route() {
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [area, ...rest] = parts;
  const u = session.user;

  if (area === 'register') { if (u) { setToken(null); session.user = null; } return (cleanup = await registerPage(root, rest)); }
  if (!u) { if (area !== 'login') { location.hash = '#/login'; return; } return (cleanup = await loginPage(root)); }
  if (area === 'login' || !area) { location.hash = home(u); return; }

  if (area === 'face-setup') { if (u.role !== 'employee') { location.hash = home(u); return; } return (cleanup = await faceSetupPage(root)); }
  if (area === 'a') {
    if (u.role !== 'admin') { location.hash = home(u); return; }
    document.body.classList.remove('is-emp');
    return (cleanup = await adminRoute(root, rest));
  }
  if (area === 'e') {
    if (u.role !== 'employee') { location.hash = home(u); return; }
    if (!u.hasFace) { location.hash = '#/face-setup'; return; }
    document.body.classList.add('is-emp');
    return (cleanup = await employeeRoute(root, rest));
  }
  location.hash = home(u);
}

window.addEventListener('unhandledrejection', (e) => console.error(e.reason));
boot().catch((e) => { root.innerHTML = `<div class="centered"><div class="card"><h2>Couldn’t start the app</h2><p class="sub">${esc(e.message)}</p></div></div>`; });
