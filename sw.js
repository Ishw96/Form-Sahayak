/* ============================================================
   FORM SAHAYAK — Service Worker
   Cache-first shell, network-first APIs, old cache cleanup
   ============================================================ */

const CACHE_NAME = 'form-sahayak-v3';

const APP_SHELL = [
  './',
  './index.html',
  './css/design-system.css',
  './css/components.css',
  './css/responsive.css',
  './manifest.json',
  './js/app.js',
  './js/ui.js',
  './js/api.js',
  './js/storage.js',
  './js/utils.js',
];

/* ── Install: Pre-cache app shell ───────────────────────── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Pre-caching app shell');
        return cache.addAll(APP_SHELL);
      })
      .then(() => self.skipWaiting())
      .catch((err) => {
        console.warn('[SW] Pre-cache failed for some assets:', err);
        // Don't block install if some assets aren't available yet
        return self.skipWaiting();
      })
  );
});

/* ── Activate: Purge old caches ─────────────────────────── */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        )
      )
      .then(() => self.clients.claim())
  );
});

/* ── Fetch Strategy ─────────────────────────────────────── */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip chrome-extension and other non-http schemes
  if (!url.protocol.startsWith('http')) return;

  // ── Network-only: Gemini API calls ──
  if (url.hostname.includes('generativelanguage.googleapis.com') ||
      url.hostname.includes('gemini')) {
    return; // Let the browser handle API calls normally
  }

  // ── Network-first: Google Fonts (pass through, no caching complexity) ──
  if (url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
    return;
  }

  // ── Cache-first: App shell and static assets ──
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        // Return cache hit, but also fetch update in background
        const fetchPromise = fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const responseClone = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, responseClone);
              });
            }
            return networkResponse;
          })
          .catch(() => {/* ignore background fetch failures */});

        return cachedResponse;
      }

      // Not in cache — fetch from network
      return fetch(request).then((networkResponse) => {
        // Only cache same-origin successful responses
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          url.origin === self.location.origin
        ) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return networkResponse;
      });
    })
  );
});

/* ── Message handler for cache control ──────────────────── */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME).then(() => {
      console.log('[SW] Cache cleared');
    });
  }
});
