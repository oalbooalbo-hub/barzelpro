/**
 * network.js — Offline-first network utility for BARZELPRO
 *
 * Responsibilities:
 *   1. JWT cache — store & validate Firebase ID token in IndexedDB
 *      so users can access the dashboard while offline
 *   2. Online guard — wrapper around all Firestore writes that checks
 *      navigator.onLine before hitting the network
 *   3. Offline queue — failed/skipped writes are queued in IndexedDB
 *      and replayed when connectivity is restored (Background Sync)
 *
 * Usage:
 *   import Net from './network.js';
 *
 *   // Check if user has a valid cached token (offline-safe auth)
 *   const ok = await Net.hasValidSession();
 *
 *   // Wrap any Firestore write — auto-queues when offline
 *   await Net.request('setDoc', { ref, data, merge: true });
 *
 *   // Manually flush the queue (called automatically on 'online')
 *   await Net.flushQueue();
 */

// ── Constants ─────────────────────────────────────────────────────────────────
const DB_NAME       = 'BarzelpoDB';
const DB_STORE      = 'barzelproStore';
const TOKEN_KEY     = 'barzelpro_jwt_cache';
const QUEUE_KEY     = 'barzelpro_offline_queue';
const SESSION_KEY   = 'barzelpro_session_meta';

// Token considered valid if it expires more than 2 minutes from now
const TOKEN_EXPIRY_BUFFER_MS = 2 * 60 * 1000;

// ── localForage reference (loaded via CDN before this module) ─────────────────
const _lf = () => {
  if (typeof window !== 'undefined' && window.localforage) return window.localforage;
  throw new Error('[Net] localForage not available');
};

// ── Online status ─────────────────────────────────────────────────────────────
let _isOnline = navigator.onLine;

window.addEventListener('online',  () => { _isOnline = true;  onComeOnline(); });
window.addEventListener('offline', () => { _isOnline = false; onGoOffline();  });

function isOnline() { return _isOnline; }

function onComeOnline() {
  console.log('[Net] Connection restored');
  showOfflineBanner(false);
  flushQueue();
}

function onGoOffline() {
  console.log('[Net] Went offline');
  showOfflineBanner(true);
}

// Offline banner — injected into the DOM when offline
function showOfflineBanner(show) {
  let banner = document.getElementById('_offlineBanner');
  if (show) {
    if (!banner) {
      banner = document.createElement('div');
      banner.id = '_offlineBanner';
      banner.style.cssText = [
        'position:fixed;top:0;left:0;right:0;z-index:99998',
        'background:#ff8c42;color:#000',
        'font-family:"DM Sans",sans-serif;font-size:12px;font-weight:700',
        'text-align:center;padding:7px 16px',
        'letter-spacing:.5px;',
      ].join(';');
      banner.textContent = '⚠️ Offline — changes will sync when you reconnect';
      document.body.prepend(banner);
    }
  } else {
    banner?.remove();
  }
}

// ── JWT Cache ─────────────────────────────────────────────────────────────────

/**
 * Save a Firebase ID token to IndexedDB after successful login.
 * Called automatically from the auth flow.
 * @param {Object} user  — Firebase user object
 */
async function cacheToken(user) {
  try {
    const token      = await user.getIdToken(false); // don't force refresh
    const tokenResult = await user.getIdTokenResult(false);
    const expiresAt  = new Date(tokenResult.expirationTime).getTime();

    await _lf().setItem(TOKEN_KEY, {
      token,
      expiresAt,
      uid:         user.uid,
      email:       user.email,
      displayName: user.displayName || '',
      cachedAt:    Date.now(),
    });

    // Also cache session metadata (role, brandId) for offline dashboard access
    const sessionMeta = {
      uid:      user.uid,
      email:    user.email,
      brandId:  window.BRAND_ID || '',
      role:     window._currentUserData?.role || 'client',
      userData: window._currentUserData || {},
      savedAt:  Date.now(),
    };
    await _lf().setItem(SESSION_KEY, sessionMeta);
    console.log('[Net] Token cached, expires:', new Date(expiresAt).toLocaleTimeString());
  } catch (e) {
    console.warn('[Net] Failed to cache token:', e.message);
  }
}

/**
 * Check if a valid (non-expired) token exists in IndexedDB.
 * Used to allow dashboard access while offline.
 * @returns {Promise<boolean>}
 */
