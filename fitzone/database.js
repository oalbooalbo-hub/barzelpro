/**
 * database.js — Offline-first local storage layer for BARZELPRO
 *
 * Uses localForage (IndexedDB > WebSQL > localStorage fallback).
 * Acts as the local source of truth. Firestore is the remote backup.
 *
 * Usage:
 *   import DB from './database.js';
 *   await DB.saveWorkout(data);
 *   const all = await DB.getAllWorkouts();
 *   await DB.syncToServer();
 */

// ── Load localForage from CDN (no bundler needed) ────────────────────────────
// localForage is loaded via <script> tag in index.html before this module runs.
// window.localforage is available globally after that.

const _lf = () => {
  if (typeof window !== 'undefined' && window.localforage) return window.localforage;
  throw new Error('localForage not loaded. Add the CDN script tag before database.js.');
};

// ── Brand-scoped store key prefix ────────────────────────────────────────────
const brandId = () => (window.BRAND_ID || window.BRAND_CONFIG?.id || 'default');
const key = (name) => `barzelpro_${brandId()}_${name}`;

// ── Sync state tracking ───────────────────────────────────────────────────────
let _pendingSync = false;
let _syncTimer = null;

// Debounced sync — waits 3s after last write before hitting Firestore
function _scheduleSync() {
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => syncToServer(), 3000);
}

// ── Core data types ───────────────────────────────────────────────────────────
// Each key maps to an array stored as a single localForage entry.
// This mirrors the existing localStorage _LS pattern but uses IndexedDB.

const KEYS = {
  workouts:         'workouts',
  deletedWorkouts:  'deleted_workouts',
  cardioLog:        'cardio',
  customExercises:  'custom_ex',
  plannedWorkouts:  'planned',
  customCardioTypes:'cardio_custom',
  hiddenEx:         'hidden_ex',
  excludedEx:       'excluded_ex',
  settings:         'settings',
  syncMeta:         'sync_meta',
};

// ── READ ──────────────────────────────────────────────────────────────────────

/**
 * Get all saved workouts (excludes drafts by default).
 * @param {boolean} includeDrafts
 * @returns {Promise<Array>}
 */
async function getAllWorkouts(includeDrafts = false) {
  const all = await _lf().getItem(key(KEYS.workouts)) || [];
  return includeDrafts ? all : all.filter(w => !w._draft);
}

/**
 * Get all cardio log entries.
 * @returns {Promise<Array>}
 */
async function getAllCardio() {
  return await _lf().getItem(key(KEYS.cardioLog)) || [];
}

/**
 * Get all custom exercises.
 * @returns {Promise<Array>}
 */
async function getAllCustomExercises() {
  return await _lf().getItem(key(KEYS.customExercises)) || [];
}

/**
 * Get planned workouts.
 * @returns {Promise<Array>}
 */
async function getAllPlanned() {
  return await _lf().getItem(key(KEYS.plannedWorkouts)) || [];
}

/**
 * Get app settings.
 * @returns {Promise<Object>}
 */
async function getSettings() {
  return await _lf().getItem(key(KEYS.settings)) || {};
}

/**
 * Get sync metadata (last sync time, pending changes).
 * @returns {Promise<Object>}
 */
async function getSyncMeta() {
  return await _lf().getItem(key(KEYS.syncMeta)) || { lastSync: null, pendingChanges: 0 };
}

// ── WRITE ─────────────────────────────────────────────────────────────────────

/**
 * Save a single workout. If workout.id exists, updates it. Otherwise appends.
 * Schedules a Firestore sync automatically.
 * @param {Object} data — workout object with { id, name, date, exercises, ... }
 * @returns {Promise<void>}
 */
async function saveWorkout(data) {
  if (!data || !data.id) throw new Error('saveWorkout: workout must have an id');
  const all = await _lf().getItem(key(KEYS.workouts)) || [];
  const idx = all.findIndex(w => w.id === data.id);
  if (idx >= 0) {
    all[idx] = { ...all[idx], ...data };
  } else {
    all.push(data);
  }
  await _lf().setItem(key(KEYS.workouts), all);
  await _bumpPendingChanges();
  _scheduleSync();
}

/**
 * Save the full workouts array (replaces entire collection).
 * @param {Array} workoutsArray
 * @returns {Promise<void>}
 */
async function saveAllWorkouts(workoutsArray) {
  await _lf().setItem(key(KEYS.workouts), workoutsArray);
  await _bumpPendingChanges();
  _scheduleSync();
}

/**
 * Delete a workout by id (moves to deletedWorkouts).
 * @param {string|number} id
 * @returns {Promise<void>}
 */
async function deleteWorkout(id) {
  const all = await _lf().getItem(key(KEYS.workouts)) || [];
  const workout = all.find(w => w.id === id);
  const filtered = all.filter(w => w.id !== id);
  await _lf().setItem(key(KEYS.workouts), filtered);
  if (workout) {
    const deleted = await _lf().getItem(key(KEYS.deletedWorkouts)) || [];
    deleted.push({ ...workout, _deletedAt: new Date().toISOString() });
    await _lf().setItem(key(KEYS.deletedWorkouts), deleted);
  }
  await _bumpPendingChanges();
  _scheduleSync();
}

/**
 * Save the full cardio log.
 * @param {Array} cardioArray
 * @returns {Promise<void>}
 */
async function saveCardio(cardioArray) {
  await _lf().setItem(key(KEYS.cardioLog), cardioArray);
  await _bumpPendingChanges();
  _scheduleSync();
}

/**
 * Save custom exercises.
 * @param {Array} exercises
 * @returns {Promise<void>}
 */
