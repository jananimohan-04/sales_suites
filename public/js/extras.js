// Helpers for the day plan (place search + map pin), road routing, proof photos and meeting notes.
import { getToken } from './api.js';
import { $, esc, icon, modal, toast, withBusy, fmtDur } from './ui.js';
import { createMap, siteMarker } from './map.js';

/* ---------- place search & road routes (public OpenStreetMap services) ---------- */
export async function geocode(q) {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=6&addressdetails=0&q=${encodeURIComponent(q)}`);
  if (!r.ok) throw new Error('Place search is unavailable right now. Tap the map to drop a pin instead.');
  return (await r.json()).map((x) => ({ name: x.name || x.display_name.split(',')[0], address: x.display_name, lat: +x.lat, lng: +x.lon }));
}

export async function reverseGeocode(lat, lng) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
    const j = await r.json();
    return { name: j.name || '', address: j.display_name || '' };
  } catch { return { name: '', address: '' }; }
}

// Driving route from -> to. Returns { points: [[lat,lng]...], meters, seconds } or null when routing is unavailable.
export async function getRoute(from, to) {
  try {
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`);
    const j = await r.json();
    const rt = j.routes && j.routes[0];
    if (!rt) return null;
    return { points: rt.geometry.coordinates.map(([lng, lat]) => [lat, lng]), meters: rt.distance, seconds: rt.duration };
  } catch { return null; }
}

export const navLink = (s) => `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}&travelmode=driving`;

/* ---------- proof photo ---------- */
// Shrinks a camera/gallery photo to a ≤1280px JPEG so uploads stay small on mobile data.
export function shrinkImage(file, max = 1280, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error('Choose an image file'));
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')); };
    img.src = url;
  });
}

// <img> can't send the auth header, so fetch the protected photo and show it via a blob URL.
export async function loadPhoto(visitId, imgEl) {
  try {
    const r = await fetch(`/api/visits/${visitId}/site-photo`, { headers: { Authorization: 'Bearer ' + getToken() } });
    if (!r.ok) throw new Error();
    imgEl.src = URL.createObjectURL(await r.blob());
    imgEl.classList.remove('hide');
  } catch { imgEl.closest('[data-photo-wrap]')?.classList.add('hide'); }
}

export const photoBlock = (v, title = 'Site proof photo') => v.sitePhoto
  ? `<div data-photo-wrap><p class="cap" style="text-align:left;margin-bottom:8px">${esc(title)}</p><img class="proof hide" alt="Company logo or visiting card" data-photo="${v.id}"></div>` : '';
export const mountPhotos = (root) => root.querySelectorAll('img[data-photo]').forEach((el) => loadPhoto(el.dataset.photo, el));

/* ---------- meeting notes ---------- */
export const OUTCOMES = { interested: 'Interested', follow_up: 'Needs follow-up', order_placed: 'Order placed', not_interested: 'Not interested' };
const OUTCOME_COLOR = { interested: 'blue', follow_up: 'orange', order_placed: 'green', not_interested: 'gray' };

export function meetingBlock(m, title = 'Meeting details') {
  if (!m) return '';
  return `<div class="card col" style="gap:12px"><div class="row between"><h3>${esc(title)}</h3><span class="chip ${OUTCOME_COLOR[m.outcome] || 'gray'}">${esc(OUTCOMES[m.outcome] || m.outcome)}</span></div>
    ${m.contact ? `<div class="row sub">${icon('user')}<span>Met <b>${esc(m.contact)}</b></span></div>` : ''}
    <p style="white-space:pre-wrap">${esc(m.notes)}</p>
    <div><p class="cap" style="text-align:left;margin-bottom:6px">Products discussed</p><div class="row wrap" style="gap:6px">${m.products.map((p) => `<span class="chip brand">${esc(p)}</span>`).join('')}</div></div>
    ${m.nextAction ? `<div class="alert info">${icon('flag')}<span><b>Next step:</b> ${esc(m.nextAction)}</span></div>` : ''}</div>`;
}

