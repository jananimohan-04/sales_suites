import { get, post, setToken, session } from './api.js';
import { $, icon, esc, toast, withBusy, formData, fieldErr, successCheck, confetti } from './ui.js';
import { mountEnroll } from './face.js';

const brandMark = `<div class="lockup"><div class="logo">${icon('pin')}</div><span>Argus Field</span></div>`;

export function home(user) { return user.role === 'admin' ? '#/a/dashboard' : user.hasFace ? '#/e' : '#/face-setup'; }

const QUESTIONS = ['Where is my sales employee?', 'Did they actually reach the customer site?', 'Did they verify their identity?', 'How long were they really at the site?'];

export async function loginPage(root) {
  document.body.classList.remove('is-emp');
  root.innerHTML = `<div class="auth">
    <div class="auth-art">${brandMark}
      <div><h1>Know exactly where your field team is — and that they were really there.</h1>
        <div class="qlist">${QUESTIONS.map((q) => `<div>${icon('check')}${q}</div>`).join('')}</div></div>
      <p style="opacity:.75">Live GPS • Geofenced arrival • Face-verified attendance</p></div>
    <div class="auth-form"><div class="auth-card col" style="gap:18px">
      <div><h1>Welcome back</h1><p class="sub" style="margin-top:6px">Sign in to ${esc(session.config.orgName)} with your Google account</p></div>
      ${googleSlot()}
      <div id="err"></div>
      <p class="muted" style="font-size:12.5px">Use the Google account your invitation was sent to. New employee? Open the invitation email first.</p>
    </div></div></div>`;
  mountGoogle($('#gbtn', root), async (credential) => {
    const errBox = $('#err', root); errBox.innerHTML = '';
    try {
      const r = await post('/auth/google', { credential });
      setToken(r.token); session.user = r.user; location.hash = home(r.user);
    } catch (err) { errBox.innerHTML = `<div class="alert err">${icon('alert')}<span>${esc(err.message)}</span></div>`; }
  });
}

const googleSlot = () => session.config.googleClientId
  ? '<div id="gbtn" style="display:flex;justify-content:center;min-height:44px"></div>'
  : `<div class="alert warn">${icon('alert')}<span>Google sign-in isn’t configured yet. Set <b>GOOGLE_CLIENT_ID</b> on the server.</span></div>`;

// Google blocks its web sign-in inside Android WebViews, so the APK uses the native Google account picker instead.
const nativeGoogle = () => (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() && window.Capacitor.Plugins && window.Capacitor.Plugins.SocialLogin) || null;

