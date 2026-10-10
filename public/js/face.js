// Face capture UI on top of face-api.js. Everything runs in the browser; only 128-number
// descriptors are sent to the server — never a photo.
//   * full 68-point landmarks (better alignment => more accurate descriptors)
//   * lighting / size / centering / pose checks before any capture
//   * verification is fast: it captures as soon as the face is aligned (no blink step)
import { $, icon, successCheck, esc } from './ui.js';

const VER = '1.7.13';
const LIB = `https://cdn.jsdelivr.net/npm/@vladmandic/face-api@${VER}/dist/face-api.js`;
const MODELS = `https://cdn.jsdelivr.net/npm/@vladmandic/face-api@${VER}/model/`;

let loading = null;
// Called early so the models are already downloaded when the camera screen opens.
export const preloadFaceEngine = () => { loadFaceEngine().catch(() => {}); };
export function loadFaceEngine() {
  if (loading) return loading;
  loading = (async () => {
    if (!window.faceapi) {
      await new Promise((res, rej) => {
        const s = document.createElement('script'); s.src = LIB; s.onload = res;
        s.onerror = () => rej(new Error('Could not load the face recognition engine. Check your internet connection.'));
        document.head.appendChild(s);
      });
    }
    const f = window.faceapi;
    await Promise.all([f.nets.tinyFaceDetector.loadFromUri(MODELS), f.nets.faceLandmark68Net.loadFromUri(MODELS), f.nets.faceRecognitionNet.loadFromUri(MODELS)]);
    return f;
  })().catch((e) => { loading = null; throw e; });
  return loading;
}

