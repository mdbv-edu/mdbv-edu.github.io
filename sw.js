/* MDBV Portal — background script (service worker).
 *
 * What it does:
 *  - Pages (index.html, about.html …): always fetched fresh from the internet first, so every
 *    update you upload to GitHub reaches the app straight away. The last copy is kept and used
 *    only when there is no signal.
 *  - Pictures, icons and other files on mdbv-edu.in: shown from the phone's copy at once and
 *    refreshed in the background.
 *  - Everything else (the Supabase database, Tailwind, fonts, other websites) is left alone —
 *    the app talks to them exactly as the website does.
 *
 *  - Notifications: shows the pop-ups sent by the school's "notify" service, and opens the
 *    portal's alerts list when one is tapped (without reloading an open portal, which would log out).
 *
 * To force every phone to drop its saved copies, change VERSION below and upload this file.
 */
const VERSION = 'mdbv-app-v4';
const SHELL = ['/', '/manifest.webmanifest', '/app/icon-192.png', '/app/icon-512.png', '/assets/img/logo.png'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSION)
      .then(cache => Promise.all(SHELL.map(u => cache.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // database, CDNs, other sites: untouched
  if (url.searchParams.has('build-check')) return;          // the portal's "new version?" check: always straight to the internet

  // Pages: internet first, saved copy when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true })
          .then(hit => hit || caches.match('/'))
          .then(hit => hit || new Response(
            '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
            '<title>MDBV — offline</title><body style="font-family:sans-serif;text-align:center;padding:48px 16px;color:#7a1e2e">' +
            '<h2>No internet connection</h2><p style="color:#444">Please check your mobile data or Wi-Fi and try again.</p>' +
            '<button onclick="location.reload()" style="padding:10px 18px;border:0;border-radius:8px;background:#7a1e2e;color:#fff">Try again</button>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } })))
    );
    return;
  }

  // Pictures and other files from our own site: saved copy first, refreshed in the background.
  event.respondWith(
    caches.open(VERSION).then(cache =>
      cache.match(req).then(hit => {
        const fresh = fetch(req).then(res => {
          if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
          return res;
        }).catch(() => hit);
        return hit || fresh;
      })
    )
  );
});

// ---- Notifications (pop-ups) ----
self.addEventListener('push', event => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { title: 'MDBV', body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(d.title || 'MDBV', {
    body: d.body || '', tag: d.tag || undefined, renotify: !!d.tag,
    icon: '/app/icon-192.png', badge: '/app/icon-192.png', lang: 'en-IN',
    vibrate: [200, 100, 200], timestamp: Date.now(), silent: false,
    requireInteraction: d.kind === 'money',
    data: { url: d.url || '/?notifications=1' }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/?notifications=1', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => c.url.startsWith(self.location.origin));
    if (open) { open.postMessage({ type: 'mdbv-open-notifications', url }); return open.focus(); }   // already open: no reload (keeps the login)
    return self.clients.openWindow(url);
  }));
});
