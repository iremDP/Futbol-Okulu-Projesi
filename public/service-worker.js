const CACHE_NAME = 'futbol-okulu-v4';
const STATIC_ASSETS = [
  '/',
  '/login.html',
  '/index.html',
  '/dashboard.html',
  '/veli.html',
  '/gruplar.html',
  '/odemeler.html',
  '/donemler.html',
  '/raporlar.html',
  '/kullanicilar.html',
  '/subeler.html',
  '/muhasebe.html',
  '/testler.html',
  '/checkin.html',
  '/api.js',
  '/menu.js',
  '/push-client.js',
  '/manifest.json',
  '/css/responsive.css',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {});
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // API ve sayfa geçişleri - SW müdahale etmesin, doğrudan ağa gitsin (Failed to fetch hatasını önler)
  if (e.request.url.includes('/api/') || e.request.mode === 'navigate') {
    return;
  }
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

// Web Push bildirimleri
self.addEventListener('push', (event) => {
  let payload = { title: 'Bildirim', body: '' };
  try {
    if (event.data) {
      payload = event.data.json();
    }
  } catch (_) {
    try { payload.body = event.data.text(); } catch (_) { /* sessiz */ }
  }
  const title = payload.title || 'Futbol Okulu';
  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: payload.url || '/' },
    vibrate: [100, 50, 100]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const c of wins) {
        if ('focus' in c) {
          c.navigate(url).catch(() => {});
          return c.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
