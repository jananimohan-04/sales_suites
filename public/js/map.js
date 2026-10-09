// Leaflet helpers with a clean, low-clutter style.
import { icon } from './ui.js';

export function createMap(el, { center = [13.0827, 80.2707], zoom = 12, zoomControl = true } = {}) {
  const map = L.map(el, { zoomControl, attributionControl: true }).setView(center, zoom);
  const tiles = window.__tiles || {};
  L.tileLayer(tiles.url || 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: tiles.attribution || 'Tiles &copy; Esri' }).addTo(map);
  const t = setTimeout(() => { if (map._loaded) map.invalidateSize(); }, 120);
  map.on('unload', () => clearTimeout(t));
  return map;
}

export const personMarker = (ll, color = '#2563eb', label = '') =>
  L.marker(ll, { icon: L.divIcon({ className: '', iconSize: [40, 40], iconAnchor: [20, 20], html: `<div class="mk-person" style="--c:${color}"><i></i><b>${label}</b></div>` }), zIndexOffset: 800 });

export const siteMarker = (ll) =>
  L.marker(ll, { icon: L.divIcon({ className: '', iconSize: [34, 34], iconAnchor: [17, 34], html: `<div class="mk-site">${icon('building').replace('class="ico "', '')}</div>` }), zIndexOffset: 500 });

export const dotMarker = (ll, color, title) =>
  L.marker(ll, { icon: L.divIcon({ className: '', iconSize: [16, 16], iconAnchor: [8, 8], html: `<div class="mk-dot" style="background:${color}"></div>` }), title, zIndexOffset: 300 });

export const geofence = (site) => L.circle([site.lat, site.lng], { radius: site.radius, color: '#4f46e5', weight: 1.5, fillColor: '#4f46e5', fillOpacity: .08, dashArray: '5 6' });

export const routeLine = (pts, color = '#4f46e5') => L.polyline(pts.map((p) => [p.lat, p.lng]), { color, weight: 4, opacity: .85, lineJoin: 'round' });

export function fit(map, layers, pad = 50) {
  const pts = [];
  layers.forEach((l) => { if (!l) return; if (l.getLatLng) pts.push(l.getLatLng()); else if (l.getBounds) { const b = l.getBounds(); pts.push(b.getSouthWest(), b.getNorthEast()); } });
  if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [pad, pad], maxZoom: 16, animate: false });
}

export function haversine(a, b) {
  const R = 6371000, r = (d) => d * Math.PI / 180, dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