const OPTS = () => new window.faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.55 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// Eye aspect ratio (Soukupova & Czech): ~0.30 open, <0.20 closed.
const ear = (p, i) => (dist(p[i + 1], p[i + 5]) + dist(p[i + 2], p[i + 4])) / (2 * dist(p[i], p[i + 3]));
const mean = (arr) => arr[0].map((_, i) => arr.reduce((a, d) => a + d[i], 0) / arr.length);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class FaceCam {
  constructor(root) {
    this.root = root; this.alive = true; this.stream = null; this.frame = 0; this.dark = false;
    root.innerHTML = `<div class="cam" id="cam">
      <video playsinline muted autoplay></video><div class="shade"></div>
      <svg class="guide" viewBox="0 0 300 400" preserveAspectRatio="none"><ellipse class="oval" cx="150" cy="176" rx="100" ry="124"/>
        <ellipse class="prog" cx="150" cy="176" rx="100" ry="124" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100" transform="rotate(-90 150 176)" style="opacity:0"/></svg>
      <div class="scan hide"></div>
      <div class="pill" id="pill">${icon('camera')}<span>Starting camera…</span></div>
      <div class="state" id="cam-state"></div></div>
      <style>.spin-lg{width:38px;height:38px;border:3px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:rot .8s linear infinite;margin:auto}</style>`;
    this.cam = $('#cam', root); this.video = $('video', root); this.pill = $('#pill span', root); this.state = $('#cam-state', root);
    this.prog = $('.prog', root); this.scan = $('.scan', root);
    this.canvas = document.createElement('canvas'); this.canvas.width = 48; this.canvas.height = 36;
  }
  say(text, mode = '') { this.pill.textContent = text; this.cam.classList.toggle('ok', mode === 'ok'); this.cam.classList.toggle('bad', mode === 'bad'); }
  progress(p) { this.prog.style.opacity = p > 0 ? 1 : 0; this.prog.style.strokeDashoffset = String(100 - Math.max(0, Math.min(100, p))); }
  showState(html) { this.state.innerHTML = html; this.state.classList.remove('hide'); }
  hideState() { this.state.classList.add('hide'); }
  loadingState(msg) { this.showState(`<div><div class="spin-lg"></div><p style="margin-top:14px;font-weight:600">${esc(msg)}</p></div>`); }
  fail(message) {
    this.showState(`<div><div style="width:56px;height:56px;border-radius:18px;background:rgba(255,107,129,.18);display:grid;place-items:center;margin:0 auto 14px;color:#ff8b9b">${icon('alert')}</div><p style="font-weight:700;margin-bottom:6px">Camera unavailable</p><p style="opacity:.75;font-size:13.5px;line-height:1.5">${esc(message)}</p><button class="btn sm" style="margin-top:16px" id="cam-retry">Try again</button></div>`);
    $('#cam-retry', this.root).onclick = () => this.init();
  }
  async init() {
    this.loadingState('Loading face recognition…');
    try {
      if (!window.isSecureContext && location.hostname !== 'localhost') throw new Error('Camera access needs a secure (HTTPS) connection. Open this app over HTTPS or on localhost.');
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('This browser does not support camera access.');
      await loadFaceEngine();
      this.loadingState('Starting camera…');
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      this.video.srcObject = this.stream; await this.video.play();
      await new Promise((r) => { if (this.video.videoWidth) r(); else this.video.onloadedmetadata = r; });
      this.hideState(); this.say('Looking for your face…');
      return true;
    } catch (e) {
      const m = e && e.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access in your browser settings and try again.'
        : e && e.name === 'NotFoundError' ? 'No camera was found on this device.' : e && e.name === 'NotReadableError' ? 'The camera is in use by another app.' : (e && e.message) || 'Could not start the camera.';
      this.fail(m); return false;
    }
  }
  brightness() {
    const c = this.canvas.getContext('2d', { willReadFrequently: true });
    c.drawImage(this.video, 0, 0, 48, 36);
    const d = c.getImageData(0, 0, 48, 36).data; let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return s / (d.length / 4);
  }
  /** Analyse one frame. Returns geometry relative to the visible 3:4 camera area. */
  async look(withDescriptor = false) {
    const f = window.faceapi, v = this.video;
    if (!v.videoWidth) return null;
    if (this.frame++ % 6 === 0) this.dark = this.brightness() < 55;
    let q = f.detectSingleFace(v, OPTS()).withFaceLandmarks();
    if (withDescriptor) q = q.withFaceDescriptor();
    const r = await q;
    if (!r) return { found: false, dark: this.dark };
    const W = v.videoWidth, H = v.videoHeight;
    let vw, vh, ox, oy;
    if (W / H > 0.75) { vh = H; vw = H * 0.75; ox = (W - vw) / 2; oy = 0; } else { vw = W; vh = W / 0.75; ox = 0; oy = (H - vh) / 2; }
    const b = r.detection.box, cx = (b.x + b.width / 2 - ox) / vw, cy = (b.y + b.height / 2 - oy) / vh, size = b.width / vw;
    const p = r.landmarks.positions;
    const ratio = (p[30].x - p[0].x) / (p[16].x - p[0].x);
    const eyes = (ear(p, 36) + ear(p, 42)) / 2;
    let hint = null;
    if (this.dark) hint = 'Too dark — find better light';
    else if (size < 0.4) hint = 'Move closer'; else if (size > 0.85) hint = 'Move back a little';
    else if (cx < 0.33 || cx > 0.67 || cy < 0.28 || cy > 0.62) hint = 'Center your face in the oval';
    return { found: true, ok: !hint, hint, ratio, eyes, score: r.detection.score, descriptor: r.descriptor ? Array.from(r.descriptor) : null };
  }
  async loop(fn, ms = 30) {
    const tick = async () => {
      if (!this.alive) return;
      let again = true;
      try { again = (await fn(this)) !== false; } catch (e) { console.warn(e); }
      if (this.alive && again) this.timer = setTimeout(tick, ms);
    };
    tick();
  }
  stopLoop() { this.alive = false; clearTimeout(this.timer); }
  destroy() {
    this.stopLoop();
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.video) this.video.srcObject = null;
  }
}

