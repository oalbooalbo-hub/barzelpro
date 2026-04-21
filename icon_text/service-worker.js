/**
 * service-worker.js — BARZELPRO PWA Service Worker v2.2.1
 */

const APP_VERSION   = 'v2.2.4';
const STATIC_CACHE  = `barzelpro-static-${APP_VERSION}`;
const RUNTIME_CACHE = `barzelpro-runtime-${APP_VERSION}`;

// Removed config.js from here so it defaults to Network First

const STATIC_ASSETS = [
  './',
  './index.html',
  './offline.html',
  './pwa-styles.css',
  './manifest.json',
  './brand_library.json',
  './logo.svg'
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
        STATIC_ASSETS.map(asset => cache.add(asset).catch(e => console.warn('[SW] Pre-cache failed:', asset)))
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
        keys.filter(key => key !== STATIC_CACHE && key !== RUNTIME_CACHE)
            .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }).then(clients => {
        clients.forEach(client => client.postMessage({ type: 'SW_UPDATED', version: APP_VERSION }));
      }))
  );
});

// ── FETCH ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  
  if (request.method !== 'GET' || !url.protocol.startsWith('http')) return;

  // 1. Firebase/Firestore (Always live)
  if (NETWORK_ONLY_PATTERNS.some(p => p.test(request.url))) { 
    event.respondWith(fetch(request)); 
    return; 
  }

  // 2. CDNs/Fonts (Fastest + Update in background)
  if (SWR_PATTERNS.some(p => p.test(request.url))) { 
    event.respondWith(staleWhileRevalidate(request)); 
    return; 
  }

  // 3. HTML & Config (Try latest first, 3s timeout)
  if (
    request.headers.get('accept')?.includes('text/html') || 
    url.pathname.endsWith('.html') || 
    url.pathname.endsWith('/') ||
    url.pathname.includes('config.js') // Added config.js here
  ) {
    event.respondWith(networkFirst(request)); 
    return;
  }

  // 4. Other static assets (Images, JSON)
  event.respondWith(cacheFirst(request));
});

// ── STRATEGIES ───────────────────────────────────────────────────────────────

async function networkFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 3000));

  try {
    const res = await Promise.race([fetch(request), timeoutPromise]);
    if (res && res.ok) {
      cache.put(request, res.clone());
      return res;
    }
    
    // 1. Try to find the specific page in cache
    const cached = await cache.match(request);
    if (cached) return cached;

    // 2. If it's a page navigation, show the offline page
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

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  
  const fresh = fetch(request).then(r => { 
    if (r.ok) cache.put(request, r.clone()); 
    return r; 
  }).catch(() => null);

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
