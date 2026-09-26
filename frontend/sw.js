// AeroCast Service Worker - Static App Shell Cache
//
// IMPORTANT: bump CACHE_NAME on every deploy that changes app.js/style.css/
// index.html. The previous version used a cache-first strategy with a
// CACHE_NAME that never changed, so once a browser had the shell cached it
// kept serving the OLD app.js/style.css forever - code fixes (like the
// read-aloud toggle fix) were shipped but invisible to already-installed
// users. This version fixes that two ways:
//   1. CACHE_NAME is versioned - bump it whenever the app shell changes so
//      `activate` purges the old cache immediately.
//   2. The app shell (HTML/JS/CSS) uses network-first with a cache fallback
//      (only used when offline), instead of cache-first, so a live network
//      connection always gets the latest deployed code.
const CACHE_NAME = 'aerocast-shell-v2';
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './config.js',
  './manifest.json',
  './icon.svg'
];

// Extensions that should always prefer the network (app code/markup).
// Everything else (fonts, icons, images) can stay cache-first since it
// rarely changes and cache-first keeps those fast.
const NETWORK_FIRST_EXT = /\.(html|js|css)$/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Strictly network-only for API calls, third-party data APIs, or POST requests
  if (
    req.method !== 'GET' ||
    url.pathname.includes('/api/') ||
    url.hostname.includes('open-meteo.com') ||
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('generativelanguage.googleapis.com')
  ) {
    return;
  }

  const isAppShell = req.mode === 'navigate' || NETWORK_FIRST_EXT.test(url.pathname) || url.pathname === '/' || url.pathname.endsWith('/');

  if (isAppShell && url.origin === self.location.origin) {
    // Network-first for the app shell: always try to get the latest
    // deployed HTML/JS/CSS, only falling back to the cache when offline.
    event.respondWith(
      fetch(req).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return response;
      }).catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }

  // Cache-first for everything else (fonts, icons, third-party libs)
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((response) => {
        if (response.ok && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return response;
      }).catch(() => {
        if (req.mode === 'navigate') return caches.match('./index.html');
      });
    })
  );
});
