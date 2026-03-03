// Substrate Service Worker — enables PWA install + background notifications
const CACHE_NAME = 'substrate-v27';
const PRECACHE = ['/ui', '/ui/main.js?v=20260216b', '/static/js/avatar.js?v=20260215f', '/static/css/avatar.css?v=20260215f'];

// Install: cache shell assets
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: network-first, fall back to cache for offline resilience
self.addEventListener('fetch', (e) => {
  // Skip non-GET and API calls (always go to network)
  if (e.request.method !== 'GET' || e.request.url.includes('/api/')) return;
  e.respondWith(
    fetch(e.request).then(resp => {
      const clone = resp.clone();
      caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      return resp;
    }).catch(() => caches.match(e.request))
  );
});

// Push notification from server (future: Web Push)
self.addEventListener('push', (e) => {
  let data = { title: 'Substrate', body: '' };
  try { data = e.data.json(); } catch (_) { data.body = e.data ? e.data.text() : ''; }
  e.waitUntil(
    self.registration.showNotification(data.title || 'Substrate', {
      body: data.body || '',
      icon: '/ui/icon-192.png',
      badge: '/ui/icon-192.png',
      tag: data.tag || 'substrate-default',
      vibrate: [200, 100, 200],
    })
  );
});

// Notification click: focus or open the WebUI
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
      for (const w of wins) {
        if (w.url.includes('/ui') && 'focus' in w) return w.focus();
      }
      return clients.openWindow('/ui');
    })
  );
});
