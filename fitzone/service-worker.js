/**
 * service-worker.js — BARZELPRO PWA Service Worker
 *
 * Strategies:
 *   • Cache First       — static assets (HTML, JS, CSS, fonts, images, JSON)
 *   • Stale-While-Revalidate — API/CDN routes (Firebase, Google Fonts, etc.)
 *   • Network Only      — Firestore writes (never cache mutations)
 */

// ── Cache config ──────────────────────────────────────────────────────────────
const CACHE_VERSION = 'v1';
const STATIC_CACHE  = `barzelpro-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `barzelpro-runtime-${CACHE_VERSION}`;

// Critical assets to pre-cache on install (Cache First)
const STATIC_ASSETS = [
  './',
  './index.html',
  './config.js',
  './database.js',
  './exercises.json',
  './manifest.json',
  './logo.svg',
];

// URL patterns that should use Stale-While-Revalidate
const SWR_PATTERNS = [
  /fonts\.googleapis\.com/,
  /fonts\.gstatic\.com/,
  /cdnjs\.cloudflare\.com/,
  /firebasestorage\.googleapis\.com/,
];

// URL patterns that should NEVER be cached (Firestore reads/writes, Auth)
const NETWORK_ONLY_PATTERNS = [
  /firestore\.googleapis\.com/,
  /identitytoolkit\.googleapis\.com/,
  /securetoken\.googleapis\.com/,
  /firebase\.googleapis\.com/,
];

// ── INSTALL — pre-cache static assets ────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing version:', CACHE_VERSION);

  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('[SW] Pre-caching critical assets');
        // addAll is atomic — if one fails, none are cached
        // Use individual adds so a missing logo.svg doesn't break install
        return Promise.allSettled(
          STATIC_ASSETS.map(asset =>
            cache.add(asset).catch(e =>
              console.warn('[SW] Failed to cache asset:', asset, e.message)
            )
          )
        );
      })
      .then(() => {
        console.log('[SW] Install complete — skipping waiting');
        return self.skipWaiting(); // activate immediately
      })
  );
});

// ── ACTIVATE — clean up old caches ───────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating version:', CACHE_VERSION);

  const validCaches = new Set([STATIC_CACHE, RUNTIME_CACHE]);

  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => !validCaches.has(key))
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      ))
      .then(() => self.clients.claim()) // take control of all open tabs
  );
});

// ── FETCH — route requests to the right strategy ─────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests entirely (POST/PUT/DELETE go to network)
  if (request.method !== 'GET') return;

  // Skip chrome-extension, data: and other non-http requests
  if (!url.protocol.startsWith('http')) return;

  // Network Only — Firestore, Firebase Auth
  if (NETWORK_ONLY_PATTERNS.some(p => p.test(request.url))) {
    event.respondWith(fetch(request));
    return;
  }

  // Stale-While-Revalidate — CDN, fonts
  if (SWR_PATTERNS.some(p => p.test(request.url))) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  // Cache First — all static assets (HTML, JS, JSON, SVG, fonts loaded locally)
  event.respondWith(cacheFirst(request, STATIC_CACHE));
});

// ── STRATEGIES ────────────────────────────────────────────────────────────────

/**
 * Cache First — serve from cache, fall back to network and update cache.
 * Best for: HTML, JS, CSS, JSON, images that don't change often.
 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  if (cached) {
    return cached;
  }

  // Not in cache — fetch from network and store for next time
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (e) {
    // Offline and not cached — return a fallback for HTML requests
    if (request.headers.get('accept')?.includes('text/html')) {
      const fallback = await cache.match('./index.html');
      if (fallback) return fallback;
    }
    throw e;
  }
}

/**
 * Stale-While-Revalidate — serve from cache immediately, update in background.
 * Best for: CDN fonts, external scripts where freshness matters but latency doesn't.
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  // Kick off a background fetch regardless
  const networkFetch = fetch(request)
    .then(response => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  // Return cached immediately if available, otherwise wait for network
  return cached || networkFetch;
}

// ── MESSAGE HANDLER — receive commands from the app ───────────────────────────
self.addEventListener('message', event => {
  if (!event.data) return;

  switch (event.data.type) {

    // App requests SW to activate immediately (e.g. user clicked "refresh")
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    // App requests cache to be cleared (e.g. after logout)
    case 'CLEAR_CACHE':
      caches.keys().then(keys =>
        Promise.all(keys.map(k => caches.delete(k)))
      ).then(() => {
        event.ports[0]?.postMessage({ success: true });
        console.log('[SW] All caches cleared on request');
      });
      break;

    // App requests list of cached URLs (for debug)
    case 'GET_CACHE_CONTENTS':
      caches.open(STATIC_CACHE).then(cache => cache.keys()).then(keys => {
        event.ports[0]?.postMessage({ urls: keys.map(r => r.url) });
      });
      break;
  }
});

// ── BACKGROUND SYNC ───────────────────────────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'barzelpro-sync') {
    console.log('[SW] Background sync triggered');
    event.waitUntil(
      // Notify all open clients to flush their queue
      self.clients.matchAll({ type: 'window' }).then(clients => {
        clients.forEach(client => client.postMessage({ type: 'BACKGROUND_SYNC' }));
      })
    );
  }
});