/** Guided enrolment: straight, slightly left, slightly right — 2 samples per angle. */
export function mountEnroll(root, { onDone }) {
  root.innerHTML = `<div id="cam-host"></div><div class="pose-steps" id="poses"><div>${icon('user')}<br>Look straight</div><div>${icon('back')}<br>Slightly left</div><div>${icon('chev')}<br>Slightly right</div></div>`;
  const cam = new FaceCam($('#cam-host', root));
  const poses = $('#poses', root).children;
  const labels = ['Look straight', 'Move slightly left', 'Move slightly right'];
  const samples = []; let step = 0, streak = 0, turnSign = 0, busy = false;
  const mark = () => [...poses].forEach((p, i) => { p.classList.toggle('done', i < step); p.classList.toggle('cur', i === step); });
  mark();

  const poseOk = (r) => {
    const off = r.ratio - 0.5;
    if (step === 0) return Math.abs(off) <= 0.07;
    const s = Math.sign(off);
    return Math.abs(off) >= 0.075 && Math.abs(off) <= 0.34 && (step === 1 || s === -turnSign);
  };
  const poseMsg = (r) => {
    const off = r.ratio - 0.5;
    if (step === 0) return labels[0];
    if (step === 2 && Math.abs(off) >= 0.075 && Math.sign(off) === turnSign) return 'Turn the other way';
    return Math.abs(off) < 0.075 ? `${labels[step]} · a little more` : Math.abs(off) > 0.34 ? 'Not that far — just slightly' : labels[step];
  };

  cam.init().then((okay) => {
    if (!okay) return;
    cam.loop(async () => {
      if (busy || step >= 3) return false;
      const r = await cam.look(false);
      if (!r) return;
      if (!r.found) { streak = 0; cam.progress(0); cam.say(r.dark ? 'Too dark — find better light' : 'No face detected — look at the camera'); return; }
      if (!r.ok) { streak = 0; cam.progress(0); cam.say(r.hint, 'bad'); return; }
      if (!poseOk(r)) { streak = 0; cam.progress(0); cam.say(poseMsg(r)); return; }
      streak++; cam.progress((streak / 3) * 100); cam.say('Face detected — hold still', 'ok');
      if (streak < 3) return;
      busy = true; cam.say('Capturing…', 'ok');
      const got = [];
      for (let i = 0; i < 2; i++) {
        const full = await cam.look(true);
        if (full && full.found && full.ok && full.descriptor && poseOk(full)) got.push(full.descriptor);
        await sleep(60);
      }
      if (got.length === 2) {
        samples.push(...got);
        if (step === 1) turnSign = Math.sign(r.ratio - 0.5) || 1;
        step++; streak = 0; mark(); cam.progress(0);
        if (step >= 3) {
          cam.say('All angles captured', 'ok'); cam.stopLoop();
          cam.showState(`<div>${successCheck()}<p style="margin-top:12px;font-weight:700;font-size:17px">Saving your face…</p></div>`);
          await onDone(samples, cam); return false;
        }
        cam.say(labels[step]);
      } else { streak = 0; cam.say('Hold steady and try again'); }
      busy = false;
    });
  });
  return { destroy: () => cam.destroy(), cam };
}

/**
 * Verification with liveness: align, blink (or turn head), capture, submit.
 * `submit(descriptor)` resolves on success or throws {message, code, data}.
 */