async function hasValidSession() {
  try {
    const cached = await _lf().getItem(TOKEN_KEY);
    if (!cached) return false;
    const isValid = cached.expiresAt > Date.now() + TOKEN_EXPIRY_BUFFER_MS;
    console.log('[Net] Cached token valid:', isValid,
      '| expires in:', Math.round((cached.expiresAt - Date.now()) / 60000), 'min');
    return isValid;
  } catch (e) {
    console.warn('[Net] Error reading cached token:', e.message);
    return false;
  }
}

/**
 * Get the cached session metadata (uid, role, userData).
 * Used to restore user context when offline.
 * @returns {Promise<Object|null>}
 */
async function getCachedSession() {
  try {
    return await _lf().getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

/**
 * Clear cached token and session on logout.
 */
async function clearSession() {
  await Promise.allSettled([
    _lf().removeItem(TOKEN_KEY),
    _lf().removeItem(SESSION_KEY),
  ]);
  console.log('[Net] Session cache cleared');
}

// ── Network Request Wrapper ───────────────────────────────────────────────────

/**
 * Wrapper around Firestore writes.
 * If online  → execute immediately.
 * If offline → queue in IndexedDB for background sync.
 *
 * @param {string}   operation  — 'setDoc' | 'updateDoc' | 'deleteDoc'
 * @param {Object}   payload    — operation-specific data
 * @param {Object}   [opts]     — { priority: 'high'|'normal', dedupe: string }
 * @returns {Promise<{queued: boolean, executed: boolean}>}
 */
async function request(operation, payload, opts = {}) {
  if (!isOnline()) {
    return await _enqueue(operation, payload, opts);
  }

  try {
    return await _execute(operation, payload);
  } catch (e) {
    // Network error despite navigator.onLine — queue it
    if (_isNetworkError(e)) {
      console.warn('[Net] Network error — queuing:', operation);
      return await _enqueue(operation, payload, opts);
    }
    throw e;
  }
}

/**
 * Direct network execute — does not check online status.
 */
async function _execute(operation, payload) {
  switch (operation) {
    case 'setDoc': {
      const { ref, data, merge } = payload;
      await window._fbSetDoc(ref, data, merge ? { merge: true } : undefined);
      return { queued: false, executed: true };
    }
    case 'updateDoc': {
      // Firebase updateDoc — ref + partial data
      const { ref, data } = payload;
      await window._fbSetDoc(ref, data, { merge: true });
      return { queued: false, executed: true };
    }
    case 'deleteDoc': {
      if (window._fbDeleteDoc) {
        await window._fbDeleteDoc(payload.ref);
      }
      return { queued: false, executed: true };
    }
    default:
      throw new Error(`[Net] Unknown operation: ${operation}`);
  }
}

/**
 * Add a request to the offline queue in IndexedDB.
 */
async function _enqueue(operation, payload, opts = {}) {
  const queue = await _lf().getItem(QUEUE_KEY) || [];

  // Deduplicate — if a key is provided, replace any existing entry with same key
  const { dedupe, priority = 'normal' } = opts;
  const filtered = dedupe
    ? queue.filter(item => item.dedupe !== dedupe)
    : queue;

  // Serialize refs — Firestore DocumentReference objects can't be stored as-is
  const serialized = _serializePayload(operation, payload);

  filtered.push({
    id:        `${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
    operation,
    payload:   serialized,
    dedupe:    dedupe || null,
    priority,
    queuedAt:  new Date().toISOString(),
    attempts:  0,
  });

  // High priority items go to the front
  if (priority === 'high') {
    const high   = filtered.filter(i => i.priority === 'high');
    const normal = filtered.filter(i => i.priority !== 'high');
    await _lf().setItem(QUEUE_KEY, [...high, ...normal]);
  } else {
    await _lf().setItem(QUEUE_KEY, filtered);
  }

  console.log(`[Net] Queued offline: ${operation} (queue length: ${filtered.length})`);

  // Register background sync if supported
  _registerBackgroundSync();

  return { queued: true, executed: false };
}

/**
 * Serialize Firestore DocumentReference path for storage.
 */
function _serializePayload(operation, payload) {
  if (!payload.ref) return payload;
  return {
    ...payload,
    ref: undefined,
    refPath: payload.ref?.path || String(payload.ref),
  };
}

/**
 * Deserialize — re-build ref from path before executing.
 */
function _deserializePayload(operation, payload) {
  if (!payload.refPath || !window._fbDb || !window._fbDoc) return payload;
  const parts = payload.refPath.split('/');
  let ref = window._fbDoc(window._fbDb, ...parts);
  return { ...payload, ref };
}

// ── Queue Flush ───────────────────────────────────────────────────────────────

let _flushing = false;

/**
 * Execute all queued offline requests in order.
 * Called automatically when connection is restored.
 * @returns {Promise<{success: number, failed: number}>}
 */
async function flushQueue() {
  if (_flushing || !isOnline()) return { success: 0, failed: 0 };
  _flushing = true;

  const queue = await _lf().getItem(QUEUE_KEY) || [];
  if (!queue.length) { _flushing = false; return { success: 0, failed: 0 }; }

  console.log(`[Net] Flushing ${queue.length} queued requests`);

  let success = 0;
  let failed  = 0;
  const remaining = [];

  for (const item of queue) {
    try {
      const payload = _deserializePayload(item.operation, item.payload);
      await _execute(item.operation, payload);
      success++;
      console.log(`[Net] Flushed: ${item.operation} (id: ${item.id})`);
    } catch (e) {
      item.attempts++;
      item.lastError = e.message;
      // Keep in queue if < 5 attempts, drop permanently after that
      if (item.attempts < 5) {
        remaining.push(item);
        failed++;
      } else {
        console.warn(`[Net] Dropping after 5 failures: ${item.operation}`, e.message);
      }
    }
  }

  await _lf().setItem(QUEUE_KEY, remaining);
  _flushing = false;

  if (success > 0) {
    console.log(`[Net] Flush complete: ${success} synced, ${failed} failed`);
    if (typeof window.showToast === 'function' && success > 0) {
      window.showToast(`☁ Synced ${success} offline change${success > 1 ? 's' : ''}`);
    }
  }

  return { success, failed };
}

/**
 * Get pending queue length.
 * @returns {Promise<number>}
 */
async function getPendingCount() {
  const queue = await _lf().getItem(QUEUE_KEY) || [];
  return queue.length;
}

/**
 * Clear the entire offline queue (use with caution).
 * @returns {Promise<void>}
 */
async function clearQueue() {
  await _lf().removeItem(QUEUE_KEY);
  console.log('[Net] Offline queue cleared');
}

// ── Background Sync ───────────────────────────────────────────────────────────

const SYNC_TAG = 'barzelpro-sync';

function _registerBackgroundSync() {
  if (!('serviceWorker' in navigator) || !('SyncManager' in window)) return;
  navigator.serviceWorker.ready
    .then(reg => reg.sync.register(SYNC_TAG))
    .catch(e => console.warn('[Net] Background sync registration failed:', e.message));
}

// Listen for sync messages from the service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'BACKGROUND_SYNC') {
      console.log('[Net] Background sync triggered by SW');
      flushQueue();
    }
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _isNetworkError(e) {
  return (
    e instanceof TypeError ||
    e.message?.includes('network') ||
    e.message?.includes('Failed to fetch') ||
    e.message?.includes('offline') ||
    e.code === 'unavailable'
  );
}

// ── Offline-aware syncToFirestore override ────────────────────────────────────
// After Net is loaded, it patches window.syncToFirestore to be offline-aware.

function installOfflineGuard() {
  const originalSync = window.syncToFirestore;
  if (!originalSync) return;

  window.syncToFirestore = function() {
    if (!isOnline()) {
      console.log('[Net] Offline — sync deferred to queue');
      // Queue the bulk sync as a single high-priority item
      _enqueue('setDoc', {
        refPath: `userData/${window.BRAND_ID || 'default'}/users/${window._currentUser?.uid}`,
        data: _collectSyncPayload(),
        merge: false,
      }, { dedupe: 'main-sync', priority: 'high' });
      return;
    }
    return originalSync.apply(this, arguments);
  };
}

function _collectSyncPayload() {
  // Mirror what syncToFirestore sends to Firestore
  return {
    workouts:         (window.workouts         || []).filter(w => !w._draft),
    deletedWorkouts:  (window.deletedWorkouts  || []),
    cardioLog:        (window.cardioLog        || []),
    customExercises:  (window.customExercises  || []),
    plannedWorkouts:  (window.plannedWorkouts  || []),
    customCardioTypes:(window.customCardioTypes|| []),
    settings: {
      workoutWeekTarget: window.workoutWeekTarget,
      cardioWeekTarget:  window.cardioWeekTarget,
      lastTimerSecs:     window.lastTimerSecs,
      miniChartRange:    window.miniChartRange,
    },
    updatedAt: new Date().toISOString(),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────
const Net = {
  // Auth / session
  cacheToken,
  hasValidSession,
  getCachedSession,
  clearSession,

  // Network wrapper
  request,
  isOnline,

  // Queue management
  flushQueue,
  getPendingCount,
  clearQueue,

  // Setup
  installOfflineGuard,
};

export default Net;
window.BarzelpNet = Net; // global access for non-module scripts
