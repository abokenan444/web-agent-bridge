const CACHE_NAME = 'wab-browser-v2';
const SHELL_ASSETS = [
  '/pwa/',
  '/pwa/app.css',
  '/pwa/app.js',
  '/pwa/manifest.json',
  '/pwa/icons/icon-192.svg',
  '/pwa/icons/icon-512.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Only cache same-origin shell assets; let everything else go to network
  if (url.origin === self.location.origin && SHELL_ASSETS.includes(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then((cached) => cached || fetch(e.request))
    );
    return;
  }
  // Network first for API calls and browsed content
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
