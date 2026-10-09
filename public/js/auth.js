import { get, post, setToken, session } from './api.js';
import { $, icon, esc, toast, withBusy, formData, fieldErr, successCheck, confetti } from './ui.js';
import { mountEnroll } from './face.js';

const brandMark = `<div class="lockup"><div class="logo">${icon('pin')}</div><span>Argus Field</span></div>`;

export function home(user) { return user.role === 'admin' ? '#/a/dashboard' : user.hasFace ? '#/e' : '#/face-setup'; }

const QUESTIONS = ['Where is my sales employee?', 'Did they actually reach the customer site?', 'Did they verify their identity?', 'How long were they really at the site?'];

export async function loginPage(root) {
  document.body.classList.remove('is-emp');
  const demo = session.config.demo;
  root.innerHTML = `<div class="auth">
    <div class="auth-art">${brandMark}
      <div><h1>Know exactly where your field team is — and that they were really there.</h1>
        <div class="qlist">${QUESTIONS.map((q) => `<div>${icon('check')}${q}</div>`).join('')}</div></div>
      <p style="opacity:.75">Live GPS • Geofenced arrival • Face-verified attendance</p></div>
    <div class="auth-form"><form class="auth-card col" style="gap:18px" id="f" novalidate>
      <div><h1>Welcome back</h1><p class="sub" style="margin-top:6px">Sign in to ${esc(session.config.orgName)}</p></div>
      <div class="field"><label>Email</label><input class="input" name="email" type="email" autocomplete="username" placeholder="you@company.com"></div>
      <div class="field"><label>Password</label><input class="input" name="password" type="password" autocomplete="current-password" placeholder="••••••••"></div>
      <div id="err"></div>
      <button class="btn primary lg block" type="submit">Sign in</button>
      ${session.config.googleClientId ? '<div class="or"><span>or</span></div><div id="gbtn" style="display:flex;justify-content:center;min-height:44px"></div>' : ''}
      ${demo ? `<div class="demo"><b>Demo accounts</b><div>
        <button type="button" data-u="admin@argus.test" data-p="Admin@123">Admin</button>
        <button type="button" data-u="arun@argus.test" data-p="Demo@123">Arun</button>
        <button type="button" data-u="priya@argus.test" data-p="Demo@123">Priya</button>
        <button type="button" data-u="karthik@argus.test" data-p="Demo@123">Karthik (no face yet)</button></div>
        <p class="muted" style="margin-top:8px">Employees: password <code>Demo@123</code>. New employees join through an emailed invitation.</p></div>` : ''}
    </form></div></div>`;
  const f = $('#f', root);
  root.querySelectorAll('[data-u]').forEach((b) => b.addEventListener('click', () => { f.email.value = b.dataset.u; f.password.value = b.dataset.p; }));
  if (session.config.googleClientId) mountGoogle($('#gbtn', root), $('#err', root));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(f); $('#err', root).innerHTML = '';
    try {
      await withBusy($('button[type=submit]', f), async () => {
        const r = await post('/auth/login', d);
        setToken(r.token); session.user = r.user; location.hash = home(r.user);
      });
    } catch (err) { $('#err', root).innerHTML = `<div class="alert err">${icon('alert')}<span>${esc(err.message)}</span></div>`; }
  });
}

function mountGoogle(host, errBox) {
  const init = () => {
    window.google.accounts.id.initialize({
      client_id: session.config.googleClientId,
      callback: async ({ credential }) => {
        errBox.innerHTML = '';
        try {
          const r = await post('/auth/google', { credential });
          setToken(r.token); session.user = r.user; location.hash = home(r.user);
        } catch (err) { errBox.innerHTML = `<div class="alert err">${icon('alert')}<span>${esc(err.message)}</span></div>`; }
      },
    });
    window.google.accounts.id.renderButton(host, { theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill', width: Math.min(host.clientWidth || 340, 400) });
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
      <div class="field"><label>Password</label><input class="input" name="password" type="password" autocomplete="new-password" placeholder="At least 8 characters, letters + numbers">
        <div class="pwmeter"><i id="pw"></i></div></div>
      <div id="err"></div>
      <button class="btn primary lg block" type="submit">Continue to face registration ${icon('chev')}</button>
    </form></div>`;
  const f = $('#f', root);
  f.password.addEventListener('input', () => {
    const p = f.password.value; const s = (p.length >= 8) + (/[A-Z]/.test(p)) + (/\d/.test(p)) + (/[^A-Za-z0-9]/.test(p));
    const m = $('#pw', root); m.style.width = `${(s / 4) * 100}%`; m.style.background = ['#dc2e45', '#dc2e45', '#ea7b0c', '#12a150', '#12a150'][s];
  });
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); const d = formData(f); let bad = false;
    ['name', 'phone', 'password'].forEach((k) => fieldErr(f, k, ''));
    if (d.name.trim().length < 2) { fieldErr(f, 'name', 'Enter your full name'); bad = true; }
    if (!/^\+?[0-9 ()-]{7,18}$/.test(d.phone.trim())) { fieldErr(f, 'phone', 'Enter a valid phone number'); bad = true; }
    if (d.password.length < 8 || !/[A-Za-z]/.test(d.password) || !/\d/.test(d.password)) { fieldErr(f, 'password', 'Min 8 characters with a letter and a number'); bad = true; }
    if (bad) return;
    try {
      await withBusy($('button[type=submit]', f), async () => {
        const r = await post(`/invite/${token}/register`, d);
        setToken(r.token); session.user = r.user; toast('Account created', 'success'); location.hash = '#/face-setup';
      });
    } catch (err) { $('#err', root).innerHTML = `<div class="alert err">${icon('alert')}<span>${esc(err.message)}</span></div>`; }
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