function mountGoogle(host, onCredential) {
  if (!host) return;
  const native = nativeGoogle();
  if (native) {
    host.innerHTML = `<button type="button" class="btn lg block" id="gnative">${icon('user')} Continue with Google</button>`;
    host.querySelector('#gnative').addEventListener('click', async (e) => {
      const btn = e.currentTarget; btn.disabled = true;
      try {
        await native.initialize({ google: { webClientId: session.config.googleClientId } });
        const r = await native.login({ provider: 'google', options: {} });
        const idToken = r && r.result && r.result.idToken;
        if (!idToken) throw new Error('Google did not return a sign-in token');
        await onCredential(idToken);
      } catch (err) {
        if (!/cancel/i.test(String(err && err.message))) toast(String((err && err.message) || err), 'error', 'Google sign-in failed');
      } finally { btn.disabled = false; }
    });
    return;
  }
  const init = () => {
    window.google.accounts.id.initialize({ client_id: session.config.googleClientId, callback: ({ credential }) => onCredential(credential) });
    window.google.accounts.id.renderButton(host, { theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill', width: Math.min(host.clientWidth || 340, 400) });
  };
  if (window.google && window.google.accounts) return init();
  const sc = document.createElement('script');
  sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true; sc.onload = init;
  sc.onerror = () => { host.innerHTML = '<span class="muted">Google sign-in is unavailable right now.</span>'; };
  document.head.appendChild(sc);
}

export async function registerPage(root, [token]) {
  document.body.classList.add('is-emp');
  root.innerHTML = `<div class="page-simple"><div class="skel" style="height:420px;border-radius:24px;margin-top:40px"></div></div>`;
  let inv;
  try { inv = await get(`/invite/${token}`); } catch (e) {
    root.innerHTML = `<div class="centered"><div class="card" style="max-width:420px;text-align:center"><div class="ill" style="width:60px;height:60px;border-radius:20px;background:var(--red-soft);color:var(--red);display:grid;place-items:center;margin:0 auto 14px">${icon('alert')}</div>
      <h2>Invitation unavailable</h2><p class="sub" style="margin:8px 0 18px">${esc(e.message)}</p><a class="btn" href="#/login">Go to sign in</a></div></div>`; return;
  }
  root.innerHTML = `<div class="page-simple"><div style="padding:18px 4px 22px">${brandMark}</div>
    <form class="card col" style="gap:16px;padding:24px" id="f" novalidate>
      <div><span class="chip brand">Step 1 of 2</span><h1 style="margin-top:10px;font-size:24px">Create your account</h1>
      <p class="sub" style="margin-top:4px">You were invited to <b>${esc(inv.org)}</b> as ${esc(inv.designation)}.</p></div>
      <div class="field"><label>Full name</label><input class="input" name="name" value="${esc(inv.name)}" autocomplete="name"></div>
      <div class="field"><label>Email</label><input class="input" name="email" value="${esc(inv.email)}" readonly></div>
      <div class="field"><label>Phone number</label><input class="input" name="phone" value="${esc(inv.phone)}" inputmode="tel" autocomplete="tel"></div>
      <div class="field"><label>Employee ID</label><input class="input" name="empId" value="${esc(inv.empId)}" readonly></div>
      <div class="alert info">${icon('mail')}<span>Continue with the Google account <b>${esc(inv.email)}</b>. You’ll use it to sign in from now on — no password needed.</span></div>
      <div id="err"></div>
      ${googleSlot()}
    </form></div>`;
  const f = $('#f', root);
  mountGoogle($('#gbtn', root), async (credential) => {
    const d = formData(f); let bad = false; const errBox = $('#err', root); errBox.innerHTML = '';
    ['name', 'phone'].forEach((k) => fieldErr(f, k, ''));
    if (d.name.trim().length < 2) { fieldErr(f, 'name', 'Enter your full name'); bad = true; }
    if (!/^\+?[0-9 ()-]{7,18}$/.test(d.phone.trim())) { fieldErr(f, 'phone', 'Enter a valid phone number'); bad = true; }
    if (bad) { toast('Fill in your name and phone, then continue with Google', 'error'); return; }
    try {
      const r = await post(`/invite/${token}/register`, { name: d.name, phone: d.phone, credential });
      setToken(r.token); session.user = r.user; toast('Account created', 'success'); location.hash = '#/face-setup';
    } catch (err) { errBox.innerHTML = `<div class="alert err">${icon('alert')}<span>${esc(err.message)}</span></div>`; }
  });
}

export async function faceSetupPage(root) {
  document.body.classList.add('is-emp');
  const u = session.user;
  if (u.hasFace && !u.faceResetAllowed) { location.hash = '#/e'; return; }
  let handle = null;
  const intro = () => {
    root.innerHTML = `<div class="facepage"><header><div><span class="chip" style="background:rgba(255,255,255,.14);color:#fff">Step 2 of 2</span><h2 style="margin-top:8px">Register your face</h2></div></header>
      <div style="padding:8px 20px"><div class="card col" style="gap:14px;border-radius:24px;padding:22px">
        <div class="ill" style="width:60px;height:60px;border-radius:20px;background:var(--brand-soft);color:var(--brand);display:grid;place-items:center">${icon('scan')}</div>
        <h2>We’ll scan three angles</h2>
        <p class="sub">You’ll use your face to confirm you’re at the customer site and again when you leave. Takes about 15 seconds.</p>
        <div class="col" style="gap:8px;font-size:13.5px"><div class="row">${icon('check')}Look straight</div><div class="row">${icon('check')}Turn slightly left</div><div class="row">${icon('check')}Turn slightly right</div></div>
        <div class="alert info">${icon('lock')}<span>Only an encrypted numeric face template is stored — never your photo.</span></div>
        <button class="btn primary lg block" id="go">${icon('camera')} Start camera</button></div></div></div>`;
    $('#go', root).addEventListener('click', camera);
  };
  const camera = () => {
    root.innerHTML = `<div class="facepage"><header><button class="x" id="back" aria-label="Back">${icon('back')}</button><div><h2>Face registration</h2><p style="opacity:.65;font-size:13px">Keep your face inside the oval</p></div></header><div id="stage"></div><div class="foot">Good, even lighting works best.</div></div>`;
    $('#back', root).addEventListener('click', () => { handle && handle.destroy(); intro(); });
    handle = mountEnroll($('#stage', root), {
      onDone: async (samples, cam) => {
        try {
          const r = await post('/me/face', { samples });
          session.user = r.user; handle.destroy(); done();
        } catch (e) {
          toast(e.message, 'error', 'Face registration failed'); handle.destroy(); camera();
        }
      },
    });
  };
  const done = () => {
    root.innerHTML = `<div class="facepage" style="justify-content:center"><div class="overlay-done" style="position:relative">${successCheck()}
      <h1 style="margin-top:20px;font-size:26px">Registration Completed ✓</h1><p style="opacity:.75;margin:8px 0 26px">Your account and face are set up. You’re ready for your first site visit.</p>
      <button class="btn primary lg" id="next">Go to dashboard</button></div></div>`;
    confetti($('.overlay-done', root));
    $('#next', root).addEventListener('click', () => { location.hash = '#/e'; });
  };
  intro();
  return () => handle && handle.destroy();
}