/* ---------- add a stop to today's plan ---------- */
// Resolves with the saved place payload, or null if dismissed.
export function pickPlace({ start, onSave }) {
  return new Promise((resolve) => {
    let map, marker, chosen = null, done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const m = modal({
      title: 'Add a stop', sub: 'Search the company, or tap the map to drop a pin.',
      body: `<div class="col" style="gap:12px;padding-bottom:8px">
        <div class="row" style="gap:8px"><input class="input" id="pq" placeholder="Search company or address…" autocomplete="off"><button class="btn" id="psearch" type="button" aria-label="Search">${icon('search')}</button></div>
        <div id="presults" class="col" style="gap:6px"></div>
        <div style="height:260px;border-radius:16px;overflow:hidden;border:1px solid var(--line-2)"><div id="pmap" class="map"></div></div>
        <button class="btn sm" id="pme" type="button">${icon('target')} Use my current location</button>
        <div class="field"><label>Company / place name</label><input class="input" id="pname" maxlength="80" placeholder="e.g. ABC Industries"></div>
        <div class="field"><label>Address <span class="muted">(optional)</span></label><input class="input" id="paddr" maxlength="160"></div>
        <div id="perr"></div></div>`,
      footer: `<button class="btn" data-close type="button">Cancel</button><button class="btn primary" id="psave" type="button" disabled>Add to my plan</button>`,
      onMount: (el) => {
        map = createMap($('#pmap', el), { center: start ? [start.lat, start.lng] : undefined, zoom: start ? 14 : 11 });
        setTimeout(() => map.invalidateSize(), 250);
        const setPoint = (lat, lng, name, address) => {
          chosen = { lat, lng };
          if (marker) marker.setLatLng([lat, lng]); else marker = siteMarker([lat, lng]).addTo(map);
          if (name !== undefined && name !== null) $('#pname', el).value = name || $('#pname', el).value;
          if (address !== undefined) $('#paddr', el).value = address || '';
          $('#psave', el).disabled = false;
        };
        map.on('click', async (e) => {
          setPoint(e.latlng.lat, e.latlng.lng);
          const g = await reverseGeocode(e.latlng.lat, e.latlng.lng);
          if (chosen && chosen.lat === e.latlng.lat) { if (!$('#pname', el).value) $('#pname', el).value = g.name; $('#paddr', el).value = g.address; }
        });
        const search = async () => {
          const q = $('#pq', el).value.trim(); if (q.length < 3) return;
          const box = $('#presults', el); box.innerHTML = `<p class="muted">Searching…</p>`;
          try {
            const list = await geocode(q);
            box.innerHTML = list.length ? list.map((p, i) => `<button type="button" class="site-opt" data-i="${i}"><span class="pin">${icon('pin')}</span><span class="grow"><b style="display:block">${esc(p.name)}</b><span class="muted" style="font-size:12px">${esc(p.address.slice(0, 90))}</span></span></button>`).join('') : `<p class="muted">No matches — tap the map instead.</p>`;
            box.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => {
              const p = list[+b.dataset.i]; setPoint(p.lat, p.lng, p.name, p.address); map.setView([p.lat, p.lng], 16); box.innerHTML = '';
            }));
          } catch (e) { box.innerHTML = `<div class="alert warn">${icon('alert')}<span>${esc(e.message)}</span></div>`; }
        };
        $('#psearch', el).addEventListener('click', search);
        $('#pq', el).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
        $('#pme', el).addEventListener('click', () => {
          if (!start) return toast('Location is not available yet', 'error');
          setPoint(start.lat, start.lng); map.setView([start.lat, start.lng], 16);
        });
        $('#psave', el).addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
          const name = $('#pname', el).value.trim();
          if (name.length < 2) { $('#perr', el).innerHTML = `<div class="alert err">${icon('alert')}<span>Enter the company or place name</span></div>`; return; }
          try { await onSave({ name, address: $('#paddr', el).value.trim(), lat: chosen.lat, lng: chosen.lng }); finish(true); m.close(); }
          catch (err) { $('#perr', el).innerHTML = `<div class="alert err">${icon('alert')}<span>${esc(err.message)}</span></div>`; }
        }));
      },
    });
    const obs = new MutationObserver(() => { if (!document.body.contains(m.el)) { obs.disconnect(); if (map) map.remove(); finish(null); } });
    obs.observe(document.body, { childList: true });
  });
}

export { fmtDur };