export function mountVerify(root, { submit, onSuccess, successText = 'Face Verified' }) {
  const cam = new FaceCam(root);
  let aligned = 0, busy = false, phase = 'align', startedLive = 0;
  let openMax = 0, closed = false, blinked = false, rMin = 1, rMax = 0;

  const resetLive = () => { openMax = 0; closed = false; blinked = false; rMin = 1; rMax = 0; startedLive = Date.now(); };

  const start = () => {
    aligned = 0; busy = false; phase = 'align'; resetLive();
    cam.hideState(); cam.progress(0); cam.scan.classList.add('hide'); cam.say('Look straight at the camera');
    cam.alive = true;
    cam.loop(async () => {
      if (busy) return false;
      const r = await cam.look(false);
      if (!r) return;
      if (!r.found) { aligned = 0; phase = 'align'; cam.progress(0); cam.say(r.dark ? 'Too dark — find better light' : 'No face detected — look at the camera'); return; }
      if (!r.ok) { aligned = 0; phase = 'align'; cam.progress(0); cam.say(r.hint, 'bad'); return; }

      if (phase === 'align') {
        if (Math.abs(r.ratio - 0.5) > 0.13) { aligned = 0; cam.progress(0); cam.say('Look straight at the camera', 'bad'); return; }
        aligned++; cam.progress((aligned / 2) * 90); cam.say('Face detected', 'ok');
        if (aligned >= 2) phase = 'capture';
        return;
      }

      if (phase === 'live') {
        // liveness: a blink (open -> closed -> open) or a clear head movement
        openMax = Math.max(openMax * 0.995, r.eyes);
        if (!closed && openMax > 0.2 && r.eyes < Math.min(0.21, openMax * 0.72)) closed = true;
        else if (closed && r.eyes > openMax * 0.85) { blinked = true; closed = false; }
        rMin = Math.min(rMin, r.ratio); rMax = Math.max(rMax, r.ratio);
        const turned = rMax - rMin > 0.12;
        const waited = (Date.now() - startedLive) / 1000;
        cam.progress(50 + (blinked || turned ? 40 : Math.min(30, waited * 4)));
        cam.say(waited > 6 ? 'Blink, or turn your head slightly' : 'Now blink once', 'ok');
        if (blinked || turned) phase = 'capture';
        return;
      }

      // capture: need a calm, straight, well-framed face for the descriptors
      if (Math.abs(r.ratio - 0.5) > 0.12) { cam.say('Look straight at the camera'); return; }
      busy = true; cam.progress(95); cam.say('Verifying…', 'ok'); cam.scan.classList.remove('hide');
      const shots = [];
      for (let i = 0; i < 3 && shots.length < 2; i++) {
        const d = await cam.look(true);
        if (d && d.found && d.ok && d.descriptor && Math.abs(d.ratio - 0.5) <= 0.13) shots.push(d.descriptor);
        await sleep(40);
      }
      if (shots.length < 1) { busy = false; phase = 'align'; aligned = 0; cam.scan.classList.add('hide'); cam.progress(0); cam.say('Hold steady and look straight'); return; }
      try {
        const res = await submit(mean(shots));
        cam.scan.classList.add('hide'); cam.destroy();
        cam.showState(`<div>${successCheck()}<p style="margin-top:14px;font-weight:800;font-size:20px">${esc(successText)} ✓</p>${res && res.confidence ? `<p style="opacity:.7;margin-top:4px">Match confidence ${res.confidence}%</p>` : ''}</div>`);
        setTimeout(() => onSuccess(res), 600);
      } catch (e) {
        cam.scan.classList.add('hide'); cam.stopLoop(); cam.progress(0);
        const locked = e.code === 'LOCKED' || e.status === 429;
        const mismatch = e.code === 'FACE_MISMATCH';
        cam.showState(`<div>${successCheck(true)}<p style="margin-top:14px;font-weight:800;font-size:19px">${mismatch ? 'Face verification failed' : 'Verification not completed'}</p>
          <p style="opacity:.75;margin:6px 0 16px;font-size:13.5px;line-height:1.5">${esc(mismatch ? `We couldn’t match your face. Remove glasses or a mask, face a light source and look straight at the camera.${e.data && e.data.attemptsLeft ? ` ${e.data.attemptsLeft} attempt(s) left before a short lock.` : ''}` : e.message)}</p>
          ${locked ? '' : '<button class="btn primary" id="vf-retry">Try again</button>'}</div>`);
        const b = $('#vf-retry', root); if (b) b.onclick = start;
      }
      return false;
    });
  };
  cam.init().then((okay) => { if (okay) start(); });
  return { destroy: () => cam.destroy() };
}