async function saveCustomExercises(exercises) {
  await _lf().setItem(key(KEYS.customExercises), exercises);
  await _bumpPendingChanges();
  _scheduleSync();
}

/**
 * Save planned workouts.
 * @param {Array} planned
 * @returns {Promise<void>}
 */
async function savePlanned(planned) {
  await _lf().setItem(key(KEYS.plannedWorkouts), planned);
  await _bumpPendingChanges();
  _scheduleSync();
}

/**
 * Save app settings.
 * @param {Object} settings
 * @returns {Promise<void>}
 */
async function saveSettings(settings) {
  const existing = await _lf().getItem(key(KEYS.settings)) || {};
  await _lf().setItem(key(KEYS.settings), { ...existing, ...settings });
  _scheduleSync();
}

// ── SYNC ──────────────────────────────────────────────────────────────────────

/**
 * Push local data to Firestore.
 * Delegates to window.syncToFirestore() which is defined in index.html.
 * No-op if user is not logged in or offline.
 * @returns {Promise<boolean>} true if synced, false if skipped
 */
async function syncToServer() {
  if (_pendingSync) return false;
  if (!window._currentUser || !window._fbDb) return false;
  if (!navigator.onLine) {
    console.log('[DB] Offline — sync deferred');
    return false;
  }

  _pendingSync = true;
  try {
    if (typeof window.syncToFirestore === 'function') {
      window.syncToFirestore();
    }
    await _lf().setItem(key(KEYS.syncMeta), {
      lastSync: new Date().toISOString(),
      pendingChanges: 0,
    });
    return true;
  } catch (e) {
    console.warn('[DB] syncToServer failed:', e.message);
    return false;
  } finally {
    _pendingSync = false;
  }
}

/**
 * Pull data from Firestore and merge into local store.
 * Delegates to window.loadFromFirestore() defined in index.html.
 * @param {string} uid — Firebase user UID
 * @returns {Promise<boolean>}
 */
async function loadFromServer(uid) {
  if (!uid || !window._fbDb) return false;
  if (!navigator.onLine) {
    console.log('[DB] Offline — using local data only');
    return false;
  }
  try {
    if (typeof window.loadFromFirestore === 'function') {
      return await window.loadFromFirestore(uid);
    }
    return false;
  } catch (e) {
    console.warn('[DB] loadFromServer failed:', e.message);
    return false;
  }
}

// ── MIGRATION ─────────────────────────────────────────────────────────────────

/**
 * One-time migration from localStorage (_LS) to localForage (IndexedDB).
 * Called on first load — safe to run multiple times (idempotent).
 * @returns {Promise<boolean>} true if migration was performed
 */
async function migrateFromLocalStorage() {
  const migrated = await _lf().getItem(key('_migrated_v1'));
  if (migrated) return false; // already done

  const brand = brandId();
  const pfx = `ironlog_${brand}_`;

  const migrate = async (lsKey, dbKey) => {
    const raw = localStorage.getItem(pfx + lsKey) || localStorage.getItem('ironlog_' + lsKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      const existing = await _lf().getItem(key(dbKey));
      if (!existing || (Array.isArray(existing) && existing.length === 0)) {
        await _lf().setItem(key(dbKey), parsed);
      }
    } catch (e) { /* skip malformed */ }
  };

  await migrate('workouts',       KEYS.workouts);
  await migrate('deleted_workouts', KEYS.deletedWorkouts);
  await migrate('cardio',         KEYS.cardioLog);
  await migrate('custom_ex',      KEYS.customExercises);
  await migrate('planned',        KEYS.plannedWorkouts);
  await migrate('cardio_custom',  KEYS.customCardioTypes);
  await migrate('hidden_ex',      KEYS.hiddenEx);

  await _lf().setItem(key('_migrated_v1'), true);
  console.log('[DB] Migration from localStorage complete');
  return true;
}

// ── UTILS ─────────────────────────────────────────────────────────────────────

async function _bumpPendingChanges() {
  const meta = await getSyncMeta();
  await _lf().setItem(key(KEYS.syncMeta), {
    ...meta,
    pendingChanges: (meta.pendingChanges || 0) + 1,
  });
}

/**
 * Clear all local data for the current brand (destructive!).
 * @returns {Promise<void>}
 */
async function clearAll() {
  await Promise.all(Object.values(KEYS).map(k => _lf().removeItem(key(k))));
  await _lf().removeItem(key('_migrated_v1'));
  console.log('[DB] All local data cleared for brand:', brandId());
}

/**
 * Get a summary of what's stored locally.
 * @returns {Promise<Object>}
 */
async function getStorageSummary() {
  const [workouts, cardio, exercises, planned, meta] = await Promise.all([
    getAllWorkouts(),
    getAllCardio(),
    getAllCustomExercises(),
    getAllPlanned(),
    getSyncMeta(),
  ]);
  return {
    workouts: workouts.length,
    cardio: cardio.length,
    exercises: exercises.length,
    planned: planned.length,
    lastSync: meta.lastSync,
    pendingChanges: meta.pendingChanges,
    online: navigator.onLine,
  };
}

// ── PUBLIC API ─────────────────────────────────────────────────────────────────
const DB = {
  // Read
  getAllWorkouts,
  getAllCardio,
  getAllCustomExercises,
  getAllPlanned,
  getSettings,
  getSyncMeta,
  getStorageSummary,

  // Write
  saveWorkout,
  saveAllWorkouts,
  deleteWorkout,
  saveCardio,
  saveCustomExercises,
  savePlanned,
  saveSettings,

  // Sync
  syncToServer,
  loadFromServer,

  // Migration & utils
  migrateFromLocalStorage,
  clearAll,
};

export default DB;

// Also expose globally for non-module scripts
window.BarzelpoDB = DB;
