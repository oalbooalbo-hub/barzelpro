/**
 * service-worker.js — BARZELPRO PWA Service Worker v2.2
 *
 * Key behavior:
 *   • index.html — Network First (always try to get latest, fall back to cache)
 *   • Static assets (JS, JSON, SVG) — Cache First
 *   • CDN/Fonts — Stale-While-Revalidate
 *   • Firestore/Firebase Auth — Network Only (never cache)
 *   • Auto-reload clients when a new SW version activates
 */

const APP_VERSION   = 'v2.2';
const STATIC_CACHE  = `barzelpro-static-${APP_VERSION}`;
const RUNTIME_CACHE = `barzelpro-runtime-${APP_VERSION}`;

const STATIC_ASSETS = [
  './',
  './index.html',
  './config.js',
  './exercises.json',
  './manifest.json',
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
  if (request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;
  if (NETWORK_ONLY_PATTERNS.some(p => p.test(request.url))) { event.respondWith(fetch(request)); return; }
  if (SWR_PATTERNS.some(p => p.test(request.url))) { event.respondWith(staleWhileRevalidate(request)); return; }
  if (request.headers.get('accept')?.includes('text/html') || url.pathname.endsWith('.html') || url.pathname.endsWith('/')) {
    event.respondWith(networkFirst(request)); return;
  }
  event.respondWith(cacheFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch { return (await cache.match(request)) || Response.error(); }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const fresh = fetch(request).then(r => { if (r.ok) cache.put(request, r.clone()); return r; }).catch(() => null);
  return cached || fresh;
}

// ── MESSAGES ──────────────────────────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// ── BACKGROUND SYNC ───────────────────────────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'barzelpro-sync') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window' })
        .then(clients => clients.forEach(c => c.postMessage({ type: 'BACKGROUND_SYNC' })))
    );
  }
});
