const CACHE_NAME = 'futbol-okulu-v3';
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
  '/api.js',
  '/menu.js',
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
