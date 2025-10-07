// service-worker.js — cache bump to refresh files
const CACHE_NAME = 'bff-gym-cache-v10'; // bump this when you change files
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './settings.js',
  './manifest.json',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/bff-logo.png'
];

// Install: pre-cache
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

// Activate: delete old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for HTML, cache-first for assets
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const isHTML = req.headers.get('accept')?.includes('text/html');
  if (isHTML) {
    e.respondWith(fetch(req).catch(() => caches.match('./index.html')));
  } else {
    e.respondWith(caches.match(req).then(res => res || fetch(req)));
  }
});

// Allow page to trigger immediate update
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
