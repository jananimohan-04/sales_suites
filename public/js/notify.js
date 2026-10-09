// System notifications (status bar / notification shade): native local notifications inside the Android app,
// browser notifications (via the service worker) on the web. Failing silently is fine — the in-app UI still shows everything.
const cap = () => (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() ? window.Capacitor : null);
const LN = () => { const c = cap(); return c && c.Plugins && c.Plugins.LocalNotifications; };
export const nativePlugin = (name) => { const c = cap(); return (c && c.Plugins && c.Plugins[name]) || null; };

const numId = (tag) => { let h = 7; for (const ch of String(tag)) h = (h * 31 + ch.charCodeAt(0)) % 2147483000; return h || 1; };
let swReg = null;

export async function initNotifications() {
  if (cap() || !('serviceWorker' in navigator)) return;
  try { swReg = await navigator.serviceWorker.register('/sw.js'); } catch { /* needs https or localhost */ }
}

export async function ensurePermission() {
  try {
    const ln = LN();
    if (ln) { const p = await ln.checkPermissions(); if (p.display === 'granted') return true; return (await ln.requestPermissions()).display === 'granted'; }
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    return (await Notification.requestPermission()) === 'granted';
  } catch { return false; }
}

// Browsers only allow the permission prompt after a tap/click, so ask on the first one.
export function armPermissionOnGesture() {
  if (cap() || !('Notification' in window) || Notification.permission !== 'default') return;
  const once = () => { document.removeEventListener('click', once, true); ensurePermission(); };
  document.addEventListener('click', once, true);
}

// tag: a notification with the same tag replaces the previous one. ongoing: stays pinned until cleared.
export async function notify(title, body, { tag = 'argus', ongoing = false } = {}) {
  try {
    const ln = LN();
    if (ln) {
      if (!(await ensurePermission())) return;
      await ln.schedule({ notifications: [{ id: numId(tag), title, body, ongoing, autoCancel: !ongoing }] });
      return;
    }
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const opts = { body, tag, renotify: !ongoing, requireInteraction: ongoing, silent: ongoing, icon: '/icon.svg', badge: '/icon.svg' };
    if (swReg) await swReg.showNotification(title, opts); else new Notification(title, opts);
  } catch { /* ignore */ }
}

export async function clearNotify(tag) {
  try {
    const ln = LN();
    if (ln) { await ln.cancel({ notifications: [{ id: numId(tag) }] }); return; }
    if (swReg) (await swReg.getNotifications({ tag })).forEach((n) => n.close());
  } catch { /* ignore */ }
}
