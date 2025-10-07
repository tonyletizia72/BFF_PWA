// service-worker.js — Boxing for Fitness
const CACHE_NAME = 'bff-gym-cache-v2';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './settings.js',
  './manifest.json',
  './assets/bff-logo.png',
  './assets/icon-192.png',
  './assets/icon-512.png'
];

// ✅ Install: Cache all app shell files
self.addEventListener('install', event => {
  console.log('[Service Worker] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[Service Worker] Caching core files');
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting(); // activate immediately
});

// ✅ Activate: Remove old caches when new version detected
self.addEventListener('activate', event => {
  console.log('[Service Worker] Activating...');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(key => {
        if (key !== CACHE_NAME) {
          console.log('[Service Worker] Deleting old cache:', key);
          return caches.delete(key);
        }
      }))
    )
  );
  self.clients.claim();
});

// ✅ Fetch: Serve cached files, then fallback to network
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      const fetchPromise = fetch(event.request)
        .then(networkResponse => {
          // Update cache if newer version found
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, networkResponse.clone());
          });
          return networkResponse;
        })
        .catch(() => cached); // fallback to cache if offline
      return cached || fetchPromise;
    })
  );
});

// ✅ Listen for skipWaiting() trigger from app
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
