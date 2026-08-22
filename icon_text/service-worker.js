/**
 * service-worker.js — BARZELPRO PWA Service Worker v2.5.0
 */

const APP_VERSION   = 'v2.5.1';
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
  './icons/icon-192.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512.png',
];

// index.html's top module block does static `import`s of these straight from
// gstatic — if that import fails (nothing cached + no network), the whole
// module throws and never runs, which means auth/Firestore/showAuthScreen
// never initialize and the app hangs on a black screen after the loading
// overlay's safety-net timer hides it. Without this, they only ever got
// cached "incidentally" via the generic cacheFirst rule below, which only
// works once the SW is already active and controlling a prior successful
// online load — precache them explicitly instead so a fresh install/cleared
// cache still has them the first time the app is opened offline.
const FIREBASE_SDK_ASSETS = [
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js',
];

// index.html also has blocking classic <script src> tags in <head> —
// localforage and Chart.js — that run before the rest of the app's inline
// script block. If they fail to load (offline + nothing cached yet), that
// whole inline block throws partway through and everything defined later in
// it (including window._onAuthReady, near the very end) never gets assigned,
// which hangs the app behind the loading overlay just as hard as the Firebase
// SDK imports failing does. These were previously left to the generic SWR
// rule below, which only ever caches them "incidentally" after a prior
// successful online load — precache them explicitly so a fresh
// install/cleared cache still has them the first time the app is opened
// offline.
const CDN_LIB_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/localforage/1.10.0/localforage.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
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
        [...STATIC_ASSETS, ...FIREBASE_SDK_ASSETS, ...CDN_LIB_ASSETS].map(asset =>
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

  // 4. index.html / config.js / HTML navigations / *.json data files —
  // network-first (3s timeout). JSON is included here (not left to rule 5)
  // because hand-edited data files like coach_male/data.json need to be picked
  // up on next load, not stuck serving whatever was cached the first time a
  // device ever fetched them.
  if (
    request.headers.get('accept')?.includes('text/html') ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('/') ||
    url.pathname.endsWith('.json') ||
    url.pathname.includes('config.js')
  ) {
    event.respondWith(networkFirst(request));
    return;
  }

  // 5. Everything else (images, etc.) — cache-first
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
    console.log('[SW] Offline (network failed/timed out) — serving from cache:', request.url);
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.headers.get('accept')?.includes('text/html')) {
      console.log('[SW] No cached copy either — falling back to offline.html:', request.url);
      return caches.match('./offline.html');
    }
    return Response.error();
  } catch {
    console.log('[SW] Offline (fetch threw) — serving from cache:', request.url);
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.headers.get('accept')?.includes('text/html')) {
      console.log('[SW] No cached copy either — falling back to offline.html:', request.url);
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
    console.log('[SW] Offline with no cached copy — request failed:', request.url);
    return Response.error();
  }
}

/**
 * Stale-while-revalidate — serve cached, update in background.
 * Note: on a cache miss (e.g. first-ever offline load), this must not resolve
 * to `null` — respondWith() only accepts an actual Response, and handing it
 * null fails the request outright instead of a clean offline error.
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const freshPromise = fetch(request)
    .then(r => { if (r.ok) cache.put(request, r.clone()); return r; })
    .catch(() => null);
  if (cached) return cached;
  const fresh = await freshPromise;
  return fresh || Response.error();
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
