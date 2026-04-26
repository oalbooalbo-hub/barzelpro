/**
 * service-worker.js — BARZELPRO PWA Service Worker v2.3.0
 */

const APP_VERSION   = 'v2.3.7';
const STATIC_CACHE  = `barzelpro-static-${APP_VERSION}`;
const RUNTIME_CACHE = `barzelpro-runtime-${APP_VERSION}`;

const STATIC_ASSETS = [
  './',
  './index.html',
  './install.html',      // ← Install landing page (LCP critical)
  './success.html',      // ← Post-install success page
  './offline.html',
  './manifest.json',
  './brand_library.json',
  './logo.svg',
];

const NETWORK_ONLY_PATTERNS = [
  /firestore\.googleapis\.com/,
  /identitytoolkit\.googleapis\.com/,
  /securetoken\.googleapis\.com/,
  /firebase\.googleapis\.com/,
];

const SWR_PATTERNS = [
  /fonts\.googleapis\.com/,
  /fonts\.gstatic\.com/,
  /cdnjs\.cloudflare\.com/,
];

// ── INSTALL ───────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing', APP_VERSION);
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => Promise.allSettled(
        STATIC_ASSETS.map(asset =>
          cache.add(asset).catch(e => console.warn('[SW] Pre-cache failed:', asset, e))
        )
      ))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating', APP_VERSION);
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== STATIC_CACHE && key !== RUNTIME_CACHE)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
      .then(() =>
        self.clients.matchAll({ type: 'window' }).then(clients =>
          clients.forEach(client =>
            client.postMessage({ type: 'SW_UPDATED', version: APP_VERSION })
          )
        )
      )
  );
});

// ── FETCH ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || !url.protocol.startsWith('http')) return;

  // 1. Firebase/Firestore — always live, never cache
  if (NETWORK_ONLY_PATTERNS.some(p => p.test(request.url))) {
    event.respondWith(fetch(request));
    return;
  }

  // 2. CDNs / Fonts — stale-while-revalidate
  if (SWR_PATTERNS.some(p => p.test(request.url))) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // 3. install.html — cache-first for instant LCP, revalidate in background
  if (url.pathname.endsWith('install.html')) {
    event.respondWith(cacheFirstWithRevalidate(request));
    return;
  }

  // 4. index.html / config.js / HTML navigations — network-first (3s timeout)
  if (
    request.headers.get('accept')?.includes('text/html') ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('/') ||
    url.pathname.includes('config.js')
  ) {
    event.respondWith(networkFirst(request));
    return;
  }

  // 5. Everything else (images, JSON, etc.) — cache-first
  event.respondWith(cacheFirst(request));
});

// ── STRATEGIES ───────────────────────────────────────────────────────────────

/**
 * Cache-first with background revalidate — instant LCP for install.html.
 * Serves from cache immediately, then fetches fresh copy in background.
 */
async function cacheFirstWithRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);

  // Revalidate in background regardless
  const fetchPromise = fetch(request)
    .then(res => { if (res.ok) cache.put(request, res.clone()); return res; })
    .catch(() => null);

  // Serve cached instantly if available — zero network wait = low LCP
  return cached || fetchPromise || caches.match('./offline.html');
}

/**
 * Network-first with 3s timeout, fallback to cache.
 */
async function networkFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(null), 3000));

  try {
    const res = await Promise.race([fetch(request), timeoutPromise]);
    if (res && res.ok) {
      cache.put(request, res.clone());
      return res;
    }
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.headers.get('accept')?.includes('text/html')) {
      return caches.match('./offline.html');
    }
    return Response.error();
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.headers.get('accept')?.includes('text/html')) {
      return caches.match('./offline.html');
    }
    return Response.error();
  }
}

/**
 * Cache-first, fill from network on miss.
 */
async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    return Response.error();
  }
}

/**
 * Stale-while-revalidate — serve cached, update in background.
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const fresh = fetch(request)
    .then(r => { if (r.ok) cache.put(request, r.clone()); return r; })
    .catch(() => null);
  return cached || fresh;
}

// ── MESSAGES & SYNC ──────────────────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('sync', event => {
  if (event.tag === 'barzelpro-sync') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window' })
        .then(clients => clients.forEach(c => c.postMessage({ type: 'BACKGROUND_SYNC' })))
    );
  }
});
