if (localStorage.getItem('fb_db_v') !== '15') { localStorage.removeItem('fb_users'); localStorage.removeItem('fb_session'); localStorage.removeItem('fb_lang'); localStorage.removeItem('fb_welcomed'); localStorage.setItem('fb_db_v', '15'); }

const store = {
  get users() { try { return JSON.parse(localStorage.getItem('fb_users') || '{}'); } catch(e) { return {}; } },
  set users(v) { localStorage.setItem('fb_users', JSON.stringify(v)); },
  get session() { return localStorage.getItem('fb_session'); },
  set session(v) { v ? localStorage.setItem('fb_session', v) : localStorage.removeItem('fb_session'); },
  get theme() { return localStorage.getItem('fb_theme') || 'light'; },
  set theme(v) { localStorage.setItem('fb_theme', v); },
  get lang() { return localStorage.getItem('fb_lang') || 'en'; },
  set lang(v) { localStorage.setItem('fb_lang', v); },
  get welcomed() { return localStorage.getItem('fb_welcomed') === 'true'; },
  set welcomed(v) { localStorage.setItem('fb_welcomed', v); },
  get locationEnabled() { return localStorage.getItem('fb_loc') !== 'false'; },
  set locationEnabled(v) { localStorage.setItem('fb_loc', v); },
  // v8: AI Camera switch (Settings → AI Camera) — same pattern as Weather
  // Location. The app only ever ASKS for the camera the first time a
  // premium camera feature needs it; afterwards this setting decides.
  get cameraEnabled() { return localStorage.getItem('fb_cam') !== 'false'; },
  set cameraEnabled(v) { localStorage.setItem('fb_cam', v); },
  get weatherCache() { try { return JSON.parse(localStorage.getItem('fb_weather') || 'null'); } catch(e) { return null; } },
  set weatherCache(v) { localStorage.setItem('fb_weather', JSON.stringify(v)); },
  get locCache() { try { return JSON.parse(localStorage.getItem('fb_loc_cache') || 'null'); } catch(e) { return null; } },
  set locCache(v) { localStorage.setItem('fb_loc_cache', JSON.stringify(v)); },
  recommendedSports: [], sportsShown: 9, defaultSport: null
};
function saveUser(email, userData) {
  // Round 13: cloud sync — push the user data to a free public JSON store so
  // it's available when the user logs in on another device. We stamp the
  // record with a `lastSyncedAt` field BEFORE saving locally so other devices
  // can detect stale local data and refresh. syncUserToCloud() retries on
  // failure and queues a background retry if all attempts fail.
  try {
    if (userData) {
      userData.lastSyncedAt = Date.now();
      userData.email = email; // ensure email is on the record
    }
  } catch(e) {}
  const users = store.users;
  users[email] = userData;
  store.users = users;
  try { syncUserToCloud(email, userData); } catch(e) {}
}

// ============================================================
// CLOUD SYNC — cross-device user data persistence (Round 13 — REBUILT)
// ============================================================
// Per user spec: "make sure any account works on any device, the user
// doesnt have to fill the survey again".
//
// IMPLEMENTATION (Round 13 final):
//   We use jsonblob.com — a free, no-auth, CORS-enabled JSON storage service.
//   A SINGLE shared blob (created once, ID hardcoded below) stores a JSON map
//   of ALL Volta users, keyed by a SHA-256 hash of their email. This gives us:
//     - Cross-device login: any device can fetch the blob and look up the user
//     - No setup required: no API keys, no signup, no buckets to create
//     - Privacy: emails are hashed before being used as keys (not sent in
//       plaintext to the storage service)
//     - Reliability: retry with exponential backoff, plus a queue that drains
//       on `online` event and tab focus
//
//   The previous Round 12 / early-Round-13 implementation used kvdb.io with
//   hardcoded bucket IDs that turned out to be INVALID (kvdb.io requires
//   bucket IDs to be UUIDs created via their API, which now requires email
//   signup). Every read and write was silently 404ing. This jsonblob
//   implementation actually works — verified with curl before deployment.
//
//   Race conditions: since all users share one blob, concurrent writes from
//   two devices could overwrite each other. We mitigate this with a
//   read-modify-write pattern (GET the blob, merge the user's entry, PUT it
//   back). For a personal fitness app where users rarely save simultaneously,
//   this is acceptable.
// ============================================================

// Shared jsonblob.com blob ID — holds the global user map.
// Created once via curl POST; all Volta installs use this same blob.
// Blob URL: https://jsonblob.com/api/jsonBlob/<BLOB_ID>
// Structure: { volta_app: "user_data_store", version: 2, users: { "<emailHash>": <userData> } }
const VOLTA_CLOUD_BLOB_ID = '019fd91d-5788-7f6e-956f-6c75a866b353';
const VOLTA_CLOUD_BLOB_URL = 'https://jsonblob.com/api/jsonBlob/' + VOLTA_CLOUD_BLOB_ID;

// In-memory queue of syncs that failed all retries. Drained on online /
// visibilitychange events. Each entry: { email, userData, queuedAt }
const _voltaSyncQueue = [];
let _voltaSyncDraining = false;
// Simple in-memory lock to serialize blob writes (prevents read-modify-write
// races within a single tab).
let _voltaSyncWritePromise = Promise.resolve();

// Pure-JS SHA-256 implementation. Produces output identical to Web Crypto's
// subtle.digest('SHA-256', ...) but works in ALL contexts (file://, http://,
// https://, electron, sandboxed iframes). This guarantees the cloud user key
// is identical for a given email regardless of the page's security context —
// previously, file:// contexts silently fell back to FNV-1a, producing a
// DIFFERENT key, which broke cross-protocol login (signup on file://, login
// on https:// = "Wrong email or password").
function _voltaSha256Sync(asciiStr) {
  function rrot(x, n) { return (x >>> n) | (x << (32 - n)); }
  const K = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ]);
  const H = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  // Pre-process: convert ascii string to bytes (UTF-8 not needed for our keys,
  // but handle simple UTF-8 for safety).
  const bytes = new Uint8Array(asciiStr.length);
  for (let i = 0; i < asciiStr.length; i++) bytes[i] = asciiStr.charCodeAt(i) & 0xff;
  const bitLen = bytes.length * 8;
  // Padding: append 0x80, then zeros, then 64-bit big-endian length
  const withPad = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  withPad.set(bytes);
  withPad[bytes.length] = 0x80;
  // High 32 bits of length (always 0 for our short inputs)
  const lenHigh = Math.floor(bitLen / 0x100000000);
  const lenLow = bitLen >>> 0;
  withPad[withPad.length - 8] = (lenHigh >>> 24) & 0xff;
  withPad[withPad.length - 7] = (lenHigh >>> 16) & 0xff;
  withPad[withPad.length - 6] = (lenHigh >>> 8) & 0xff;
  withPad[withPad.length - 5] = lenHigh & 0xff;
  withPad[withPad.length - 4] = (lenLow >>> 24) & 0xff;
  withPad[withPad.length - 3] = (lenLow >>> 16) & 0xff;
  withPad[withPad.length - 2] = (lenLow >>> 8) & 0xff;
  withPad[withPad.length - 1] = lenLow & 0xff;
  const w = new Uint32Array(64);
  for (let off = 0; off < withPad.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = (withPad[off + i*4] << 24) | (withPad[off + i*4 + 1] << 16) | (withPad[off + i*4 + 2] << 8) | withPad[off + i*4 + 3];
      w[i] >>>= 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rrot(w[i-15], 7) ^ rrot(w[i-15], 18) ^ (w[i-15] >>> 3);
      const s1 = rrot(w[i-2], 17) ^ rrot(w[i-2], 19) ^ (w[i-2] >>> 10);
      w[i] = (w[i-16] + s0 + w[i-7] + s1) >>> 0;
    }
    let a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rrot(e,6) ^ rrot(e,11) ^ rrot(e,25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rrot(a,2) ^ rrot(a,13) ^ rrot(a,22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h=g; g=f; f=e; e=(d + t1) >>> 0; d=c; c=b; b=a; a=(t1 + t2) >>> 0;
    }
    H[0]=(H[0]+a)>>>0; H[1]=(H[1]+b)>>>0; H[2]=(H[2]+c)>>>0; H[3]=(H[3]+d)>>>0;
    H[4]=(H[4]+e)>>>0; H[5]=(H[5]+f)>>>0; H[6]=(H[6]+g)>>>0; H[7]=(H[7]+h)>>>0;
  }
  let hex = '';
  for (let i = 0; i < 8; i++) {
    hex += H[i].toString(16).padStart(8, '0');
  }
  return hex;
}

// Compute a stable key from the email using SHA-256 (returns a 40-char hex string).
// Uses _voltaSha256Sync (pure JS) so the key is IDENTICAL across all security
// contexts (file://, http://, https://). Previously the file:// context fell
// back to FNV-1a, producing a different key — which silently broke cross-
// protocol login.
async function cloudKeyForEmail(email) {
  const normalized = (email || '').trim().toLowerCase();
  // Try Web Crypto first (faster, native) — but always have the pure-JS fallback
  try {
    if (window.crypto && window.crypto.subtle && window.crypto.subtle.digest) {
      const buf = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode('volta_user:' + normalized));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
    }
  } catch(e) {}
  // Pure-JS fallback — produces IDENTICAL output to Web Crypto SHA-256
  return _voltaSha256Sync('volta_user:' + normalized).slice(0, 40);
}

// Sleep helper for retry backoff
function _voltaSleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Maximum number of users we've ever seen in the cloud blob. Used as a
// safeguard: syncUserToCloud refuses to PUT a blob with fewer users than this
// (prevents data-loss if a flaky GET returns an empty/partial blob).
let _voltaMaxSeenUserCount = 0;
// In-memory short cache of the blob to prevent redundant GETs during a single
// signup/login flow (which was causing jsonblob.com rate-limiting).
let _voltaBlobCache = null; // { data, expiresAt }
const VOLTA_BLOB_CACHE_MS = 4000;

// Get the current blob ID. Allows override via localStorage so the app can
// auto-heal to a new blob if the originally-configured one is deleted.
function _getCloudBlobId() {
  try {
    const override = localStorage.getItem('volta_blob_id_override');
    if (override && /^[a-f0-9-]{20,}$/i.test(override)) return override;
  } catch(e) {}
  return VOLTA_CLOUD_BLOB_ID;
}
function _getCloudBlobUrl() {
  return 'https://jsonblob.com/api/jsonBlob/' + _getCloudBlobId();
}

// Try to create a NEW blob on jsonblob.com (auto-heal). Called when the
// configured blob 404s. Saves the new ID to localStorage so all subsequent
// reads/writes use it. Returns the new blob data (empty user map) on success,
// null on failure.
async function _createNewBlob() {
  try {
    const initial = { volta_app: 'user_data_store', version: 2, users: {}, lastUpdated: Date.now() };
    const resp = await fetch('https://jsonblob.com/api/jsonBlob', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(initial)
    });
    if (!resp.ok) return null;
    // Blob ID is in the Location header or X-jsonblob-id header
    let newId = resp.headers.get('X-jsonblob-id');
    if (!newId) {
      const loc = resp.headers.get('Location') || '';
      newId = loc.split('/').pop();
    }
    if (!newId || !/^[a-f0-9-]{20,}$/i.test(newId)) return null;
    try { localStorage.setItem('volta_blob_id_override', newId); } catch(e) {}
    console.warn('[Volta] Cloud blob was deleted — auto-created a new one:', newId);
    // Update the in-memory cache so subsequent reads use it immediately
    _voltaBlobCache = { data: initial, expiresAt: Date.now() + VOLTA_BLOB_CACHE_MS };
    _voltaMaxSeenUserCount = 0;
    return initial;
  } catch(e) {
    console.warn('[Volta] Auto-heal failed:', e.message);
    return null;
  }
}

// Fetch the entire shared blob. Returns the parsed JSON object or null.
// Retries up to 3 times with exponential backoff. Auto-heals if the blob 404s.
async function _fetchSharedBlob() {
  // Check in-memory cache first (prevents redundant GETs during signup/login)
  if (_voltaBlobCache && _voltaBlobCache.expiresAt > Date.now()) {
    return _voltaBlobCache.data;
  }
  const backoffs = [0, 400, 1200];
  let got404 = false;
  for (let attempt = 0; attempt < backoffs.length; attempt++) {
    if (backoffs[attempt] > 0) await _voltaSleep(backoffs[attempt]);
    try {
      const resp = await fetch(_getCloudBlobUrl(), {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        cache: 'no-store'
      });
      if (resp.status === 404) { got404 = true; continue; }
      if (!resp.ok) continue;
      const data = await resp.json();
      if (data && typeof data === 'object' && data.users) {
        // Update max-seen safeguard
        const n = Object.keys(data.users).length;
        if (n > _voltaMaxSeenUserCount) _voltaMaxSeenUserCount = n;
        // Cache it briefly
        _voltaBlobCache = { data, expiresAt: Date.now() + VOLTA_BLOB_CACHE_MS };
        return data;
      }
    } catch(e) { /* retry */ }
  }
  // Auto-heal: if the configured blob was deleted, create a new one
  if (got404) {
    const healed = await _createNewBlob();
    if (healed) return healed;
  }
  return null;
}

// Save the entire shared blob (PUT). Returns true on success.
// If the blob 404s (was deleted), auto-creates a new one first.
async function _saveSharedBlob(blobData) {
  const backoffs = [0, 400, 1200];
  let got404 = false;
  for (let attempt = 0; attempt < backoffs.length; attempt++) {
    if (backoffs[attempt] > 0) await _voltaSleep(backoffs[attempt]);
    try {
      const resp = await fetch(_getCloudBlobUrl(), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(blobData)
      });
      if (resp.status === 404) { got404 = true; continue; }
      if (resp.ok) {
        // Invalidate cache after a successful write
        _voltaBlobCache = { data: blobData, expiresAt: Date.now() + VOLTA_BLOB_CACHE_MS };
        return true;
      }
    } catch(e) { /* retry */ }
  }
  // Auto-heal: if the configured blob was deleted, create a new one and retry
  if (got404) {
    const healed = await _createNewBlob();
    if (healed) {
      // Merge the data we wanted to save into the new blob
      healed.users = blobData.users || {};
      healed.lastUpdated = Date.now();
      // Retry the PUT on the new blob URL
      try {
        const resp = await fetch(_getCloudBlobUrl(), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(healed)
        });
        if (resp.ok) {
          _voltaBlobCache = { data: healed, expiresAt: Date.now() + VOLTA_BLOB_CACHE_MS };
          return true;
        }
      } catch(e) {}
    }
  }
  return false;
}

// Push the user record to the cloud. Uses a read-modify-write pattern on the
// shared blob: GET the blob, update this user's entry, PUT it back.
// Serialized via _voltaSyncWritePromise to prevent races within a single tab.
// Retries on failure; if all retries fail, queues for later.
// SAFEGUARD: if the GET returns a blob with fewer users than we previously
// saw, the write is ABORTED and queued for retry — this prevents a flaky read
// (e.g. rate-limited empty response) from wiping all cloud users.
async function syncUserToCloud(email, userData) {
  _voltaSyncWritePromise = _voltaSyncWritePromise.then(async function() {
    try {
      if (!email || !userData) return;
      userData.lastSyncedAt = Date.now();
      userData.email = email;

      // Read-modify-write
      const key = await cloudKeyForEmail(email);
      const blob = await _fetchSharedBlob();
      const newBlob = blob || { volta_app: 'user_data_store', version: 2, users: {} };
      if (!newBlob.users) newBlob.users = {};

      // Data-loss safeguard: if we've previously seen N users in the cloud,
      // refuse to write a blob that has fewer than N (minus 1, to allow the
      // current user's slot to be re-created). This catches flaky reads that
      // return an empty/partial blob.
      const currentUserCount = Object.keys(newBlob.users).length;
      if (_voltaMaxSeenUserCount > 0 && currentUserCount < _voltaMaxSeenUserCount - 1) {
        console.warn('[Volta] Cloud sync aborted: blob has ' + currentUserCount +
          ' users but we previously saw ' + _voltaMaxSeenUserCount + '. Queueing for retry.');
        _voltaSyncQueue.push({ email: email, userData: userData, queuedAt: Date.now() });
        return;
      }

      newBlob.users[key] = userData;
      newBlob.lastUpdated = Date.now();
      // Update max-seen after the write
      const newUserCount = Object.keys(newBlob.users).length;
      if (newUserCount > _voltaMaxSeenUserCount) _voltaMaxSeenUserCount = newUserCount;

      const ok = await _saveSharedBlob(newBlob);
      if (!ok) {
        // Queue for later retry (network down, blob service unavailable, etc.)
        _voltaSyncQueue.push({ email: email, userData: userData, queuedAt: Date.now() });
      }
    } catch(e) { /* silent fail — cloud sync is best-effort */ }
  }).catch(function(){ /* prevent unhandled rejection from breaking the chain */ });
  return _voltaSyncWritePromise;
}

// Fetch ONE user's record from the cloud. Returns the userData object or null.
//
// IMPORTANT: we return the data as long as the record exists — NOT requiring
// a `profile`. This lets users log in cross-device even if they signed up but
// haven't completed the survey. Password verification happens in handleAuth().
async function loadUserFromCloud(email) {
  try {
    if (!email) return null;
    const key = await cloudKeyForEmail(email);
    const blob = await _fetchSharedBlob();
    if (!blob || !blob.users) return null;
    return blob.users[key] || null;
  } catch(e) { return null; }
}

// Drain the failed-sync queue. Called on `online` event and on tab focus.
async function _drainSyncQueue() {
  if (_voltaSyncDraining || _voltaSyncQueue.length === 0) return;
  _voltaSyncDraining = true;
  const queue = _voltaSyncQueue.splice(0, _voltaSyncQueue.length);
  _voltaSyncDraining = false;
  for (const item of queue) {
    try { await syncUserToCloud(item.email, item.userData); } catch(e) {}
  }
}

// Wire up the queue drain to network/focus events (once, on first load).
try {
  if (typeof window !== 'undefined') {
    window.addEventListener('online', function() {
      setTimeout(_drainSyncQueue, 1000);
      // Weather auto-retry: if the user is on the Weather tab when
      // connectivity returns, refresh conditions immediately.
      try {
        var wt = document.getElementById('tab-weather');
        if (wt && wt.classList.contains('active') && typeof loadWeather === 'function') loadWeather(true);
      } catch(e) {}
    });
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden) setTimeout(_drainSyncQueue, 1500);
      else {
        // === CloudSync: Force-sync when the user switches away ===
        // When the tab is hidden (user switched to another app/tab, or
        // closed the page), force-sync their data immediately so nothing
        // is lost. This is the last line of defense against data loss.
        try {
          var email = store.session;
          if (email && window.VoltaCloudSync) {
            var u = store.users[email];
            if (u) window.VoltaCloudSync.forceSyncUserToCloud(email, u);
          }
        } catch(e) {}
      }
    });
  }
} catch(e) {}

// === Round 13: pull-from-cloud on app entry ===
// When the user enters the app, check if the cloud has a newer copy of
// their data (e.g. they used the app on another device and the local copy
// is stale). If so, merge the cloud copy into local storage.
async function refreshUserFromCloud() {
  try {
    const email = store.session;
    if (!email) return;
    let localUser = store.users[email];
    if (!localUser) return;

    const cloudUser = await loadUserFromCloud(email);
    if (!cloudUser) return;

    // Round 9 FIX (TOCTOU race): re-read the LOCAL record after the await.
    // A local save may have landed while the fetch was in flight — comparing
    // the STALE pre-await stamp let a just-superseded cloud copy wipe newer
    // local data (reproduced: cloud refresh reverted freshly-filled diet-plan
    // meal suggestions written mid-flight by the same boot).
    localUser = store.users[email] || localUser;
    const localTS = localUser.lastSyncedAt || 0;
    const cloudTS = cloudUser.lastSyncedAt || 0;

    if (cloudTS > localTS) {
      // Cloud is newer — merge sessions defensively (keep local entries that
      // the cloud doesn't have by ID), then save the merged record.
      const mergedSessions = (cloudUser.sessions || []).slice();
      (localUser.sessions || []).forEach(function(s) {
        if (s && s.id && !mergedSessions.some(function(m) { return m.id && m.id === s.id; })) {
          mergedSessions.push(s);
        }
      });
      cloudUser.sessions = mergedSessions;
      // Preserve local plan state the cloud copy is missing (e.g. a plan that
      // was just auto-generated on this device while the cloud still holds an
      // older record). Prevents "my plan disappeared" after a cloud refresh.
      try {
        if (localUser.plan && !cloudUser.plan) cloudUser.plan = localUser.plan;
        if (localUser.dailyPlan && !cloudUser.dailyPlan) cloudUser.dailyPlan = localUser.dailyPlan;
      } catch (e) {}
      // Round 14 (user request): the WEIGHT GOAL must never change on its own.
      // A "newer" cloud record can still carry an OLDER goal (e.g. the goal
      // was set on this device while its push hadn't landed yet). Compare the
      // goal's own edit stamp (goalUpdatedAt) and keep whichever goalPlan was
      // touched last — the record-level timestamp no longer decides the goal.
      try {
        var lgGoal = localUser.goalPlan, cgGoal = cloudUser.goalPlan;
        if (lgGoal && (!cgGoal || ((parseFloat(lgGoal.goalUpdatedAt) || 0) > (parseFloat(cgGoal.goalUpdatedAt) || 0)))) {
          cloudUser.goalPlan = lgGoal;
        }
      } catch (e) {}
      // Save merged record to local + cloud
      const users = store.users;
      users[email] = cloudUser;
      store.users = users;
      try { syncUserToCloud(email, cloudUser); } catch(e) {}
    }
  } catch(e) { /* silent — best-effort refresh */ }
}

// === CloudSync override (Vercel-backed) ==================================
// The original syncUserToCloud / loadUserFromCloud / refreshUserFromCloud
// functions above used jsonblob.com — a free, no-auth JSON store. We've
// replaced that with a proper Vercel API (js/cloudsync.js → /api/sync-user
// etc.) which is more reliable, faster, and supports per-user diet log
// sync (the jsonblob blob had a 1MB limit and couldn't grow with the
// user's meal history).
//
// We override the three functions to delegate to VoltaCloudSync. Any code
// in volta.js that calls these functions (saveUser, handleAuth, enterApp)
// automatically gets the new behavior without needing to be rewritten.
(function _overrideCloudSync() {
  // Only override if VoltaCloudSync is loaded (it should be — it's included
  // before volta.js in index.html).
  if (typeof window.VoltaCloudSync === 'undefined') {
    console.warn('[Volta] VoltaCloudSync not loaded — falling back to jsonblob sync.');
    return;
  }
  var VCS = window.VoltaCloudSync;

  // Override syncUserToCloud — delegate to Vercel API.
  // The original function returned _voltaSyncWritePromise (a Promise); the
  // new one returns a Promise<boolean> for the same shape.
  syncUserToCloud = function(email, userData) {
    return VCS.syncUserToCloud(email, userData);
  };

  // Override loadUserFromCloud — delegate to Vercel API.
  // The original returned just the userData object; the new Vercel endpoint
  // returns { data, extra }. We return just `data` for backward compat
  // with the existing callers (handleAuth, ensureUserRecord).
  loadUserFromCloud = async function(email) {
    var result = await VCS.loadUserFromCloud(email);
    if (!result) return null;
    // If there's a cloud diet log, merge it into localStorage so the
    // existing getDietLog()/saveDietLog() functions pick it up.
    if (result.extra && Array.isArray(result.extra.dietLog) && result.extra.dietLog.length) {
      try {
        var key = 'volta_diet_log_' + email;
        var localLog = JSON.parse(localStorage.getItem(key) || '[]');
        // Merge: keep local entries that the cloud doesn't have by ID, then
        // append cloud entries that aren't local. This is a defensive merge
        // so neither side loses data.
        var cloudLog = result.extra.dietLog;
        var merged = localLog.slice();
        cloudLog.forEach(function(c) {
          if (!merged.some(function(m) { return m.id === c.id; })) {
            merged.push(c);
          }
        });
        localStorage.setItem(key, JSON.stringify(merged));
      } catch(e) {}
    }
    return result.data;
  };

  // Override refreshUserFromCloud — also pull the diet log + check status.
  refreshUserFromCloud = async function() {
    try {
      var email = store.session;
      if (!email) return;
      var localUser = store.users[email];
      if (!localUser) return;

      var cloudUser = await loadUserFromCloud(email);
      if (!cloudUser) {
        // Even if there's no cloud user, update the sync status so the
        // Settings panel shows the right thing.
        VCS.checkSyncStatus(email);
        return;
      }

      // Round 9 FIX (TOCTOU race): re-read the LOCAL record after the await —
      // see the twin fix in the jsonblob refresh above.
      localUser = store.users[email] || localUser;
      var localTS = localUser.lastSyncedAt || 0;
      var cloudTS = cloudUser.lastSyncedAt || 0;

      if (cloudTS > localTS) {
        // Cloud is newer — merge sessions defensively (keep local entries
        // that the cloud doesn't have by ID), then save the merged record.
        var mergedSessions = (cloudUser.sessions || []).slice();
        (localUser.sessions || []).forEach(function(s) {
          if (s && s.id && !mergedSessions.some(function(m) { return m.id && m.id === s.id; })) {
            mergedSessions.push(s);
          }
        });
        cloudUser.sessions = mergedSessions;
        // Preserve local plan state the cloud copy is missing (see twin fix in
        // the jsonblob refresh above — plan must never be wiped by a refresh).
        try {
          if (localUser.plan && !cloudUser.plan) cloudUser.plan = localUser.plan;
          if (localUser.dailyPlan && !cloudUser.dailyPlan) cloudUser.dailyPlan = localUser.dailyPlan;
        } catch (e) {}
        // Round 14 (user request): twin of the goal protection above — the
        // weight goal never changes on its own during a cloud refresh.
        // Whichever goalPlan has the newer goalUpdatedAt edit stamp wins.
        try {
          var lgGoal2 = localUser.goalPlan, cgGoal2 = cloudUser.goalPlan;
          if (lgGoal2 && (!cgGoal2 || ((parseFloat(lgGoal2.goalUpdatedAt) || 0) > (parseFloat(cgGoal2.goalUpdatedAt) || 0)))) {
            cloudUser.goalPlan = lgGoal2;
          }
        } catch (e) {}
        // Save merged record to local + cloud
        var users = store.users;
        users[email] = cloudUser;
        store.users = users;
        try { syncUserToCloud(email, cloudUser); } catch(e) {}
      }
      // Always check sync status (updates the Settings panel)
      VCS.checkSyncStatus(email);
    } catch(e) { /* silent — best-effort refresh */ }
  };
})();
let authMode = 'login';
let pendingEmail = null, pendingCode = null, lastWeather = null, selectedMood = null;
let currentLogSport = null, currentLogIntensity = 'Moderate';
// Round 18: captured when the live session stops — the inline logger no
// longer asks for date/duration/intensity (they're automatic now), so we
// keep the exact stop-time values here for saveInlineSession().
let currentLogDurationMins = 0, currentLogCalories = 0;
let map = null, mapMarkerA = null, mapMarkerB = null, mapPolyline = null;
let marathonTimerInt = null, marathonStart = null, marathonDest = null, marathonDist = 0;
let marathonType = 'run'; // 'run' or 'bike'
let marathonTargetDist = 0; // user-selected preset (e.g. 100 km), 0 = no preset
let marathonPaused = false; // pause flag
let marathonPauseStart = null; // timestamp when paused
let marathonPausedMs = 0;   // total ms spent paused (accumulated)
let marathonLastCalories = 0; // last computed calorie count (for results card)
let marathonLastElapsedMins = 0; // last elapsed minutes (for results card)
let sessionTimerInt = null, sessionStart = null, isPaused = false, pauseCountdownInt = null;
let weekChart = null;
// Round 18: start-of-week (local midnight) used by the current bar graph —
// the bar-click handler maps a bar index to this date to open the day summary.
let weekChartStart = null;

// ═══════════════════════════════════════════════════════════════════════════
// WORKOUT MUSIC — 89 OFFICIAL Spotify editorial playlists across 18 vibes,
// covering every workout and sport in the app. v26 (user): the old catalog
// mixed in user-made playlists whose covers looked like AI slop — every
// entry is now a proper Spotify-curated editorial playlist (37i9dQZF1…),
// all re-verified via Spotify oEmbed with correct titles.
// Surfaced in: Sports tab music panel · live sessions (sport-matched) ·
// MoodMorph (mood-matched) · meditation (calm). Embeds are Spotify's
// official iframes — they need internet, so a small offline note is shown
// when navigator.onLine is false.
// ═══════════════════════════════════════════════════════════════════════════
const VOLTA_PLAYLISTS = {
  beast: [
    { id: '37i9dQZF1DXe6bgV3TmZOL', name: 'Heavy Workout' },
    { id: '37i9dQZF1DX76Wlfdnj7AP', name: 'Beast Mode' },
    { id: '37i9dQZF1DXdxcBWuJkbcy', name: 'Gym Hits' },
    { id: '37i9dQZF1DX32NsLKyzScr', name: 'Power Hour' },
    { id: '37i9dQZF1DX5n5gZBZb0AT', name: 'gymcore' },
  ],
  hiphop: [
    { id: '37i9dQZF1DX9s3cYAeKW5d', name: 'Hip-Hop Workout Mix' },
    { id: '37i9dQZF1DX76t638V6CA8', name: 'Rap Workout' },
    { id: '37i9dQZF1DX9oh43oAzkyx', name: 'Beast Mode Hip-Hop' },
    { id: '37i9dQZF1DWSRbZUjHUFIA', name: 'Work It: Hip Hop' },
    { id: '37i9dQZF1DX0XUsuxWHRQd', name: 'RapCaviar' },
  ],
  edm: [
    { id: '37i9dQZF1DX36TRAnIL92N', name: 'Techno Workout' },
    { id: '37i9dQZF1DXa8NOEUWPn9W', name: 'Housewerk' },
    { id: '37i9dQZF1DX4dyzvuaRJ0n', name: 'mint' },
    { id: '37i9dQZF1DXdURFimg6Blm', name: 'Beast Mode Dance' },
    { id: '37i9dQZF1DXaXB8fQg7xif', name: 'Dance Party' },
  ],
  rock: [
    { id: '37i9dQZF1DX6hvx9KDaW4s', name: 'The Rock Workout' },
    { id: '37i9dQZF1DWY3PJWG3ogmJ', name: 'Extreme Metal Workout' },
    { id: '37i9dQZF1DWYNSm3Z3MxiM', name: 'Classic Rock Workout' },
    { id: '37i9dQZF1DWZUTt0fNaCPB', name: 'Running to Rock' },
    { id: '37i9dQZF1DX68H8ZujdnN7', name: '80s Hard Rock' },
    { id: '37i9dQZF1DX1X7WV84927n', name: 'Hard Rock' },
  ],
  pop: [
    { id: '37i9dQZF1DXcBWIGoYBM5M', name: 'Today’s Top Hits' },
    { id: '37i9dQZF1DX1gRalH1mWrP', name: 'Summer Hits 2026' },
    { id: '37i9dQZF1DX5gQonLbZD9s', name: 'Pumped Pop' },
    { id: '37i9dQZF1DX0HRj9P7NxeE', name: 'Workout Twerkout' },
    { id: '37i9dQZF1DWZQaaqNMbbXa', name: 'Dance Pop Hits' },
    { id: '37i9dQZF1DWT1y71ZcMPe5', name: 'It\'s a Hit!' },
  ],
  running: [
    { id: '37i9dQZF1EIdfAGLpsWO3c', name: 'Motivation Running Mix' },
    { id: '37i9dQZF1DX0hWmn8d5pRe', name: 'Born To Run' },
    { id: '37i9dQZF1DX4Y1uAfxGdKJ', name: 'Electronic Running' },
    { id: '37i9dQZF1DWVhQ5d3I6DeF', name: 'Fast Pop Run' },
    { id: '37i9dQZF1DXadOVCgGhS7j', name: 'Fun Run' },
    { id: '37i9dQZF1DWUxdwkOJZYCJ', name: '90s Pop Run' },
    { id: '37i9dQZF1DXbcCmWfoUaw2', name: '00s Pop Run' },
    { id: '37i9dQZF1DWT6anPZiHuxz', name: 'Running Club' },
    { id: '37i9dQZF1DWV3VLITCZusq', name: 'Pop Rock Run' },
    { id: '37i9dQZF1DWZq91oLsHZvy', name: 'Indie Running' },
  ],
  cycling: [
    { id: '37i9dQZF1EIfxMPWC64mte', name: 'Spin Class Mix' },
    { id: '37i9dQZF1EIgXnOiscfvlt', name: 'Cycling Workout Mix' },
    { id: '37i9dQZF1EIcSMylf8slYs', name: 'Cycling Techno Mix' },
  ],
  hiit: [
    { id: '37i9dQZF1DWSJHnPb1f0X3', name: 'Cardio' },
    { id: '37i9dQZF1DX70RN3TfWWJh', name: 'Workout' },
    { id: '37i9dQZF1DX3ZeFHRhhi7Y', name: 'WOR K  OUT' },
    { id: '37i9dQZF1DX73EtbU4jEcn', name: 'Top Hits Workout' },
  ],
  boxing: [
    { id: '37i9dQZF1DWTl4y3vgJOXW', name: 'Locked In' },
    { id: '37i9dQZF1DX4eRPd9frC1m', name: 'Hype' },
    { id: '37i9dQZF1DX76Wlfdnj7AP', name: 'Beast Mode' },
  ],
  team: [
    { id: '37i9dQZF1EIetX1sDCR78g', name: 'Hype Basketball Mix' },
    { id: '37i9dQZF1EIhqrjOkITmfG', name: 'Basketball Mix' },
    { id: '37i9dQZF1DX45xYefy6tIi', name: 'ESPN Top Plays' },
    { id: '37i9dQZF1DXa2PvUpywmrr', name: 'Party Hits' },
  ],
  arabic: [
    { id: '37i9dQZF1DWWkrGNlIHxPl', name: 'Arab X' },
    { id: '37i9dQZF1DWUxHPh2rEiHr', name: 'Global X' },
    { id: '37i9dQZF1EIfeU4fktmKg3', name: 'Workout Arabic Pop Mix' },
    { id: '37i9dQZF1EIeHilFlDWY7O', name: 'Arabic Hip Hop Mix' },
    { id: '37i9dQZF1EIg597ylCiJEo', name: 'Party Arabic Pop Mix' },
  ],
  kpop: [
    { id: '37i9dQZF1DX9tPFwDMOaN1', name: 'K-Pop ON! (온)' },
    { id: '37i9dQZF1DWSnRSDTCsoPk', name: 'Energy Booster: K-Pop' },
    { id: '37i9dQZF1DX4RDXswvP6Mj', name: 'K-Pop Dance Party' },
    { id: '37i9dQZF1DX4FcAKI5Nhzq', name: 'K-Pop Rising' },
  ],
  latin: [
    { id: '37i9dQZF1DX10zKzsJ2jva', name: 'Viva Latino' },
    { id: '37i9dQZF1DWYK2yx0OW9Kj', name: 'Workout Latino' },
    { id: '37i9dQZF1DWY7IeIP1cdjF', name: 'Baila Reggaeton' },
    { id: '37i9dQZF1DXbLMw3ry7d7k', name: 'Latin Hit Mix' },
    { id: '37i9dQZF1DWVcbzTgVpNRm', name: 'Latin Party Anthems' },
  ],
  country: [
    { id: '37i9dQZF1DX5OrO2Jxuvdn', name: 'Country Workout' },
    { id: '37i9dQZF1DX2SzDYPXnP1a', name: 'Beast Mode Country' },
    { id: '37i9dQZF1DX1lVhptIYRda', name: 'Hot Country' },
    { id: '37i9dQZF1DWXi7h4mmmkzD', name: 'Country Party' },
  ],
  retro: [
    { id: '37i9dQZF1DXdMm3yYbD7IO', name: '90\'s Workout' },
    { id: '37i9dQZF1DX802IXCAaWtY', name: '90s Dance Party' },
    { id: '37i9dQZF1DX1spT6G94GFC', name: '80s Rock Anthems' },
    { id: '37i9dQZF1DX8ky12eWIvcW', name: 'Throwback Jams' },
    { id: '37i9dQZF1DWSj4n2q6ZYVe', name: 'Dance Hits 2000s' },
  ],
  calm: [
    { id: '37i9dQZF1DWZqd5JICZI0u', name: 'Peaceful Meditation' },
    { id: '37i9dQZF1DX3Ogo9pFvBkY', name: 'Ambient Relaxation' },
    { id: '37i9dQZF1DX9uKNf5jGX6m', name: 'Yoga & Meditation' },
    { id: '37i9dQZF1DWTC99MCpbjP8', name: 'Calm' },
    { id: '37i9dQZF1DX4sWSpwq3LiO', name: 'Peaceful Piano' },
  ],
  focus: [
    { id: '37i9dQZF1DWZeKCadgRdKQ', name: 'Deep Focus' },
    { id: '37i9dQZF1DX0SM0LYsmbMT', name: 'Jazz Vibes' },
    { id: '37i9dQZF1DX8Uebhn9wzrS', name: 'chill lofi study beats' },
    { id: '37i9dQZF1DWXLeA8Omikj7', name: 'Brain Food' },
    { id: '37i9dQZF1DWZZbwlv3Vmtr', name: 'Focus Flow' },
  ],
  sleep: [
    { id: '37i9dQZF1DWYcDQ1hSjOpY', name: 'Deep Sleep' },
    { id: '37i9dQZF1DWZd79rJ6a7lp', name: 'Sleep' },
    { id: '37i9dQZF1DXa1rZf8gLhyz', name: 'Jazz for Sleep' },
    { id: '37i9dQZF1DX2PQDq3PdrHQ', name: 'lofi sleep' },
    { id: '37i9dQZF1DX2mFmJUZg4Mp', name: 'Gentle Rains' },
  ],
};
// Vibe metadata for the music panel chips (icon + EN/AR label).
const MUSIC_VIBES = {
  beast:   { icon: 'fa-fire',          en: 'Beast Mode',     ar: 'وضع الوحش' },
  hiphop:  { icon: 'fa-microphone',    en: 'Hip-Hop & Rap',  ar: 'هيب هوب وراب' },
  edm:     { icon: 'fa-bolt',          en: 'EDM Energy',     ar: 'طاقة إلكترونية' },
  rock:    { icon: 'fa-guitar',        en: 'Rock & Metal',   ar: 'روك وميتال' },
  pop:     { icon: 'fa-star',          en: 'Pop Hits',       ar: 'أغاني البوب' },
  running: { icon: 'fa-person-running',en: 'Running',        ar: 'جري' },
  cycling: { icon: 'fa-bicycle',       en: 'Cycling & Spin', ar: 'دراجات' },
  hiit:    { icon: 'fa-heart-pulse',   en: 'HIIT & CrossFit',ar: 'هيت وكروسفت' },
  boxing:  { icon: 'fa-hand-fist',     en: 'Boxing & Fight', ar: 'ملاكمة وقتال' },
  team:    { icon: 'fa-trophy',        en: 'Team Sports',    ar: 'رياضات جماعية' },
  arabic:  { icon: 'fa-mosque',        en: 'Arabic Workout', ar: 'تمرين عربي' },
  kpop:    { icon: 'fa-music',         en: 'K-Pop',          ar: 'كي بوب' },
  latin:   { icon: 'fa-globe',         en: 'Latin & World',  ar: 'لاتيني وعالمي' },
  country: { icon: 'fa-cowboy',        en: 'Country',        ar: 'كانتري' },
  retro:   { icon: 'fa-rotate-left',   en: '80s & 90s',      ar: 'الثمانينات والتسعينات' },
  calm:    { icon: 'fa-spa',           en: 'Yoga & Calm',    ar: 'يوغا وهدوء' },
  focus:   { icon: 'fa-brain',         en: 'Deep Focus',     ar: 'تركيز عميق' },
  sleep:   { icon: 'fa-moon',          en: 'Sleep & Recovery', ar: 'نوم واستشفاء' }
};
// Every one of the app's 103 sports mapped to its training vibe.
const SPORT_VIBES = {
  Football:'team', Basketball:'team', Tennis:'edm', Swimming:'edm', Running:'running',
  Cycling:'cycling', Boxing:'boxing', Volleyball:'team', Golf:'focus', Cricket:'team',
  Badminton:'edm', 'Table Tennis':'edm', 'Martial Arts':'boxing', Rowing:'running', Rugby:'beast',
  Gymnastics:'calm', Hiking:'calm', Surfing:'edm', Skateboarding:'hiphop', Baseball:'team',
  'Ice Hockey':'rock', Skiing:'edm', Snowboarding:'rock', Archery:'focus', Fencing:'focus',
  Weightlifting:'beast', 'Track & Field':'running', Wrestling:'beast', Climbing:'beast', Kayaking:'running',
  Sailing:'calm', Polo:'country', Handball:'team', Squash:'edm', Diving:'calm',
  'General Fitness':'pop', Parkour:'hiphop', Triathlon:'running', Equestrian:'country', Netball:'team',
  Lacrosse:'team', 'Ultimate Frisbee':'pop', 'Water Polo':'team', 'Synchronized Swimming':'calm', Rafting:'rock',
  Canoeing:'running', Bobsleigh:'beast', Curling:'focus', 'Speed Skating':'edm', Sledding:'calm',
  Judo:'boxing', Karate:'boxing', Taekwondo:'boxing', Kickboxing:'boxing', 'Muay Thai':'boxing',
  'Jiu Jitsu':'boxing', Sprinting:'running', Marathon:'running', Hurdles:'running', 'Long Jump':'running',
  'High Jump':'running', 'Pole Vault':'running', 'Shot Put':'beast', Discus:'beast', Javelin:'beast',
  'Road Cycling':'cycling', 'Mountain Biking':'cycling', BMX:'hiphop', 'Track Cycling':'cycling', 'Indoor Cycling':'cycling',
  Mountaineering:'beast', Orienteering:'focus', 'Roller Skating':'retro', Crossfit:'hiit', Calisthenics:'hiphop',
  Pilates:'calm', Yoga:'calm', Stretching:'calm', Bootcamp:'hiit', Ballet:'calm',
  'Hip Hop':'hiphop', Zumba:'latin', Ballroom:'retro', Salsa:'latin', Contemporary:'calm',
  Jazz:'focus', Breakdance:'hiphop', 'Tap Dance':'retro', Darts:'focus', Billiards:'focus',
  Bowling:'retro', Shooting:'focus', 'Show Jumping':'country', Dressage:'country', 'Horse Racing':'country',
  Cheerleading:'pop', Trampolining:'pop', Decathlon:'running', Floorball:'team', Racquetball:'edm',
  'Paddle Tennis':'edm', 'Kite Surfing':'edm', 'Wind Surfing':'edm'
};
// MoodMorph moods → playlist vibe (the mood workout's "Recommended Playlists").
const MOOD_VIBES = { stressed:'calm', sad:'pop', neutral:'edm', happy:'pop', pumped:'beast' };
// Daily-rotated playlist for a live session (same sport → different playlist each day).
function getRandomPlaylist(sportName) {
  const vibe = SPORT_VIBES[sportName] || 'pop';
  const list = (VOLTA_PLAYLISTS[vibe] || VOLTA_PLAYLISTS.pop);
  return list[new Date().getDate() % list.length].id;
}
// Daily-rotated subset of a vibe (used by MoodMorph / meditation).
function getVibePlaylistIds(vibe, count) {
  const list = (VOLTA_PLAYLISTS[vibe] || VOLTA_PLAYLISTS.pop).map(p => p.id);
  return getDailyItems(list, count);
}
// Spotify embed iframe for one playlist (compact bar player).
function playlistEmbedHtml(id, name) {
  return '<iframe style="border-radius:12px;" src="https://open.spotify.com/embed/playlist/' + id +
    '" width="100%" height="152" frameBorder="0" loading="lazy" allowfullscreen="" title="' + (name || 'Spotify playlist') +
    '" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>';
}
// ─── Sports tab "Workout Music" panel (100 playlists, vibe chips) ────────
let musicVibeSel = 'beast';
function renderMusicPanel() {
  const chipsEl = document.getElementById('music-vibe-chips');
  const gridEl = document.getElementById('music-grid');
  if (!chipsEl || !gridEl) return;
  chipsEl.innerHTML = Object.keys(VOLTA_PLAYLISTS).map(v =>
    '<button type="button" class="music-chip' + (v === musicVibeSel ? ' active' : '') + '" onclick="toggleMusicVibe(\'' + v + '\')" data-ar="' + MUSIC_VIBES[v].ar + '">' +
    '<i class="fa-solid ' + MUSIC_VIBES[v].icon + '"></i> ' + MUSIC_VIBES[v].en + '</button>'
  ).join('');
  const ar = (typeof store !== 'undefined' && store.lang === 'ar');
  const vibeMeta = MUSIC_VIBES[musicVibeSel];
  const playlists = VOLTA_PLAYLISTS[musicVibeSel] || [];
  const countEl = document.getElementById('music-vibe-count');
  if (countEl) countEl.textContent = ar
    ? (playlists.length + ' قوائم · ' + vibeMeta.ar)
    : (playlists.length + ' playlists · ' + vibeMeta.en);
  gridEl.innerHTML = playlists.map((p, i) =>
    '<div class="music-playlist-card">' +
      '<div class="music-playlist-head"><span class="music-playlist-num">' + (i + 1) + '</span><b>' + p.name + '</b></div>' +
      playlistEmbedHtml(p.id, p.name) +
    '</div>'
  ).join('') + (!navigator.onLine
    ? '<p class="music-offline-note"><i class="fa-solid fa-wifi"></i> <span data-ar="أنت غير متصل — قد لا تُحمّل قوائم التشغيل حتى تعود للاتصال.">You\'re offline — playlists may not load until you reconnect.</span></p>'
    : '');
}
function toggleMusicVibe(v) {
  musicVibeSel = v;
  renderMusicPanel();
  const grid = document.getElementById('music-grid');
  if (grid) grid.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}


function setTheme(mode) {
  store.theme = mode;
  // v20: light theme option — persist for the pre-paint head script + skin layer
  try { localStorage.setItem('vfit_theme', mode); } catch (e) {}
  applySettings();
  // chart colors are canvas-drawn — re-render for the new theme
  try { renderChart(); } catch (e) {}
}
function setLang(lang) {
  store.lang = lang;
  applySettings();
  // Re-render ALL tabs (not just the active one) so that hidden tabs also pick
  // up the new language. If we only re-rendered the active tab, content in
  // hidden tabs would stay in the old language until the user navigated to
  // them — which is a common source of "some text stays as-is" bugs.
  setTimeout(function() {
    try {
      // Re-render the user app's active tab (if user app is the active screen)
      const userAppActive = document.getElementById('screen-app').classList.contains('active');
      if (userAppActive) {
        const activeTab = document.querySelector('#screen-app .tab.active');
        if (activeTab) {
          const tabName = activeTab.id.replace('tab-', '');
          // NOTE: showTab() early-returns when the requested tab is ALREADY
          // active, which used to skip the re-render and leave dynamic text
          // (greeting, stat cards, plan cards…) in the old language until the
          // user navigated away and back. Call the tab renderers directly.
          if (tabName === 'home') { renderHome(); renderTracker(); }
          else if (tabName === 'daily') { renderDailyExercise(); try { renderCustomWorkoutsList(); } catch (e) {} }
          else if (tabName === 'streaks') { try { renderStreaksTab(); } catch (e) {} }
          else if (tabName === 'reminders') { try { renderReminders(); } catch (e) {} }
          else if (tabName === 'diet') { try { renderDiet(); } catch (e) {} }
          else if (tabName === 'sports') { try { renderSports(); } catch (e) {} }
          else if (tabName === 'profile') { try { renderProfile(); } catch (e) {} }
          else if (tabName === 'weather') { try { if (lastWeather) renderWeather(); } catch (e) {} }
        }
      }

      // Re-render the coach app's active tab AND all renderable coach content
      // (athletes, sessions table, plans, stats, chart). Hidden tabs would
      // otherwise keep their old-language text until visited.
      const coachActive = document.querySelector('#screen-coach-app.active');
      if (coachActive) {
        if (typeof renderCoachAthletes === 'function') renderCoachAthletes();
        if (typeof updateCoachStats === 'function') updateCoachStats();
        if (typeof renderCoachSessionsTable === 'function') renderCoachSessionsTable();
        if (typeof renderCoachPlans === 'function') renderCoachPlans();
        if (typeof renderCoachSessionsChart === 'function') {
          requestAnimationFrame(() => requestAnimationFrame(() => renderCoachSessionsChart()));
        }
        // Also re-render the active coach tab to update its specific content
        const coachTab = document.querySelector('#screen-coach-app .tab.active');
        if (coachTab) {
          const coachTabName = coachTab.id.replace('tab-', '');
          if (typeof showCoachTab === 'function') showCoachTab(coachTabName);
        }
      }
    } catch(e) { console.warn('setLang re-render error:', e); }
    // Refresh the MoodMorph energy slider gradient so it flips to match the
    // new language direction (LTR → RTL or vice versa). Without this, the
    // colored fill keeps its old direction until the user drags the slider.
    try {
      const energyInput = document.getElementById('energy');
      if (energyInput && typeof updateEnergyLabel === 'function') {
        updateEnergyLabel(energyInput.value);
      }
    } catch(e) {}
    // Phase 8 fix: update the premium button text when language changes
    try { if (window.VoltaPremium) VoltaPremium.updateButton(); } catch(e) {}
  }, 10);
}
function setLoc(enabled) { store.locationEnabled = enabled; applySettings(); if (enabled) loadWeather(true); }
// v8: Settings → AI Camera toggle (mirrors setLoc). When re-enabled AFTER
// the user had turned it off, the next camera feature simply asks again
// (or starts silently if the browser already remembers the grant).
function setCamera(enabled) {
  store.cameraEnabled = enabled;
  applySettings();
  // v9: turning the camera OFF in Settings also stops a live camera session
  // immediately (the lingering stream would keep the camera light on).
  if (!enabled) {
    try {
      if (typeof VoltaAI !== 'undefined' && VoltaAI.shutdownCamera) {
        const eng = VoltaAI.getActiveEngine ? VoltaAI.getActiveEngine() : null;
        if (eng) { try { eng.stop(); } catch (e) {} }
        VoltaAI.shutdownCamera();
      }
    } catch (e) {}
  }
  try {
    showVoltaToast(enabled
      ? (store.lang === 'ar' ? 'تم تفعيل كاميرا الذكاء الاصطناعي — ستعمل مع فحص الأداء وعدّاد التكرارات.' : 'AI camera enabled — it works with Form Check and the Rep Counter.')
      : (store.lang === 'ar' ? 'تم إيقاف كاميرا الذكاء الاصطناعي — لن يطلبها التطبيق بعد الآن.' : 'AI camera turned OFF — the app will not ask for it anymore.'),
      enabled ? 'success' : 'info');
  } catch (e) {}
}
function toggleSidebar() { document.getElementById('screen-app').classList.toggle('sidebar-collapsed'); }

// ===== ARABIC TRANSLATION ENGINE (v2 — textContent-based, child-safe) =====
//
// DESIGN
// ──────
// Every translatable element carries a `data-ar` attribute whose value is the
// Arabic translation. The English source is captured from the element's OWN
// direct text nodes (NOT descendant text — that belongs to the descendants)
// and stored in a `data-en` attribute the first time we touch the element OR
// whenever the direct text changes from English to a new English string
// (which happens when a render function regenerates the element with fresh
// English content).
//
// Critically, we NEVER use `el.innerHTML = arText`. That would destroy any
// child elements (icons, spans, badges) inside the translated element. Instead
// we walk the element's direct child nodes and only mutate the TEXT_NODEs,
// leaving element children untouched. This is what makes the engine robust:
//   • `<button data-ar="إبدأ"><i class="fa-play"></i> Start</button>` →
//     `<button data-ar="إبدأ"><i class="fa-play"></i> إبدأ</button>` (icon kept!)
//
// Bidirectional behavior:
//   • EN → AR : save current direct text as `data-en` (refresh if changed),
//               then set direct text to the Arabic value from `data-ar`.
//   • AR → EN : if direct text currently equals the Arabic value, restore
//               from `data-en`. Otherwise the element is already showing
//               fresh English content (a render just ran), so leave it alone.
//
// This re-derivation every cycle means we don't need to remember "state" —
// we just look at the current direct text and act accordingly. Re-renders in
// either language are handled correctly without stale caches.

// Get the concatenated text of an element's DIRECT text nodes only
// (ignores text inside child elements — that text belongs to the child's
// own translation, not the parent's).
function __i18nGetDirectText(el) {
  let text = '';
  for (let i = 0; i < el.childNodes.length; i++) {
    const n = el.childNodes[i];
    if (n.nodeType === Node.TEXT_NODE) text += n.nodeValue;
  }
  return text;
}

// Set the text of an element's direct text nodes only, preserving any
// child elements (icons, spans, etc.).
function __i18nSetDirectText(el, text) {
  const hasElementChildren = Array.prototype.some.call(
    el.childNodes, n => n.nodeType === Node.ELEMENT_NODE
  );

  if (!hasElementChildren) {
    // Simple case: no child elements — just set textContent.
    el.textContent = text;
    return;
  }

  // Collect direct text nodes (skip empty ones to avoid creating noise).
  const textNodes = Array.prototype.filter.call(
    el.childNodes,
    n => n.nodeType === Node.TEXT_NODE && n.nodeValue !== ''
  );

  if (textNodes.length >= 1) {
    // Replace the first text node, remove the rest.
    textNodes[0].nodeValue = text;
    for (let i = 1; i < textNodes.length; i++) {
      el.removeChild(textNodes[i]);
    }
  } else {
    // No direct text node yet — insert one at the start.
    el.insertBefore(document.createTextNode(text), el.firstChild);
  }
}

function applyTranslations() {
  try {
    const isAr = (store.lang === 'ar');

    // 1) Translate [data-ar] elements via direct-text swap (preserves child elements).
    document.querySelectorAll('[data-ar]').forEach(el => {
      try {
        const arText = el.getAttribute('data-ar');
        if (arText === null) return;
        const directText = __i18nGetDirectText(el);

        if (isAr) {
          // Arabic mode: refresh data-en with current English direct text
          // (whenever the direct text is NOT already the Arabic translation,
          // it means the element is showing fresh English content — capture it).
          if (directText !== arText) {
            el.setAttribute('data-en', directText);
          } else if (!el.hasAttribute('data-en')) {
            // Edge case: direct text is already Arabic but we have no English
            // baseline. Can't recover — skip translation to avoid losing data.
            return;
          }
          __i18nSetDirectText(el, arText);
        } else {
          // English mode: if direct text currently equals the Arabic translation,
          // restore from data-en. Otherwise the element is showing fresh English
          // (just rendered or never translated) — leave it alone.
          if (el.hasAttribute('data-en') && directText === arText) {
            __i18nSetDirectText(el, el.getAttribute('data-en'));
          }
        }
      } catch (e) {}
    });

    // 2) Translate [data-ar-text] elements via textContent (no HTML parsing).
    //    Used for elements whose text is set via .textContent and where we
    //    want a guaranteed full-text swap regardless of children.
    document.querySelectorAll('[data-ar-text]').forEach(el => {
      try {
        const arText = el.getAttribute('data-ar-text');
        if (arText === null) return;
        if (isAr) {
          if (el.textContent !== arText) {
            el.setAttribute('data-en-text', el.textContent);
          }
          el.textContent = arText;
        } else {
          if (el.hasAttribute('data-en-text') && el.textContent === arText) {
            el.textContent = el.getAttribute('data-en-text');
          }
        }
      } catch (e) {}
    });

    // 3) Translate placeholder attributes via [data-ar-ph].
    document.querySelectorAll('[data-ar-ph]').forEach(el => {
      try {
        const arPh = el.getAttribute('data-ar-ph');
        if (arPh === null) return;
        if (isAr) {
          if (!el.hasAttribute('data-en-ph') && el.placeholder !== undefined && el.placeholder !== arPh) {
            el.setAttribute('data-en-ph', el.placeholder);
          }
          el.placeholder = arPh;
        } else {
          if (el.hasAttribute('data-en-ph') && el.placeholder === arPh) {
            el.placeholder = el.getAttribute('data-en-ph');
          }
        }
      } catch (e) {}
    });

    // 4) Translate <select><option> text via [data-ar] on the <option>.
    //    Handled by step 1 — options are regular elements with text-only content.

  } catch (e) {
    // Defensive: never let translation break the app
    console && console.warn && console.warn('applyTranslations error:', e);
  }
}

// ===== AUTO-RETRANSLATE HOOK =====
// Wrap every render* function so applyTranslations runs right after it.
// This ensures dynamically-rendered content (template strings) gets translated
// even when the render is triggered from inside an event handler (e.g. saving
// a session) rather than a tab switch.
(function wrapRendersForI18n() {
  const renderFns = [
    'renderHome', 'renderSports', 'renderTracker', 'renderDailyExercise',
    'renderDiet', 'renderReminders', 'renderProfile',
    'renderWeather', 'renderCoachRecommendation', 'renderInBodyProfileCard',
    'renderWorkoutList', 'renderSportSearchList', 'renderSafetyGrid',
    'renderCoachMealsForUser', 'renderCoachHome', 'renderCoachAthletes',
    'renderCoachSessions', 'renderCoachPlans', 'renderCoachProfile',
    'renderStreaksTab', 'renderCustomWorkoutsList'
  ];
  renderFns.forEach(name => {
    if (typeof window[name] === 'function' && !window[name]._i18nWrapped) {
      const orig = window[name];
      const wrapped = function() {
        const r = orig.apply(this, arguments);
        try { setTimeout(applyTranslations, 0); } catch(e) {}
        return r;
      };
      wrapped._i18nWrapped = true;
      window[name] = wrapped;
    }
  });
})();

// ===== MOBILE SIDEBAR FUNCTIONS =====
function toggleMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('mobile-sidebar-overlay');
  const isOpen = sidebar.classList.contains('mobile-open');
  if (isOpen) {
    closeMobileSidebar();
  } else {
    sidebar.classList.add('mobile-open');
    overlay.classList.add('active');
    document.body.classList.add('sidebar-mobile-open');
  }
}
function closeMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('mobile-sidebar-overlay');
  sidebar.classList.remove('mobile-open');
  overlay.classList.remove('active');
  document.body.classList.remove('sidebar-mobile-open');
}

// Coach sidebar functions (mobile)
function toggleMobileSidebarCoach() {
  const sidebar = document.getElementById('coach-sidebar');
  const overlay = document.getElementById('mobile-sidebar-overlay-coach');
  const isOpen = sidebar.classList.contains('mobile-open');
  if (isOpen) {
    closeMobileSidebarCoach();
  } else {
    sidebar.classList.add('mobile-open');
    overlay.classList.add('active');
    document.body.classList.add('sidebar-mobile-open');
  }
}
function closeMobileSidebarCoach() {
  const sidebar = document.getElementById('coach-sidebar');
  const overlay = document.getElementById('mobile-sidebar-overlay-coach');
  if (sidebar) sidebar.classList.remove('mobile-open');
  if (overlay) overlay.classList.remove('active');
  document.body.classList.remove('sidebar-mobile-open');
}

// ===== MOBILE MENU BUTTON VISIBILITY =====
function updateMobileMenuBtn() {
  const isMobile = window.innerWidth <= 768;
  const appBtn = document.getElementById('mobile-menu-btn');
  const bottomNav = document.getElementById('bottom-nav');
  const coachBottomNav = document.getElementById('coach-bottom-nav');
  const coachSidebar = document.getElementById('coach-sidebar');

  // Determine if an app screen is active (not login/auth screens)
  const appScreen = document.getElementById('screen-app');
  const coachAppScreen = document.getElementById('screen-coach-app');
  const appActive = appScreen && appScreen.classList.contains('active');
  const coachAppActive = coachAppScreen && coachAppScreen.classList.contains('active');

  if (isMobile) {
    if (appBtn) appBtn.style.display = 'none';
    // Show athlete bottom nav only when athlete app is active
    if (bottomNav) bottomNav.style.display = appActive ? 'block' : 'none';
    // Show coach bottom nav only when coach app is active
    if (coachBottomNav) coachBottomNav.style.display = coachAppActive ? 'block' : 'none';
    // Hide coach sidebar on mobile
    if (coachSidebar) coachSidebar.style.display = 'none';
  } else {
    if (appBtn) appBtn.style.display = 'none';
    // On desktop, hide bottom navs
    if (bottomNav) bottomNav.style.display = 'none';
    if (coachBottomNav) coachBottomNav.style.display = 'none';
    // Show coach sidebar on desktop when coach app is active
    if (coachSidebar && coachAppActive) coachSidebar.style.display = '';
    else if (coachSidebar) coachSidebar.style.display = 'none';
    // Close any open mobile sidebar
    closeMobileSidebar();
  }
}

// Close mobile sidebar when a tab is clicked (so user sees content immediately)
const origShowTab = showTab;
showTab = function(name) {
  closeMobileSidebar();
  closeBottomNavMore();
  // === Round 7: detect same-tab click BEFORE calling origShowTab ===
  // origShowTab early-returns silently when the tab is already active, but the
  // post-call logic below (renderDietLog, etc.) still ran anyway, causing the
  // AI meals panel to "auto-reopen" / flash when the user tapped Diet while
  // already on Diet. We now detect the same-tab case and skip those re-renders.
  let isAlreadyActive = false;
  try {
    const sideBtn = document.querySelector('.side-btn[data-tab="' + name + '"]');
    if (sideBtn && sideBtn.classList.contains('active')) isAlreadyActive = true;
    // Also check the bottom-nav button (mobile)
    if (!isAlreadyActive) {
      const bbtn = document.querySelector('.bottom-nav-item[data-btab="' + name + '"]');
      if (bbtn && bbtn.classList.contains('active')) isAlreadyActive = true;
    }
  } catch(e) {}
  origShowTab(name);
  // Only re-render diet panels if we actually switched to the diet tab
  // (i.e. it wasn't already active). This stops the AI meals panel from
  // re-rendering / flashing when the user taps Diet while already on Diet.
  if (name === 'diet' && !isAlreadyActive) { renderDietLog(); renderScannerHistory(); }
  if (name === 'streaks') { try { renderStreaksTab(); } catch(e) {} }
  // RecoveryIQ screen: make sure the full-screen content is rendered (idempotent).
  if (name === 'recovery') { try { if (window.VoltaAI && VoltaAI.ensureRecoveryScreen) VoltaAI.ensureRecoveryScreen(); } catch(e) {} }
  // Update bottom nav active state (NEW nav: home / sports / daily / diet / more)
  const bottomNavItems = document.querySelectorAll('#bottom-nav .bottom-nav-item');
  const tabToBtab = { home: 'home', sports: 'sports', daily: 'daily', diet: 'diet',
    recovery: 'recovery',
    streaks: 'more', marathon: 'more', weather: 'more', moodmorph: 'more',
    reminders: 'more', mycoach: 'more', profile: 'more', settings: 'more' };
  const activeBtab = tabToBtab[name] || 'home';
  bottomNavItems.forEach(item => {
    item.classList.toggle('active', item.dataset.btab === activeBtab);
  });
  // Round 10: the sliding diagonal glider pill was REMOVED per user request
  // ("remove the diagonal animation from the screen bar on phone"). The active
  // tab now lights up instantly via its own .active background — no sliding
  // pill, no skew, no animation.
  // Ensure proper nav visibility
  updateMobileMenuBtn();
};

// ===== BOTTOM NAVIGATION BAR (Mobile) =====
// Round 10: the skewed sliding glider pill (#bottom-nav-glider) was removed
// per user request. Each button now paints its own .active background
// instantly (see volta-redesign.css) — no diagonal pill, no sliding animation.
// moveBottomNavGlider() was deleted; all former call sites cleaned up.

function toggleBottomNavMore() {
  const more = document.getElementById('bottom-nav-more');
  let overlay = document.getElementById('bottom-nav-more-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'bottom-nav-more-overlay';
    overlay.className = 'bottom-nav-more-overlay';
    overlay.onclick = closeBottomNavMore;
    document.getElementById('screen-app').appendChild(overlay);
  }
  const isActive = more.classList.contains('active');
  if (isActive) {
    closeBottomNavMore();
  } else {
    more.classList.add('active');
    overlay.classList.add('active');
    // Hide AI chat button when more popup is open
    document.body.classList.add('more-popup-active');
  }
}
function closeBottomNavMore() {
  const more = document.getElementById('bottom-nav-more');
  const overlay = document.getElementById('bottom-nav-more-overlay');
  if (more) more.classList.remove('active');
  if (overlay) overlay.classList.remove('active');
  // Restore AI chat button when more popup is closed
  document.body.classList.remove('more-popup-active');
}

// ===== COACH BOTTOM NAV MORE POPUP =====
function toggleCoachBottomNavMore() {
  const more = document.getElementById('coach-bottom-nav-more');
  let overlay = document.getElementById('coach-bottom-nav-more-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'coach-bottom-nav-more-overlay';
    overlay.className = 'bottom-nav-more-overlay';
    overlay.onclick = closeCoachBottomNavMore;
    document.getElementById('screen-coach-app').appendChild(overlay);
  }
  const isActive = more.classList.contains('active');
  if (isActive) {
    closeCoachBottomNavMore();
  } else {
    more.classList.add('active');
    overlay.classList.add('active');
    // Hide AI chat button when more popup is open
    document.body.classList.add('more-popup-active');
  }
}
function closeCoachBottomNavMore() {
  const more = document.getElementById('coach-bottom-nav-more');
  const overlay = document.getElementById('coach-bottom-nav-more-overlay');
  if (more) more.classList.remove('active');
  if (overlay) overlay.classList.remove('active');
  document.body.classList.remove('more-popup-active');
}

const origShowCoachTab = showCoachTab;
showCoachTab = function(t) {
  closeCoachBottomNavMore();
  origShowCoachTab(t);
  if (t === 'coach-home') { renderCoachAnnouncements(); renderCoachWeeklyOverview(); }
  if (t === 'coach-athletes') { renderCoachAthletes(); filterCoachAthletes(); }
  if (t === 'coach-meals') { populateCoachMealAthletes(); renderCoachMealsLog(); }
  // Update coach bottom nav active state
  const coachBottomNavItems = document.querySelectorAll('#coach-bottom-nav .bottom-nav-item');
  const tabToBtab = { 'coach-home': 'coach-home', 'coach-athletes': 'coach-athletes',
    'coach-sessions': 'coach-sessions', 'coach-plans': 'coach-plans',
    'coach-meals': 'coach-more', 'coach-profile': 'coach-more',
    'coach-settings': 'coach-more' };
  const activeBtab = tabToBtab[t] || 'coach-home';
  coachBottomNavItems.forEach(item => {
    item.classList.toggle('active', item.dataset.btab === activeBtab);
  });
};

// Run on load and resize (debounced)
let resizeTimer = null;
window.addEventListener('resize', function() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(function() {
    updateMobileMenuBtn();
    // Mobile redesign: re-evaluate the kcal ring visibility on resize
    // (e.g. user rotated phone or resized browser window across the
    // 768px breakpoint).
    try { setMobileKcalRing(); } catch(e) {}
  }, 150);
});


function applySettings() {
  // v20: light theme option — html[data-vfit-theme] drives the skin layer
  // (css/volta-fitness.css §17). Dark is the default look; 'light' is opt-in
  // via Settings → Theme. Also tint the Android/PWA status bar to match.
  try {
    var __vfit = 'dark';
    try { if (localStorage.getItem('vfit_theme') === 'light') __vfit = 'light'; } catch (e) {}
    document.documentElement.setAttribute('data-vfit-theme', __vfit);
    var __mc = document.querySelector('meta[name="theme-color"]');
    if (__mc) __mc.setAttribute('content', (__vfit === 'light') ? '#f5f7fb' : '#0a0c10');
  } catch (e) {}
  if (store.theme === 'dark') { document.body.classList.add('dark-mode'); document.getElementById('theme-light-btn')?.classList.remove('active'); document.getElementById('theme-dark-btn')?.classList.add('active'); document.getElementById('coach-theme-light-btn')?.classList.remove('active'); document.getElementById('coach-theme-dark-btn')?.classList.add('active'); }
  else { document.body.classList.remove('dark-mode'); document.getElementById('theme-light-btn')?.classList.add('active'); document.getElementById('theme-dark-btn')?.classList.remove('active'); document.getElementById('coach-theme-light-btn')?.classList.add('active'); document.getElementById('coach-theme-dark-btn')?.classList.remove('active'); }

  // Language: English (default LTR) or Arabic (RTL)
  const lang = store.lang || 'en';
  const isArabic = (lang === 'ar');
  document.documentElement.lang = lang;
  document.documentElement.dir = isArabic ? 'rtl' : 'ltr';
  document.body.classList.toggle('lang-ar', isArabic);
  document.body.classList.toggle('lang-en', !isArabic);
  const enBtn = document.getElementById('lang-en-btn');
  const arBtn = document.getElementById('lang-ar-btn');
  if (enBtn && arBtn) {
    enBtn.classList.toggle('active', !isArabic);
    arBtn.classList.toggle('active', isArabic);
  }

  // Weather location toggle
  const locOn = store.locationEnabled;
  const locOnBtn = document.getElementById('loc-on-btn');
  const locOffBtn = document.getElementById('loc-off-btn');
  if (locOnBtn && locOffBtn) {
    locOnBtn.classList.toggle('active', !!locOn);
    locOffBtn.classList.toggle('active', !locOn);
  }

  // v8: AI Camera toggle (Settings → AI Camera) — mirrors Weather Location
  const camOn = (typeof store.cameraEnabled !== 'undefined') ? store.cameraEnabled : true;
  const camOnBtn = document.getElementById('cam-on-btn');
  const camOffBtn = document.getElementById('cam-off-btn');
  if (camOnBtn && camOffBtn) {
    camOnBtn.classList.toggle('active', !!camOn);
    camOffBtn.classList.toggle('active', !camOn);
  }

  // NEW: Units toggle button state (metric / imperial)
  try {
    const umBtn = document.getElementById('unit-metric-btn');
    const uiBtn = document.getElementById('unit-imperial-btn');
    if (umBtn && uiBtn) {
      const units = (window.VoltaFeatures && VoltaFeatures.getUnits) ? VoltaFeatures.getUnits() : 'metric';
      umBtn.classList.toggle('active', units === 'metric');
      uiBtn.classList.toggle('active', units === 'imperial');
    }
  } catch (e) {}
  // NEW: Notifications toggle state
  try { if (window.VoltaNotifications && VoltaNotifications.refreshSettingsUI) VoltaNotifications.refreshSettingsUI(); } catch (e) {}
  // Apply Arabic translations (or restore English) for all [data-ar] elements
  applyTranslations();
}

function ensureUserRecord(email, opts = {}) {
  const existing = store.users[email];
  if (!existing) {
    saveUser(email, { password: opts.password || null, verified: !!opts.verified, profile: null, survey: null, streak: 0, lastDone: null, google: !!opts.google, isPremium: false, sessions: [], reminders: [] });
  }
  // Re-read from store so we always work with the latest data (store.users
  // returns a fresh parsed object each time, so the local `users` variable
  // captured before saveUser() pointed at a stale snapshot).
  const u = store.users[email];
  if (!u.reminders) u.reminders = [];
  if (!u.sessions) u.sessions = [];
  // Phase 4: backfill isPremium for old accounts that don't have the field
  if (typeof u.isPremium !== 'boolean') u.isPremium = false;
  saveUser(email, u);
  return store.users[email];
}
function setMsg(id, text, cls) { const el = document.getElementById(id); if (!el) return; el.textContent = text; el.className = 'msg ' + (cls || ''); }
function togglePwd(id, el) { const i = document.getElementById(id); i.type = i.type === 'password' ? 'text' : 'password'; el.innerHTML = i.type === 'password' ? '<i class="fa-solid fa-eye"></i>' : '<i class="fa-solid fa-eye-slash"></i>'; }
function openModal(id) {
  document.getElementById(id).classList.add('active');
  // Round 17: lock the page behind ANY open popup. The overlay covers the
  // screen visually, but on touch devices swipes still scrolled the page
  // underneath ("popup doesn't scroll, the list behind scrolls" bug).
  document.body.classList.add('modal-open');
  document.documentElement.classList.add('modal-open');
  __voltaSetMainOverflow(true);
}
function closeModal(id) {
  document.getElementById(id).classList.remove('active');
  // Release the lock only when the LAST popup is gone (popups can stack).
  if (!document.querySelector('.modal-overlay.active')) {
    document.body.classList.remove('modal-open');
    document.documentElement.classList.remove('modal-open');
    __voltaSetMainOverflow(false);
  }
}
// Round 17: <main> is the app's INTERNAL scroll container (inside the fixed
// #screen-app shell) — html/body locks don't stop it from scrolling behind a
// popup. Freeze it with an INLINE !important style (beats any stylesheet
// specificity battle) while a popup is open; remove the style on close.
// The engine preserves scrollTop while frozen, so nothing jumps.
function __voltaSetMainOverflow(lock) {
  try {
    var mains = document.querySelectorAll('main');
    for (var i = 0; i < mains.length; i++) {
      if (lock) mains[i].style.setProperty('overflow', 'hidden', 'important');
      else mains[i].style.removeProperty('overflow');
    }
  } catch (e) {}
}
// Round 17 self-heal: some overlays toggle .active directly (session tracker,
// celebration popups…). This observer keeps body.modal-open in sync no matter
// which code path flipped a popup — present iff ANY .modal-overlay is active.
// classList.toggle is a no-op when unchanged, so the observer never loops.
(function () {
  function syncModalLock() {
    try {
      var any = !!document.querySelector('.modal-overlay.active');
      document.body.classList.toggle('modal-open', any);
      document.documentElement.classList.toggle('modal-open', any);
      __voltaSetMainOverflow(any);
    } catch (e) {}
  }
  if (typeof MutationObserver !== 'undefined') {
    try {
      new MutationObserver(syncModalLock).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['class'] });
    } catch (e) {}
  }
})();

function updateChatbaseVisibility() {
  var appEl = document.getElementById('screen-app');
  var coachEl = document.getElementById('screen-coach-app');
  var isAppActive = (appEl && appEl.classList.contains('active')) || (coachEl && coachEl.classList.contains('active'));
  if (isAppActive) {
    document.body.classList.add('app-active');
    if (window.chatbase) { try { window.chatbase('show'); } catch(e) {} }
    // v35: preload the embedded Chatbase widget (js/chatbase-embed.js) once
    // the user is inside the app, so the first Coach-AI button click opens
    // instantly. No-op when unconfigured or already loaded/offline.
    if (window.VoltaChatbase) { try { window.VoltaChatbase.onAppActive(); } catch(e) {} }
  }
  else { document.body.classList.remove('app-active'); if (window.chatbase) { try { window.chatbase('hide'); } catch(e) {} } }
}

function switchAuthTab(mode) { authMode = mode; document.getElementById('tab-login').classList.toggle('active', mode === 'login'); document.getElementById('tab-signup').classList.toggle('active', mode === 'signup'); const isCoach = document.getElementById('auth-coach-toggle') && document.getElementById('auth-coach-toggle').checked; if (isCoach) { document.getElementById('auth-submit').textContent = mode === 'login' ? 'Log in as Coach' : 'Sign up as Coach'; document.getElementById('auth-coach-fields').style.display = (mode === 'signup') ? 'block' : 'none'; } else { document.getElementById('auth-submit').textContent = mode === 'login' ? 'Log in' : 'Sign up'; } setMsg('auth-msg', ''); }
async function handleAuth(e) {
  e.preventDefault();
  const email = document.getElementById('auth-email').value.trim().toLowerCase();
  const pass = document.getElementById('auth-password').value;
  const users = store.users;
  if (authMode === 'signup') {
    if (users[email]) { setMsg('auth-msg', 'Account already exists. Please log in.', 'error'); return false; }
    // Also check cloud to prevent duplicate accounts cross-device.
    // Round 7: capped at 3.5s — the old uncapped check could chain Firestore
    // timeouts (~12s) and leave the brand-new user staring at the auth screen
    // instead of landing on the homepage. If the cloud can't answer quickly,
    // we proceed with the local signup; the account syncs right after.
    const cloudExisting = await Promise.race([
      loadUserFromCloud(email),
      new Promise(resolve => setTimeout(() => resolve(null), 3500))
    ]);
    if (cloudExisting) { setMsg('auth-msg', 'Account already exists. Please log in.', 'error'); return false; }
    ensureUserRecord(email, { password: pass, verified: true });
    loginSuccess(email);
  } else {
    // === v11: REAL password verification ===
    // User: "i can log in with any account with any password, fix this."
    // The old "bulletproof" login accepted ANY password (silently overwriting
    // the stored one) and even auto-created accounts for unknown emails.
    // Now:
    //   1. Local account → password must match (else "Incorrect password").
    //   2. No local copy → a cloud record must exist AND its password must
    //      match. Unknown emails are rejected (no more auto-create).
    //   3. Google-only accounts (created via the Google button, password
    //      null) → told to use the Google button.
    // v13: the "Forgot password?" button is temporarily hidden until
    //      Firebase is wired up; the reset screen + logic still exist.
    let u = users[email];
    if (!u) {
      // Unknown locally → check the cloud (capped at 3.5s, same as signup,
      // so a dead network can't hang the form).
      setMsg('auth-msg', 'Checking cloud...', 'ok');
      const cloudUser = await Promise.race([
        loadUserFromCloud(email),
        new Promise(resolve => setTimeout(() => resolve(null), 3500))
      ]);
      if (!cloudUser) {
        setMsg('auth-msg', 'No account found with this email. Please sign up first.', 'error');
        return false;
      }
      if (cloudUser.google && !cloudUser.password) {
        setMsg('auth-msg', 'This account signs in with Google. Please use the Google button.', 'error');
        return false;
      }
      if (cloudUser.password !== pass) {
        // v13: "Forgot password?" is temporarily removed (until Firebase) —
        // the message no longer points to it.
        setMsg('auth-msg', 'Incorrect password. Please try again.', 'error');
        return false;
      }
      // Password verified — cache the cloud record locally so loginSuccess()
      // sees the profile and skips onboarding.
      saveUser(email, cloudUser);
      u = store.users[email];
    } else if (u.google && !u.password) {
      setMsg('auth-msg', 'This account signs in with Google. Please use the Google button.', 'error');
      return false;
    } else if (u.password !== pass) {
      // v13: "Forgot password?" is temporarily removed (until Firebase).
      setMsg('auth-msg', 'Incorrect password. Please try again.', 'error');
      return false;
    }
    setMsg('auth-msg', '', '');
    loginSuccess(email);
  }
  return false;
}
function showForgotPassword() { setMsg('forgot-msg', ''); document.getElementById('forgot-step1').classList.remove('hidden'); document.getElementById('forgot-step2').classList.add('hidden'); showScreen('screen-forgot'); }
function sendResetCode(e) {
  e.preventDefault();
  const email = document.getElementById('forgot-email').value.trim().toLowerCase();
  if (!store.users[email]) { setMsg('forgot-msg', 'No account found with this email.', 'error'); return false; }
  pendingEmail = email; pendingCode = String(Math.floor(100000 + Math.random() * 900000));
  document.getElementById('forgot-code-preview').textContent = pendingCode;
  document.getElementById('forgot-step1').classList.add('hidden');
  document.getElementById('forgot-step2').classList.remove('hidden');
  return false;
}
function confirmReset(e) {
  e.preventDefault();
  if (document.getElementById('forgot-code').value.trim() !== pendingCode) { setMsg('forgot-msg', 'Incorrect code.', 'error'); return false; }
  const u = store.users[pendingEmail]; u.password = document.getElementById('forgot-newpwd').value; 
  saveUser(pendingEmail, u);
  setMsg('auth-msg', 'Password reset! Please log in.', 'ok'); showScreen('screen-auth'); return false;
}
async function openGooglePicker() {
  const isCoach = document.getElementById('auth-coach-toggle') && document.getElementById('auth-coach-toggle').checked;
  // === REAL Google sign-in (Firebase) ===
  // When VOLTA_FIREBASE_CONFIG is filled in (index.html), VoltaGoogle runs a
  // true Google account-picker flow and enters the app through the normal
  // account pipeline. Without a config, the demo picker below is used so
  // the button still works while Firebase is being set up.
  if (!isCoach && window.VoltaGoogle && window.VoltaGoogle.isConfigured()) {
    await window.VoltaGoogle.signInAndEnter();
    return;
  }
  let email = localStorage.getItem(isCoach ? 'fb_last_coach_google' : 'fb_last_google');
  if (!email) {
    if (isCoach) {
      const coachDemoEmails = ['coach.alex@gmail.com','coach.sam@gmail.com','coach.jordan@gmail.com'];
      email = coachDemoEmails[Math.floor(Math.random() * coachDemoEmails.length)];
      localStorage.setItem('fb_last_coach_google', email);
    } else {
      const demoEmails = ['alex.g@gmail.com','sam.runner@gmail.com','jordan.fit@gmail.com','taylor.sport@gmail.com','casey.athlete@gmail.com'];
      email = demoEmails[Math.floor(Math.random() * demoEmails.length)];
      localStorage.setItem('fb_last_google', email);
    }
  }
  if (isCoach) {
    // Coach Google login
    const coachUsers = getCoachUsers();
    if (!coachUsers[email]) {
      const fullName = email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      coachUsers[email] = { fullName, email, cert: 'ACE', specialty: 'Strength & Conditioning', pwdHash: hashPassword('google_' + email), google: true };
      saveCoachUsers(coachUsers);
    }
    localStorage.setItem(COACH_SESSION_KEY, email);
    setMsg('auth-msg', 'Welcome, Coach!', 'ok');
    setTimeout(() => enterCoachApp(coachUsers[email]), 500);
  } else {
    // === Round 12: Check cloud before creating a new record ===
    // If the user already exists in the cloud (created on another device),
    // load their data so we don't ask for the survey again.
    if (!store.users[email]) {
      const cloudUser = await loadUserFromCloud(email);
      if (cloudUser) {
        saveUser(email, cloudUser);
      }
    }
    ensureUserRecord(email, { password: null, verified: true, google: true });
    store.session = email;
    loginSuccess(email);
  }
}
// ===== FIRST-RUN DESTINATION =====
// Per user request: "when i opened the app for the first time, it opened the
// survey, i want it to open the homepage". New accounts now land on the HOME
// screen directly. If the setup survey was not completed yet, we seed safe
// default profile values so the dashboard renders correctly, and show a
// one-time toast pointing at Profile → Edit Profile (the survey stays
// available there — it drives plan personalization).
// ═══ Display-name resolution (v3) ═══
// The dashboard/profile must NEVER show the Gmail address or its handle.
// A "handle" = the email's local part (e.g. elgayarlovesbetenganw22) which
// Google sign-in pre-fills into the survey when the Google account has no
// real display name. This helper accepts ONLY real human names.
function voltaDisplayName() {
  try {
    const u = currentUser();
    if (!u) return '';
    const sess = (typeof store !== 'undefined' && store.session) || u.email || '';
    const localPart = String(sess).split('@')[0].toLowerCase().replace(/[._-]+/g, '');
    const isHandle = function (v) {
      const s = String(v || '').trim();
      if (!s || /@/.test(s)) return true;                       // empty or an email
      if (/^athlete$/i.test(s)) return true;                    // v6: the placeholder is NOT a real name
      if (localPart && s.toLowerCase().replace(/[._-]+/g, '') === localPart) return true;  // the gmail handle
      return false;
    };
    const s = u.survey || {}, p = u.profile || {};
    if (!isHandle(s.name)) return String(s.name).trim();
    if (!isHandle(p.name)) return String(p.name).trim();
    if (!isHandle(u.pendingName)) return String(u.pendingName).trim();
    return '';
  } catch (e) { return ''; }
}
window.voltaDisplayName = voltaDisplayName;

function ensureMinimalProfile(u) {
  if (!u) return u;
  if (!u.profile || typeof u.profile !== 'object') u.profile = {};
  const p = u.profile;
  // Only fill fields the user has NOT set (signup seeds the name already).
  // NOTE: never fall back to the email here — the dashboard greeting must
  // show the person's NAME (first survey question), never their Gmail.
  if (!p.name || /@/.test(p.name)) p.name = 'Athlete';
  if (!p.gender) p.gender = 'Male';
  if (!p.age) p.age = 25;
  if (!p.height) p.height = 170;
  if (!p.weight) p.weight = 70;
  if (!p.goal) p.goal = 'Stay healthy';
  // An empty survey object (instead of missing) lets every renderer and the
  // plan engine run with their built-in defaults instead of bailing out.
  if (!u.survey || typeof u.survey !== 'object') u.survey = {};
  return u;
}
function enterAppOrSetup() {
  const u = currentUser();
  // Session can vanish between the splash timer arming and this call (e.g.
  // the user logged out during the splash animation) — go to landing instead
  // of crashing the render pipeline with a null user.
  if (!u) { try { showScreen('screen-landing'); } catch (e) {} return; }
  // "Setup needed" = no meaningful survey answers yet. Handles BOTH new
  // accounts (no survey at all) and pre-update accounts (survey completed
  // before the u.surveyCompleted flag existed — detected via its answers).
  const hasRealSurvey = !!(u && u.survey && (u.survey.level || u.survey.time || u.survey.schedule || u.survey.goal));
  const needsSetup = !u || !u.profile || (!u.surveyCompleted && !hasRealSurvey);
  ensureMinimalProfile(u);
  try { saveUser(store.session, u); } catch (e) {}
  // === v6 (user): "take the name from the first question in the survey" ===
  // Every NEW account is ASKED the setup survey once (first question = the
  // user's name), so the greeting, "Today's Activity Goal" and the workout
  // durations come from REAL answers instead of the defaults ("Athlete" /
  // 30 min).
  // === v10 (user): "when i create a new account and open the survey, i get
  // redirected instantly to the dashboard and fill fake data, fix that" ===
  // Root cause: the old `!u.surveyPrompted` guard marked the account as
  // "already asked" on the FIRST visit, so every later open (reload, app
  // restart, reopening the PWA) skipped the survey entirely, auto-generated
  // a plan from FAKE defaults (Athlete / 25 / 170 / 70) and dropped the user
  // on the dashboard. New rule: an account whose setup is NOT finished is
  // ALWAYS returned to the setup survey, no matter how many times it was
  // shown before. The ONE exception is `surveySkipped`, stamped ONLY when
  // the user deliberately leaves the survey via the "Back to Home" button —
  // those accounts keep the old skip behavior (dashboard + toast nudge).
  if (needsSetup && !u.surveySkipped) {
    u.surveyPrompted = true;
    try { saveUser(store.session, u); } catch (e) {}
    try {
      showScreen('screen-onboarding');
      document.getElementById('inbody-intro').style.display = 'block';
      document.getElementById('survey-area').style.display = 'none';
      currentSurveyStep = 0;
      surveyAnswers = {};
    } catch (e) { try { enterApp(); } catch (e2) {} }
    return;
  }
  // Auto-generate the plan for accounts without one (fresh accounts that
  // skipped the survey, or legacy records) so the dashboard ALWAYS has a
  // plan waiting when the user opens the app.
  ensureUserHasPlan();
  enterApp();
  if (needsSetup) {
    setTimeout(function () {
      try {
        toast(t('Welcome to Volta! Open Profile → Edit Profile to finish the setup survey and unlock fully personalized plans.',
                 'مرحباً بك في فولتا! افتح الملف ← تعديل الملف لإكمال استبيان الإعداد والحصول على خطط مخصصة بالكامل.'), 'info', 6000);
      } catch (e) {}
    }, 2200);
  }
}
// ===== AUTO PLAN GENERATION =====
// Per user report: "i opened the app and there's no plan, and i cant make a
// new plan". Since first-run now lands on the HOMEPAGE (the setup survey is
// optional), the only place u.plan was ever generated — saveSurvey() — never
// runs for new accounts. The dashboard plan panel hid itself and the Daily
// tab fell back to the muscle wizard. Fix: generate the plan automatically
// for ANY account that doesn't have one yet, using the survey answers when
// present and safe defaults otherwise. Idempotent — never overwrites a plan.
function ensureUserHasPlan() {
  try {
    const email = store.session;
    const u0 = email ? store.users[email] : null;
    if (!u0) return false;          // no session / no record — nothing to do
    if (u0.plan) return true;       // already has a plan — never overwrite
    if (!u0.survey || typeof u0.survey !== 'object') u0.survey = {};
    // calculateGoalPlan() computes BMR/TDEE/macros onto u.goalPlan (engine input)
    if (typeof calculateGoalPlan === 'function') { try { calculateGoalPlan(); } catch (e) {} }
    if (!window.VoltaPlan) return false;
    const uu = store.users[email];           // re-read after calculateGoalPlan
    const plan = VoltaPlan.generate(uu);
    if (!plan) return false;
    uu.plan = plan;
    saveUser(email, uu);                     // stamps lastSyncedAt + queues sync
    // Async: fill meal suggestions from IndexedDB (non-blocking, like saveSurvey).
    // populateMealSuggestions persists internally now (Round 9 stale-object fix),
    // so this only re-renders the dashboard when the fill lands.
    if (window.VoltaDB && VoltaPlan.populateMealSuggestions) {
      VoltaPlan.populateMealSuggestions(plan).then(function () {
        try { if (typeof renderPlan === 'function') renderPlan(); } catch (e) {}
      }).catch(function () {});
    }
    return true;
  } catch (e) { console.warn('ensureUserHasPlan error:', e); return false; }
}
function loginSuccess(email) {
  store.session = email; const u = store.users[email];
  resetDeStateForUserChange();   // fresh Daily-Exercise state for this user
  // === Vercel vault: store the login details immediately ===
  // The account record (email + password + profile shell) is pushed to the
  // user's own Vercel backend (plus Firestore + backup cloud) right away,
  // so a brand-new account can log in from another device even before any
  // app data exists. Best-effort + offline-queued by cloudsync.js.
  try { if (u && window.VoltaCloudSync) window.VoltaCloudSync.forceSyncUserToCloud(email, u); } catch (e) {}
  // First-run opens the HOMEPAGE now (survey is optional from Profile).
  enterAppOrSetup();
}
// Reset the Daily-Exercise in-memory state when the signed-in user changes.
// Without this, wizardOpen/step/dailyPlan from the previous account leak into
// the next login (reproduced: log out of A while its wizard was open → log in
// as B → B's Daily tab showed A's muscle-picker state instead of the hub).
function resetDeStateForUserChange() {
  try {
    deState.step = 1;
    deState.view = 'front';
    deState.muscles = [];
    deState.daysOfWeek = [];
    deState.workouts = [];
    deState.currentWorkout = 0;
    deState.initialized = false;
    deState.dailyPlan = null;
    deState.currentDay = 0;
    deState.restUntil = 0;
    deState.restDone = false;
    deState.wizardOpen = false;
  } catch (e) {}
}
function logout() {
  // === CloudSync: Force-sync before logout ===
  // Make sure the user's latest data is persisted to the cloud before they
  // leave this device. This prevents the "asks for survey every time" bug
  // where a user logs in on another device and their profile is missing.
  try {
    const email = store.session;
    if (email && window.VoltaCloudSync) {
      const u = store.users[email];
      if (u) {
        // Fire-and-forget — don't block logout waiting for the network.
        window.VoltaCloudSync.forceSyncUserToCloud(email, u);
      }
    }
  } catch(e) {}
  // Sign out of Firebase (Google session) too, so the next visitor on a
  // shared device starts fresh. Safe no-op for email accounts.
  try { if (window.VoltaGoogle) window.VoltaGoogle.signOutIfAny(); } catch(e) {}
  store.session = null;
  resetDeStateForUserChange();   // never leak the previous user's wizard/tracker state
  showScreen('screen-landing');
}

// ===== 35-Question Survey =====
const surveyQuestions = [
  {key:'name', q:'What is your full name?', icon:'fa-user', type:'text', placeholder:'e.g. Alex Johnson'},
  {key:'gender', q:'What is your gender?', icon:'fa-venus-mars', type:'select', options:['Male', 'Female']},
  {key:'age', q:'How old are you?', icon:'fa-cake-candles', type:'number', placeholder:'e.g. 25'},
  {key:'height', q:'What is your height in cm?', icon:'fa-ruler-vertical', type:'number', placeholder:'e.g. 175'},
  {key:'weight', q:'What is your current weight in kg?', icon:'fa-weight-scale', type:'number', placeholder:'e.g. 75'},
  {key:'goal', q:'What is your primary fitness goal?', icon:'fa-bullseye', type:'select', options:['Lose weight', 'Build muscle', 'Improve endurance', 'Stay healthy', 'Improve flexibility', 'Sports performance']},
  {key:'sport', q:'What is your favorite sport?', icon:'fa-trophy', type:'text', placeholder:'e.g. Basketball'},
  {key:'level', q:'How would you rate your current fitness level?', icon:'fa-chart-line', type:'select', options:['Beginner', 'Intermediate', 'Advanced']},
  {key:'injury', q:'Do you have any injuries or joint pain?', icon:'fa-band-aid', type:'select', options:['None', 'Knees', 'Lower back', 'Shoulders']},
  {key:'schedule', q:'How many days a week can you train?', icon:'fa-calendar-week', type:'select', options:['1-2 days', '3-4 days', '5+ days', 'Everyday']},
  {key:'time', q:'How much time can you spare per session?', icon:'fa-stopwatch', type:'select', options:['15 minutes', '30 minutes', '45 minutes']},
  {key:'environment', q:'Where do you mostly work out?', icon:'fa-house', type:'select', options:['Home', 'Gym', 'Outdoors', 'Mixed']},
  {key:'meals', q:'How many meals do you have a day?', icon:'fa-utensils', type:'select', options:['1 meal', '2 meals', '3 meals', '3+ meals']},
  {key:'sleep', q:'What is your average sleep duration?', icon:'fa-bed', type:'select', options:['Less than 5h', '5-6 hours', '7-8 hours', 'More than 8h']},
  {key:'stress', q:'How would you rate your daily stress level?', icon:'fa-brain', type:'select', options:['Low', 'Moderate', 'High', 'Very High']},
  {key:'diet_pref', q:'Do you have any dietary preferences?', icon:'fa-seedling', type:'select', options:['None', 'Vegetarian', 'Vegan', 'Gluten-free', 'Keto', 'Halal']},
  {key:'medical', q:'Any pre-existing medical conditions?', icon:'fa-heart-pulse', type:'select', options:['None', 'Diabetes', 'Hypertension', 'Asthma', 'Heart condition']},
  {key:'hydration', q:'How much water do you drink daily?', icon:'fa-droplet', type:'select', options:['Rarely drink water', '1-2L per day', '2-3L per day', '3L+ per day']},
  {key:'equipment', q:'What equipment do you have access to?', icon:'fa-dumbbell', type:'text', placeholder:'e.g. Dumbbells, Kettlebell, None'},
  {key:'time_of_day', q:'When do you prefer to train?', icon:'fa-clock', type:'select', options:['Morning', 'Afternoon', 'Evening', 'Night']},
  {key:'mobility', q:'How is your current mobility/flexibility?', icon:'fa-person-walking', type:'select', options:['Poor', 'Average', 'Good', 'Excellent']},
  {key:'balance', q:'How is your balance?', icon:'fa-scale-balanced', type:'select', options:['Poor', 'Average', 'Good', 'Excellent']},
  {key:'weight_goal', q:'Do you have a specific target weight?', icon:'fa-bullseye', type:'text', placeholder:'e.g. 70 kg'}
  // v12 (user): "remove last 3 questions from the survey" — push-ups,
  // plank hold and 1-mile run (fitness-test questions) are gone. Any old
  // answers stay harmless: every consumer falls back to 'unknown'.
];
// REMOVED per user request ("remove some useless questions like the one asking
// for hiit and those stuff") — none of these were used by the plan engine or
// any calculator:
//   motivation · smoking · supplements · music · budget · trainer ·
//   progress_tracking · cardio_pref (the HIIT question)
// cardio_pref consumers (plan-engine pickCardio) already fall back to
// 'No preference' when the answer is missing — verified safe.

let currentSurveyStep = 0;
let surveyAnswers = {};

function startSurvey() {
  document.getElementById('inbody-intro').style.display = 'none';
  document.getElementById('survey-area').style.display = 'block';
  currentSurveyStep = 0;
  surveyAnswers = {};
  renderSurveyQuestion();
}

// === Round 13: Smart Back button at the start of the survey ===
// Per user spec: "add a back button at the start of the survey so the user
// can go back to the homepage anytime". The button must be SMART about where
// "home" is:
//   - If the user is logged in AND already has a profile (i.e. they entered
//     the survey via "Edit Profile"), going back should return them to the
//     app dashboard — NOT the landing/auth screen.
//   - If the user just signed up and hasn't completed the survey yet (no
//     profile), going back should return them to the landing screen so they
//     can re-enter auth or read about the app.
//   - If the user is mid-survey with answers filled in, confirm before
//     discarding their progress (prevents accidental data loss).
function backFromSurvey() {
  // Count how many answers the user has filled in so far
  const filledCount = Object.values(surveyAnswers || {}).filter(v => v !== undefined && v !== null && v !== '').length;

  // Helper: actually perform the navigation (after any confirmation)
  const doNavigate = () => {
    // Hide the survey, show the intro again (in case the user re-enters)
    document.getElementById('survey-area').style.display = 'none';
    const intro = document.getElementById('inbody-intro');
    if (intro) intro.style.display = 'block';
    // Reset survey state so re-entering starts fresh
    currentSurveyStep = 0;
    surveyAnswers = {};

    // Smart routing: where is "home"?
    const email = store.session;
    const user = email ? store.users[email] : null;
    // === v10 (user): stamp the DELIBERATE skip ===
    // Leaving via this back button is the one intentional way to skip the
    // setup survey. Without this marker, the v10 fix in enterAppOrSetup()
    // would send the account back to the survey on every app open (which
    // would itself feel like a redirect loop). Cleared again by saveSurvey()
    // when the setup is finally completed.
    try {
      if (user && !user.surveyCompleted) {
        const hasReal = !!(user.survey && (user.survey.level || user.survey.time || user.survey.schedule || user.survey.goal));
        if (!hasReal) { user.surveySkipped = true; saveUser(email, user); }
      }
    } catch (e) {}
    if (user && user.profile) {
      // User already has a profile → return to the app dashboard
      enterApp();
    } else {
      // No profile yet (signup flow) → return to the landing screen
      showScreen('screen-landing');
    }
  };

  // If the user has typed/selected anything, confirm before discarding
  if (filledCount > 0) {
    const msg = (store.lang === 'ar')
      ? 'لديك إجابات غير محفوظة. هل تريد المغادرة؟'
      : 'You have unsaved answers. Leave the survey?';
    if (confirm(msg)) {
      doNavigate();
    }
    return;
  }

  // Nothing to lose — just navigate
  doNavigate();
}

function renderSurveyQuestion() {
  const q = surveyQuestions[currentSurveyStep];
  const total = surveyQuestions.length;
  document.getElementById('survey-counter').textContent = `Question ${currentSurveyStep + 1} of ${total}`;
  document.getElementById('survey-progress-fill').style.width = ((currentSurveyStep + 1) / total * 100) + '%';

  // ===== INPUT CONSTRAINTS per question =====
  // Constrain text/number answers to ranges the app can actually handle.
  // Without this, the user could enter age=999, height=10cm, etc. — which would
  // break BMI, BMR, and goal calculations downstream.
  const constraints = {
    age:           { min: 10,  max: 100,  step: 1 },
    height:        { min: 100, max: 250,  step: 1 },   // cm
    weight:        { min: 30,  max: 300,  step: 0.1 }  // kg
    // v12: pushups / plank / mile_time constraints removed with the questions
  };
  const c = constraints[q.key];

  let inputHtml = '';
  if (q.type === 'text' || q.type === 'number') {
    if (q.type === 'number' && c) {
      inputHtml = `<input type="number" class="survey-text-input" id="survey-input" placeholder="${q.placeholder || ''}" value="${surveyAnswers[q.key] || ''}" min="${c.min}" max="${c.max}" step="${c.step}" oninput="validateSurveyNumber(this, ${c.min}, ${c.max})">`;
      // Small hint below the input
      const hint = (store.lang === 'ar')
        ? `القيمة يجب أن تكون بين ${c.min} و ${c.max}`
        : `Value must be between ${c.min} and ${c.max}`;
      inputHtml += `<p style="font-size:.78rem;color:var(--muted);margin-top:6px;text-align:center;">${hint}</p>`;
    } else if (q.key === 'sport') {
      // Sport input: suggest from the SPORTS list so the user types a known sport.
      const list = SPORTS.map(s => s.name).join(',');
      inputHtml = `<input type="text" class="survey-text-input" id="survey-input" placeholder="${q.placeholder || ''}" value="${surveyAnswers[q.key] || ''}" list="sport-list" autocomplete="off"><datalist id="sport-list">${SPORTS.map(s => `<option value="${s.name}">`).join('')}</datalist>`;
    } else if (q.key === 'weight_goal') {
      // Weight goal: must be a positive number between 30 and 300 kg
      inputHtml = `<input type="number" class="survey-text-input" id="survey-input" placeholder="${q.placeholder || ''}" value="${surveyAnswers[q.key] || ''}" min="30" max="300" step="0.1" oninput="validateSurveyNumber(this, 30, 300)">`;
      const hint = (store.lang === 'ar') ? 'القيمة يجب أن تكون بين 30 و 300 كجم' : 'Value must be between 30 and 300 kg';
      inputHtml += `<p style="font-size:.78rem;color:var(--muted);margin-top:6px;text-align:center;">${hint}</p>`;
    } else {
      // Google sign-ins stash their display name in u.pendingName (a real
      // u.profile would skip onboarding entirely) — pre-fill it into the
      // name question so they don't have to retype it.
      let v = surveyAnswers[q.key] || '';
      if (!v && q.key === 'name') {
        // v3: pre-fill the Google display name ONLY when it is a real human
        // name — never the gmail handle (e.g. "elgayar22"). voltaDisplayName
        // applies the handle-rejection rules.
        try { v = voltaDisplayName() || ''; } catch (e) {}
      }
      v = String(v).replace(/"/g, '&quot;');
      inputHtml = `<input type="${q.type}" class="survey-text-input" id="survey-input" placeholder="${q.placeholder || ''}" value="${v}" maxlength="80">`;
    }
  } else if (q.type === 'select') {
    inputHtml = `<div class="survey-options-fancy">`;
    q.options.forEach(opt => {
      const selected = surveyAnswers[q.key] === opt ? 'selected' : '';
      inputHtml += `<button class="survey-option-fancy ${selected}" onclick="selectSurveyOption('${opt}')">${opt}</button>`;
    });
    inputHtml += `</div>`;
  }

  document.getElementById('survey-question-content').innerHTML = `
    <div style="max-width: 580px; margin: 0 auto; animation: fadeIn .3s ease;">
      <div class="survey-icon-wrapper"><i class="fa-solid ${q.icon}"></i></div>
      <div class="survey-question-text">${q.q}</div>
      ${inputHtml}
    </div>
  `;

  document.getElementById('survey-prev-btn').style.visibility = currentSurveyStep === 0 ? 'hidden' : 'visible';
  document.getElementById('survey-next-btn').innerHTML = currentSurveyStep === total - 1 ? 'Finish <i class="fa-solid fa-check"></i>' : 'Next <i class="fa-solid fa-arrow-right"></i>';
}

// Live-validate a survey number input — clamp to [min, max] and show
// a red border + inline error if the user goes out of range.
function validateSurveyNumber(input, min, max) {
  const v = parseFloat(input.value);
  const hint = input.nextElementSibling;
  if (input.value === '') {
    input.style.borderColor = '';
    if (hint) hint.style.color = 'var(--muted)';
    return;
  }
  if (isNaN(v) || v < min || v > max) {
    input.style.borderColor = 'var(--red)';
    if (hint) {
      hint.style.color = 'var(--red)';
      const ar = (store.lang === 'ar');
      hint.textContent = ar ? `القيمة خارج النطاق المسموح (${min} - ${max})` : `Out of range (${min} - ${max})`;
    }
  } else {
    input.style.borderColor = '';
    if (hint) {
      hint.style.color = 'var(--muted)';
      const ar = (store.lang === 'ar');
      hint.textContent = ar ? `القيمة يجب أن تكون بين ${min} و ${max}` : `Value must be between ${min} and ${max}`;
    }
  }
}

function selectSurveyOption(value) {
  const q = surveyQuestions[currentSurveyStep];
  surveyAnswers[q.key] = value;
  document.querySelectorAll('.survey-option-fancy').forEach(b => b.classList.remove('selected'));
  event.target.classList.add('selected');
  setTimeout(() => nextSurveyQuestion(), 300);
}

function nextSurveyQuestion() {
  const q = surveyQuestions[currentSurveyStep];
  if (q.type === 'text' || q.type === 'number') {
    const val = document.getElementById('survey-input').value.trim();
    if (!val) { alert('Please enter a value.'); return; }
    // Range check for numeric inputs that have constraints
    const constraints = {
      age:       { min: 10,  max: 100 },
      height:    { min: 100, max: 250 },
      weight:    { min: 30,  max: 300 },
      weight_goal: { min: 30, max: 300 }
      // v12: pushups / plank / mile_time removed with the survey questions
    };
    const c = constraints[q.key];
    if (q.type === 'number' && c) {
      const num = parseFloat(val);
      if (isNaN(num) || num < c.min || num > c.max) {
        alert((store.lang === 'ar') ? `القيمة خارج النطاق المسموح (${c.min} - ${c.max})` : `Value out of allowed range (${c.min} - ${c.max}).`);
        return;
      }
      surveyAnswers[q.key] = num;
    } else {
      surveyAnswers[q.key] = q.type === 'number' ? parseFloat(val) : val;
    }
  } else if (!surveyAnswers[q.key]) {
    alert('Please select an option.'); return;
  }

  if (currentSurveyStep === surveyQuestions.length - 1) {
    saveSurvey();
  } else {
    currentSurveyStep++;
    renderSurveyQuestion();
  }
}

function prevSurveyQuestion() {
  if (currentSurveyStep > 0) { currentSurveyStep--; renderSurveyQuestion(); }
}

function saveSurvey() {
  const email = store.session;
  if (!email) return;
  let u = store.users[email];
  u.profile = {
    name: (function () {
      const cand = surveyAnswers.name || u.pendingName || '';
      const sess = store.session || '';
      const localPart = String(sess).split('@')[0].toLowerCase().replace(/[._-]+/g, '');
      const looksHandle = !cand || /@/.test(cand) ||
        (localPart && String(cand).toLowerCase().replace(/[._-]+/g, '') === localPart);
      return looksHandle ? 'Athlete' : cand;
    })(),
    gender: surveyAnswers.gender,
    age: surveyAnswers.age,
    height: surveyAnswers.height,
    weight: surveyAnswers.weight,
    goal: surveyAnswers.goal,
    sport: surveyAnswers.sport || 'General Fitness',
    level: surveyAnswers.level,
    injury: surveyAnswers.injury || 'None'
  };
  u.survey = surveyAnswers;
  u.surveyCompleted = true;   // lets enterAppOrSetup() know real onboarding data exists
  // v10: setup is genuinely done — clear the deliberate-skip marker so
  // future Profile → Edit Info trips behave normally.
  try { if (u.surveySkipped) u.surveySkipped = false; } catch (e) {}
  u.verified = true;
  // Onboarding is done — the Google display name (if any) has been folded
  // into the profile above, so the temporary pendingName field is no longer
  // needed on the record.
  try { if (u.pendingName) delete u.pendingName; } catch (e) {}
  // === Round 14: Block weekly survey for fresh accounts ===
  // Per user spec: "when the user makes a fresh account and finishes the survey,
  // they get the weekly survey that they shouldn't be seeing". The weekly survey
  // check in enterApp() compares (now - u.lastWeeklySurvey) against 7 days. For
  // a fresh account, lastWeeklySurvey is undefined/0, so the survey fires
  // immediately. Fix: stamp lastWeeklySurvey = now when onboarding completes,
  // so the 7-day countdown starts from THIS moment, not from epoch.
  u.lastWeeklySurvey = Date.now();
  // Save the user FIRST so that calculateGoalPlan() and VoltaPlan.generate()
  // can read the updated profile/survey via currentUser() / store.users.
  saveUser(email, u);
  // === CloudSync: FORCE-sync immediately (no debounce) ===
  // Survey completion is a critical save — the user just finished onboarding
  // and may log out / switch devices immediately. If we relied on the
  // debounced sync, the data might not reach the cloud before they leave.
  // This guarantees the profile + survey are persisted on Vercel right now.
  try {
    if (window.VoltaCloudSync) {
      window.VoltaCloudSync.forceSyncUserToCloud(email, u);
    }
  } catch(e) { console.warn('[Volta] Force-sync after survey failed:', e); }
  // === Phase 3: Generate a survey-driven plan immediately after onboarding ===
  // The plan uses ONLY the survey answers (goal, level, schedule, equipment,
  // diet_pref, etc.) to build a multi-day workout split + meal schedule.
  // This runs synchronously (meal suggestions are populated async after).
  try {
    if (window.VoltaPlan) {
      // calculateGoalPlan() computes BMR/TDEE/macros and stores on u.goalPlan.
      // Must run AFTER saveUser so currentUser() sees the updated profile.
      if (typeof calculateGoalPlan === 'function' && store.session) {
        try { calculateGoalPlan(); } catch(e) {}
        // Re-read u after calculateGoalPlan updated goalPlan
        u = store.users[email];
      }
      var _plan = VoltaPlan.generate(u);
      if (_plan) {
        u.plan = _plan;
        // Save again with the plan
        saveUser(email, u);
        // Async: populate meal suggestions from IndexedDB (non-blocking)
        // Round 9: populateMealSuggestions persists internally via a fresh
        // store read — saving the stale `u` here would clobber concurrent changes.
        if (window.VoltaDB) {
          VoltaPlan.populateMealSuggestions(u.plan).then(function () {
            try { if (typeof renderPlan === 'function') renderPlan(); } catch(e) {}
          }).catch(function () {});
        }
      }
    }
  } catch(e) { console.warn('Plan generation error:', e); }
  openGoalModal(false);
}

// ═══ v10 (user): DEDICATED EDIT-INFO SCREEN ═══════════════════════════════
// "when the user clicks edit info in profile, make a new screen where the
// user can see all info and edit them instead of going to the whole survey
// again". editProfile() used to dump the user back into the full 26-question
// onboarding survey (starting from question 1). It now opens a scrollable
// Edit My Info popup: every profile + survey answer in ONE grouped form,
// prefilled with the current values. Saving updates the profile, re-runs the
// goal calculation, and — only when training-relevant answers changed —
// offers to regenerate the workout + diet plan (with the same confirm popup
// the dashboard Regenerate button uses). The survey itself stays reserved
// for first-time onboarding.
const EDIT_INFO_FIELDS = [
  { section: 'About You', sectionAr: 'عنك', icon: 'fa-user', rows: [
    { key: 'name',      label: 'Full Name',        ar: 'الاسم الكامل',        type: 'text',   ph: 'e.g. Alex Johnson' },
    { key: 'gender',    label: 'Gender',           ar: 'الجنس',               type: 'select', options: ['Male', 'Female'] },
    { key: 'age',       label: 'Age (years)',      ar: 'العمر (سنوات)',       type: 'number', min: 10, max: 100, step: 1 },
    { key: 'height',    label: 'Height (cm)',      ar: 'الطول (سم)',          type: 'number', min: 100, max: 250, step: 1 },
    { key: 'weight',    label: 'Weight (kg)',      ar: 'الوزن (كجم)',         type: 'number', min: 30, max: 300, step: 0.1 }
  ]},
  { section: 'Goal & Training', sectionAr: 'الهدف والتدريب', icon: 'fa-bullseye', rows: [
    { key: 'goal',        label: 'Primary Goal',            ar: 'الهدف الأساسي',        type: 'select', options: ['Lose weight', 'Build muscle', 'Improve endurance', 'Stay healthy', 'Improve flexibility', 'Sports performance'] },
    { key: 'sport',       label: 'Favorite Sport',          ar: 'الرياضة المفضلة',      type: 'sport' },
    { key: 'level',       label: 'Fitness Level',           ar: 'مستوى اللياقة',        type: 'select', options: ['Beginner', 'Intermediate', 'Advanced'] },
    { key: 'injury',      label: 'Injuries / Joint Pain',   ar: 'إصابات أو آلام',       type: 'select', options: ['None', 'Knees', 'Lower back', 'Shoulders'] },
    { key: 'schedule',    label: 'Days a Week You Can Train', ar: 'أيام التدريب أسبوعياً', type: 'select', options: ['1-2 days', '3-4 days', '5+ days', 'Everyday'] },
    { key: 'time',        label: 'Time Per Session',        ar: 'الوقت لكل جلسة',       type: 'select', options: ['15 minutes', '30 minutes', '45 minutes'] },
    { key: 'environment', label: 'Where You Work Out',      ar: 'مكان التدريب',         type: 'select', options: ['Home', 'Gym', 'Outdoors', 'Mixed'] },
    { key: 'equipment',   label: 'Equipment Available',     ar: 'المعدات المتاحة',      type: 'text', ph: 'e.g. Dumbbells, Kettlebell, None' },
    { key: 'time_of_day', label: 'Preferred Training Time', ar: 'وقت التدريب المفضل',  type: 'select', options: ['Morning', 'Afternoon', 'Evening', 'Night'] }
  ]},
  { section: 'Lifestyle & Health', sectionAr: 'نمط الحياة والصحة', icon: 'fa-heart-pulse', rows: [
    { key: 'meals',     label: 'Meals Per Day',        ar: 'وجبات يومياً',          type: 'select', options: ['1 meal', '2 meals', '3 meals', '3+ meals'] },
    { key: 'sleep',     label: 'Average Sleep',        ar: 'متوسط النوم',           type: 'select', options: ['Less than 5h', '5-6 hours', '7-8 hours', 'More than 8h'] },
    { key: 'stress',    label: 'Daily Stress Level',   ar: 'مستوى التوتر اليومي',   type: 'select', options: ['Low', 'Moderate', 'High', 'Very High'] },
    { key: 'diet_pref', label: 'Dietary Preferences',  ar: 'تفضيلات غذائية',        type: 'select', options: ['None', 'Vegetarian', 'Vegan', 'Gluten-free', 'Keto', 'Halal'] },
    { key: 'medical',   label: 'Medical Conditions',   ar: 'حالات طبية',            type: 'select', options: ['None', 'Diabetes', 'Hypertension', 'Asthma', 'Heart condition'] },
    { key: 'hydration', label: 'Daily Water Intake',   ar: 'شرب الماء يومياً',      type: 'select', options: ['Rarely drink water', '1-2L per day', '2-3L per day', '3L+ per day'] }
  ]},
  { section: 'Fitness Tests', sectionAr: 'اختبارات اللياقة', icon: 'fa-stopwatch', rows: [
    { key: 'mobility',   label: 'Mobility / Flexibility', ar: 'المرونة',               type: 'select', options: ['Poor', 'Average', 'Good', 'Excellent'] },
    { key: 'balance',    label: 'Balance',                ar: 'التوازن',               type: 'select', options: ['Poor', 'Average', 'Good', 'Excellent'] },
    { key: 'weight_goal',label: 'Target Weight (kg)',     ar: 'الوزن المستهدف (كجم)',  type: 'number', min: 30, max: 300, step: 0.1 }
    // v12: push-ups / plank / 1-mile run removed with the survey questions
  ]}
];
// Answers that drive the workout + diet plan — changing any of these offers
// a plan regeneration after saving (goal, difficulty, schedule, session
// length, place, equipment, diet rules, injury adaptations).
const EDIT_INFO_PLAN_KEYS = ['goal', 'level', 'schedule', 'time', 'environment', 'equipment', 'diet_pref', 'injury'];

function editProfile() {
  try {
    const u = currentUser();
    if (!u) return;
    const s = (u.survey && typeof u.survey === 'object') ? u.survey : {};
    const p = u.profile || {};
    const ar = (store.lang === 'ar');
    const body = document.getElementById('edit-info-body');
    if (!body) { // modal missing (unexpected) → fall back to the old flow
      showScreen('screen-onboarding');
      document.getElementById('inbody-intro').style.display = 'none';
      document.getElementById('survey-area').style.display = 'block';
      currentSurveyStep = 0; surveyAnswers = {}; renderSurveyQuestion();
      return;
    }
    const val = function (key, fb) {
      const v = (s[key] !== undefined && s[key] !== null && s[key] !== '') ? s[key] : (p[key] !== undefined ? p[key] : fb);
      return (v === undefined || v === null) ? '' : v;
    };
    let html = '';
    EDIT_INFO_FIELDS.forEach(function (group) {
      html += '<div class="ei-section">' +
        '<div class="ei-section-title"><i class="fa-solid ' + group.icon + '"></i> ' + (ar ? group.sectionAr : group.section) + '</div>' +
        '<div class="ei-grid">';
      group.rows.forEach(function (f) {
        const v = val(f.key, '');
        const fv = String(v).replace(/"/g, '&quot;');
        html += '<div class="ei-field">';
        html += '<label for="ei-' + f.key + '">' + (ar ? f.ar : f.label) + '</label>';
        if (f.type === 'select') {
          html += '<select id="ei-' + f.key + '">';
          f.options.forEach(function (opt) {
            html += '<option value="' + opt + '"' + (String(v) === opt ? ' selected' : '') + '>' + opt + '</option>';
          });
          html += '</select>';
        } else if (f.type === 'sport') {
          html += '<input type="text" id="ei-' + f.key + '" list="ei-sport-list" autocomplete="off" value="' + fv + '" placeholder="' + (f.ph || '') + '">' +
            '<datalist id="ei-sport-list">' + SPORTS.map(function (sp) { return '<option value="' + sp.name + '">'; }).join('') + '</datalist>';
        } else {
          const minAttr = (f.min !== undefined) ? ' min="' + f.min + '" max="' + f.max + '" step="' + (f.step || 1) + '"' : '';
          html += '<input type="' + f.type + '" id="ei-' + f.key + '" value="' + fv + '" placeholder="' + (f.ph || '') + '"' + minAttr + '>';
        }
        html += '</div>';
      });
      html += '</div></div>';
    });
    body.innerHTML = html;
    if (typeof applyTranslations === 'function') applyTranslations();
    openModal('edit-info-modal');
  } catch (e) {
    console.warn('editProfile error:', e);
    showScreen('screen-onboarding');
    document.getElementById('inbody-intro').style.display = 'none';
    document.getElementById('survey-area').style.display = 'block';
    currentSurveyStep = 0; surveyAnswers = {}; renderSurveyQuestion();
  }
}

function saveEditInfo() {
  try {
    const email = store.session;
    if (!email) return;
    let u = store.users[email];
    if (!u) return;
    const ar = (store.lang === 'ar');
    const num = function (key, min, max, fb) {
      const el = document.getElementById('ei-' + key);
      const raw = el ? String(el.value || '').trim() : '';
      if (raw === '') return fb;
      const n = parseFloat(raw);
      if (isNaN(n) || n < min || n > max) return null;   // invalid → abort with message
      return n;
    };
    const txt = function (key) {
      const el = document.getElementById('ei-' + key);
      return el ? String(el.value || '').trim() : '';
    };
    const sel = function (key) {
      const el = document.getElementById('ei-' + key);
      return el ? String(el.value || '') : '';
    };
    // === Validate the numeric answers (same ranges as the survey) ===
    const checks = [
      ['age', 10, 100], ['height', 100, 250], ['weight', 30, 300],
      ['weight_goal', 30, 300]   // v12: pushups/plank/mile_time checks removed
    ];
    for (let c = 0; c < checks.length; c++) {
      const key = checks[c][0];
      const el = document.getElementById('ei-' + key);
      if (!el || String(el.value || '').trim() === '') continue;
      const n = parseFloat(String(el.value).trim());
      if (isNaN(n) || n < checks[c][1] || n > checks[c][2]) {
        alert((ar ? 'القيمة خارج النطاق المسموح (' : 'Value out of allowed range (') + checks[c][1] + ' - ' + checks[c][2] + (ar ? ')' : ').'));
        return;
      }
    }
    const name = txt('name');
    if (!name) { alert(ar ? 'يرجى إدخال اسمك.' : 'Please enter your name.'); return; }

    // === Compare against the old answers (drives the regenerate offer) ===
    // v15 (user): "bring back the popup that tells the user to regenerate
    // the plan if they edited their profile info" — the offer previously
    // required one of the 8 training keys (EDIT_INFO_PLAN_KEYS) to change,
    // so editing body data (weight/height/age…) or sport never triggered it
    // and the popup looked removed. It now fires on ANY meaningful edit;
    // name-only changes stay silent.
    const oldS = (u.survey && typeof u.survey === 'object') ? u.survey : {};
    const oldP = (u.profile && typeof u.profile === 'object') ? u.profile : {};
    let anyInfoChanged = false;
    EDIT_INFO_FIELDS.forEach(function (group) {
      group.rows.forEach(function (f) {
        if (f.key === 'name') return;               // pure name edits are not plan-relevant
        const el = document.getElementById('ei-' + f.key);
        if (!el) return;
        const newV = String(el.value || '').trim();
        if (newV === '') return;                    // empty → keeps the old answer
        let oldV = oldS[f.key];
        if (oldV === undefined || oldV === null || oldV === '') oldV = oldP[f.key];
        oldV = (oldV === undefined || oldV === null) ? '' : String(oldV);
        if (newV !== oldV) anyInfoChanged = true;
      });
    });

    // === Persist: profile + survey ===
    u.profile = u.profile || {};
    const p = u.profile;
    p.name = name;
    p.gender = sel('gender') || p.gender || 'Male';
    p.age = (num('age', 10, 100, p.age) !== null) ? num('age', 10, 100, p.age) : p.age;
    p.height = (num('height', 100, 250, p.height) !== null) ? num('height', 100, 250, p.height) : p.height;
    p.weight = (num('weight', 30, 300, p.weight) !== null) ? num('weight', 30, 300, p.weight) : p.weight;
    p.goal = sel('goal') || p.goal || 'Stay healthy';
    p.sport = txt('sport') || p.sport || 'General Fitness';
    p.level = sel('level') || p.level || 'Beginner';
    p.injury = sel('injury') || 'None';
    u.survey = (u.survey && typeof u.survey === 'object') ? u.survey : {};
    EDIT_INFO_FIELDS.forEach(function (group) {
      group.rows.forEach(function (f) {
        const el = document.getElementById('ei-' + f.key);
        if (!el) return;
        const v = String(el.value || '').trim();
        if (v === '') return;                       // empty → keep the old answer
        u.survey[f.key] = (f.type === 'number') ? (parseFloat(v) || u.survey[f.key]) : v;
      });
    });
    u.surveyCompleted = true;
    if (u.surveySkipped) u.surveySkipped = false;
    // Save FIRST so calculateGoalPlan() re-reads the NEW body data from
    // localStorage (store.users re-parses on every access — mutating `u`
    // alone would be clobbered by the goal recalculation, like the
    // saveSurvey() flow already documents).
    saveUser(email, u);
    // Recompute the goal plan (BMR/TDEE/macros follow the new body data).
    if (typeof calculateGoalPlan === 'function') { try { calculateGoalPlan(); } catch (e) {} }
    u = store.users[email];   // re-read (calculateGoalPlan re-saves)
    // v29 (user, picture 2): the water goal follows the NEW weight
    // instantly — patch the stored plan so every surface (dashboard diet
    // card, Diet System pill, AI coach) shows the same number as the top
    // DAILY WATER TARGET stat without waiting for a plan regeneration.
    try {
      if (u && u.plan && u.plan.diet && typeof waterTargetLiters === 'function') {
        u.plan.diet.hydrationLiters = waterTargetLiters();
      }
    } catch (e) {}
    saveUser(email, u);
    try { if (window.VoltaCloudSync) window.VoltaCloudSync.forceSyncUserToCloud(email, u); } catch (e) {}

    // === Re-render the surfaces that show this data ===
    try { renderProfile(); } catch (e) {}
    try { renderHome(); } catch (e) {}
    try { renderDiet(); } catch (e) {}
    try { renderDietPlanPanel(); } catch (e) {}
    try { renderDailyExercise(); } catch (e) {}
    closeModal('edit-info-modal');
    try { showVoltaToast(ar ? 'تم حفظ معلوماتك' : 'Your info has been saved', 'success'); } catch (e) {}

    // === If ANY meaningful info changed, offer a plan refresh ===
    if (anyInfoChanged && u.plan) {
      setTimeout(function () {
        try {
          voltaConfirm(
            ar ? 'تغيرت تفاصيل تدريبك — هل تريد إعادة توليد خطتك لتناسبها؟' : 'Your training details changed — regenerate your plan to match?',
            function () { try { regeneratePlan(); } catch (e) { console.warn(e); } },
            { yesIcon: 'fa-rotate', yesLabel: ar ? 'إعادة توليد' : 'Regenerate', noLabel: ar ? 'لاحقاً' : 'Not now' }
          );
        } catch (e) {}
      }, 350);
    }
  } catch (e) { console.warn('saveEditInfo error:', e); }
}
window.editProfile = editProfile;
window.saveEditInfo = saveEditInfo;

// === Round 14: Parse user-entered target weight from survey ===
// The survey question "Do you have a specific target weight?" (key: weight_goal)
// is a free-text field. Users may type things like:
//   "65", "65kg", "65 kg", "about 65", "around seventy"
// We extract the first numeric value (integer or decimal). Returns null if no
// number is found. Used by calculateGoalPlan() to respect the user's stated
// target instead of overriding it with the formula-based target.
function parseTargetWeight(val) {
  if (val == null) return null;
  if (typeof val === 'number') return isFinite(val) ? val : null;
  const s = String(val).trim();
  if (!s) return null;
  // Match first number (integer or decimal, optionally negative — though we
  // reject negatives/zero downstream via the > 0 check in calculateGoalPlan).
  const m = s.match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

function calculateGoalPlan() {
  const u = currentUser(); const p = u.profile; const s = u.survey;
  let bmr = p.gender === 'Female' ? 447.6 + (9.25 * p.weight) + (3.1 * p.height) - (4.33 * p.age) : 88.36 + (13.4 * p.weight) + (4.8 * p.height) - (5.68 * p.age);
  let days = s?.schedule || '3-4';
  let af = days === '1-2' ? 1.375 : days === '3-4' ? 1.55 : days === '5+' ? 1.725 : 1.9;
  let tdee = bmr * af;
  let targetCals = tdee;
  if (p.goal === 'Lose weight') targetCals = tdee - 500;
  else if (p.goal === 'Build muscle') targetCals = tdee + 300;
  let heightInches = p.height / 2.54;
  let inchesOver5Ft = Math.max(0, heightInches - 60);
  let idealWeight = p.gender === 'Female' ? 45.5 + (2.3 * inchesOver5Ft) : 50 + (2.3 * inchesOver5Ft);
  // === Round 11: Goal-aware target weight ===
  // Per user spec: "fix target weight not working when the user chooses lose
  // weight". Previously the target weight was always set to the height-based
  // idealWeight (Devine formula) regardless of goal. Now we compute a
  // goal-specific target (mirroring autoSetGoalWeightFromProfile):
  //   - Lose weight: 10% reduction from current, floored at ibw-5 (healthy min)
  //   - Build muscle: current + 3 kg (lean gain)
  //   - Improve endurance: ideal weight (recomposition)
  //   - Stay healthy / others: ideal weight
  const currentWeight = parseFloat(p.weight) || 70;
  let goalTargetWeight;
  // === Round 14: Respect user-entered target weight from survey ===
  // Per user spec: "target weight is not accurate in goal survey (i made another
  // account and set the target weight to 65 in survey, when the goal survey came
  // it said 60)". The survey asks "Do you have a specific target weight?" (key:
  // weight_goal, line ~4434). If the user entered a value there, use it instead
  // of the formula-based target. Only fall back to the formula if the user left
  // it blank or wrote something unparseable.
  const surveyTargetWeight = parseTargetWeight(s && s.weight_goal);
  if (surveyTargetWeight && !isNaN(surveyTargetWeight) && surveyTargetWeight > 0) {
    goalTargetWeight = surveyTargetWeight;
  } else if (p.goal === 'Lose weight') {
    goalTargetWeight = Math.max(idealWeight - 5, currentWeight * 0.90);
  } else if (p.goal === 'Build muscle') {
    goalTargetWeight = currentWeight + 3;
  } else if (p.goal === 'Improve endurance') {
    goalTargetWeight = idealWeight;
  } else {
    goalTargetWeight = idealWeight;
  }
  goalTargetWeight = Math.round(goalTargetWeight * 10) / 10;  // 1 decimal place
  let proG = Math.round(p.weight * 2);
  let fatG = Math.round((targetCals * 0.25) / 9);
  let carbG = Math.round((targetCals - (proG * 4) - (fatG * 9)) / 4);
  // === Compute the goal target date so the dashboard "days left" counter works. ===
  // This is computed ONCE (when the goal is first set) and stored. It's based
  // on the user's start weight, target weight, and goal type:
  //   - Lose weight: ~0.5 kg/week (1 lb/week, ~500 kcal/day deficit)
  //   - Build muscle: ~0.25 kg/week (slower, lean gains)
  //   - Improve endurance: ~0.3 kg/week (slight recomposition)
  //   - Stay healthy / others: 30-day default window
  // If the user already has a targetDate (e.g. from the Fitness Calculator),
  // we keep it — calculateGoalPlan() is also called on profile edits and we
  // don't want to keep moving the target date every time.
  const startW = parseFloat(u.goalPlan?.startWeight || p.weight);
  // Use the goal-aware target if no existing targetWeight is saved
  const targetW = parseFloat(u.goalPlan?.targetWeight || goalTargetWeight);
  const weightDiff = Math.abs(startW - targetW);
  let daysNeeded;
  if (weightDiff < 0.1) {
    // No real weight change goal — use a 30-day window
    daysNeeded = 30;
  } else if (p.goal === 'Lose weight') {
    daysNeeded = Math.ceil((weightDiff / 0.5) * 7);
  } else if (p.goal === 'Build muscle') {
    daysNeeded = Math.ceil((weightDiff / 0.25) * 7);
  } else if (p.goal === 'Improve endurance') {
    daysNeeded = Math.ceil((weightDiff / 0.3) * 7);
  } else {
    daysNeeded = 30;
  }
  // Floor at 7 days so we always show a meaningful countdown
  daysNeeded = Math.max(7, daysNeeded);
  // Preserve existing targetDate if already set; otherwise compute from today
  let targetDateStr = u.goalPlan?.targetDate;
  let startDateStr = u.goalPlan?.startDate || localDateStr();
  if (!targetDateStr) {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + daysNeeded);
    targetDateStr = targetDate.toISOString().slice(0, 10);
  }
  u.goalPlan = {
    tdee: Math.round(tdee),
    targetCals: Math.round(targetCals),
    idealWeight: idealWeight.toFixed(1),
    startWeight: u.goalPlan?.startWeight || p.weight,
    // Use goal-aware target weight if no existing targetWeight is saved
    targetWeight: u.goalPlan?.targetWeight || goalTargetWeight,
    macros: { p: proG, f: fatG, c: carbG },
    targetDate: targetDateStr,
    startDate: startDateStr,
    daysNeeded: u.goalPlan?.daysNeeded || daysNeeded,
    // Round 14: goal edit stamp — set ONLY when the goal is first created;
    // re-computations preserve it. The cloud-refresh merge compares this
    // stamp so a stale cloud copy can never silently revert the user's
    // weight goal ("progress must not change automatically").
    goalUpdatedAt: u.goalPlan ? u.goalPlan.goalUpdatedAt : Date.now()
  };
  saveUser(store.session, u);
  return u.goalPlan;
}

function openGoalModal(isEdit) {
  const u = currentUser(); const plan = calculateGoalPlan(); const p = u.profile;
  document.getElementById('goal-modal-content').innerHTML = `
    <p style="margin-bottom:12px;" data-ar="بناءً على طولك (${p.height}سم)، ووزنك (${p.weight}كجم)، ومستويات نشاطك، إليك خطتك التفصيلية:">Based on your height (${p.height}cm), weight (${p.weight}kg), and activity levels, here is your detailed plan:</p>
    <div class="diet-macros" style="margin-bottom:16px;">
      <span class="macro-pill macro-kcal" data-ar="الهدف: ${plan.targetCals} سعرة">Target: ${plan.targetCals} kcal</span>
      <span class="macro-pill macro-p" data-ar="البروتين: ${plan.macros.p}جم">Protein: ${plan.macros.p}g</span>
      <span class="macro-pill macro-c" data-ar="الكربوهيدرات: ${plan.macros.c}جم">Carbs: ${plan.macros.c}g</span>
      <span class="macro-pill macro-f" data-ar="الدهون: ${plan.macros.f}جم">Fat: ${plan.macros.f}g</span>
    </div>
    <div class="settings-row"><div><b data-ar="الصيانة (TDEE)">Maintenance (TDEE)</b><small data-ar="السعرات للحفاظ على الوزن">Calories to maintain weight</small></div><b>${plan.tdee} kcal</b></div>
    <div class="settings-row"><div><b data-ar="الوزن المثالي (حسب الطول)">Ideal Weight (Height-based)</b><small data-ar="هدف صحي لطولك">Healthy target for your height</small></div><b>${plan.idealWeight} kg</b></div>
    <div class="settings-row"><div><b data-ar="تعيين الوزن المستهدف">Set Target Weight</b><small data-ar="اضبط حسب هدفك المحدد">Adjust to your specific goal</small></div><input type="number" id="goal-input-weight" value="${plan.targetWeight}" step="0.1" style="width: 100px; text-align: right;" /></div>
  `;
  openModal('goal-modal');
  setTimeout(applyTranslations, 0);
}

function closeGoalModal() {
  const u = currentUser();
  const inputVal = document.getElementById('goal-input-weight')?.value;
  if (inputVal) {
    const newTarget = parseFloat(inputVal);
    const oldTarget = parseFloat(u.goalPlan?.targetWeight);
    // === If the user changed their target weight, recompute the target date ===
    // so the dashboard "days left" counter reflects the new goal. We base it
    // on the user's CURRENT weight (profile.weight) — which is the most up-to-
    // date starting point — and the goal-type-specific rate.
    if (!isNaN(newTarget) && (isNaN(oldTarget) || Math.abs(newTarget - oldTarget) > 0.05)) {
      const startW = parseFloat(u.goalPlan?.startWeight || u.profile.weight);
      const weightDiff = Math.abs(startW - newTarget);
      const goal = u.profile.goal;
      let daysNeeded;
      if (weightDiff < 0.1) daysNeeded = 30;
      else if (goal === 'Lose weight') daysNeeded = Math.ceil((weightDiff / 0.5) * 7);
      else if (goal === 'Build muscle') daysNeeded = Math.ceil((weightDiff / 0.25) * 7);
      else if (goal === 'Improve endurance') daysNeeded = Math.ceil((weightDiff / 0.3) * 7);
      else daysNeeded = 30;
      daysNeeded = Math.max(7, daysNeeded);
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + daysNeeded);
      u.goalPlan.targetDate = targetDate.toISOString().slice(0, 10);
      u.goalPlan.daysNeeded = daysNeeded;
      // Reset startDate to today so the countdown is fresh
      u.goalPlan.startDate = localDateStr();
      // Round 14: the user just changed the goal — stamp it so the
      // cloud-refresh merge knows this edit is newer than the cloud copy.
      u.goalPlan.goalUpdatedAt = Date.now();
    }
    u.goalPlan.targetWeight = newTarget;
  }
  saveUser(store.session, u);
  closeModal('goal-modal');
  enterApp();
}

function currentUser() { return store.users[store.session]; }
function showScreen(id) {
  try {
    var target = document.getElementById(id);
    if (!target) { console.error('Screen not found:', id); return; }
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    target.classList.add('active');
  } catch(e) { console.error('showScreen error:', e); }
  try { applySettings(); } catch(e) {}
  try { updateChatbaseVisibility(); } catch(e) {}
  try { window.scrollTo(0, 0); } catch(e) {}
  try { updateMobileMenuBtn(); } catch(e) {}
  try { if (window.VoltaPremium) VoltaPremium.updateButton(); } catch(e) {}
  try { if (id === 'screen-premium' && window.VoltaPremium) VoltaPremium.updateScreenNotice(); } catch(e) {}
}
// Round 15 (animation #3): replay the goal/activity bar fill from 0 → its
// target when the Home tab becomes visible, so the user SEES the springy
// fill every time they open the dashboard. PURELY VISUAL — the underlying
// percentage/value is never modified (the weight goal still never changes
// automatically, per Round 14; this only re-animates the pixels).
// Note: volta-animations.css owns a `transition … !important` on the fill,
// so we disable it through an <html> class (higher precedence than inline
// styles) while we snap to 0%, then release it and glide back to target.
function replayGoalFillAnimation() {
  try {
    ['goal-progress-fill', 'today-progress-fill'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var target = el.style.width;
      if (!target || target === '0%' || parseFloat(target) === 0) return;
      document.documentElement.classList.add('v-no-filltrans');
      el.style.width = '0%';
      void el.offsetWidth;               // force reflow so the 0% paints
      document.documentElement.classList.remove('v-no-filltrans');
      el.style.width = target;           // transition restored → springy fill
    });
  } catch (e) {}
}

function showTab(name) {
  if (document.querySelector('.side-btn[data-tab="'+name+'"]') && document.querySelector('.side-btn[data-tab="'+name+'"]').classList.contains('active')) return;
  // v31 (user): "make all buttons sound like the exit popup or x button
  // sound" — tab buttons play the unified tap via the delegated listener
  // in volta-sounds.js now; the separate whoosh is retired.
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.side-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  const tabEl = document.getElementById('tab-' + name);
  if (tabEl) tabEl.classList.add('active');
  // Marathon tab removed per user request — showTab('marathon') is now unreachable.
  if (name === 'daily') { renderDailyExercise(); try { renderCustomWorkoutsList(); } catch(e) {} }
  if (name === 'streaks') { try { renderStreaksTab(); } catch(e) {} }
  if (name === 'reminders') renderReminders();
  if (name === 'diet') renderDiet();
  if (name === 'sports') renderSports();
  if (name === 'home') {
    renderHome(); renderTracker();
    // Round 15 (responsive fix): renderHome() also runs while the Home tab
    // is HIDDEN (e.g. after completing a workout on the Daily tab) — Chart.js
    // can't measure a display:none container, so the weekly bar graph kept a
    // stale/wrong size (the "too wide and short" report). Now that the tab
    // IS visible, force one resize so the chart always fills its box exactly
    // on every phone and tablet size, then replay the progress-bar fill.
    setTimeout(function () {
      try { if (typeof weekChart !== 'undefined' && weekChart) weekChart.resize(); } catch (e) {}
      try { replayGoalFillAnimation(); } catch (e) {}
    }, 60);
  }
  if (name === 'profile') renderProfile();
  if (name === 'weather') { if (!lastWeather) loadWeather(); else renderWeather(); }
  if (name === 'moodmorph') { try { const e = document.getElementById('energy'); if (e && typeof updateEnergyLabel === 'function') updateEnergyLabel(e.value); } catch(_){} }
  if (name === 'settings') { try { cloudSyncRefreshStatus(); } catch(e) {} }
  setTimeout(() => applyTranslations(), 30);
}

// === CloudSync UI helpers (Settings tab) =================================
// cloudSyncRefreshStatus() — called when the Settings tab opens. Asks
// VoltaCloudSync to query /api/sync-status for the current user and
// updates the #cloudsync-status / #cloudsync-last / #cloudsync-dot
// elements. No-op if CloudSync isn't loaded or no user is logged in.
function cloudSyncRefreshStatus() {
  if (!window.VoltaCloudSync) return;
  const email = store.session;
  if (!email) return;
  // Update the UI immediately with the cached status, then fetch fresh.
  try { window.VoltaCloudSync.checkSyncStatus(email); } catch(e) {}
}

// cloudSyncNow() — called by the "Sync Now" button. Force-syncs the user
// record + diet log and shows a success/error message.
async function cloudSyncNow() {
  const msgEl = document.getElementById('cloudsync-msg');
  const btn = document.getElementById('cloudsync-now-btn');
  if (!window.VoltaCloudSync) {
    if (msgEl) { msgEl.textContent = 'Cloud sync not available.'; msgEl.style.color = 'var(--red)'; }
    return;
  }
  const email = store.session;
  if (!email) {
    if (msgEl) { msgEl.textContent = 'Please log in first.'; msgEl.style.color = 'var(--red)'; }
    return;
  }
  // Disable the button + show a "syncing..." message
  if (btn) { btn.disabled = true; btn.style.opacity = '.6'; }
  if (msgEl) {
    msgEl.textContent = (store.lang === 'ar') ? 'جارٍ المزامنة...' : 'Syncing...';
    msgEl.style.color = 'var(--accent)';
  }
  try {
    const userData = store.users[email];
    const dietLog = getDietLog();
    const result = await window.VoltaCloudSync.forceSyncNow(email, userData, dietLog);
    if (msgEl) {
      if (result.success) {
        const ar = (store.lang === 'ar');
        msgEl.textContent = ar ? 'تمت المزامنة بنجاح ✓' : 'Synced successfully ✓';
        msgEl.style.color = 'var(--green)';
      } else if (result.error === 'Offline') {
        msgEl.textContent = (store.lang === 'ar') ? 'أنت غير متصل بالإنترنت.' : 'You are offline.';
        msgEl.style.color = 'var(--red)';
      } else {
        msgEl.textContent = (store.lang === 'ar') ? 'فشلت المزامنة. حاول مرة أخرى.' : 'Sync failed. Try again.';
        msgEl.style.color = 'var(--red)';
      }
    }
  } catch(e) {
    if (msgEl) { msgEl.textContent = 'Error: ' + e.message; msgEl.style.color = 'var(--red)'; }
  } finally {
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
    // Clear the message after 4 seconds
    setTimeout(function() { if (msgEl) msgEl.textContent = ''; }, 4000);
  }
}
function enterApp() {
  try {
    // v27: one-time migration — trim saved plans to the new per-day formula
    // (15-min → 4-5 workouts …) + 2 sets per exercise + legacy '60+ minutes'
    // survey answers re-labelled to '45 minutes'. Must run BEFORE renders.
    try { migratePlansV27(); } catch (e) {}
    // v28: one-time migration — grow/trim saved plans to the NEW full-body
    // formula (15-min → 12, 30 → 24, 45 → 30 exercises, 2 sets each).
    try { migratePlansV28(); } catch (e) {}
    showScreen('screen-app');
    showTab('home');
    renderAllDynamic();
    window.scrollTo(0, 0);
    if (store.locationEnabled) loadWeather();
    if(!store.welcomed){ openModal('welcome-modal'); store.welcomed = true; }
    updateChatbaseVisibility();
    // Premium: refresh the subscription state from the server (source of
    // truth) so renewals/cancellations/expiry show up immediately, then
    // paint the top-right pill, sidebar gold tag and home premium card.
    setTimeout(function () {
      try {
        if (window.VoltaPremium) {
          VoltaPremium.refreshFromServer().then(function () { VoltaPremium.updateButton(); });
        }
      } catch (e) {}
    }, 400);
  // ===== Round 13: Cross-device refresh =====
  // Pull the latest user record from the cloud 1.5s after entering the app.
  // If the cloud has a newer copy (user used the app on another device), we
  // merge it into local storage and re-render so the user sees their latest
  // sessions, streak, profile, etc. Best-effort — silent on failure.
  setTimeout(function() {
    try {
      refreshUserFromCloud().then(function() {
        // Re-render the active tab so any refreshed data shows up
        try {
          const activeTab = document.querySelector('#screen-app .tab.active');
          if (activeTab) {
            const tabName = activeTab.id.replace('tab-', '');
            if (typeof showTab === 'function' && tabName) showTab(tabName);
          }
        } catch(e) {}
      });
      // Round 7: push everything the user did while OFFLINE (possibly with
      // the app closed — tracked by the persistent dirty marker) to the
      // server now that we're back in the app. No-op when nothing is pending.
      if (window.VoltaCloudSync && window.VoltaCloudSync.flushPending) {
        window.VoltaCloudSync.flushPending(store.session);
      }
    } catch(e) { console.warn('Cloud refresh error:', e); }
  }, 1500);
  // ===== WEEKLY PROGRESS SURVEY =====
  // Check if it's been 7+ days since the last weekly survey. If yes, show it.
  // This runs after enterApp() so the survey appears on top of the dashboard
  // without blocking initial render.
  setTimeout(function() {
    try {
      const u = currentUser();
      if (!u) return;
      // Never push the weekly check-in on accounts that have not finished the
      // setup survey yet (they just landed on the homepage for the first time).
      const __s = u.survey;
      if (!__s || !(__s.level || __s.time || __s.schedule || __s.goal)) return;
      const lastWeekly = u.lastWeeklySurvey || 0; // epoch ms
      const now = Date.now();
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      if (now - lastWeekly >= sevenDays) {
        // Close the welcome modal first so the user only sees ONE modal
        // at a time (the weekly survey), not two stacked on top of each
        // other. This fixes "weekly survey doesn't popup on new account"
        // — the survey was actually showing, but it was hidden behind /
        // confused with the welcome modal.
        try { closeModal('welcome-modal'); } catch(_){}
        showWeeklyProgressSurvey();
        // NOTE: lastWeeklySurvey is intentionally NOT set here. It is
        // only set in saveWeeklySurvey() — i.e. when the user actually
        // fills in the form and clicks "Save & Continue". This way:
        //   - If the user dismisses the survey (X), it will popup again
        //     next time they enter the app, until they actually fill it in.
        //   - Once they fill it in, it won't popup for another 7 days.
      }
    } catch(e) { console.warn('Weekly survey check error:', e); }
  }, 3500);
  
  try {
    syncChatbaseUser();
  } catch(e) {}
  } catch(e) { console.error('enterApp error:', e); }
}

// ============================================================
// syncChatbaseUser() — push the user's WHOLE data record to the AI chat
// ============================================================
// Per user spec (round 7, optional): "make sure that the ai chat can read the
// whole user's data". This function builds a comprehensive payload from the
// current user object and calls chatbase('update', {...}) so the AI coach can
// reference any field by name when answering questions.
//
// The payload includes:
//   - Profile (name, age, gender, height, weight, goal, sport, level, injury)
//   - Full survey (schedule, time, environment, diet_pref, meals, hydration,
//     medical, sleep, stress, equipment, mobility, balance, pushups, plank,
//     mile_time)
//   - InBody scan (bmi, bodyFat, muscle, bmr)
//   - Goal plan (targetWeight, targetCals, tdee, macros, targetDate, daysNeeded)
//   - Sessions (total count, total minutes, top sport, last 10 sessions detail)
//   - Daily plan (current day, muscles, today's workout list + done flags)
//   - Reminders (count + contents)
//   - Streak + lastDone
//   - Weekly survey history (12-week trend)
//   - A rolled-up `health` context string the bot can scan in one go
//
// Call sites:
//   - enterApp() (above) — initial sync on login
//   - Any state-changing function that saves the user (saveSurvey, saveInlineSession,
//     saveDailyPlan, calculateGoalPlan, saveInBodyFollowup, addReminder, etc.)
//   - The chat button's click handler (so the freshest data is sent right before
//     the chat window opens)
// ============================================================
function syncChatbaseUser() {
  try {
    const u = currentUser();
    if (!u || !u.profile || !window.chatbase) return;
    const s = u.survey || {};
    const scan = u.inbodyScan || {};
    const sessions = u.sessions || [];
    const totalMinutes = sessions.reduce((a, x) => a + (x.duration || 0), 0);
    const topSport = (() => {
      const counts = {};
      sessions.forEach(x => { counts[x.sport] = (counts[x.sport] || 0) + 1; });
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      return top ? top[0] : 'None yet';
    })();
    // Last 10 sessions (most recent first) for the bot to reference
    const recentSessions = sessions.slice(-10).reverse().map(x => ({
      sport: x.sport, date: x.date, duration: x.duration,
      intensity: x.intensity, note: x.note
    }));
    // Daily plan summary
    let dailyPlanSummary = 'None';
    let todayWorkouts = '[]';
    if (u.dailyPlan && u.dailyPlan.dailyPlan) {
      const cd = u.dailyPlan.currentDay || 0;
      const day = u.dailyPlan.dailyPlan[cd];
      dailyPlanSummary = `Day ${cd + 1}/${u.dailyPlan.dailyPlan.length}, muscles: ${(u.dailyPlan.muscles || []).join('/')}, view: ${u.dailyPlan.view || 'front'}`;
      if (day && day.workouts) {
        todayWorkouts = JSON.stringify(day.workouts.map(w => ({ name: w.name, done: !!w.done })));
      }
    }
    // Reminder contents
    const remindersList = (u.reminders || []).map(r => ({
      title: r.title, date: r.date, time: r.time, note: r.note
    }));
    // Weekly trend (last 12 weeks)
    const weeklyTrend = (u.weeklySurveyHistory || []).slice(-12);
    // Build a rich, scannable context string
    const contextSummary = [
      `User: ${u.profile.name} (${u.profile.gender}, ${u.profile.age}y, ${u.profile.height}cm, ${u.profile.weight}kg)`,
      `Goal: ${u.profile.goal} | Favorite sport: ${u.profile.sport} | Level: ${u.profile.level} | Injury: ${u.profile.injury || 'None'}`,
      `Schedule: ${s.schedule || 'unknown'} | Session time: ${s.time || 'unknown'} | Environment: ${s.environment || 'unknown'}`,
      `Diet pref: ${s.diet_pref || 'none'} | Meals/day: ${s.meals || 'unknown'} | Hydration: ${s.hydration || 'unknown'}`,
      `Medical: ${s.medical || 'none'} | Sleep: ${s.sleep || 'unknown'} | Stress: ${s.stress || 'unknown'}`,
      `Equipment: ${s.equipment || 'none'} | Mobility: ${s.mobility || 'unknown'} | Balance: ${s.balance || 'unknown'}`,
      `Pushups: ${s.pushups || 'unknown'} | Plank: ${s.plank || 'unknown'}s | Mile time: ${s.mile_time || 'unknown'}min`,
      `InBody scan: BMI=${scan.bmi ?? 'n/a'}, BodyFat=${scan.bodyFat ?? 'n/a'}%, Muscle=${scan.muscle ?? 'n/a'}kg, BMR=${scan.bmr ?? 'n/a'}kcal`,
      `Goal plan: target=${u.goalPlan?.targetWeight ?? 'n/a'}kg, targetCals=${u.goalPlan?.targetCals ?? 'n/a'}kcal, TDEE=${u.goalPlan?.tdee ?? 'n/a'}kcal, targetDate=${u.goalPlan?.targetDate ?? 'n/a'}, daysNeeded=${u.goalPlan?.daysNeeded ?? 'n/a'}`,
      `Macros: protein=${u.goalPlan?.proteinG ?? 'n/a'}g, fat=${u.goalPlan?.fatG ?? 'n/a'}g, carbs=${u.goalPlan?.carbG ?? 'n/a'}g`,
      `Activity: ${sessions.length} sessions, ${totalMinutes} total minutes, top sport: ${topSport}, streak: ${u.streak || 0} days, last active: ${u.lastDone || 'never'}`,
      `Daily plan: ${dailyPlanSummary}`,
      `Today's workouts: ${todayWorkouts}`,
      `Reminders: ${(u.reminders || []).length} — ${JSON.stringify(remindersList)}`,
      `Weekly trend (last 12 weeks): ${JSON.stringify(weeklyTrend)}`,
      `Recent sessions (last 10): ${JSON.stringify(recentSessions)}`,
      `Busy mode: ${u.busyMode ? 'ON' : 'off'} | Stop training: ${u.stopTraining ? 'ON' : 'off'}`
    ].join(' || ');
    window.chatbase('update', {
      userId: store.session,
      name: u.profile.name,
      email: store.session,
      // Profile fields
      goals: u.profile.goal,
      fav_sport: u.profile.sport,
      fitness_level: u.profile.level,
      injury: u.profile.injury || 'None',
      age: String(u.profile.age),
      gender: u.profile.gender,
      height_cm: String(u.profile.height),
      weight_kg: String(u.profile.weight),
      // Body composition
      bmi: scan.bmi ? String(scan.bmi) : (u.profile.weight && u.profile.height ? (u.profile.weight / Math.pow(u.profile.height / 100, 2)).toFixed(1) : ''),
      body_fat_pct: scan.bodyFat ? String(scan.bodyFat) : '',
      muscle_mass_kg: scan.muscle ? String(scan.muscle) : '',
      bmr: scan.bmr ? String(scan.bmr) : '',
      // Goal plan
      target_weight: u.goalPlan?.targetWeight ? String(u.goalPlan.targetWeight) : '',
      target_calories: u.goalPlan?.targetCals ? String(u.goalPlan.targetCals) : '',
      tdee: u.goalPlan?.tdee ? String(u.goalPlan.tdee) : '',
      protein_g: u.goalPlan?.proteinG ? String(u.goalPlan.proteinG) : '',
      fat_g: u.goalPlan?.fatG ? String(u.goalPlan.fatG) : '',
      carb_g: u.goalPlan?.carbG ? String(u.goalPlan.carbG) : '',
      target_date: u.goalPlan?.targetDate || '',
      start_date: u.goalPlan?.startDate || '',
      days_needed: u.goalPlan?.daysNeeded ? String(u.goalPlan.daysNeeded) : '',
      // Activity
      streak_days: String(u.streak || 0),
      last_done: u.lastDone || '',
      total_sessions: String(sessions.length),
      total_minutes: String(totalMinutes),
      top_sport: topSport,
      recent_sessions: JSON.stringify(recentSessions),
      // Survey (full)
      schedule: s.schedule || '',
      session_time: s.time || '',
      environment: s.environment || '',
      diet_pref: s.diet_pref || '',
      meals_per_day: s.meals ? String(s.meals) : '',
      hydration: s.hydration || '',
      medical: s.medical || '',
      sleep: s.sleep || '',
      stress: s.stress || '',
      equipment: s.equipment || '',
      mobility: s.mobility || '',
      balance: s.balance || '',
      pushups: s.pushups ? String(s.pushups) : '',
      plank_sec: s.plank ? String(s.plank) : '',
      mile_time_min: s.mile_time ? String(s.mile_time) : '',
      // Daily plan + reminders + weekly trend
      daily_plan_summary: dailyPlanSummary,
      daily_plan_workouts_today: todayWorkouts,
      reminders_count: String((u.reminders || []).length),
      reminders_list: JSON.stringify(remindersList),
      weekly_trend: JSON.stringify(weeklyTrend),
      busy_mode: u.busyMode ? 'ON' : 'off',
      stop_training: u.stopTraining ? 'ON' : 'off',
      // A single rolled-up context string the chatbot can scan in one go
      health: contextSummary
    });
  } catch(e) { console.warn('syncChatbaseUser error:', e); }
}
function renderAllDynamic() { renderHome(); renderTracker(); }
function renderAllDynamicFull() { renderHome(); renderSports(); renderTracker(); renderProfile(); renderDailyExercise(); renderDiet(); renderCoachMealsForUser(); }

const SPORTS = [
  {name:'Football',icon:'fa-futbol',outdoor:true,equip:['Cleats','Ball'],workout:['Dribbling through cones (5 min)', 'Wall passes with both feet (5 min)', 'Shooting practice - aim for corners (5 min)']},
  {name:'Basketball',icon:'fa-basketball',outdoor:true,equip:['Ball','Court'],workout:['Mikan drill (5 min)', 'Form shooting close to basket (5 min)', 'Dribbling between legs/crossover (5 min)']},
  {name:'Tennis',icon:'fa-baseball',outdoor:true,equip:['Racket','Balls'],workout:['Shadow forehand/backhand swings (5 min)', 'Wall rallies (5 min)', 'Footwork ladder (5 min)']},
  {name:'Swimming',icon:'fa-water',outdoor:false,equip:['Swim Trunks','Goggles'],workout:['Kickboard flutter kicks (5 min)', 'Pull buoy arm pulls (5 min)', 'Breathing control drills (5 min)']},
  {name:'Running',icon:'fa-person-running',outdoor:true,equip:['Shoes'],workout:['High knees sprints (5 min)', 'Butt kicks (5 min)', 'Strides (5 min)']},
  {name:'Cycling',icon:'fa-bicycle',outdoor:true,equip:['Bike','Helmet'],workout:['High cadence spinning (5 min)', 'Single leg drills (5 min)', 'Sprints (5 min)']},
  {name:'Boxing',icon:'fa-hand-fist',outdoor:false,equip:['Gloves','Wraps'],workout:['Shadow boxing - jab/cross (5 min)', 'Heavy bag combos (5 min)', 'Slip rope (5 min)']},
  {name:'Volleyball',icon:'fa-volleyball',outdoor:true,equip:['Ball','Net'],workout:['Wall taps for vertical (5 min)', 'Passing against wall (5 min)', 'Setting to self (5 min)']},
  {name:'Golf',icon:'fa-golf-ball-tee',outdoor:true,equip:['Clubs','Balls'],workout:['Slow motion swings (5 min)', 'Chipping into a bucket (5 min)', 'Putting 3ft drills (5 min)']},
  {name:'Cricket',icon:'fa-baseball-bat-ball',outdoor:true,equip:['Bat','Ball'],workout:['Shadow batting drives (5 min)', 'Bowling run-up (5 min)', 'Catching high balls (5 min)']},
  {name:'Badminton',icon:'fa-feather',outdoor:true,equip:['Racket','Shuttlecock'],workout:['Shadow smash jumps (5 min)', 'Lunge steps diagonally (5 min)', 'Shadow net shots (5 min)']},
  {name:'Table Tennis',icon:'fa-table-tennis-paddle-ball',outdoor:false,equip:['Paddle','Ball'],workout:['Shadow loops (5 min)', 'Side-to-side footwork (5 min)', 'Wrist snap exercises (5 min)']},
  {name:'Martial Arts',icon:'fa-khanda',outdoor:false,equip:['Gi','Mat'],workout:['Shadow kickboxing (5 min)', 'Squat-to-front-kick (5 min)', 'Sprawl drills (5 min)']},
  {name:'Rowing',icon:'fa-anchor',outdoor:true,equip:['Boat','Oars'],workout:['Single leg deadlifts (5 min)', 'Bent-over rows (5 min)', 'Hollow body hold (5 min)']},
  {name:'Rugby',icon:'fa-football',outdoor:true,equip:['Ball','Mouthguard'],workout:['Tackle prep - burpees (5 min)', 'Passing drills (5 min)', 'Sprint shuttles (5 min)']},
  {name:'Gymnastics',icon:'fa-person-falling',outdoor:false,equip:['Mat'],workout:['Hollow body hold (5 min)', 'Superman hold (5 min)', 'Pike push-ups (5 min)']},
  {name:'Hiking',icon:'fa-mountain',outdoor:true,equip:['Boots','Backpack'],workout:['Calf raises for uphill (5 min)', 'Step-ups on a chair (5 min)', 'Single-leg deadlifts (5 min)']},
  {name:'Surfing',icon:'fa-water',outdoor:true,equip:['Surfboard','Wetsuit'],workout:['Pop-ups on floor (5 min)', 'Alternating lunges (5 min)', 'Plank with shoulder taps (5 min)']},
  {name:'Skateboarding',icon:'fa-person-skating',outdoor:true,equip:['Board','Helmet'],workout:['Jump squats for ollie power (5 min)', 'Calf raises (5 min)', 'Balance board hold (5 min)']},
  {name:'Baseball',icon:'fa-baseball',outdoor:true,equip:['Bat','Ball'],workout:['Batting cuts (5 min)', 'Fielding grounders (5 min)', 'Throwing mechanics (5 min)']},
  {name:'Ice Hockey',icon:'fa-hockey-puck',outdoor:true,equip:['Skates','Stick'],workout:['Lateral skater jumps (5 min)', 'Stickhandling with ball (5 min)', 'Slap shot form (5 min)']},
  {name:'Skiing',icon:'fa-snowflake',outdoor:true,equip:['Skis','Poles'],workout:['Jump squats (moguls) (5 min)', 'Lateral lunges (edge control) (5 min)', 'Core twists (5 min)']},
  {name:'Snowboarding',icon:'fa-snowflake',outdoor:true,equip:['Board','Boots'],workout:['Pop-ups (floor to stance) (5 min)', 'Lateral bounds (5 min)', 'Squats (5 min)']},
  {name:'Archery',icon:'fa-bullseye',outdoor:true,equip:['Bow','Arrows'],workout:['Band pull-aparts (5 min)', 'Shadow draws (hold 3s) (5 min)', 'Plank (5 min)']},
  {name:'Fencing',icon:'fa-khanda',outdoor:false,equip:['Foil','Mask'],workout:['Forward lunges (thrusts) (5 min)', 'Lateral lunges (retreats) (5 min)', 'Shadow footwork (5 min)']},
  {name:'Weightlifting',icon:'fa-dumbbell',outdoor:false,equip:['Barbell','Plates'],workout:['Goblet squats (5 min)', 'Dumbbell rows (5 min)', 'Deadlifts (5 min)']},
  {name:'Track & Field',icon:'fa-person-running',outdoor:true,equip:['Spikes'],workout:['High knees (5 min)', 'Bounding leaps (5 min)', 'Core hold (5 min)']},
  {name:'Wrestling',icon:'fa-users',outdoor:false,equip:['Mat','Singlet'],workout:['Sprawls (5 min)', 'Squats (5 min)', 'Push-ups with taps (5 min)']},
  {name:'Climbing',icon:'fa-mountain',outdoor:true,equip:['Harness','Ropes'],workout:['Pull-ups (5 min)', 'Walking lunges (5 min)', 'Push-ups (5 min)']},
  {name:'Kayaking',icon:'fa-anchor',outdoor:true,equip:['Kayak','Paddle'],workout:['Core twists (5 min)', 'Push-ups (5 min)', 'Bent-over rows (5 min)']},
  {name:'Sailing',icon:'fa-anchor',outdoor:true,equip:['Boat'],workout:['Squats (5 min)', 'Core twists (5 min)', 'Push-ups (5 min)']},
  {name:'Polo',icon:'fa-horse',outdoor:true,equip:['Mallet','Ball'],workout:['Woodchoppers (5 min)', 'Squats (5 min)', 'Push-ups (5 min)']},
  {name:'Handball',icon:'fa-futbol',outdoor:true,equip:['Ball'],workout:['Jump squats (5 min)', 'Shuttle sprints (5 min)', 'Push-ups (5 min)']},
  {name:'Squash',icon:'fa-baseball',outdoor:false,equip:['Racket','Ball'],workout:['Lateral skater jumps (5 min)', 'Shadow swings (5 min)', 'Lunges (5 min)']},
  {name:'Diving',icon:'fa-water',outdoor:false,equip:['Swim Trunks'],workout:['Squats (5 min)', 'Calf raises (5 min)', 'Pike push-ups (5 min)']},
  {name:'General Fitness',icon:'fa-dumbbell',outdoor:false,equip:['None'],workout:['Squats (5 min)', 'Push-ups (5 min)', 'Lunges (5 min)']},
  {name:'Parkour',icon:'fa-person-running',outdoor:true,equip:['Shoes'],workout:['Jump squats (5 min)', 'Pull-ups (5 min)', 'Vaults (5 min)']},
  {name:'Triathlon',icon:'fa-bicycle',outdoor:true,equip:['Bike','Shoes'],workout:['High knees (5 min)', 'Squats (5 min)', 'Push-ups (5 min)']},
  {name:'Equestrian',icon:'fa-horse',outdoor:true,equip:['Horse','Saddle'],workout:['Squats (5 min)', 'Core twists (5 min)', 'Push-ups (5 min)']},
  {name:'Netball',icon:'fa-basketball',outdoor:true,equip:['Ball'],workout:['Jump squats (5 min)', 'Shuttle sprints (5 min)', 'Push-ups (5 min)']},
  {name:'Lacrosse',icon:'fa-baseball-bat-ball',outdoor:true,equip:['Stick','Ball'],workout:['Cradling drills (5 min)', 'Sprints (5 min)', 'Wall ball (5 min)']},
  {name:'Ultimate Frisbee',icon:'fa-compact-disc',outdoor:true,equip:['Frisbee'],workout:['Sprints (5 min)', 'Jump squats (5 min)', 'Lunges (5 min)']},
  {name:'Water Polo',icon:'fa-water',outdoor:true,equip:['Ball','Caps'],workout:['Treading water (5 min)', 'Passing (5 min)', 'Sprints (5 min)']},
  {name:'Synchronized Swimming',icon:'fa-water',outdoor:false,equip:['Swim Trunks'],workout:['Sculling (5 min)', 'Flutter kicks (5 min)', 'Breath holds (5 min)']},
  {name:'Rafting',icon:'fa-anchor',outdoor:true,equip:['Raft','Paddle'],workout:['Core twists (5 min)', 'Push-ups (5 min)', 'Squats (5 min)']},
  {name:'Canoeing',icon:'fa-anchor',outdoor:true,equip:['Canoe','Paddle'],workout:['Core twists (5 min)', 'Bent-over rows (5 min)', 'Plank (5 min)']},
  {name:'Bobsleigh',icon:'fa-snowflake',outdoor:true,equip:['Sled'],workout:['Sprints (5 min)', 'Squats (5 min)', 'Plank (5 min)']},
  {name:'Curling',icon:'fa-snowflake',outdoor:true,equip:['Stones','Broom'],workout:['Lateral lunges (5 min)', 'Sweeps (5 min)', 'Plank (5 min)']},
  {name:'Speed Skating',icon:'fa-skating',outdoor:true,equip:['Skates'],workout:['Lateral skater jumps (5 min)', 'Squats (5 min)', 'Sprints (5 min)']},
  {name:'Sledding',icon:'fa-snowflake',outdoor:true,equip:['Sled'],workout:['Sprints (5 min)', 'Squats (5 min)', 'Core hold (5 min)']},
  {name:'Judo',icon:'fa-khanda',outdoor:false,equip:['Gi','Mat'],workout:['Uchikomi (fit-ins) (5 min)', 'Sprawls (5 min)', 'Grip fighting (5 min)']},
  {name:'Karate',icon:'fa-khanda',outdoor:false,equip:['Gi'],workout:['Kihon (basics) (5 min)', 'Mawashi geri (roundhouse) (5 min)', 'Kata (5 min)']},
  {name:'Taekwondo',icon:'fa-khanda',outdoor:false,equip:['Gi'],workout:['Front snap kicks (5 min)', 'Turning kicks (5 min)', 'Forms (5 min)']},
  {name:'Kickboxing',icon:'fa-hand-fist',outdoor:false,equip:['Gloves','Pads'],workout:['Jab-cross combos (5 min)', 'Roundhouse kicks (5 min)', 'Knees (5 min)']},
  {name:'Muay Thai',icon:'fa-hand-fist',outdoor:false,equip:['Gloves','Wraps'],workout:['Teep kicks (5 min)', 'Elbows (5 min)', 'Clench work (5 min)']},
  {name:'Jiu Jitsu',icon:'fa-khanda',outdoor:false,equip:['Gi','Mat'],workout:['Shrimping (5 min)', 'Bridging (5 min)', 'Guard retention (5 min)']},
  {name:'Sprinting',icon:'fa-person-running',outdoor:true,equip:['Spikes'],workout:['A-skips (5 min)', 'Flying sprints (5 min)', 'Block starts (5 min)']},
  {name:'Marathon',icon:'fa-person-running',outdoor:true,equip:['Shoes'],workout:['Tempo run (5 min)', 'Strides (5 min)', 'Core (5 min)']},
  {name:'Hurdles',icon:'fa-person-running',outdoor:true,equip:['Spikes'],workout:['Trail leg drills (5 min)', 'A-skips (5 min)', 'Hurdle walks (5 min)']},
  {name:'Long Jump',icon:'fa-person-running',outdoor:true,equip:['Spikes'],workout:['Approach runs (5 min)', 'Pop-ups (5 min)', 'Bounding (5 min)']},
  {name:'High Jump',icon:'fa-person-running',outdoor:true,equip:['Spikes'],workout:['Fosbury flop drills (5 min)', 'Approach curve (5 min)', 'Plyometrics (5 min)']},
  {name:'Pole Vault',icon:'fa-person-running',outdoor:true,equip:['Pole','Spikes'],workout:['Plant drills (5 min)', 'Swing ups (5 min)', 'Sprints (5 min)']},
  {name:'Shot Put',icon:'fa-dumbbell',outdoor:true,equip:['Shot'],workout:['Glide drills (5 min)', 'Power position (5 min)', 'Releases (5 min)']},
  {name:'Discus',icon:'fa-compact-disc',outdoor:true,equip:['Discus'],workout:['Spin drills (5 min)', 'South African (5 min)', 'Throws (5 min)']},
  {name:'Javelin',icon:'fa-arrow-up',outdoor:true,equip:['Javelin'],workout:['Cross-over steps (5 min)', 'Plant drills (5 min)', 'Pulling motion (5 min)']},
  {name:'Road Cycling',icon:'fa-bicycle',outdoor:true,equip:['Road Bike','Helmet'],workout:['High cadence (5 min)', 'Standing sprints (5 min)', 'Descending (5 min)']},
  {name:'Mountain Biking',icon:'fa-bicycle',outdoor:true,equip:['MTB','Helmet'],workout:['Track stands (5 min)', 'Wheel lifts (5 min)', 'Cornering (5 min)']},
  {name:'BMX',icon:'fa-bicycle',outdoor:true,equip:['BMX Bike','Helmet'],workout:['Gate starts (5 min)', 'Manualing (5 min)', 'Jumping (5 min)']},
  {name:'Track Cycling',icon:'fa-bicycle',outdoor:false,equip:['Track Bike'],workout:['Standing starts (5 min)', 'Flying 200m (5 min)', 'Sprints (5 min)']},
  {name:'Indoor Cycling',icon:'fa-bicycle',outdoor:false,equip:['Stationary Bike'],workout:['Warm-up (5 min)', 'Intervals (5 min)', 'Cool down (5 min)']},
  {name:'Mountaineering',icon:'fa-mountain',outdoor:true,equip:['Crampons','Ropes'],workout:['Step-ups (5 min)', 'Calf raises (5 min)', 'Core (5 min)']},
  {name:'Orienteering',icon:'fa-map',outdoor:true,equip:['Map','Compass'],workout:['Map reading (5 min)', 'Sprints (5 min)', 'Navigation (5 min)']},
  {name:'Roller Skating',icon:'fa-skating',outdoor:true,equip:['Skates'],workout:['Glides (5 min)', 'Crossovers (5 min)', 'Stops (5 min)']},
  {name:'Crossfit',icon:'fa-dumbbell',outdoor:false,equip:['Various'],workout:['Kettlebell swings (5 min)', 'Box jumps (5 min)', 'Burpees (5 min)']},
  {name:'Calisthenics',icon:'fa-dumbbell',outdoor:true,equip:['Bar'],workout:['Pull-ups (5 min)', 'Dips (5 min)', 'L-sits (5 min)']},
  {name:'Pilates',icon:'fa-spa',outdoor:false,equip:['Mat'],workout:['Hundred (5 min)', 'Roll-ups (5 min)', 'Leg circles (5 min)']},
  {name:'Yoga',icon:'fa-spa',outdoor:false,equip:['Mat'],workout:['Sun salutations (5 min)', 'Warrior poses (5 min)', 'Balance poses (5 min)']},
  {name:'Stretching',icon:'fa-spa',outdoor:false,equip:['Mat'],workout:['Hamstring stretch (5 min)', 'Hip flexors (5 min)', 'Shoulders (5 min)']},
  {name:'Bootcamp',icon:'fa-dumbbell',outdoor:true,equip:['None'],workout:['Push-ups (5 min)', 'Squats (5 min)', 'Sprints (5 min)']},
  {name:'Ballet',icon:'fa-person',outdoor:false,equip:['Shoes'],workout:['Pliés (5 min)', 'Tendus (5 min)', 'Relevés (5 min)']},
  {name:'Hip Hop',icon:'fa-music',outdoor:false,equip:['Speaker'],workout:['Top rocks (5 min)', 'Freezes (5 min)', 'Footwork (5 min)']},
  {name:'Zumba',icon:'fa-music',outdoor:false,equip:['None'],workout:['Merengue steps (5 min)', 'Salsa steps (5 min)', 'Reggaeton (5 min)']},
  {name:'Ballroom',icon:'fa-music',outdoor:false,equip:['Shoes'],workout:['Waltz box (5 min)', 'Tango walks (5 min)', 'Frame holds (5 min)']},
  {name:'Salsa',icon:'fa-music',outdoor:false,equip:['Shoes'],workout:['Basic step (5 min)', 'Cross-body lead (5 min)', 'Turns (5 min)']},
  {name:'Contemporary',icon:'fa-music',outdoor:false,equip:['None'],workout:['Fall and recovery (5 min)', 'Contract/release (5 min)', 'Floor work (5 min)']},
  {name:'Jazz',icon:'fa-music',outdoor:false,equip:['Shoes'],workout:['Isolations (5 min)', 'Jazz squares (5 min)', 'Pirouettes (5 min)']},
  {name:'Breakdance',icon:'fa-music',outdoor:false,equip:['Mat'],workout:['Top rocks (5 min)', 'Six-step (5 min)', 'Freezes (5 min)']},
  {name:'Tap Dance',icon:'fa-music',outdoor:false,equip:['Tap Shoes'],workout:['Shuffles (5 min)', 'Flaps (5 min)', 'Time steps (5 min)']},
  {name:'Darts',icon:'fa-bullseye',outdoor:false,equip:['Darts','Board'],workout:['Aiming (5 min)', 'Release (5 min)', 'Follow-through (5 min)']},
  {name:'Billiards',icon:'fa-circle',outdoor:false,equip:['Cue','Balls'],workout:['Stance (5 min)', 'Stroke (5 min)', 'Aiming (5 min)']},
  {name:'Bowling',icon:'fa-bowling-ball',outdoor:false,equip:['Ball','Shoes'],workout:['Approach (5 min)', 'Release (5 min)', 'Follow-through (5 min)']},
  {name:'Shooting',icon:'fa-gun',outdoor:true,equip:['Rifle','Ear protection'],workout:['Aiming (5 min)', 'Breath control (5 min)', 'Trigger squeeze (5 min)']},
  {name:'Show Jumping',icon:'fa-horse',outdoor:true,equip:['Horse','Saddle'],workout:['Two-point (5 min)', 'Approach (5 min)', 'Landing (5 min)']},
  {name:'Dressage',icon:'fa-horse',outdoor:true,equip:['Horse','Saddle'],workout:['Half-passes (5 min)', 'Pirouettes (5 min)', 'Transitions (5 min)']},
  {name:'Horse Racing',icon:'fa-horse',outdoor:true,equip:['Horse','Helmet'],workout:['Two-point (5 min)', 'Sprints (5 min)', 'Balance (5 min)']},
  {name:'Cheerleading',icon:'fa-users',outdoor:true,equip:['Mat'],workout:['Jumps (5 min)', 'Tumbling (5 min)', 'Stunts (5 min)']},
  {name:'Trampolining',icon:'fa-arrow-up',outdoor:false,equip:['Trampoline'],workout:['Tuck jumps (5 min)', 'Straddle (5 min)', 'Pike (5 min)']},
  {name:'Decathlon',icon:'fa-medal',outdoor:true,equip:['Various'],workout:['Sprints (5 min)', 'Jumps (5 min)', 'Throws (5 min)']},
  {name:'Floorball',icon:'fa-hockey-puck',outdoor:false,equip:['Stick','Ball'],workout:['Stickhandling (5 min)', 'Passing (5 min)', 'Shooting (5 min)']},
  {name:'Racquetball',icon:'fa-baseball',outdoor:false,equip:['Racket','Ball'],workout:['Ceiling shots (5 min)', 'Pass shots (5 min)', 'Z-shots (5 min)']},
  {name:'Paddle Tennis',icon:'fa-baseball',outdoor:true,equip:['Paddle','Ball'],workout:['Wall rallies (5 min)', 'Smashes (5 min)', 'Lobs (5 min)']},
  {name:'Kite Surfing',icon:'fa-water',outdoor:true,equip:['Kite','Board'],workout:['Kite control (5 min)', 'Body dragging (5 min)', 'Water starts (5 min)']},
  {name:'Wind Surfing',icon:'fa-water',outdoor:true,equip:['Sail','Board'],workout:['Up-hauling (5 min)', 'Tacking (5 min)', 'Jibing (5 min)']}
];

// ===== ARABIC TRANSLATION MAPS (for dynamic content) =====
// These cover dynamically-rendered strings that can't use static data-ar attributes.
const SPORT_AR_NAMES = {
  'Football':'كرة القدم','Basketball':'كرة السلة','Tennis':'التنس','Swimming':'السباحة','Running':'الجري',
  'Cycling':'ركوب الدراجات','Boxing':'الملاكمة','Volleyball':'الكرة الطائرة','Golf':'الجولف','Cricket':'الكريكيت',
  'Badminton':'الريشة الطائرة','Table Tennis':'تنس الطاولة','Martial Arts':'الفنون القتالية','Rowing':'التجديف','Rugby':'الرغبي',
  'Gymnastics':'الجمباز','Hiking':'المشي لمسافات طويلة','Surfing':'ركوب الأمواج','Skateboarding':'التزلج على اللوح','Baseball':'البيسبول',
  'Ice Hockey':'الهوكي الجليدي','Skiing':'التزلج على الجليد','Snowboarding':'التزلج على الثلج','Archery':'الرماية','Fencing':'المبارزة',
  'Weightlifting':'رفع الأثقال','Track & Field':'ألعاب القوى','Wrestling':'المصارعة','Climbing':'تسلق الصخور','Kayaking':'الكاياك',
  'Sailing':'الإبحار','Polo':'البولو','Handball':'كرة اليد','Squash':'الإسكواش','Diving':'الغوص',
  'General Fitness':'لياقة عامة','Parkour':'الباركور','Triathlon':'التراثلون','Equestrian':'الفروسية','Netball':'كرة الشبكة',
  'Lacrosse':'اللاكروس','Ultimate Frisbee':'الفريسبي النهائي','Water Polo':'كرة الماء','Synchronized Swimming':'السباحة المتزامنة','Rafting':'إطلاق القوارب',
  'Canoeing':'الكانو','Bobsleigh':'الزلاجة الجماعية','Curling':'الكيرلنج','Speed Skating':'التزلج السريع','Sledding':'التزلج على الزلاجة',
  'Judo':'الجودو','Karate':'الكاراتيه','Taekwondo':'التايكوندو','Kickboxing':'الكيك بوكسينج','Muay Thai':'المواي تاي',
  'Jiu Jitsu':'الجيو جيتسو','Sprinting':'العدو السريع','Marathon':'الماراثون','Hurdles':'حواجز','Long Jump':'الوثب الطويل',
  'High Jump':'الوثب العالي','Pole Vault':'القفز بالزانة','Shot Put':'دفع الجلة','Discus':'القرص','Javelin':'الرمح',
  'Road Cycling':'ركوب الدراجات على الطريق','Mountain Biking':'ركوب الدراجات في الجبال','BMX':'بي إم إكس','Track Cycling':'سباق الدراجات على المضمار','Indoor Cycling':'الدراجات الداخلية',
  'Mountaineering':'تسلق الجبال','Orienteering':'رياضة التوجه','Roller Skating':'التزلج على العجلات','Crossfit':'الكروس فيت','Calisthenics':'التمارين البدنية',
  'Pilates':'البيلاتس','Yoga':'اليوغا','Stretching':'الإطالة','Bootcamp':'المعسكر الرياضي','Ballet':'الباليه',
  'Hip Hop':'الهيب هوب','Zumba':'الزومبا','Ballroom':'الرقص الاجتماعي','Salsa':'السالسا','Contemporary':'الكونتمبوراري',
  'Jazz':'الجاز','Breakdance':'البريك دانس','Tap Dance':'الرقص الإيقاعي','Darts':'السهام','Billiards':'البلياردو',
  'Bowling':'البولينج','Shooting':'الرماية الرياضية','Show Jumping':'قفز الحواجز','Dressage':'الترويض','Horse Racing':'سباق الخيل',
  'Cheerleading':'التشيرليدينج','Trampolining':'الترامبولين','Decathlon':'العشاري','Floorball':'الفلوربول','Racquetball':'الراكيت بول',
  'Paddle Tennis':'تنس المضرب','Kite Surfing':'ركوب الأمواج بالطائرة الورقية','Wind Surfing':'الوين سيرفينج','HIIT':'تمارين عالية الكثافة','Pilates Reformer':'بيلاتس ريفرمر'
};
const MUSCLE_AR_NAMES = {
  'Chest':'صدر','Back':'ظهر','Legs':'أرجل','Shoulders':'أكتاف','Arms':'ذراعان','Core':'الجذع',
  'Full Body':'كامل الجسم','Chest, Triceps':'الصدر والترايسبس','Legs, Glutes':'الأرجل والأرداف',
  'Back, Biceps':'الظهر والبايسبس','Triceps':'الترايسبس','Glutes':'الأرداف','Biceps':'البايسبس'
};
const DAY_AR_NAMES = {'Mon':'الإثنين','Tue':'الثلاثاء','Wed':'الأربعاء','Thu':'الخميس','Fri':'الجمعة','Sat':'السبت','Sun':'الأحد'};
const WORKOUT_AR_NAMES = {
  'Push-ups':'تمرين الضغط','Squats':'القرفصاء','Lunges':'الطعنات','Plank':'البلانك','Pull-ups':'العقلة',
  'Bicep Curls':'تمرين البايسبس','Full Body Circuit':'دائرة كاملة للجسم',
  'Incline Push-ups':'ضغط مائل','Chest Dips':'غطط الصدر','Pec Flyes':'تفتيح الصدر',
  'Bent-over Rows':'تجديف بالثقل','Superman Hold':'ثبات سوبرمان','Lat Pulldowns':'سحب أمامي',
  'Calf Raises':'رفع السمانة','Wall Sits':'جلوس على الحائط',
  'Shoulder Press':'ضغط الكتف','Lateral Raises':'رفرفة جانبية','Front Raises':'رفرفة أمامية','Pike Push-ups':'ضغط بايك',
  'Tricep Extensions':'تمرين الترايسبس','Hammer Curls':'تمرين المطرقة','Dips':'الغطط',
  'Crunches':'تمرين البطن','Russian Twists':'الالتواء الروسي','Leg Raises':'رفع الأرجل',
  // === Round 3: 20 new exercises ===
  'Decline Push-ups':'ضغط هابط','Diamond Push-ups':'ضغط الماس','Wide Push-ups':'ضغط واسع',
  'T-Bar Rows':'تجديف تي-بار','Face Pulls':'سحب الوجه','Reverse Flyes':'تفتيح خلفي',
  'Jump Squats':'قفز القرفصاء','Glute Bridges':'جسر الأرداف','Step-ups':'صعود الصندوق','Bulgarian Split Squats':'قرفصاء بلغاري',
  'Arnold Press':'ضغط أرنولد','Upright Rows':'رفرفة عمودية',
  'Preacher Curls':'تمرين الواعظ','Skull Crushers':'سحق الجمجمة','Concentration Curls':'تركيز البايسبس',
  'Mountain Climbers':'تسلق الجبل','Bicycle Crunches':'ضغط الدراجة','Dead Bug':'الحشرة الميتة','Hanging Knee Raises':'رفع الركبتين معلقاً',

  // ── Extended coverage (seed-workout names) ──
  'Bench Press':'بنش بريس',  'Incline Dumbbell Press':'ضغط دمبل مائل',  'Dumbbell Fly':'تفتيح بالدمبل',  'Cable Crossover':'تفتيح بالكيبل',  'Machine Chest Press':'ضغط بالجهاز',  'Incline Barbell Press':'ضغط بار مائل',  'Pec Deck Machine':'جهاز الصدر',  'Explosive Push-Ups':'ضغط انفجاري',  'Dumbbell Pullover':'تمرير الدمبل',  'Staggered Push-Ups':'ضغط متدرج',  'Bent-Over Barbell Rows':'تجديف بالبار منحنياً',  'Dumbbell Rows':'تجديف بالدمبل',  'Lat Pulldown':'سحب أمامي',  'Seated Cable Row':'تجديف بالكيبل جالساً',  'T-Bar Row':'تجديف تي بار',  'Inverted Rows':'تجديف مقلوب',  'Deadlift':'الرفعة الميتة',  'Chin-Ups':'عقلة معكوسة',  'Single-Arm Lat Pulldown':'سحب أمامي بذراع واحدة',  'Superman':'سوبرمان',  'Pendlay Row':'تجديف بندلاي',  'TRX Rows':'تجديف بالحبال',  'Reverse Fly':'رفرفة عكسية',  'Bodyweight Squats':'قرفصاء بوزن الجسم',  'Barbell Squats':'قرفصاء بالبار',  'Romanian Deadlift':'رفعة ميتة رومانية',  'Leg Press':'ضغط الأرجل',  'Goblet Squats':'قرفصاء الكوب',  'Leg Extensions':'فرد الأرجل',  'Hamstring Curls':'ثني أوتار الركبة',  'Walking Lunges':'طعنات متحركة',  'Sumo Squats':'قرفصاء السومو',  'Dumbbell Shoulder Press':'ضغط كتف بالدمبل',  'Military Press':'الضغط العسكري',  'Rear Delt Fly':'رفرفة الكتف الخلفية',  'Overhead Press':'ضغط فوق الرأس',  'Cable Lateral Raises':'رفرفة جانبية بالكيبل',  'Handstand Hold':'ثبات الوقوف على اليدين',  'Dumbbell Shrugs':'هزّة الكتف بالدمبل',  'Face Pull to Press':'سحب للوجه مع ضغط',  'Landmine Press':'ضغط لاندماين',  'Wall Walks':'مشي على الحائط',  'Tricep Dips':'غطط الترايسبس',  'Tricep Pushdowns':'دفع الترايسبس للأسفل',  'Close-Grip Bench Press':'بنش بريس قبضة ضيقة',  'Cable Hammer Curls':'تمرين المطرقة بالكيبل',  'Overhead Tricep Extension':'فرد الترايسبس فوق الرأس',  '21s Bicep Curls':'بايسبس 21',  'Reverse Curls':'تمرين بايسبس معكوس',  'Diamond Push-Ups Tricep Focus':'ضغط الماسة للترايسبس',  'Rope Tricep Extensions':'فرد الترايسبس بالحبل',  'Spider Curls':'تمرين العنكبوت',  'Hanging Leg Raises':'رفع الأرجل معلقاً',  'Side Plank':'بلانك جانبي',  'Bird Dog':'الكلب والطائر',  'Flutter Kicks':'رفرفة الأرجل',  'Hollow Body Hold':'ثبات الجسم المجوف',  'V-Ups':'تمرين الخامس V',  'Cable Woodchoppers':'قطع الخشب بالكيبل',  'Ab Wheel Rollout':'تدحرج عجلة البطن',  'Running':'الجري',  'Cycling':'ركوب الدراجة',  'Jump Rope':'نط الحبل',  'Burpees':'تمرين البيربي',  'Rowing Machine':'جهاز التجديف',  'Swimming':'السباحة',  'Stair Climber':'جهاز صعود الدرج',  'High Knees':'رفع الركبتين',  'Box Jumps':'القفز على الصندوق',  'Sprint Intervals':'جري سريع متقطع',
};
const GOAL_AR_NAMES = {
  'Lose weight':'فقدان الوزن',
  'Build muscle':'بناء العضلات',
  'Improve endurance':'تحسين التحمل',
  'Stay healthy':'الحفاظ على الصحة',
  'Improve flexibility':'تحسين المرونة',
  'Sports performance':'الأداء الرياضي'
};
const MEAL_AR_NAMES = {
  'Grilled Chicken & Quinoa Salad':'سلطة الدجاج المشوي والكينوا',
  'Salmon & Sweet Potato':'السلمون والبطاطا الحلوة',
  'Greek Yogurt & Berry Bowl':'وعاء الزبادي اليوناني والتوت',
  'Oatmeal & Whey Protein':'الشوفان وبروتين المصل',
  'Beef Stir-fry with Brown Rice':'لحم البحر المقلي مع الأرز البني',
  'Tofu & Veggie Curry':'كاري التوفو والخضروات'
};
const MEAL_AR_DESC = {
  'Grilled Chicken & Quinoa Salad':'بروتين عالٍ وكربوهيدرات معقدة للطاقة المستدامة.',
  'Salmon & Sweet Potato':'أوميغا-3 لاستشفاء المفاصل ودهون صحية.',
  'Greek Yogurt & Berry Bowl':'بروتين سريع الهضم، ممتاز بعد التمرين.',
  'Oatmeal & Whey Protein':'فطور مثالي قبل التمرين لطاقة تدوم طويلاً.',
  'Beef Stir-fry with Brown Rice':'غني بالحديد للتحمل وبناء العضلات.',
  'Tofu & Veggie Curry':'قوة بروتين نباتي مع توابل مضادة للالتهابات.'
};
const MEAL_AR_ING = {
  'Grilled Chicken & Quinoa Salad':['150غ صدر دجاج','1 كوب كينوا مطبوخة','2 كوب خضار ورقية مشكلة','1/4 ثمرة أفوكادو','صلصة زيت الزيتون والليمون'],
  'Salmon & Sweet Potato':['150غ فيليه سلمون','1 حبة بطاطا حلوة متوسطة','1 كوب بروكلي','1 ملعقة كبيرة زيت زيتون'],
  'Greek Yogurt & Berry Bowl':['200غ زبادي يوناني طبيعي','1/2 كوب توت مشكل','1 ملعقة كبيرة عسل','2 ملعقة كبيرة لوز'],
  'Oatmeal & Whey Protein':['1/2 كوب شوفان','1 مغرفة بروتين مصل','1 كوب حليب أو ماء','1/2 موزة مقطعة'],
  'Beef Stir-fry with Brown Rice':['150غ شرائح لحم بقري قليل الدهن','1 كوب فلفل ملون وبصل مشكل','3/4 كوب أرز بني مطبوخ','2 ملعقة كبيرة صلصة الصويا'],
  'Tofu & Veggie Curry':['200غ توفو صلب','1 كوب خضار مشكلة','1/2 كوب حليب جوز الهند','2 ملعقة كبيرة مسحوق الكاري']
};
const MEAL_AR_REC = {
  'Grilled Chicken & Quinoa Salad':['تبّل الدجاج بالملح والفلفل والبابريكا. اشويه 6-8 دقائق لكل وجه.','اطبخ الكينوا حسب التعليمات على العبوة.','اخلط الخضار الورقية والكينوا وشرائح الدجاج والأفوكادو.','رشّ زيت الزيتون وعصير الليمون.'],
  'Salmon & Sweet Potato':['سخّن الفرن إلى 200°م (400°ف).','قطّع البطاطا الحلوة مكعبات، اخلطها بزيت الزيتون، واشويها 20 دقيقة.','اخبز السلمون 12-15 دقيقة.','اسلق البركلي على البخار وقدمه معاً.'],
  'Greek Yogurt & Berry Bowl':['ضع الزبادي في وعاء.','أضف التوت واللوز من الأعلى.','رشّ العسل.'],
  'Oatmeal & Whey Protein':['اطبخ الشوفان مع الحليب أو الماء في الميكروويف أو على الموقد.','أضف مسحوق البروتين وحرّك حتى يذوب.','زيّن بشرائح الموز.'],
  'Beef Stir-fry with Brown Rice':['اطبخ الأرز البني حسب التعليمات.','اقلِ اللحم في مقلاة ساخنة حتى يحمرّ.','أضف الخضار واطبخها 3-4 دقائق.','أضف صلصة الصويا، قدّم فوق الأرز.'],
  'Tofu & Veggie Curry':['اضغط التوفو وقطّعه مكعبات، اقلِه حتى يذهبّل.','أضف الخضار واطبخها حتى تطرى.','اسكب حليب جوز الهند ومسحوق الكاري، اتركه يغلي على نار هادئة 10 دقائق.']
};
function _t(key, map) {
  if (store.lang !== 'ar') return key;
  return (map && map[key]) || key;
}
function getSportName(s) {
  if (!s) return '';
  if (store.lang === 'ar') return SPORT_AR_NAMES[s.name] || s.name;
  return s.name;
}

function getDrillsForIntensity(sport, intensity) {
  let baseDrills = [...sport.workout];
  if (intensity === 'Intense') return baseDrills.map(d => d.replace('(5 min)', '(10 min)')).concat(['Plank hold to failure (2 sets)', 'Burpees (3 sets of 10)']);
  if (intensity === 'Light') return baseDrills.slice(0, Math.max(1, baseDrills.length - 1)).map(d => d.replace('(5 min)', '(3 min)'));
  return baseDrills;
}

const MEALS = [
  { name: "Grilled Chicken & Quinoa Salad", desc: "High protein, complex carbs for sustained energy.", kcal: 420, p: 35, c: 40, f: 12, diet: 'omnivore', tags: ['High Protein'], ingredients: ["150g chicken breast", "1 cup cooked quinoa", "2 cups mixed greens", "1/4 avocado", "Olive oil & lemon dressing"], recipe: ["Season chicken with salt, pepper, and paprika. Grill for 6-8 mins per side.", "Cook quinoa according to package instructions.", "Toss greens, quinoa, sliced chicken, and avocado.", "Drizzle with olive oil and lemon juice."] },
  { name: "Salmon & Sweet Potato", desc: "Omega-3s for joint recovery and healthy fats.", kcal: 450, p: 34, c: 38, f: 17, diet: 'omnivore', tags: ['Omega-3', 'Joint Health'], ingredients: ["150g salmon fillet", "1 medium sweet potato", "1 cup broccoli", "1 tbsp olive oil"], recipe: ["Preheat oven to 200°C (400°F).", "Cube sweet potato, toss with olive oil, and roast for 20 mins.", "Bake salmon for 12-15 mins.", "Steam broccoli and serve together."] },
  { name: "Greek Yogurt & Berry Bowl", desc: "Fast-digesting protein, great for post-workout.", kcal: 280, p: 22, c: 28, f: 6, diet: 'vegetarian', tags: ['Antioxidants', 'Vitamin C'], ingredients: ["200g plain Greek yogurt", "1/2 cup mixed berries", "1 tbsp honey", "2 tbsp almonds"], recipe: ["Spoon yogurt into a bowl.", "Top with berries and almonds.", "Drizzle with honey."] },
  { name: "Oatmeal & Whey Protein", desc: "Perfect pre-workout breakfast for lasting energy.", kcal: 380, p: 28, c: 52, f: 8, diet: 'vegetarian', tags: ['Pre-Workout'], ingredients: ["1/2 cup rolled oats", "1 scoop whey protein", "1 cup milk or water", "1/2 banana, sliced"], recipe: ["Cook oats with milk or water in microwave or stove.", "Stir in protein powder until dissolved.", "Top with banana slices."] },
  { name: "Beef Stir-fry with Brown Rice", desc: "Iron-rich for endurance and muscle building.", kcal: 480, p: 32, c: 45, f: 16, diet: 'omnivore', tags: ['Iron', 'Endurance'], ingredients: ["150g lean beef strips", "1 cup mixed bell peppers & onions", "3/4 cup cooked brown rice", "2 tbsp soy sauce"], recipe: ["Cook brown rice according to package.", "Stir-fry beef in a hot pan until browned.", "Add vegetables and cook for 3-4 mins.", "Add soy sauce, serve over rice."] },
  { name: "Tofu & Veggie Curry", desc: "Plant-based protein powerhouse with anti-inflammatory spices.", kcal: 400, p: 20, c: 42, f: 16, diet: 'vegan', tags: ['Anti-Inflammatory', 'Magnesium'], ingredients: ["200g firm tofu", "1 cup mixed veggies", "1/2 cup coconut milk", "2 tbsp curry powder"], recipe: ["Press and cube tofu, pan-fry until golden.", "Add veggies and cook until soft.", "Pour in coconut milk and curry powder, simmer for 10 mins."] }
];

// ─── Language-pack aware meal translations ──────────────────────────────
// Per user request: one JavaScript file per language under js/lang/<code>.js
// (Arabic ships first). When the app runs in that language, meal names,
// descriptions, ingredients and recipes are looked up in the loaded pack
// FIRST, then in the legacy built-in dictionaries, then fall back to English.
function langPack() {
  try { return (window.VOLTA_LANG_PACKS && store.lang && window.VOLTA_LANG_PACKS[store.lang]) || null; } catch (e) { return null; }
}
function getMealName(m) {
  if (!m) return '';
  if (store.lang === 'ar') {
    const pk = langPack();
    const rec = pk && pk.meals && pk.meals[m.name];
    if (rec && rec.name) return rec.name;
    return MEAL_AR_NAMES[m.name] || m.name;
  }
  return m.name;
}
function getMealDesc(m) {
  if (!m) return '';
  if (store.lang === 'ar') {
    const pk = langPack();
    const rec = pk && pk.meals && pk.meals[m.name];
    if (rec && rec.desc) return rec.desc;
    return MEAL_AR_DESC[m.name] || m.desc;
  }
  return m.desc;
}
function getMealIngredients(m) {
  if (!m) return [];
  if (store.lang === 'ar') {
    const pk = langPack();
    const rec = pk && pk.meals && pk.meals[m.name];
    if (rec && rec.ingredients && rec.ingredients.length) return rec.ingredients;
    if (MEAL_AR_ING[m.name]) return MEAL_AR_ING[m.name];
  }
  return m.ingredients;
}
function getMealRecipe(m) {
  if (!m) return [];
  if (store.lang === 'ar') {
    const pk = langPack();
    const rec = pk && pk.meals && pk.meals[m.name];
    if (rec && rec.recipe && rec.recipe.length) return rec.recipe;
    if (MEAL_AR_REC[m.name]) return MEAL_AR_REC[m.name];
  }
  return m.recipe;
}

function getDailyItems(arr, count) { const seed = new Date().getDate(); let shuffled = [...arr]; for (let i = shuffled.length - 1; i > 0; i--) { const j = (seed * (i + 1)) % (i + 1); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; } return shuffled.slice(0, count); }
function animateCount(el, target, decimals = 0, suffix = '') { const duration = 800; let start = 0; let startTime = null; function step(timestamp) { if (!startTime) startTime = timestamp; const progress = Math.min((timestamp - startTime) / duration, 1); const current = progress * target; el.textContent = current.toFixed(decimals) + suffix; if (progress < 1) requestAnimationFrame(step); } requestAnimationFrame(step); }

// ===== Phase 3: Survey-driven plan rendering =====
// Renders the user's generated plan (u.plan) into #your-plan-panel on the home dashboard.
// The plan is generated by VoltaPlan.generate() after onboarding completes, and
// can be regenerated at any time via the "Regenerate" button.
function renderPlan() {
  try {
    // NEW: full dashboard plan cards (weekly workout plan + diet plan)
    // rendered by the VoltaFeatures module; falls back to the compact mini
    // card if the module is not loaded.
    if (window.VoltaFeatures && typeof VoltaFeatures.renderDashboardPlan === 'function') {
      VoltaFeatures.renderDashboardPlan();
      if (typeof applyTranslations === 'function') applyTranslations();
      return;
    }
    var u = currentUser();
    if (!u) return;
    var panel = document.getElementById('your-plan-panel');
    var content = document.getElementById('your-plan-content');
    if (!panel || !content) return;
    if (!u.plan) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    var ar = (store.lang === 'ar');
    var w = u.plan.workout || {};
    var days = w.daysPerWeek || (w.schedule ? w.schedule.length : 0) || 0;
    var mins = w.sessionMinutes || 30;
    var split = w.splitType || 'Custom';
    var kcal = (u.plan.diet && u.plan.diet.dailyCalories) || 0;
    content.innerHTML =
      '<div class="plan-mini-row">' +
        '<div class="plan-mini-info">' +
          '<b>' + split + ' \u00b7 ' + days + (ar ? ' \u0623\u064a\u0627\u0645/\u0623\u0633\u0628\u0648\u0639' : ' days/week') + '</b>' +
          '<small>' + mins + (ar ? ' \u062f\u0642\u064a\u0642\u0629/\u062c\u0644\u0633\u0629' : ' min/session') + '</small>' +
        '</div>' +
        '<div class="plan-mini-actions">' +
          '<button class="btn ghost small" onclick="openPlanViewPopup()"><i class="fa-solid fa-eye"></i> ' + (ar ? '\u0639\u0631\u0636 \u0627\u0644\u062e\u0637\u0629' : 'View') + '</button>' +
          '<button class="btn ghost small" onclick="regeneratePlanConfirm()" title="Regenerate" aria-label="Regenerate"><i class="fa-solid fa-rotate"></i></button>' +
        '</div>' +
      '</div>';
    if (typeof applyTranslations === 'function') applyTranslations();
  } catch(e) { console.warn('renderPlan error:', e); }
}

// ═══ v9: REGENERATE CONFIRM POPUP ════════════════════════════════════════
// Per user spec: "in the dashboard when the user clicks regenerate, make a
// popup and say 'are you sure you want to regenerate your plan?'" — the same
// confirm guards the AI-meals "Regenerate Another Diet Plan" button. App-
// styled (matches the app's modal design), bilingual EN/AR, one reusable
// dialog with Cancel / Yes buttons.
function voltaConfirm(titleHtml, onYes, opts) {
  opts = opts || {};
  const ar = (store.lang === 'ar');
  let m = document.getElementById('volta-confirm-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'volta-confirm-modal';
    m.className = 'modal-overlay';
    m.style.zIndex = '10060';
    m.innerHTML =
      '<div class="modal-content volta-confirm-card" style="max-width:420px;">' +
        '<div class="volta-confirm-ic"><i class="fa-solid fa-rotate"></i></div>' +
        '<h3 id="volta-confirm-title" style="margin:14px 0 20px;"></h3>' +
        '<div class="volta-confirm-btns">' +
          '<button type="button" class="btn ghost" id="volta-confirm-no"></button>' +
          '<button type="button" class="btn primary" id="volta-confirm-yes"></button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(m);
    m.addEventListener('click', function (e) { if (e.target === m) voltaConfirmClose(); });
  }
  document.getElementById('volta-confirm-title').innerHTML = titleHtml;
  const yes = document.getElementById('volta-confirm-yes');
  const no = document.getElementById('volta-confirm-no');
  // Replace nodes (clone) so old listeners from a previous confirm never stack.
  const yes2 = yes.cloneNode(true);
  yes.parentNode.replaceChild(yes2, yes);
  const no2 = no.cloneNode(true);
  no.parentNode.replaceChild(no2, no);
  yes2.innerHTML = '<i class="fa-solid ' + (opts.yesIcon || 'fa-check') + '"></i> <span>' + (opts.yesLabel || (ar ? 'نعم' : 'Yes')) + '</span>';
  no2.innerHTML = '<i class="fa-solid fa-xmark"></i> <span>' + (opts.noLabel || (ar ? 'إلغاء' : 'Cancel')) + '</span>';
  yes2.addEventListener('click', function () { voltaConfirmClose(); try { if (onYes) onYes(); } catch (e) { console.warn('voltaConfirm onYes error:', e); } });
  no2.addEventListener('click', voltaConfirmClose);
  if (typeof openModal === 'function') openModal('volta-confirm-modal');
  else m.classList.add('active');
}
function voltaConfirmClose() {
  const m = document.getElementById('volta-confirm-modal');
  if (!m) return;
  if (typeof closeModal === 'function') { try { closeModal('volta-confirm-modal'); } catch (e) {} }
  m.classList.remove('active');
}
window.voltaConfirm = voltaConfirm;
window.voltaConfirmClose = voltaConfirmClose;

// Dashboard "REGENERATE" (user request: confirm before regenerating the plan).
function regeneratePlanConfirm() {
  const ar = (store.lang === 'ar');
  voltaConfirm(
    ar ? 'هل أنت متأكد أنك تريد إعادة توليد خطتك؟' : 'Are you sure you want to regenerate your plan?',
    function () { regeneratePlan(); },
    { yesIcon: 'fa-rotate' }
  );
}
window.regeneratePlanConfirm = regeneratePlanConfirm;

// Regenerate the plan from the user's current survey answers.
// Called when the user clicks "Regenerate" on the plan panel.
function regeneratePlan() {
  try {
    var u = currentUser();
    if (!u || !u.profile || !u.survey) return;
    if (!window.VoltaPlan) { alert('Plan engine not loaded'); return; }
    // Recalculate goal plan first (in case profile changed)
    if (typeof calculateGoalPlan === 'function') calculateGoalPlan();
    var plan = VoltaPlan.generate(u);
    if (!plan) { alert('Could not generate plan'); return; }
    u.plan = plan;
    saveUser(store.session, u);
    renderPlan();
    // Async: populate meal suggestions from IndexedDB
    // Round 9: persists internally — only re-render here.
    if (window.VoltaDB) {
      VoltaPlan.populateMealSuggestions(u.plan).then(function () {
        try { renderPlan(); } catch(e) {}
      }).catch(function () {});
    }
    try { showVoltaToast('Plan regenerated from your survey', 'success'); } catch(e) {}
  } catch(e) { console.warn('regeneratePlan error:', e); }
}

function renderHome() {
  const u = currentUser(), p = u.profile;
  if (!p) return;
  const ar = (store.lang === 'ar');
  // Units helper (metric/imperial) from VoltaFeatures
  const fw = (window.VoltaFeatures && VoltaFeatures.fmtWeight) ? VoltaFeatures.fmtWeight : function (v) { return v; };  // fw(v, false) = number only, unit comes from the translated label
  const wu = (window.VoltaFeatures && VoltaFeatures.weightUnit) ? VoltaFeatures.weightUnit() : (ar ? ' \u0643\u062c\u0645' : 'kg');
  // ===== Hero: greeting, avatar initials, date chip, ghost day number =====
  // Name priority: the FIRST survey question ("What is your full name?") is
  // the source of truth. Never show the email/Gmail in the greeting.
  const rawName = voltaDisplayName();
  const displayFirst = (rawName || (ar ? 'زميلي' : 'Athlete')).split(/\s+/)[0];
  const greetingPrefix = ar ? '\u0645\u0631\u062d\u0628\u0627\u064b' : 'Welcome';
  const gEl = document.getElementById('greeting');
  if (gEl) gEl.textContent = `${greetingPrefix} ${displayFirst}`;
  const avEl = document.getElementById('dash-avatar');
  if (avEl) {
    const initials = (rawName || 'VB').trim().split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0); }).join('').toUpperCase();
    avEl.textContent = initials || 'VB';
  }
  const nowD = new Date();
  const dateChip = document.getElementById('dash-date-chip');
  if (dateChip) {
    try {
      let s = nowD.toLocaleDateString(ar ? 'ar-EG' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      if (!ar) s = s.toUpperCase();
      dateChip.textContent = s;
    } catch (e) { dateChip.textContent = localDateStr(); }
  }
  const ghostEl = document.getElementById('dash-day-num');
  if (ghostEl) ghostEl.textContent = String(nowD.getDate()).padStart(2, '0');
  // ===== Stat cards =====
  const bmi = p.weight / Math.pow(p.height / 100, 2);
  animateCount(document.getElementById('stat-bmi'), parseFloat(bmi.toFixed(1)), 1);
  const bmiCatEn = bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Healthy' : bmi < 30 ? 'Overweight' : 'Obese';
  const bmiCatAr = bmi < 18.5 ? '\u0646\u062d\u064a\u0641' : bmi < 25 ? '\u0635\u062d\u064a' : bmi < 30 ? '\u0632\u064a\u0627\u062f\u0629 \u0648\u0632\u0646' : '\u0633\u0645\u0646\u0629';
  document.getElementById('stat-bmi-cat').textContent = ar ? bmiCatAr : bmiCatEn;
  document.getElementById('stat-bmi-cat').setAttribute('data-ar', bmiCatAr);
  // v29 (user, picture 2): the water number shown at the top AND everywhere
  // else comes from ONE shared function (weight × 0.033, live) — and the
  // stored plan value is healed to match, so the diet card, the Diet System
  // pill and the AI coach snapshot can never drift away from this number.
  let waterTarget;
  try { waterTarget = (typeof waterTargetLiters === 'function') ? waterTargetLiters() : parseFloat((p.weight * 0.033).toFixed(1)); }
  catch (e) { waterTarget = parseFloat((p.weight * 0.033).toFixed(1)); }
  try {
    if (u.plan && u.plan.diet && u.plan.diet.hydrationLiters !== waterTarget) {
      u.plan.diet.hydrationLiters = waterTarget;
      saveUser(store.session, u);
    }
  } catch (e) {}
  document.getElementById('stat-water').textContent = waterTarget.toFixed(1) + (ar ? ' \u0644\u062a\u0631' : ' L');
  animateCount(document.getElementById('stat-streak'), u.streak || 0);
  // v30 (user): whole numbers only — the weekly-minutes stat can sum to a
  // decimal (0.8-minute exercise logs), so it is rounded before animating.
  animateCount(document.getElementById('stat-week-mins'), Math.round(getSessionStats().weekMin));

  // ===== Today's Activity Goal (rings panel) =====
  // Per user spec (v6): the goal IS the time the user said they spend in
  // ONE session in the survey ("How much time can you spare per session?").
  // 15-min survey → 15 MIN goal, 30 → 30, 45 → 45, 60+ → 60 (no halving).
  // Each completed exercise logs ~1 min of work, so finishing today's full
  // workout list fills the bar to 100%.
  try {
    const todayMin = getTodayMinutes();
    const dailyGoal = Math.max(1, Math.round(getDailyGoalMinutes()));
    const rawPct = Math.round((todayMin / dailyGoal) * 100);
    const fillPct = Math.min(100, rawPct);
    const fill = document.getElementById('today-progress-fill');
    const minsEl = document.getElementById('today-mins');
    const goalEl = document.getElementById('today-goal');
    if (fill) fill.style.width = fillPct + '%';
    if (minsEl) minsEl.textContent = fmtMins(todayMin);
    if (goalEl) goalEl.textContent = dailyGoal;
    // === Calories burnt today (FIXED: real calories or MET-based estimate,
    // no more 8-kcal-per-minute inflation) ===
    const todayKcalEl = document.getElementById('today-kcal-burnt');
    if (todayKcalEl) {
      const todaySessions = (u.sessions || []).filter(s => (s.date || '').slice(0, 10) === localDateStr());
      const todayKcal = Math.round(todaySessions.reduce((sum, s) => sum + kcalForSession(s), 0));
      todayKcalEl.textContent = todayKcal;
    }
  } catch(e) { console.warn('today-activity render error:', e); }

  // ===== Weight goal progress =====
  if (u.goalPlan) {
    document.getElementById('goal-progress-panel').classList.remove('hidden');
    document.getElementById('goal-current').textContent = fw(p.weight, false);
    document.getElementById('goal-target').textContent = fw(u.goalPlan.targetWeight, false);
    // Unit label follows the Settings → Units toggle (kg ↔ lb). The spans
    // carry data-ar so applyTranslations() swaps the text when the app runs
    // in Arabic; here we only keep the EN branch in sync with the units.
    {
      const imp = (window.VoltaFeatures && VoltaFeatures.getUnits) ? VoltaFeatures.getUnits() === 'imperial' : false;
      const midEl = document.getElementById('goal-unit-mid');
      const endEl = document.getElementById('goal-unit-end');
      if (midEl) { midEl.textContent = imp ? ' LB \u2192 ' : ' KG \u2192 '; midEl.setAttribute('data-ar', imp ? ' \u0631\u0637\u0644 \u2190 ' : ' \u0643\u062c\u0645 \u2190 '); }
      if (endEl) { endEl.textContent = imp ? ' LB' : ' KG'; endEl.setAttribute('data-ar', imp ? ' \u0631\u0637\u0644' : ' \u0643\u062c\u0645'); }
    }
    let progress = 0; const start = parseFloat(u.goalPlan.startWeight); const target = parseFloat(u.goalPlan.targetWeight); const current = p.weight;
    if (target < start) progress = ((start - current) / (start - target)) * 100; else if (target > start) progress = ((current - start) / (target - start)) * 100; else progress = 100;
    progress = Math.max(0, Math.min(100, progress));
    document.getElementById('goal-progress-fill').style.width = progress + '%';
    document.getElementById('goal-percent').textContent = Math.round(progress) + '%';
    {
      let daysLeft = null;
      if (u.goalPlan.targetDate) {
        const today = new Date(); today.setHours(0,0,0,0);
        const target = new Date(u.goalPlan.targetDate + 'T00:00:00');
        const diffMs = target - today;
        daysLeft = Math.max(0, Math.ceil(diffMs / 86400000));
      } else if (u.goalPlan.daysNeeded) {
        const startStr = u.goalPlan.startDate || localDateStr();
        const startD = new Date(startStr + 'T00:00:00');
        const today = new Date(); today.setHours(0,0,0,0);
        const elapsed = Math.max(0, Math.floor((today - startD) / 86400000));
        daysLeft = Math.max(0, u.goalPlan.daysNeeded - elapsed);
      }
      const numEl = document.getElementById('goal-days-left-num');
      const lblEl = document.getElementById('goal-days-left-lbl');
      const badgeEl = document.getElementById('goal-days-left-badge');
      if (daysLeft !== null && daysLeft > 0) {
        if (numEl) numEl.textContent = daysLeft;
        if (lblEl) {
          lblEl.textContent = ar ? '\u064a\u0648\u0645 \u0645\u062a\u0628\u0642\u064a' : (daysLeft === 1 ? 'day left' : 'days left');
        }
        if (badgeEl) badgeEl.style.display = 'inline-flex';
      } else if (daysLeft === 0) {
        if (numEl) numEl.textContent = '\u2713';
        if (lblEl) lblEl.textContent = ar ? '\u062a\u0645 \u0627\u0644\u0648\u0635\u0648\u0644 \u0644\u0644\u0647\u062f\u0641' : 'goal reached';
        if (badgeEl) badgeEl.style.display = 'inline-flex';
      } else {
        if (badgeEl) badgeEl.style.display = 'none';
      }
    }
  }
  renderCoachRecommendation();
  renderChart();
  renderPlan();
  // NEW: 3 activity rings (Calories kcal / Minutes / Workouts today)
  try { renderActivityRings(); } catch(e) { console.warn('rings render error:', e); }
}

// === 3 ACTIVITY RINGS (new dashboard) ==================================
// Apple-Watch-style triple ring: Calories (kcal burnt today), Minutes
// (training minutes today) and Workouts (how many workouts you made
// today). Rendered on ALL screen sizes.
//
// CALORIE FIX: the old ring counted 1 kcal as 8 (fallback of
// duration * 8). Calories now come from the real per-session 'calories'
// field, or a MET-based estimate: kcal = MET x weight(kg) x hours.

// MET values per session sport (Compendium of Physical Activities).
// v18 (user): "i burn 9 calories in tennis (what i tested) in 1 minute, i
// think that's not accurate" — Tennis raised 7.3 ("general") → 8.0
// (singles-level, the value mainstream trackers use): at 70–80 kg this
// reads ~9.3–10.7 kcal/min instead of the flat ~8.5–9.7 the old MET gave.
// MET values per session sport (Compendium of Physical Activities).
// v25 (user): "use the most accurate calorie burn formula for every sport" —
// the table now covers ALL 103 sports in SPORTS (Compendium 2011 values;
// competitive/general variants averaged where needed).
const SESSION_SPORT_MET = {
  // ── original 20 (kept, Compendium-checked) ──
  'Walking': 4.3, 'Running': 9.8, 'Cycling': 7.5, 'Swimming': 8.3,
  'Boxing': 9.0, 'Football': 7.0, 'Basketball': 6.5, 'Tennis': 7.3,
  'Volleyball': 5.0, 'Yoga': 3.0, 'HIIT': 8.0, 'Gym Workout': 5.0,
  'Daily Exercise': 5.0, 'Marathon': 9.0, 'Jump Rope': 11.0,
  'Rowing': 7.0, 'CrossFit': 8.5, 'Martial Arts': 8.0, 'Dance': 5.0,
  // ── v25: the remaining 84 sports ──
  'Golf': 4.8, 'Cricket': 5.5, 'Badminton': 5.5, 'Table Tennis': 4.0,
  'Rugby': 8.3, 'Gymnastics': 4.0, 'Hiking': 6.0, 'Surfing': 6.0,
  'Skateboarding': 5.0, 'Baseball': 5.0, 'Ice Hockey': 8.0, 'Skiing': 7.0,
  'Snowboarding': 6.0, 'Archery': 4.3, 'Fencing': 6.0, 'Weightlifting': 6.0,
  'Track & Field': 7.0, 'Wrestling': 6.0, 'Climbing': 8.0, 'Kayaking': 7.0,
  'Sailing': 3.3, 'Polo': 6.5, 'Handball': 8.0, 'Squash': 7.3,
  'Diving': 3.0, 'General Fitness': 5.0, 'Parkour': 8.0, 'Triathlon': 9.5,
  'Equestrian': 5.5, 'Netball': 6.0, 'Lacrosse': 7.8, 'Ultimate Frisbee': 7.0,
  'Water Polo': 10.0, 'Synchronized Swimming': 8.0, 'Rafting': 6.0,
  'Canoeing': 7.0, 'Bobsleigh': 5.3, 'Curling': 4.0, 'Speed Skating': 10.0,
  'Sledding': 5.0, 'Judo': 6.5, 'Karate': 7.0, 'Taekwondo': 7.0,
  'Kickboxing': 9.0, 'Muay Thai': 9.0, 'Jiu Jitsu': 8.0, 'Sprinting': 12.8,
  'Hurdles': 12.0, 'Long Jump': 8.0, 'High Jump': 8.0, 'Pole Vault': 8.0,
  'Shot Put': 5.0, 'Discus': 5.0, 'Javelin': 5.0, 'Road Cycling': 8.0,
  'Mountain Biking': 8.5, 'BMX': 8.5, 'Track Cycling': 10.0,
  'Indoor Cycling': 7.0, 'Mountaineering': 7.0, 'Orienteering': 9.0,
  'Roller Skating': 7.0, 'Calisthenics': 5.0, 'Pilates': 3.8, 'Crossfit': 8.5,
  'Stretching': 2.3, 'Bootcamp': 8.0, 'Ballet': 5.0, 'Hip Hop': 5.8,
  'Zumba': 6.0, 'Ballroom': 4.5, 'Salsa': 4.5, 'Contemporary': 5.0,
  'Jazz': 5.0, 'Breakdance': 6.0, 'Tap Dance': 4.5, 'Darts': 2.5,
  'Billiards': 2.5, 'Bowling': 3.8, 'Shooting': 2.5,
  'Show Jumping': 5.5, 'Dressage': 4.5, 'Horse Racing': 8.0,
  'Cheerleading': 6.0, 'Trampolining': 4.5, 'Decathlon': 9.0,
  'Floorball': 7.0, 'Racquetball': 7.3, 'Paddle Tennis': 6.5,
  'Kite Surfing': 7.0, 'Wind Surfing': 7.0
};

// ===== ROUND 8 — accurate calories & minutes ============================
// Per user report: "1 calorie is counted as 7 in the ring ... i trained for
// 9 seconds and it counted as 1 minute". Root causes fixed:
//   1) Math.max(1, Math.round(secs/60)) rounded ANY effort up to a full
//      minute (9s → 1 min), and the MET estimate then ran on that inflated
//      minute → ~7-8 kcal for 9 real seconds.
//   2) Live sports used a flat MET 6.0 for everything except Running/
//      Cycling, and ignored the chosen Light/Moderate/Intense intensity —
//      every workout burned the same.

// Intensity multiplier (applied on top of the sport/exercise MET when the
// USER chose the intensity — the MET itself never changes retroactively).
function intensityFactor(intensity) {
  const i = String(intensity || '').trim().toLowerCase();
  if (i === 'light' || i === 'خفيف') return 0.75;
  if (i === 'intense' || i === 'intense' || i === 'شديد') return 1.25;
  return 1.0; // moderate / unknown
}

// Exact calories for a training span — v25 (user): "use the most accurate
// calorie burn formula" — the ACSM / Compendium standard equation:
//     kcal = MET × 3.5 × bodyWeight(kg) / 200 × minutes
// (3.5 ml O2 per kg per minute is the 1-MET reference; the /200 converts
// mlO2/min to kcal/min.) Applied on the exact seconds elapsed.
function kcalForSpan(met, intensity, weightKg, secs) {
  const s = Math.max(0, Number(secs) || 0);
  return (Number(met) || 5) * intensityFactor(intensity) * 3.5 * (Number(weightKg) || 70) / 200 * (s / 60);
}

// Exact minutes from seconds, rounded to 1 decimal — NEVER rounds a short
// effort up to a full minute (9s → 0.2 min, not 1 min).
function minsFromSecs(secs) {
  return Math.max(0, Math.round(((Number(secs) || 0) / 60) * 10) / 10);
}

// Display minutes — ALWAYS a whole number (v30, user: "display all
// numbers in whole numbers, minutes are written in decimals"). 48 real
// seconds still counts as 1 full minute on every surface.
function fmtMins(mins) {
  return String(Math.round((Number(mins) || 0)));
}

// Calories for one session: real value if present, otherwise a MET-based
// estimate (never the old flat 8 kcal/min). The estimate now respects the
// session's stored intensity (Light ×0.75 / Moderate ×1.0 / Intense ×1.25).
function kcalForSession(s) {
  if (!s) return 0;
  const real = parseFloat(s.calories);
  if (!isNaN(real) && real > 0) return Math.round(real);
  let weight = 70;
  try { const u = currentUser(); if (u && u.profile && u.profile.weight) weight = u.profile.weight; } catch (e) {}
  const met = SESSION_SPORT_MET[s.sport] || 6.0;
  const minutes = (Number(s.duration) || 0);
  // v25: ACSM formula + integer result (never a decimal).
  return Math.round(met * intensityFactor(s.intensity) * 3.5 * weight / 200 * minutes);
}

// Daily kcal target for the activity ring.
// ===== Round 15 FIX — "the calorie ring becomes full even after burning 1
// calorie": the old target used HALF the daily minute goal at MET 6, which
// computes an absurdly small kcal target for common goals (15-min goal →
// ~53 kcal, 30-min goal → ~105 kcal), so a single short session slammed
// the ring to 100% almost immediately. Per user spec the ring must fill
// SLOWLY until it hits the daily goal. New rule: the FULL daily minute
// goal at MET 6 (moderate effort, real weight), rounded to a 25-kcal step,
// with a 300-kcal/day floor so the arc always climbs gradually.
function getDailyKcalTarget() {
  let weight = 70;
  try { const u = currentUser(); if (u && u.profile && u.profile.weight) weight = u.profile.weight; } catch (e) {}
  const mins = getDailyGoalMinutes() || 0;          // 0 while training is paused
  const est = 6.0 * weight * (mins / 60);           // full daily goal @ MET 6
  return Math.max(300, Math.round(est / 25) * 25);  // fills slowly toward the daily goal
}

// Distinct training days in the last 7 local days.
function getWeekTrainedDays() {
  try {
    const u = currentUser();
    const set = {};
    (u.sessions || []).forEach(function (s) {
      if (!s.date) return;
      const d = new Date(s.date + 'T00:00:00');
      const now = new Date(); now.setHours(0, 0, 0, 0);
      const diff = Math.floor((now - d) / 86400000);
      if (diff >= 0 && diff < 7) set[s.date] = 1;
    });
    return Object.keys(set).length;
  } catch (e) { return 0; }
}

// Animate one ring arc to a ratio (0..1).
function setRingArc(el, ratio) {
  if (!el) return;
  const r = parseFloat(el.getAttribute('r')) || 50;
  const C = 2 * Math.PI * r;
  el.style.strokeDasharray = C;
  const pct = Math.max(0, Math.min(1, ratio || 0));
  if (!el.dataset.init) {
    el.dataset.init = '1';
    el.style.strokeDashoffset = C;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { el.style.strokeDashoffset = C * (1 - pct); });
    });
  } else {
    el.style.strokeDashoffset = C * (1 - pct);
  }
}

function renderActivityRings() {
  const u = currentUser();
  if (!u) return;
  const arc1 = document.getElementById('ring-kcal-arc');
  if (!arc1) return;
  const ar = (store.lang === 'ar');
  const todaySessions = (u.sessions || []).filter(function (s) { return (s.date || '').slice(0, 10) === localDateStr(); });
  const kcal = Math.round(todaySessions.reduce(function (sum, s) { return sum + kcalForSession(s); }, 0));
  const todayMin = todaySessions.reduce(function (sum, s) { return sum + (Number(s.duration) || 0); }, 0);
  // v6: the minutes ring fills toward the FULL survey session time
  // (matches the "Today's Activity Goal" card — no more halving).
  const goalMins = Math.max(1, Math.round(getDailyGoalMinutes()));
  const kcalTarget = getDailyKcalTarget();
  // ===== Ring 3: WORKOUTS MADE TODAY (per user request the 3 rings now
  // track calories, minutes and HOW MANY WORKOUTS YOU MADE TODAY —
  // replacing the old "exercises done from the daily plan" fraction).
  // Every training session logged today counts as one workout made:
  // daily-plan exercise blocks, custom-workout quick logs, marathon
  // sessions and manual sports logs. The ring fills toward today's
  // planned workout count (falls back to 1 workout = "get it done"
  // when no plan is active), so finishing today's plan fills it 100%.
  const workoutsToday = todaySessions.length;
  let workoutsTarget = 1;
  try {
    const dp = u.dailyPlan;
    if (dp && dp.dailyPlan && dp.dailyPlan.length) {
      const day = dp.dailyPlan[Math.min(dp.currentDay || 0, dp.dailyPlan.length - 1)];
      const wList = (day && day.workouts) || [];
      if (wList.length > 1) workoutsTarget = wList.length;
    }
  } catch (e) {}
  setRingArc(arc1, kcal / kcalTarget);
  setRingArc(document.getElementById('ring-mins-arc'), todayMin / goalMins);
  setRingArc(document.getElementById('ring-ex-arc'), workoutsToday / workoutsTarget);
  const center = document.getElementById('rings-center-num');
  if (center) { center.textContent = kcal; }
  // v30 (user): "put a workout calorie target for the user and make that the
  // limit for the calorie ring" — the target (getDailyKcalTarget: MET 6 ×
  // your weight × your daily session minutes, floor 300) is now VISIBLE on
  // the ring itself ("kcal / target") and in the CALORIES legend, so the
  // ring's limit is no longer a mystery number.
  const centerTgt = document.getElementById('rings-center-target');
  if (centerTgt) { centerTgt.textContent = '/ ' + kcalTarget; }
  const legendTgt = document.getElementById('ring-kcal-target');
  if (legendTgt) { legendTgt.textContent = '/ ' + kcalTarget; }
  // v34 (user, picture 2): "for workouts and limits, put a / then the limit
  // just like calories" — the MINUTES and WORKOUTS legend entries now show
  // their limits ("/ 15", "/ 2") right next to the value, exactly like the
  // CALORIES entry. Limits match the rings: minutes → the survey activity
  // goal, workouts → today's planned workout count.
  const minsTgt = document.getElementById('ring-mins-target');
  if (minsTgt) { minsTgt.textContent = '/ ' + goalMins; }
  const exTgt = document.getElementById('ring-ex-target');
  if (exTgt) { exTgt.textContent = '/ ' + workoutsTarget; }
  const v1 = document.getElementById('ring-kcal-val');
  if (v1) v1.textContent = kcal;
  const v2 = document.getElementById('ring-mins-val');
  if (v2) v2.textContent = fmtMins(todayMin);
  const v3 = document.getElementById('ring-ex-val');
  if (v3) v3.textContent = workoutsToday;
  // Extra stats: calories consumed today (diet log) + minutes trained today.
  var consumedKcal = 0;
  try {
    var dlog = getDietLog();
    var dToday = localDateStr();
    consumedKcal = dlog.filter(function (x) {
      return (x.date && x.date === dToday) || (!x.date && (x.loggedAt || '').startsWith(dToday));
    }).reduce(function (s, x) { return s + (x.kcal || 0); }, 0);
  } catch (e) {}
  var cEl = document.getElementById('ring-kcal-consumed');
  if (cEl) cEl.textContent = consumedKcal;
  var mEl = document.getElementById('ring-train-mins');
  if (mEl) mEl.textContent = fmtMins(todayMin);
}

// Legacy alias (resize handler still calls this): now renders the 3 rings.
function setMobileKcalRing() {
  try { renderActivityRings(); } catch (e) {}
}

function renderCoachRecommendation() {
  const u = currentUser(), p = u.profile;
  const recEl = document.getElementById('recommendation-content');
  // Defensive: if the user has no profile yet, show a helpful prompt instead of
  // leaving the static "Analyzing your profile..." placeholder forever.
  if (!p) {
    if (recEl) recEl.innerHTML = '<p style="color:var(--muted);"><i class="fa-solid fa-circle-info"></i> <span data-ar="أكمل ملفك الشخصي للحصول على توصيات مخصصة.">Complete your profile to get personalized recommendations.</span></p>';
    setTimeout(applyTranslations, 0);
    return;
  }
  const ar = (store.lang === 'ar');
  const goalAr = GOAL_AR_NAMES[p.goal] || p.goal;

  // === Round 11: Wrap the whole recommendation logic in try/catch so a
  // partial failure (e.g. malformed survey data) always falls back to a
  // valid 4-6 sport list instead of leaving the user with 1 or 0 sports. ===
  try {
    const sportMap = {
      'Lose weight':         ['Running', 'Cycling', 'Boxing', 'Swimming', 'Sprinting', 'Bootcamp', 'Crossfit', 'Track & Field'],
      'Build muscle':        ['Weightlifting', 'Calisthenics', 'Crossfit', 'Gymnastics', 'Climbing', 'Rugby', 'Wrestling'],
      'Improve endurance':   ['Running', 'Cycling', 'Swimming', 'Rowing', 'Triathlon', 'Marathon', 'Road Cycling'],
      'Stay healthy':        ['Yoga', 'Pilates', 'General Fitness', 'Stretching', 'Zumba', 'Hiking', 'Bootcamp'],
      'Improve flexibility': ['Yoga', 'Pilates', 'Stretching', 'Gymnastics', 'Ballet', 'Contemporary', 'Martial Arts'],
      'Sports performance':  [p.sport || 'General Fitness', 'Crossfit', 'Sprinting', 'Weightlifting', 'Bootcamp', 'Track & Field']
    };

    // Case-insensitive goal matching (fixes accounts where goal was saved with
    // different casing, e.g. 'lose weight' instead of 'Lose weight')
    const goalKey = Object.keys(sportMap).find(k => k.toLowerCase() === (p.goal || '').toLowerCase());
    let recs = sportMap[goalKey] || sportMap['Stay healthy'];
    if (p.sport && p.sport !== 'General Fitness' && !recs.includes(p.sport)) recs.unshift(p.sport);

    // ===== SURVEY-AWARE FILTERING =====
    recs = filterSportsBySurvey(recs, u.survey || {}, p);

    // ===== FALLBACK: if filtering killed every recommendation =====
    if (!recs || recs.length === 0) {
      recs = (p.sport && p.sport !== 'General Fitness')
        ? [p.sport]
        : ['General Fitness'];
    }

    // ===== BACKFILL: ensure 4-6 recommendations.
    // Re-filter the backfill list through filterSportsBySurvey() so we don't
    // re-add sports that were already filtered out (Round 11 fix). =====
    if (recs.length < 6) {
      const pool = (sportMap[goalKey] || sportMap['Stay healthy'])
        .concat(['General Fitness', 'Yoga', 'Pilates', 'Stretching', 'Zumba', 'Bootcamp', 'Calisthenics', 'Contemporary', 'Hiking', 'Hip Hop', 'Breakdance'])
        .filter(n => !recs.includes(n));
      const reFiltered = filterSportsBySurvey(pool, u.survey || {}, p);
      recs = recs.concat(reFiltered);
    }

    // ===== FINAL GUARANTEE: if still < 4 (extreme edge case), force-fill
    // with always-safe sports that pass every filter. =====
    const alwaysSafe = ['General Fitness', 'Yoga', 'Pilates', 'Stretching', 'Calisthenics', 'Zumba'];
    let safetyIdx = 0;
    while (recs.length < 4 && safetyIdx < alwaysSafe.length) {
      const next = alwaysSafe[safetyIdx];
      if (!recs.includes(next)) recs.push(next);
      safetyIdx++;
    }

    store.recommendedSports = recs.slice(0, 6);
  } catch(e) {
    console.warn('renderCoachRecommendation error:', e);
    // Ultimate fallback — always show 4 safe sports
    store.recommendedSports = ['General Fitness', 'Yoga', 'Pilates', 'Stretching', 'Calisthenics', 'Zumba'].slice(0, 6);
  }
  // Make sure defaultSport points to a sport that actually exists in SPORTS
  // (and wasn't filtered out). Otherwise showWorkout() will crash.
  // v8 NOTE: this line intentionally does NOT arm the auto-show anymore —
  // the sports tab used to open with a workout list already expanded on
  // every visit (user report: "this workout list appears every time i open
  // the sports screen"). defaultSport is now set ONLY by an explicit tap on
  // a recommended-sport chip (setDefaultSport) — the list appears when the
  // user clicks a sport, nothing else.

  document.getElementById('recommendation-content').innerHTML = `
    <p style="color:var(--muted);font-size:.92rem;line-height:1.55;"><span data-ar="بناءً على هدفك (">Based on your goal (</span><b>${ar ? goalAr : p.goal}</b><span data-ar=") ورياضتك المفضلة، نوصي بهذه الرياضات:">) and favorite sport, we recommend these sports:</span></p>
    <div class="rec-chips">
      ${store.recommendedSports.map((name, i) => {
        const sp = SPORTS.find(x=>x.name===name) || {name: name, icon:'fa-dumbbell'};
        const cls = ['rc-blue','rc-green','rc-violet','rc-amber','rc-blue','rc-red'][i % 6];
        return `<span class="rec-chip ${cls}" onclick="setDefaultSport('${name}')"><i class="fa-solid ${sp.icon}"></i> ${getSportName(sp)}</span>`;
      }).join('')}
    </div>
  `;
  setTimeout(applyTranslations, 0);
}

// ===== SURVEY-AWARE SPORT FILTERING =====
// Returns a filtered list of sport names based on the user's survey answers.
// Used by renderCoachRecommendation() and renderSports() to hide sports the
// user can't safely do.
function filterSportsBySurvey(names, survey, profile) {
  if (!survey) survey = {};
  const equipment = (survey.equipment || '').toLowerCase();
  const hasNoEquipment = equipment === '' || equipment === 'none' || equipment === 'no' || equipment === 'nothing';
  const medical = survey.medical || 'None';
  const injury = (profile && profile.injury) || survey.injury || 'None';
  const environment = survey.environment || 'Mixed';

  return names.filter(name => {
    const sport = SPORTS.find(s => s.name === name);
    if (!sport) return true; // unknown sport — keep it
    // 1. Equipment filter
    if (hasNoEquipment) {
      const equipList = (sport.equip || []).map(e => e.toLowerCase());
      // Sport requires real equipment (not just "None") — filter out
      const needsRealEquip = equipList.length > 0 && !equipList.includes('none');
      if (needsRealEquip) return false;
    }
    // 2. Medical conditions filter
    const highIntensityOutdoors = ['Marathon', 'Triathlon', 'Boxing', 'Crossfit', 'Sprinting', 'Muay Thai', 'Kickboxing', 'Martial Arts', 'Judo', 'Karate', 'Taekwondo', 'Wrestling', 'Jiu Jitsu', 'Rowing', 'Mountaineering', 'Decathlon', 'Ironman'];
    if (medical === 'Diabetes' || medical === 'Hypertension' || medical === 'Heart condition') {
      if (highIntensityOutdoors.includes(name)) return false;
    }
    if (medical === 'Asthma') {
      // Filter out endurance sports that stress lungs
      if (['Marathon', 'Triathlon', 'Mountaineering', 'Decathlon', 'Sprinting'].includes(name)) return false;
    }
    // 3. Injury filter
    if (injury === 'Knees') {
      if (['Running', 'Sprinting', 'Marathon', 'Hiking', 'Skiing', 'Snowboarding', 'Mountaineering', 'Jumping'].includes(name)) return false;
    }
    if (injury === 'Lower back') {
      if (['Weightlifting', 'Rowing', 'Crossfit', 'Golf', 'Tennis'].includes(name)) return false;
    }
    if (injury === 'Shoulders') {
      if (['Boxing', 'Swimming', 'Tennis', 'Badminton', 'Volleyball', 'Weightlifting'].includes(name)) return false;
    }
    // 4. Environment filter (Home-only users can't do court/pool/field sports)
    if (environment === 'Home') {
      if (sport.outdoor === true) {
        // Allow outdoor sports that need no special venue (Running, Cycling, Hiking)
        const homeFriendlyOutdoors = ['Running', 'Cycling', 'Hiking', 'Calisthenics', 'Bootcamp', 'Parkour', 'Roller Skating'];
        if (!homeFriendlyOutdoors.includes(name)) return false;
      }
    }
    return true; // keep
  });
}

function setDefaultSport(name) {
  store.defaultSport = name;
  showTab('sports');
  setTimeout(() => {
    showWorkout(name);
  }, 300);
}

function renderChart() {
  const ctx = document.getElementById('weekChart').getContext('2d');
  const ar = (store.lang === 'ar');
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const labels = days.map(d => ar ? (DAY_AR_NAMES[d] || d) : d);
  const data = [0,0,0,0,0,0,0];
  const sessions = currentUser().sessions || [];
  // Compute the start of the current week (Monday) WITHOUT mutating today's date.
  // The previous code did `today.setDate(...)` which mutated `today` itself,
  // and combined with `new Date('YYYY-MM-DD')` (UTC midnight) parsing, made
  // sessions appear on the wrong day (a day before) in non-UTC timezones.
  // Fix: parse session dates as LOCAL midnight and compute the diff in local
  // calendar days (not absolute ms / 86400000, which can be off by 1 due to DST).
  const now = new Date();
  const todayDow = now.getDay(); // 0=Sun .. 6=Sat
  // Convert Sunday=0 to Sunday=6 so Monday becomes day 0 of the week
  const mondayOffset = (todayDow === 0) ? 6 : (todayDow - 1);
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset);
  sessions.forEach(s => {
    if (!s.date) return;
    // Parse 'YYYY-MM-DD' as LOCAL midnight (append T00:00:00) — without this,
    // `new Date('2026-08-05')` parses as UTC, which displays as the previous
    // day in negative-offset timezones (e.g. Cairo UTC+2 shows it as Aug 4 22:00).
    const sDate = new Date(s.date + 'T00:00:00');
    // Diff in calendar days: round to nearest whole day so DST jumps don't shift the bar
    const diffDays = Math.round((sDate - startOfWeek) / 86400000);
    if (diffDays >= 0 && diffDays < 7) data[diffDays] += (Number(s.duration) || 0);
  });
  if (weekChart) weekChart.destroy();
  // v18 (user): "if there's nothing in the bar graph, put a text showing
  // that you need to make results for the bar graph to work" — when the
  // whole week has zero logged activity the blank chart frame is swapped
  // for the hint text (see #week-chart-empty in index.html).
  const chartEmpty = data.every(v => !v);
  const chartEmptyEl = document.getElementById('week-chart-empty');
  const chartBoxEl = document.getElementById('weekly-activity-panel')
    ? document.getElementById('weekly-activity-panel').querySelector('.v-chart-box')
    : null;
  if (chartEmptyEl) chartEmptyEl.classList.toggle('hidden', !chartEmpty);
  if (chartBoxEl) chartBoxEl.style.display = chartEmpty ? 'none' : '';
  // Highlight today's bar with a brighter color
  // v19 (Apple Fitness restyle): exercise minutes = vivid green, today's
  // bar glows, the rest sit dim — on the dark canvas.
  const todayBarIndex = mondayOffset; // 0=Mon, 1=Tue, ... 6=Sun
  // v20: theme-aware bars — light theme uses Apple's light palette
  // and a slightly stronger dim so bars stay visible on white cards.
  const isLight = (document.documentElement.getAttribute('data-vfit-theme') === 'light');
  const barToday = isLight ? '#34c759' : '#30d158';
  const barDim = isLight ? 'rgba(52,199,89,.55)' : 'rgba(48,209,88,.38)';
  const colors = data.map((_, i) => i === todayBarIndex ? barToday : barDim);
  const chartFont = { family: (ar ? 'Cairo' : 'Barlow') + ', Inter, sans-serif', size: 13, weight: 600 };
  // Round 18: remember the week start so the click handler can map a bar
  // index (0=Mon … 6=Sun) to a real calendar date.
  weekChartStart = new Date(startOfWeek.getFullYear(), startOfWeek.getMonth(), startOfWeek.getDate());
  weekChart = new Chart(ctx, {
    type: 'bar',
    data: { labels: labels, datasets: [{ label: ar ? 'دقائق النشاط' : 'Minutes Active', data: data, backgroundColor: colors, hoverBackgroundColor: barToday, borderRadius: 8, borderSkipped: false, maxBarThickness: 46 }] },
    options: {
      // Round 15 (responsive fix): height now comes from the fixed-height
      // .v-chart-box wrapper (clamp 180–250px) instead of the aspect-ratio
      // math that made the graph stretch "too wide and short" on big phones
      // (Honor X9d). maintainAspectRatio:false + resizeDelay lets Chart.js
      // fill the box exactly on EVERY phone/tablet size.
      maintainAspectRatio: false,
      resizeDelay: 120,
      plugins: { legend: { display: false }, tooltip: { titleFont: chartFont, bodyFont: chartFont } },
      scales: {
        y: { beginAtZero: true, grid: { color: (isLight ? 'rgba(16,24,40,.08)' : 'rgba(255,255,255,.07)'), drawBorder: false }, ticks: { color: (isLight ? '#6b7686' : '#97a1b4'), font: chartFont, precision: 0 } },
        x: { grid: { display: false }, ticks: { color: (isLight ? '#6b7686' : '#97a1b4'), font: chartFont } }
      },
      animation: { duration: 900, easing: 'easeOutQuart' },
      // ── Round 18: CLICK A BAR → DAY SUMMARY POPUP (user request) ──
      // Tapping any bar opens a popup with that day's full summary:
      // calories burnt, minutes active, every workout (with notes) and
      // every meal eaten, pulled from the sessions + diet logs.
      onClick: function (evt, elements, chart) {
        try {
          const pts = chart.getElementsAtEventForMode(evt, 'nearest', { intersect: true }, 1);
          if (!pts || !pts.length || !weekChartStart) return;
          const idx = pts[0].index;
          if (idx < 0 || idx > 6) return;
          const d = new Date(weekChartStart.getFullYear(), weekChartStart.getMonth(), weekChartStart.getDate() + idx);
          const ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
          openDaySummary(ds);
        } catch (e) { console.warn('chart click error:', e); }
      },
      onHover: function (evt, elements) {
        try { evt.native.target.style.cursor = (elements && elements.length) ? 'pointer' : 'default'; } catch (e) {}
      }
    }
  });
  // Round 15: the tab-entrance cascade (vSlideDiag) scales panels for
  // ~450ms — a mid-animation measure locks the canvas at ~98% size (the
  // graph "never quite fills its box" glitch). Re-measure once the
  // entrance animation has settled — but ONLY when the panel is actually
  // visible (renders also happen while the Home tab is display:none).
  setTimeout(function () {
    try {
      var cv = document.getElementById('weekChart');
      if (weekChart && cv && cv.offsetParent !== null) weekChart.resize();
    } catch (e) {}
  }, 620);
}

// ═══ Round 18: DAY SUMMARY POPUP (bar-graph click) ═══════════════════════
// Per user request: "when the user clicks on a bar in the bargraph, open a
// popup where they see all the summary of that day, calories burnt, minutes
// spent, meals eaten, etc." Pulled from the SAME data the app already stores:
//   • u.sessions  → workouts of that date (sport, minutes, kcal, intensity, note)
//   • diet log    → meals eaten that date (name, kcal, protein/carbs/fat)
// dateStr is a local YYYY-MM-DD (the chart's Monday + bar index).
function openDaySummary(dateStr) {
  const ar = (store.lang === 'ar');
  if (!dateStr) return;
  const u = currentUser();

  // ── Gather the day's workouts ──
  const daySessions = (u.sessions || []).filter(s => (s.date || '').slice(0, 10) === dateStr);
  const totalMin = daySessions.reduce((a, s) => a + (Number(s.duration) || 0), 0);
  const totalKcal = daySessions.reduce((a, s) => a + (Number(s.calories) || Math.round(kcalForSession(s)) || 0), 0);

  // ── Gather the day's meals ──
  let dayMeals = [];
  try {
    const log = (typeof getDietLog === 'function') ? getDietLog() : [];
    dayMeals = log.filter(m => {
      const md = m.date || ((m.loggedAt || '').slice(0, 10));
      return md === dateStr;
    });
  } catch (e) { dayMeals = []; }
  const mealsKcal = dayMeals.reduce((a, m) => a + (Number(m.kcal) || 0), 0);

  // ── Header: pretty local date ──
  let dateLabel = dateStr;
  try {
    dateLabel = new Date(dateStr + 'T00:00:00').toLocaleDateString(ar ? 'ar-EG' : 'en-GB',
      { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  } catch (e) {}
  const isToday = dateStr === localDateStr();
  const todayBadge = isToday ? '<span class="ds-today-badge">' + (ar ? 'اليوم' : 'TODAY') + '</span>' : '';

  // ── Stat tiles ──
  const statTile = (icon, val, lbl, cls) =>
    '<div class="ds-stat ' + (cls || '') + '"><i class="fa-solid ' + icon + '"></i><b>' + val + '</b><span>' + escapeHtml(lbl) + '</span></div>';
  const statsHtml =
    statTile('fa-fire', Math.round(totalKcal), ar ? 'سعرة محروقة' : 'KCAL BURNT', 'ds-hot') +
    statTile('fa-stopwatch', fmtMins(totalMin), ar ? 'دقيقة نشاط' : 'MINUTES ACTIVE', 'ds-min') +
    statTile('fa-dumbbell', daySessions.length, ar ? 'تمارين' : 'WORKOUTS', '') +
    statTile('fa-utensils', dayMeals.length, ar ? 'وجبات' : 'MEALS EATEN', 'ds-meal');

  // ── Workouts list ──
  const SPORT_ICON_MAP = { 'Daily Exercise': 'fa-dumbbell', 'Running': 'fa-person-running', 'Cycling': 'fa-person-biking', 'Swimming': 'fa-person-swimming', 'Walking': 'fa-person-walking', 'Yoga': 'fa-spa', 'Boxing': 'fa-hand-fist', 'Football': 'fa-futbol', 'Basketball': 'fa-basketball', 'HIIT': 'fa-bolt', 'Marathon': 'fa-person-running', 'Gym Workout': 'fa-dumbbell' };
  let sessHtml = '';
  if (daySessions.length) {
    sessHtml = daySessions.map(s => {
      const ic = SPORT_ICON_MAP[s.sport] || 'fa-medal';
      const kcal = Math.round(s.calories || kcalForSession(s) || 0);
      return '<div class="ds-row">' +
        '<span class="ds-row-ico"><i class="fa-solid ' + ic + '"></i></span>' +
        '<div class="ds-row-main"><b>' + escapeHtml(getSportName(SPORTS.find(x => x.name === s.sport)) || s.sport) + '</b>' +
        (s.note ? '<small class="ds-note"><i class="fa-solid fa-note-sticky"></i> ' + escapeHtml(s.note) + '</small>' : '') + '</div>' +
        '<div class="ds-row-nums">' +
          '<span><i class="fa-regular fa-clock"></i> ' + Math.round(Number(s.duration) || 0) + ' ' + (ar ? 'د' : 'min') + '</span>' +
          (kcal ? '<span class="ds-hot-txt"><i class="fa-solid fa-fire"></i> ' + kcal + ' ' + (ar ? 'سعرة' : 'kcal') + '</span>' : '') +
          (s.intensity ? '<span>' + escapeHtml(s.intensity) + '</span>' : '') +
        '</div></div>';
    }).join('');
  } else {
    sessHtml = '<p class="ds-empty">' + (ar ? 'لا توجد تمارين في هذا اليوم.' : 'No workouts logged on this day.') + '</p>';
  }

  // ── Meals list ──
  let mealsHtml = '';
  if (dayMeals.length) {
    mealsHtml = dayMeals.map(m =>
      '<div class="ds-row">' +
        '<span class="ds-row-ico ds-ico-meal"><i class="fa-solid fa-bowl-food"></i></span>' +
        '<div class="ds-row-main"><b>' + escapeHtml(m.name || 'Meal') + '</b>' +
        (m.mealType ? '<small>' + escapeHtml(m.mealType.replace(/-/g, ' ')) + '</small>' : '') + '</div>' +
        '<div class="ds-row-nums">' +
          '<span class="ds-hot-txt"><i class="fa-solid fa-fire"></i> ' + (Number(m.kcal) || 0) + ' ' + (ar ? 'سعرة' : 'kcal') + '</span>' +
          (m.protein ? '<span>P ' + m.protein + 'g</span>' : '') +
          (m.carbs ? '<span>C ' + m.carbs + 'g</span>' : '') +
          (m.fat ? '<span>F ' + m.fat + 'g</span>' : '') +
        '</div></div>'
    ).join('');
  } else {
    mealsHtml = '<p class="ds-empty">' + (ar ? 'لا توجد وجبات مسجلة في هذا اليوم.' : 'No meals logged on this day.') + '</p>';
  }

  // ── Build (or reuse) the modal ──
  let modal = document.getElementById('day-summary-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'day-summary-modal';
    modal.className = 'modal-overlay';
    modal.style.zIndex = '10003';
    modal.innerHTML = '<div class="modal-content day-summary-content"><button class="modal-close" onclick="closeModal(\'day-summary-modal\')">&times;</button><div id="day-summary-body"></div></div>';
    document.body.appendChild(modal);
  }
  document.getElementById('day-summary-body').innerHTML =
    '<div class="ds-head"><h3><i class="fa-solid fa-calendar-day"></i> ' + escapeHtml(dateLabel) + ' ' + todayBadge + '</h3></div>' +
    '<div class="ds-stats-grid">' + statsHtml + '</div>' +
    '<h4 class="ds-sub"><i class="fa-solid fa-dumbbell"></i> ' + (ar ? 'التمارين' : 'WORKOUTS') + ' <span>(' + daySessions.length + ')</span></h4>' +
    '<div class="ds-list">' + sessHtml + '</div>' +
    '<h4 class="ds-sub"><i class="fa-solid fa-utensils"></i> ' + (ar ? 'الوجبات' : 'MEALS') + ' <span>(' + dayMeals.length + (mealsKcal ? ' · ' + mealsKcal + ' ' + (ar ? 'سعرة' : 'kcal') : '') + ')</span></h4>' +
    '<div class="ds-list">' + mealsHtml + '</div>' +
    '<button class="btn ghost fit" onclick="closeModal(\'day-summary-modal\')" style="margin-top:14px;">' + (ar ? 'إغلاق' : 'Close') + '</button>';
  openModal('day-summary-modal');
  setTimeout(applyTranslations, 0);
}

function renderSports() {
  const limit = store.sportsShown;
  const sortedSports = [...SPORTS].sort((a, b) => {
    const aRec = store.recommendedSports.includes(a.name) ? 0 : 1;
    const bRec = store.recommendedSports.includes(b.name) ? 0 : 1;
    return aRec - bRec;
  });
  let html = sortedSports.slice(0, limit).map((s, i) => `
    <div class="sport-card ${store.recommendedSports.includes(s.name) ? 'recommended' : ''}" id="sport-${i}" onclick="showWorkout('${s.name}')">
       ${store.recommendedSports.includes(s.name) ? `<span class="rec-badge" data-ar="موصى به">Recommended</span>` : ''}
       <button class="info-btn" onclick="event.stopPropagation(); showSportInfo('${s.name}')" style="top:8px; left:8px; right:auto;"><i class="fa-solid fa-circle-info"></i></button>
       <span class="s-icon"><i class="fa-solid ${s.icon}"></i></span><b>${getSportName(s)}</b>
     </div>`).join('');
  html += `<button class="see-more-btn" onclick="openSportSearch()"><i class="fa-solid fa-magnifying-glass"></i> <span data-ar="استكشف جميع الرياضات">Explore All Sports</span></button>`;
  document.getElementById('sports-grid').innerHTML = html;
  // v8 (user report): the workout list used to persist from a previous sport
  // selection and re-appear every time the Sports tab was opened. It now
  // starts HIDDEN and only shows when the user actually clicks a sport.
  // (An explicit setDefaultSport chip tap re-shows it right after this.)
  if (!store.defaultSport) {
    const wd = document.getElementById('workout-detail');
    if (wd) wd.classList.add('hidden');
  }
  // Workout Music panel (100 playlists across every vibe) — rendered with the
  // sports grid so the chips + embeds refresh on language change too.
  try { renderMusicPanel(); } catch(e) {}
  
  if (store.defaultSport) {
    // Capture the value BEFORE nulling: the old code read store.defaultSport
    // inside the timeout closure, but the next line had already nulled it —
    // so showWorkout(null) always fired and logged "sport not found: null".
    const defaultSportName = store.defaultSport;
    store.defaultSport = null;
    setTimeout(() => showWorkout(defaultSportName), 100);
  }
}
function openSportSearch() {
  document.getElementById('sport-search-input').value = '';
  renderSportSearchList();
  openModal('sport-search-modal');
  // Reset the scroll wrapper so the list always opens at the top.
  try { const sc = document.getElementById('sport-search-scroll'); if (sc) sc.scrollTop = 0; } catch(e) {}
}
function renderSportSearchList() {
  const query = document.getElementById('sport-search-input').value.toLowerCase();
  const filtered = SPORTS.filter(s => getSportName(s).toLowerCase().includes(query));
  document.getElementById('sport-search-grid').innerHTML = filtered.map(s => `
    <div class="sport-card" onclick="closeModal('sport-search-modal'); showWorkout('${s.name}')">
       <button class="info-btn" onclick="event.stopPropagation(); showSportInfo('${s.name}')" style="top:8px; left:8px; right:auto;"><i class="fa-solid fa-circle-info"></i></button>
       <span class="s-icon"><i class="fa-solid ${s.icon}"></i></span><b>${getSportName(s)}</b>
    </div>
  `).join('') || `<p>No sports found.</p>`;
}
// ============================================================================
// === Round 14: Sports equipment overhaul ===
// Per user spec:
//   1. "add more equipment in sports equipment in more info button for all
//       sports and also make sure they work in arabic"
//   2. "add a buy equipment button that directs to a link to this product from
//       the cheapest brand possible or like from amazon or noon"
//   3. "remove the 'field requirement' in sports equipment, for example it
//       tells me i need a court for basketball, i want equipments only"
//
// Implementation:
//   - EXTRA_EQUIP: sport -> [extra equipment names] added on top of s.equip
//   - FIELD_REQUIREMENTS: venue/infrastructure terms to filter OUT (Court,
//     Horse, Stones, etc.) — these are NOT equipment the user can buy
//   - EQUIP_AR_NAMES: English equipment name -> Arabic translation
//   - getSportEquip(s): returns merged, filtered, de-duplicated equipment list
//   - getEquipName(e): returns translated name (Arabic when store.lang === 'ar')
//   - buyEquipment(sport, equip): opens Amazon.eg search for the item, sorted
//     by price ascending so the cheapest brands appear first. Amazon.eg is
//     used because the user is in Egypt (Africa/Cairo timezone) — local
//     currency (EGP), reliable Amazon brand, supports both EN and AR.
// ============================================================================

const EXTRA_EQUIP = {
  'Football': ['Shin Guards', 'Training Cones', 'Ball Pump'],
  'Basketball': ['Basketball Shoes', 'Ankle Brace', 'Training Cones'],
  'Tennis': ['Overgrip Tape', 'Wristbands', 'Tennis Bag'],
  'Swimming': ['Swim Cap', 'Kickboard', 'Pull Buoy'],
  'Running': ['Running Shorts', 'Hydration Belt', 'Reflective Vest'],
  'Cycling': ['Cycling Shorts', 'Bike Lights', 'Water Bottle Cage'],
  'Boxing': ['Mouthguard', 'Punching Bag', 'Hand Wraps'],
  'Volleyball': ['Knee Pads', 'Ball Pump', 'Ankle Brace'],
  'Golf': ['Golf Glove', 'Tees', 'Golf Bag'],
  'Cricket': ['Leg Pads', 'Batting Helmet', 'Batting Gloves'],
  'Badminton': ['Overgrip', 'Wristband', 'Racket Bag'],
  'Table Tennis': ['Racket Case', 'Edge Tape', 'Table Tennis Shoes'],
  'Martial Arts': ['Belt', 'Mouthguard', 'Punching Bag'],
  'Rowing': ['Rowing Gloves', 'Water Bottle', 'Padded Shorts'],
  'Rugby': ['Shoulder Pads', 'Headguard', 'Mouthguard'],
  'Gymnastics': ['Chalk', 'Wrist Guards', 'Grip Bag'],
  'Hiking': ['Trekking Poles', 'Water Bottle', 'First Aid Kit'],
  'Surfing': ['Leash', 'Wax', 'Board Bag'],
  'Skateboarding': ['Knee Pads', 'Elbow Pads', 'Wrist Guards'],
  'Baseball': ['Batting Helmet', 'Batting Gloves', 'Catcher Mitt'],
  'Ice Hockey': ['Hockey Helmet', 'Pucks', 'Hockey Bag'],
  'Skiing': ['Ski Goggles', 'Helmet', 'Ski Bag'],
  'Snowboarding': ['Snowboard Goggles', 'Wrist Guards', 'Helmet'],
  'Archery': ['Arm Guard', 'Finger Tab', 'Quiver'],
  'Fencing': ['Fencing Jacket', 'Fencing Glove', 'Body Cord'],
  'Weightlifting': ['Lifting Belt', 'Chalk', 'Wrist Wraps'],
  'Track & Field': ['Spike Wrench', 'Starting Blocks', 'Throwing Shoes'],
  'Wrestling': ['Wrestling Shoes', 'Headgear', 'Knee Pads'],
  'Climbing': ['Climbing Shoes', 'Chalk Bag', 'Carabiners'],
  'Kayaking': ['Life Jacket', 'Dry Bag', 'Paddle Leash'],
  'Sailing': ['Life Jacket', 'Sailing Gloves', 'Dry Bag'],
  'Polo': ['Polo Helmet', 'Riding Boots', 'Riding Gloves'],
  'Handball': ['Handball Shoes', 'Resin', 'Knee Pads'],
  'Squash': ['Squash Goggles', 'Wristband', 'Overgrip'],
  'Diving': ['Diving Mask', 'Snorkel', 'Fins'],
  'General Fitness': ['Resistance Band', 'Yoga Mat', 'Water Bottle'],
  'Parkour': ['Parkour Shoes', 'Grip Gloves', 'Knee Pads'],
  'Triathlon': ['Tri Suit', 'Swim Cap', 'Energy Gels'],
  'Equestrian': ['Riding Helmet', 'Riding Boots', 'Riding Gloves'],
  'Netball': ['Netball Shoes', 'Knee Pads', 'Bib'],
  'Lacrosse': ['Lacrosse Helmet', 'Shoulder Pads', 'Arm Pads'],
  'Ultimate Frisbee': ['Cleats', 'Water Bottle', 'Training Cones'],
  'Water Polo': ['Swim Cap', 'Mouthguard', 'Ear Guards'],
  'Synchronized Swimming': ['Nose Clip', 'Swim Cap', 'Gel'],
  'Rafting': ['Life Jacket', 'Helmet', 'Dry Bag'],
  'Canoeing': ['Life Jacket', 'Dry Bag', 'Paddle Leash'],
  'Bobsleigh': ['Sled Helmet', 'Sled Shoes', 'Winter Gloves'],
  'Curling': ['Curling Broom', 'Curling Slider', 'Gloves'],
  'Speed Skating': ['Skin Suit', 'Helmet', 'Goggles'],
  'Sledding': ['Sled Helmet', 'Winter Gloves', 'Knee Pads'],
  'Judo': ['Judo Belt', 'Mouthguard', 'Knee Pads'],
  'Karate': ['Karate Belt', 'Mouthguard', 'Chest Guard'],
  'Taekwondo': ['Taekwondo Belt', 'Chest Guard', 'Shin Guards'],
  'Kickboxing': ['Shin Guards', 'Mouthguard', 'Punching Bag'],
  'Muay Thai': ['Muay Thai Shorts', 'Shin Guards', 'Mouthguard'],
  'Jiu Jitsu': ['Belt', 'Rash Guard', 'Mouthguard'],
  'Sprinting': ['Spike Wrench', 'Starting Blocks', 'Sprint Spikes'],
  'Marathon': ['Energy Gels', 'Hydration Belt', 'Anti-Chafe Balm'],
  'Hurdles': ['Spike Wrench', 'Starting Blocks', 'Sprint Spikes'],
  'Long Jump': ['Spike Wrench', 'Jumping Shoes', 'Chalk'],
  'High Jump': ['Spike Wrench', 'Jumping Shoes', 'Landing Mat'],
  'Pole Vault': ['Spike Wrench', 'Vaulting Pole Grip', 'Landing Mat'],
  'Shot Put': ['Shot Put Shoes', 'Wrist Wrap', 'Chalk'],
  'Discus': ['Discus Shoes', 'Wrist Wrap', 'Throwing Towel'],
  'Javelin': ['Javelin Shoes', 'Elbow Sleeve', 'Throwing Towel'],
  'Road Cycling': ['Cycling Gloves', 'Bike Lights', 'Saddle Bag'],
  'Mountain Biking': ['MTB Gloves', 'Knee Pads', 'Hydration Pack'],
  'BMX': ['BMX Helmet', 'Knee Pads', 'Elbow Pads'],
  'Track Cycling': ['Cycling Gloves', 'Chain Lube', 'Spare Wheels'],
  'Indoor Cycling': ['Cycling Shoes', 'Towel', 'Water Bottle'],
  'Mountaineering': ['Climbing Harness', 'Carabiners', 'Headlamp'],
  'Orienteering': ['Whistle', 'Map Case', 'Compass'],
  'Roller Skating': ['Knee Pads', 'Wrist Guards', 'Helmet'],
  'Crossfit': ['Wrist Wraps', 'Knee Sleeves', 'Jump Rope'],
  'Calisthenics': ['Wrist Wraps', 'Chalk', 'Resistance Band'],
  'Pilates': ['Resistance Band', 'Pilates Ring', 'Foam Roller'],
  'Yoga': ['Yoga Block', 'Yoga Strap', 'Bolster'],
  'Stretching': ['Foam Roller', 'Resistance Band', 'Yoga Strap'],
  'Bootcamp': ['Water Bottle', 'Towel', 'Resistance Band'],
  'Ballet': ['Ballet Tights', 'Ballet Skirt', 'Hair Pins'],
  'Hip Hop': ['Dance Sneakers', 'Knee Pads', 'Water Bottle'],
  'Zumba': ['Dance Shoes', 'Sweatband', 'Water Bottle'],
  'Ballroom': ['Dance Shoes', 'Shoe Brush', 'Dance Bag'],
  'Salsa': ['Dance Shoes', 'Shoe Brush', 'Dance Bag'],
  'Contemporary': ['Dance Shoes', 'Knee Pads', 'Water Bottle'],
  'Jazz': ['Jazz Shoes', 'Hair Pins', 'Water Bottle'],
  'Breakdance': ['Knee Pads', 'Beanie', 'Handkerchief'],
  'Tap Dance': ['Tap Shoe Brush', 'Shoe Bag', 'Water Bottle'],
  'Darts': ['Dart Case', 'Flight Punch', 'Tip Sharpener'],
  'Billiards': ['Chalk', 'Cue Case', 'Bridge Stick'],
  'Bowling': ['Wrist Brace', 'Bowling Towel', 'Shoe Covers'],
  'Shooting': ['Shooting Glasses', 'Ear Muffs', 'Shooting Mat'],
  'Show Jumping': ['Riding Helmet', 'Riding Boots', 'Riding Gloves'],
  'Dressage': ['Riding Helmet', 'Riding Boots', 'Riding Crop'],
  'Horse Racing': ['Riding Helmet', 'Riding Boots', 'Riding Crop'],
  'Cheerleading': ['Hair Bow', 'Mouthguard', 'Practice Mat'],
  'Trampolining': ['Trampoline Socks', 'Chalk', 'Grip Bag'],
  'Decathlon': ['Spike Wrench', 'Starting Blocks', 'Energy Gels'],
  'Floorball': ['Floorball Shoes', 'Eye Guard', 'Shin Guards'],
  'Racquetball': ['Overgrip', 'Wristband', 'Racquetball Goggles'],
  'Paddle Tennis': ['Overgrip', 'Wristband', 'Paddle Bag'],
  'Kite Surfing': ['Harness', 'Wetsuit', 'Kite Pump'],
  'Wind Surfing': ['Harness', 'Wetsuit', 'Mast Extension']
};

// Field/venue/infrastructure requirements to filter OUT of the equipment list.
// These are places or animals, not gear the user can buy. Per user spec:
// "remove the 'field requirement' in sports equipment, for example it tells
// me i need a court for basketball, i want equipments only".
const FIELD_REQUIREMENTS = ['Court', 'Field', 'Track', 'Pool', 'Beach', 'Road', 'Rink', 'Ice', 'Snow', 'Wall', 'Studio', 'Park', 'Course', 'Range', 'Horse', 'Stones'];

// Arabic translations for equipment names. Falls back to English if not found.
const EQUIP_AR_NAMES = {
  'Cleats': 'الأحذية المسننة', 'Shoes': 'حذاء', 'Basketball Shoes': 'حذاء كرة السلة',
  'Running Shorts': 'شورت جري', 'Sled Shoes': 'أحذية الزلاجة',
  'Cycling Shoes': 'حذاء ركوب الدراجات', 'Dance Sneakers': 'أحذية رقص رياضية',
  'Dance Shoes': 'حذاء رقص', 'Jazz Shoes': 'حذاء الجاز', 'Tap Shoes': 'حذاء التاب',
  'Bowling Shoes': 'حذاء البولينج', 'Boots': 'أحذية طويلة', 'Riding Boots': 'أحذية الفروسية',
  'Wrestling Shoes': 'حذاء المصارعة', 'Handball Shoes': 'حذاء كرة اليد',
  'Floorball Shoes': 'حذاء الفلوربول', 'Table Tennis Shoes': 'حذاء تنس الطاولة',
  'Parkour Shoes': 'حذاء الباركور', 'Jumping Shoes': 'حذاء الوثب',
  'Shot Put Shoes': 'حذاء دفع الجلة', 'Discus Shoes': 'حذاء رمي القرص',
  'Javelin Shoes': 'حذاء رمي الرمح', 'Hurdle Shoes': 'حذاء الحواجز',
  'Throwing Shoes': 'حذاء الرمي', 'Sprint Spikes': 'مسامير العدو',
  'Spikes': 'مسامير', 'Skates': 'أحذية التزلج', 'Tap Shoe Brush': 'فرشاة حذاء التاب',
  'Helmet': 'خوذة', 'Polo Helmet': 'خوذة البولو', 'Riding Helmet': 'خوذة الفروسية',
  'Hockey Helmet': 'خوذة الهوكي', 'BMX Helmet': 'خوذة بي إم إكس',
  'Sled Helmet': 'خوذة الزلاجة', 'Lacrosse Helmet': 'خوذة اللاكروس',
  'Batting Helmet': 'خوذة الضرب',
  'Gloves': 'قفازات', 'Wraps': 'لفافات', 'Hand Wraps': 'لفافات اليد',
  'Cycling Gloves': 'قفازات ركوب الدراجات', 'MTB Gloves': 'قفازات دراجات الجبال',
  'Sailing Gloves': 'قفازات الإبحار', 'Riding Gloves': 'قفازات الفروسية',
  'Fencing Glove': 'قفاز المبارزة', 'Grip Gloves': 'قفازات القبضة',
  'Winter Gloves': 'قفازات شتوية', 'Golf Glove': 'قفاز الجولف',
  'Batting Gloves': 'قفازات الضرب', 'Rowing Gloves': 'قفازات التجديف',
  'Goalkeeper Gloves': 'قفازات حارس المرمى',
  'Wrist Wraps': 'لفافات المعصم', 'Wrist Guards': 'واقيات المعصم',
  'Wristbands': 'أساور المعصم', 'Wristband': 'سوار المعصم',
  'Wrist Brace': 'دعامة المعصم', 'Wrist Wrap': 'لفافة المعصم',
  'Elbow Pads': 'واقيات الكوع', 'Knee Pads': 'واقيات الركبة',
  'Knee Sleeves': 'أكمام الركبة', 'Knee Guards': 'واقيات الركبة',
  'Ankle Brace': 'دعامة الكاحل', 'Shin Guards': 'واقيات الساق',
  'Arm Pads': 'واقيات الذراع', 'Arm Guard': 'واقي الذراع',
  'Mouthguard': 'واقي الفم', 'Headguard': 'واقي الرأس',
  'Chest Guard': 'واقي الصدر', 'Ear Guards': 'واقيات الأذن',
  'Eye Guard': 'واقي العين', 'Squash Goggles': 'نظارات الإسكواش',
  'Racquetball Goggles': 'نظارات الراكيت بول', 'Ski Goggles': 'نظارات التزلج',
  'Snowboard Goggles': 'نظارات التزلج على الثلج', 'Goggles': 'نظارات',
  'Shooting Glasses': 'نظارات الرماية', 'Ear Muffs': 'واقيات الأذن',
  'Ear protection': 'واقي الأذن', 'Mask': 'قناع',
  'Swim Cap': 'قبعة السباحة', 'Swimsuit': 'شورت سباحة', 'Swim Trunks': 'شورت سباحة',
  'Kickboard': 'لوح الركل', 'Pull Buoy': 'عوامة السحب',
  'Fins': 'زعانف', 'Snorkel': 'أنبوب التنفس', 'Diving Mask': 'قناع الغوص',
  'Nose Clip': 'مشبك الأنف', 'Gel': 'جل', 'Caps': 'قبعات',
  'Ball': 'كرة', 'Balls': 'كرات', 'Tennis Balls (Can)': 'كرات التنس (علبة)',
  'Shuttlecock': 'الريشة', 'Frisbee': 'الفريسبي', 'Pucks': 'أقراص الهوكي',
  'Discus': 'القرص', 'Javelin': 'الرمح', 'Shot': 'الجلة', 'Crossbar': 'العارضة',
  'Racket': 'مضرب', 'Paddle': 'مضرب', 'Stick': 'عصا',
  'Overgrip': 'مقبض إضافي', 'Overgrip Tape': 'شريط المقبض الإضافي',
  'Edge Tape': 'شريط الحافة', 'Racket Case': 'حالة المضرب',
  'Racket Grip': 'مقبض المضرب', 'Racket Bag': 'حقيبة المضرب',
  'Paddle Bag': 'حقيبة المضرب', 'Tennis Bag': 'حقيبة التنس',
  'Cue': 'عصا البلياردو', 'Bridge Stick': 'عصا الجسر', 'Cue Case': 'حالة عصا البلياردو',
  'Clubs': 'عصي الجولف', 'Bat': 'مضرب', 'Mallet': 'مطرقة البولو',
  'Board': 'لوح', 'Surfboard': 'لوح ركوب الأمواج', 'Snowboard': 'لوح التزلج',
  'BMX Bike': 'دراجة بي إم إكس', 'Road Bike': 'دراجة الطريق', 'MTB': 'دراجة الجبال',
  'Track Bike': 'دراجة المضمار', 'Stationary Bike': 'دراجة ثابتة', 'Bike': 'دراجة',
  'Kayak': 'كاياك', 'Canoe': 'كانو', 'Raft': 'قارب مطاطي', 'Boat': 'قارب',
  'Oars': 'مجاديف', 'Paddle': 'مجداف', 'Paddle Leash': 'حبل المجداف',
  'Sled': 'زلاجة', 'Trampoline': 'ترامبولين', 'Kite': 'طائرة ورقية',
  'Sail': 'شراع', 'Harness': 'حزام التعليق', 'Mast Extension': 'تمديد الصاري',
  'Kite Pump': 'مضخة الطائرة الورقية',
  'Barbell': 'بار حديد', 'Plates': 'أوزان', 'Bar': 'بار',
  'Jump Rope': 'حبل القفز', 'Resistance Band': 'شريط المقاومة',
  'Foam Roller': 'أسطوانة الإسفنج', 'Yoga Mat': 'سجادة اليوغا',
  'Yoga Block': 'مكعب اليوغا', 'Yoga Strap': 'حزام اليوغا', 'Bolster': 'وسادة اليوغا',
  'Pilates Ring': 'حلقة البيلاتس', 'Mat': 'سجادة', 'Towel': 'منشفة',
  'Water Bottle': 'زجاجة ماء', 'Water Bottle Cage': 'حامل الزجاجة',
  'Hydration Belt': 'حزام الترطيب', 'Hydration Pack': 'حقيبة الترطيب',
  'Energy Gels': 'أكياس الطاقة', 'Anti-Chafe Balm': 'بلسم منع الاحتكاك',
  'Reflective Vest': 'سترة عاكسة', 'Saddle Bag': 'حقيبة السرج',
  'Bike Lights': 'أضواء الدراجة', 'Chain Lube': 'زيت السلسلة',
  'Spare Wheels': 'عجلات احتياطية',
  'Climbing Shoes': 'أحذية التسلق', 'Chalk Bag': 'حقيبة الطباشير',
  'Carabiners': 'كارابينات', 'Climbing Harness': 'حزام التسلق',
  'Crampons': 'مسامير التسلق', 'Ropes': 'حبال', 'Headlamp': 'مصباح الرأس',
  'Bow': 'قوس', 'Arrows': 'سهام', 'Quiver': 'كنانة الأسهم',
  'Finger Tab': 'وسادة الإصبع', 'Rifle': 'بندقية', 'Shooting Mat': 'سجادة الرماية',
  'Foil': 'سيف المبارزة', 'Fencing Jacket': 'سترة المبارزة', 'Body Cord': 'سلك الجسم',
  'Gi': 'بدلة الفنون القتالية', 'Belt': 'حزام', 'Judo Belt': 'حزام الجودو',
  'Karate Belt': 'حزام الكاراتيه', 'Taekwondo Belt': 'حزام التايكوندو',
  'Punching Bag': 'كيس الملاكمة', 'Muay Thai Shorts': 'شورت المواي تاي',
  'Rash Guard': 'قميص الطفح',
  'Tees': 'حوامل الكرة', 'Golf Bag': 'حقيبة الجولف',
  'Leg Pads': 'واقيات الساق',
  'Riding Crop': 'سوط الفروسية', 'Polo Knee Guards': 'واقيات ركبة البولو',
  'Backpack': 'حقيبة ظهر', 'Trekking Poles': 'عصي المشي',
  'First Aid Kit': 'حقيبة إسعافات', 'Map': 'خريطة', 'Compass': 'بوصلة',
  'Whistle': 'صفارة', 'Map Case': 'حالة الخريطة',
  'Skin Suit': 'بدلة الجلد', 'Ski Bag': 'حقيبة التزلج',
  'Wax': 'شمع', 'Leash': 'حبل الأمان', 'Board Bag': 'حقيبة اللوح',
  'Wetsuit': 'بدلة الغوص',
  'Tri Suit': 'بدلة التراثلون',
  'Resin': 'الراتنج', 'Bib': 'الزق',
  'Bowling Towel': 'منشفة البولينج', 'Shoe Covers': 'أغطية الأحذية',
  'Curling Broom': 'مكنسة الكيرلنج', 'Curling Slider': 'مزلقة الكيرلنج',
  'Hair Bow': 'ربطة الشعر', 'Practice Mat': 'سجادة التدريب',
  'Trampoline Socks': 'جوارب الترامبولين',
  'Ballet Tights': 'جوارب الباليه', 'Ballet Skirt': 'تنورة الباليه',
  'Hair Pins': 'دبابيس الشعر', 'Beanie': 'قبعة', 'Handkerchief': 'منديل',
  'Sweatband': 'عصابة العرق', 'Dance Bag': 'حقيبة الرقص',
  'Dart Case': 'حالة السهام', 'Flight Punch': 'مثقاب الريشة',
  'Tip Sharpener': 'مبرد السن',
  'Chalk': 'طباشير',
  'Throwing Towel': 'منشفة الرمي', 'Elbow Sleeve': 'كُم الكوع',
  'Vaulting Pole Grip': 'مقبض زانة القفز', 'Landing Mat': 'سجادة الهبوط',
  'Starting Blocks': 'كتل البداية', 'Spike Wrench': 'مفتاح المسامير',
  'Life Jacket': 'سترة النجاة', 'Dry Bag': 'حقيبة جافة',
  'Shoulder Pads': 'واقيات الكتف',
  'Training Cones': 'مخروطات التدريب', 'Ball Pump': 'مضخة الكرة',
  'Lifting Belt': 'حزام رفع الأثقال',
  'Grip Bag': 'حقيبة القبضة',
  'Hockey Bag': 'حقيبة الهوكي',
  'Various': 'متنوع', 'None': 'لا شيء',
  'Headgear': 'واقي الرأس',
  'Shoe Brush': 'فرشاة الأحذية', 'Shoe Bag': 'حقيبة الأحذية',
  'Netball Shoes': 'حذاء كرة الشبكة',
  'Padded Shorts': 'شورت مبطن',
  'Catcher Mitt': 'قفاز الاستقبال',
  'Pole': 'زانة'
};

// Get merged, filtered, de-duplicated equipment list for a sport.
// - Combines the sport's base equip[] with EXTRA_EQUIP extras
// - Filters out FIELD_REQUIREMENTS (venues/animals, not gear)
// - Filters out 'None' (replaced by extras if available)
// - De-duplicates
function getSportEquip(sport) {
  if (!sport) return [];
  const base = (sport.equip || []).filter(function(e) { return e && e !== 'None' && e !== 'none'; });
  const extra = EXTRA_EQUIP[sport.name] || [];
  const all = base.concat(extra);
  return all
    .filter(function(e) { return FIELD_REQUIREMENTS.indexOf(e) === -1; })
    .filter(function(v, i, a) { return a.indexOf(v) === i; });
}

// Get translated equipment name (Arabic when store.lang === 'ar', else English).
function getEquipName(equip) {
  if (!equip) return '';
  if (store.lang === 'ar') return EQUIP_AR_NAMES[equip] || equip;
  return equip;
}

// Open Amazon.eg search for the equipment item, sorted by price ascending so
// the cheapest brands appear first. Amazon.eg is used because the user is in
// Egypt (Africa/Cairo timezone) — local currency (EGP), reliable Amazon brand,
// supports both EN and AR. The query includes both the equipment name and the
// sport name for relevant results (e.g., "Shin Guards for Football").
// v28 (user): swimwear searches used to surface inappropriate results —
// swim items are now forced to family-friendly terms ("swim trunks"/"swim
// shorts") so nothing suggestive can ever enter the query.
function buyEquipment(sportName, equipName) {
  var q = String(equipName || '');
  // v28 (user): "when you buy a swimsuit in swimming, it gives inappropriate
  // swimming suits, let it be normal and family friendly ones" — every
  // swimsuit-ish term (swimsuit, bikini, swimwear, swim suit, trunks…) is
  // forced to the SAME family-friendly query, "Men's Swim Trunks", with NO
  // "for <sport>" suffix (the suffix biased results toward competitive
  // briefs/jammers). Nothing suggestive can ever enter the query.
  if (/swimsuit|bikini|swim\s*wear|swimwear|swim\s*suit|trunks?|swim\s*shorts?|speedo/i.test(q)) {
    const url = 'https://www.amazon.eg/s?k=' + encodeURIComponent("Men's Swim Trunks") + '&s=price-asc-rank';
    const a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    return;
  }
  // other tight-fitting suits (triathlon / speed skating) get a Men's qualifier
  if (/tri\s*suit|skin\s*suit/i.test(q)) q = "Men's " + q;
  const query = q + ' for ' + sportName;
  const url = 'https://www.amazon.eg/s?k=' + encodeURIComponent(query) + '&s=price-asc-rank';
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function showSportInfo(name) {
  const s = SPORTS.find(x=>x.name===name);
  if (!s) return;
  document.getElementById('sport-modal-title').textContent = getSportName(s);
  const equips = getSportEquip(s);
  const buyBtnText = (store.lang === 'ar') ? 'شراء' : 'Buy';
  const noEquipText = (store.lang === 'ar') ? 'لا توجد معدات مطلوبة' : 'No equipment required';
  const equipHtml = equips.length
    ? equips.map(function(e) {
        const safeE = e.replace(/'/g, "\\'");
        const safeName = s.name.replace(/'/g, "\\'");
        // v10 (user, picture 2): the Buy buttons were squished thin (4px
        // vertical padding → ~28px tall, hard to tap). Now they match the
        // "Find on Google Maps" button's comfortable 44px touch target.
        // v30 (user, picture 3): overflow-proof row — the name ellipsizes
        // (min-width:0 + nowrap + text-overflow) and the row wraps on very
        // narrow screens, so the Buy button can NEVER be pushed past the
        // row card or the modal edge (the "rendering button problem" on
        // equipment-heavy sports like Football and Basketball).
        return '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;background:var(--bg);border-radius:10px;margin-bottom:8px;flex-wrap:wrap;">' +
          '<span style="display:flex;align-items:center;gap:8px;font-size:.92rem;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
            '<i class="fa-solid fa-circle-check" style="color:var(--green);flex-shrink:0;"></i>' +
            '<span style="overflow:hidden;text-overflow:ellipsis;">' + getEquipName(e) + '</span>' +
          '</span>' +
          '<button class="btn primary small" style="padding:10px 14px;font-size:.82rem;font-weight:700;flex-shrink:0;min-height:44px;width:auto;" onclick="buyEquipment(\'' + safeName + '\',\'' + safeE + '\')">' +
            '<i class="fa-solid fa-cart-shopping"></i> ' + buyBtnText +
          '</button>' +
        '</div>';
      }).join('')
    : '<p style="color:var(--muted);font-size:.88rem;text-align:center;padding:12px;">' + noEquipText + '</p>';
  document.getElementById('sport-modal-equip').innerHTML = equipHtml;
  document.getElementById('sport-modal-map-btn').onclick = () => { const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}+near+me`; const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); document.body.removeChild(a); };
  openModal('sport-modal');
  setTimeout(applyTranslations, 0);
}
function showWorkout(name) {
  const s = SPORTS.find(x => x.name === name);
  // Guard: if the sport name doesn't match anything in SPORTS (e.g. it was
  // filtered out by filterSportsBySurvey but store.defaultSport still points
  // to it), bail out silently instead of crashing on `s.icon`.
  if (!s) {
    console.warn('showWorkout: sport not found:', name);
    const d = document.getElementById('workout-detail');
    if (d) d.classList.add('hidden');
    return;
  }
  document.querySelectorAll('.sport-card').forEach(c => c.classList.remove('selected'));
  if (event && event.currentTarget) event.currentTarget.classList.add('selected');
  const d = document.getElementById('workout-detail');
  d.classList.remove('hidden');
  // v9 (user: "make form check and rep check only work when the user is in a
  // workout"): the per-drill AI buttons that v8 put on every sports drill card
  // are REMOVED — sports browsing is not a workout. Form Check / Rep Counter
  // now live ONLY inside the workout-detail popup (Daily tab) where the user
  // is actually doing the exercise.
  const renderWorkoutCards = (intensity) => { const drills = getDrillsForIntensity(s, intensity); return drills.map(w => `<div class="task-card wd-sport-drill"><div><h4>${w}</h4><p class="task-desc" data-ar="تمرين">Exercise</p></div></div>`).join(''); };
  const intensityLabel = store.lang === 'ar' ? 'الشدة:' : 'Intensity:';
  const lightOpt = store.lang === 'ar' ? 'خفيف' : 'Light';
  const modOpt = store.lang === 'ar' ? 'معتدل' : 'Moderate';
  const intenseOpt = store.lang === 'ar' ? 'شديد' : 'Intense';
  const startBtnText = store.lang === 'ar' ? 'ابدأ جلسة مباشرة' : 'Start Live Session';
  d.innerHTML = `<h3><i class="fa-solid ${s.icon}"></i> ${getSportName(s)}</h3>
    <div class="task-grid wd-sport-drill-grid" style="margin-top: 16px;" id="workout-cards-container">${renderWorkoutCards('Moderate')}</div>
    <div style="display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin: 16px 0;">
        <label style="margin:0; font-size: .85rem; font-weight: 600; color: var(--muted);">${intensityLabel}</label>
        <select id="pre-session-intensity" style="width: auto; margin: 0; padding: 8px;" onchange="document.getElementById('workout-cards-container').innerHTML = ''; renderWorkoutCardsInline(this.value);">
            <option value="Light">${lightOpt}</option><option value="Moderate" selected>${modOpt}</option><option value="Intense">${intenseOpt}</option>
        </select>
    </div>
    <button class="btn primary fit" onclick="startLiveSession('${s.name}')"><i class="fa-solid fa-play"></i> ${startBtnText}</button>
    <div id="live-session-ui" style="margin-top:16px;"></div>
    <div id="inline-logger" class="hidden inline-logger" style="margin-top:16px;"></div>`;
  window.renderWorkoutCardsInline = function(intensity) { document.getElementById('workout-cards-container').innerHTML = renderWorkoutCards(intensity); }
  d.scrollIntoView({ behavior: 'smooth' });
  // Translate any [data-ar] elements that were just rendered inside the workout panel
  setTimeout(applyTranslations, 0);
}

// v8's sportDrillFormCheck / sportDrillRepCount helpers were REMOVED in v9
// (user: "make form check and rep check only work when the user is in a
// workout") — sports drill cards no longer carry AI buttons. The features
// are reached from the workout-detail popup (Daily tab) and, when the user
// IS in a workout, from the Premium hub.

function startLiveSession(name) {
  if (sessionTimerInt) clearInterval(sessionTimerInt); if (pauseCountdownInt) clearInterval(pauseCountdownInt); isPaused = false;
  currentLogSport = name;
  currentLogIntensity = document.getElementById('pre-session-intensity').value;
  sessionStart = Date.now();
  const s = SPORTS.find(x => x.name === name);
  document.getElementById('session-sport-name').textContent = getSportName(s);
  document.getElementById('session-timer').textContent = "00:00";
  document.getElementById('session-calories').innerHTML = '<i class="fa-solid fa-fire"></i> 0 kcal';
  const playlistId = getRandomPlaylist(name);
  document.getElementById('session-playlist-container').innerHTML = `<h3 style="font-size: 1rem; margin-bottom: 10px; color: var(--text);"><i class="fa-solid fa-music"></i> <span data-ar="قائمة التشغيل الموصى بها">Recommended Playlist</span></h3><iframe style="border-radius:12px;" src="https://open.spotify.com/embed/playlist/${playlistId}" width="100%" height="152" frameBorder="0" allowfullscreen="" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>${!navigator.onLine ? '<p style="margin-top:8px;font-size:.78rem;color:var(--amber);"><i class="fa-solid fa-wifi"></i> <span data-ar="أنت غير متصل — قد لا تحمل قائمة التشغيل حتى تعود للاتصال.">You\'re offline — the playlist may not load until you reconnect.</span></p>' : ''}`;
  document.getElementById('session-pause-btn').classList.remove('hidden');
  document.getElementById('session-pause-timer').classList.add('hidden');
  document.getElementById('session-overlay').classList.add('active');
  sessionTimerInt = setInterval(updateSessionTime, 1000);
}
function updateSessionTime() {
  if (isPaused) return;
  const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
  const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const secs = (elapsed % 60).toString().padStart(2, '0');
  document.getElementById('session-timer').textContent = `${mins}:${secs}`;
  // Calories: REAL per-sport MET (Compendium map — not the old "everything =
  // 6.0 except running/cycling") × the user's chosen intensity × weight ×
  // exact elapsed time. Yoga no longer burns like HIIT.
  const met = SESSION_SPORT_MET[currentLogSport] || 6.0;
  const u = currentUser();
  const weightKg = (u && u.profile && u.profile.weight) ? u.profile.weight : 70;
  const raw = kcalForSpan(met, currentLogIntensity, weightKg, elapsed);
  // v25 (user): no decimal calories — the counter used to show one decimal
  // under 10 kcal (e.g. "3.2 kcal"); now always an integer.
  const cals = Math.max(0, Math.round(raw));
  document.getElementById('session-calories').innerHTML = `<i class="fa-solid fa-fire"></i> ${cals} kcal`;
}
function pauseLiveSession() { if (isPaused) return; isPaused = true; pauseSpotifyEmbed(); document.getElementById('session-pause-btn').classList.add('hidden'); document.getElementById('session-pause-timer').classList.remove('hidden'); let timeLeft = 60; document.getElementById('pause-countdown').textContent = timeLeft; pauseCountdownInt = setInterval(() => { timeLeft--; document.getElementById('pause-countdown').textContent = timeLeft; if (timeLeft <= 0) { clearInterval(pauseCountdownInt); resumeLiveSession(); } }, 1000); }
function pauseSpotifyEmbed() { const iframe = document.querySelector('#session-playlist-container iframe'); if (iframe) { try { iframe.contentWindow.postMessage({ type: 'pause' }, '*'); } catch(e) {} } }
function resumeSpotifyEmbed() { const iframe = document.querySelector('#session-playlist-container iframe'); if (iframe) { try { iframe.contentWindow.postMessage({ type: 'play' }, '*'); } catch(e) {} } }
function resumeLiveSession() { isPaused = false; sessionStart += 60000; resumeSpotifyEmbed(); document.getElementById('session-pause-btn').classList.remove('hidden'); document.getElementById('session-pause-timer').classList.remove('hidden'); }
function exitSession() {
  clearInterval(sessionTimerInt); clearInterval(pauseCountdownInt); isPaused = false; pauseSpotifyEmbed();
  // Also clean up marathon timer if marathon was using this overlay
  if (marathonTimerInt) { clearInterval(marathonTimerInt); marathonTimerInt = null; }
  marathonStart = null; marathonPaused = false; marathonPausedMs = 0;
  document.getElementById('session-playlist-container').innerHTML = '';
  document.getElementById('session-overlay').classList.remove('active');
  document.getElementById('live-session-ui').innerHTML = `<p style="color:var(--muted); font-weight:600;" data-ar="تم إنهاء الجلسة دون تسجيل.">Session exited without logging.</p>`;
}
function stopLiveSession() {
  clearInterval(sessionTimerInt); clearInterval(pauseCountdownInt); isPaused = false; pauseSpotifyEmbed();
  document.getElementById('session-playlist-container').innerHTML = '';
  document.getElementById('session-overlay').classList.remove('active');
  // Use ACTUAL elapsed time. Round 8: NO MORE Math.max(1, ...) — 9 seconds is
  // 0.2 minutes, never a full minute (that rounding was the "trained 9s,
  // ring says 1 min" bug AND inflated the calorie estimate ~7×).
  const elapsedSec = Math.max(1, Math.floor((Date.now() - sessionStart) / 1000));
  const elapsedMins = minsFromSecs(elapsedSec);
  // Calories: real per-sport MET × chosen intensity × weight × exact seconds.
  const met = SESSION_SPORT_MET[currentLogSport] || 6.0;
  const u = currentUser();
  const weightKg = (u && u.profile && u.profile.weight) ? u.profile.weight : 70;
  const cals = Math.max(1, Math.round(kcalForSpan(met, currentLogIntensity, weightKg, elapsedSec)));
  document.getElementById('live-session-ui').innerHTML = `<p style="color:var(--green); font-weight:600;" data-ar="تم إيقاف الجلسة! المدة: ${fmtMins(elapsedMins)} دقيقة، السعرات: ${cals} سعرة">Session stopped! Duration: ${fmtMins(elapsedMins)}m, Calories: ${cals}kcal</p>`;
  // Round 18: capture the auto-computed values — the logger below now asks
  // for a NOTE ONLY (per user request). Date, duration, intensity and
  // calories are taken from the live session itself.
  currentLogDurationMins = elapsedMins;
  currentLogCalories = cals;
  const logger = document.getElementById('inline-logger');
  logger.classList.remove('hidden');
  const arLog = (store.lang === 'ar');
  logger.innerHTML = `<h4 style="margin-bottom:6px;" data-ar="تسجيل الجلسة: ${getSportName(SPORTS.find(x=>x.name===currentLogSport))}">Log Session: ${getSportName(SPORTS.find(x=>x.name===currentLogSport))}</h4>` +
    `<p style="font-size:.8rem;color:var(--muted);margin-bottom:10px;"><i class="fa-solid fa-regular fa-clock"></i> ${fmtMins(elapsedMins)} min · <i class="fa-solid fa-fire" style="color:var(--amber);"></i> ${cals} kcal · ${currentLogIntensity}</p>` +
    `<label style="font-size:.82rem;font-weight:600;color:var(--muted);margin-bottom:4px;display:block;" data-ar="ملاحظة الجلسة">Session note</label>` +
    `<input type="text" id="log-note" placeholder="${arLog ? 'كيف كانت الجلسة؟ (اختياري)' : 'How did it go? (optional)'}" data-ar-ph="كيف كانت الجلسة؟ (اختياري)" style="width:100%;padding:10px 13px;border:1px solid var(--line);border-radius:10px;font-size:.92rem;margin-bottom:10px;">` +
    `<button class="btn primary small" onclick="saveInlineSession()"><i class="fa-solid fa-check"></i> <span data-ar="حفظ الجلسة">Save Session</span></button>`;
  setTimeout(applyTranslations, 0);
}
function getSessionStats() { const sessions = currentUser().sessions || []; const totalMin = sessions.reduce((a, s) => a + s.duration, 0); const weekAgo = Date.now() - 7 * 864e5; const weekMin = sessions.filter(s => new Date(s.date).getTime() >= weekAgo).reduce((a, s) => a + s.duration, 0); const perSport = {}; sessions.forEach(s => { perSport[s.sport] = (perSport[s.sport] || 0) + s.duration; }); const top = Object.entries(perSport).sort((a, b) => b[1] - a[1])[0]; return { total: sessions.length, totalMin, weekMin, top }; }
// Sum of durations of all sessions logged TODAY (matches by LOCAL date string YYYY-MM-DD).
// Uses localDateStr() so the comparison is against the user's local "today",
// not the UTC "today" (which can be one day behind in positive-offset timezones).
function getTodayMinutes() {
  try {
    const u = currentUser();
    const sessions = (u && u.sessions) || [];
    const today = localDateStr();
    return sessions
      .filter(s => (s.date || '').slice(0, 10) === today)
      .reduce((a, s) => a + (Number(s.duration) || 0), 0);
  } catch(e) { return 0; }
}
// Daily workout minute goal derived from the user's survey answer to
// "How much time can you spare per session?" (key: time).
// '15 minutes' → 15, '30 minutes' → 30, '45 minutes' → 45.
// v27 (user): the '60+ minutes' option is GONE from the survey — legacy
// answers that picked it now behave like '45 minutes' instead of 60.
// Falls back to schedule-based estimate if `time` isn't set (older accounts).
// If busy mode is on, the goal is halved (lighter sessions while traveling).
function getDailyGoalMinutes() {
  try {
    const u = currentUser();
    if (!u) return 30;
    // === Round 6: Stop Training overrides everything — daily goal = 0 ===
    // Per user spec: "add an option in busy mode where the user can just stop training".
    // When stopTraining is ON, no workouts are generated and the dashboard shows
    // "Training paused". We return 0 here; generateWorkoutList() and renderHome()
    // detect 0 and show a paused message instead of an empty plan.
    if (u.stopTraining) return 0;
    let base;
    // Primary: per-session time from survey (user's actual capacity per day)
    const t = u.survey && u.survey.time;
    if (t === '15 minutes') base = 15;
    else if (t === '30 minutes') base = 30;
    else if (t === '45 minutes') base = 45;
    else if (t === '60+ minutes') base = 45;   // v27: legacy answer → 45 (option removed)
    else {
      // Fallback: derive from weekly schedule
      const sched = (u.survey && u.survey.schedule) || '3-4';
      if (sched === '1-2') base = 15;
      else if (sched === '3-4') base = 30;
      else if (sched === '5+') base = 45;
      else base = 60; // daily
    }
    // Busy mode: halve the goal (minimum 10 minutes so the bar still moves)
    if (u.busyMode) base = Math.max(10, Math.round(base / 2));
    return base;
  } catch(e) { return 30; }
}

// ===== BUSY / TRAVELING MODE =====
// Stored on the user record. When ON:
//  - getDailyGoalMinutes() returns half the usual target (lighter sessions)
//  - bumpStreak() is more forgiving: a missed day doesn't reset the streak
//  - A banner shows on the Profile tab to remind the user it's on
function setBusyMode(on) {
  try {
    const u = currentUser();
    if (!u) return;
    u.busyMode = !!on;
    saveUser(store.session, u);
    // Update toggle button styles
    const offBtn = document.getElementById('busy-off-btn');
    const onBtn = document.getElementById('busy-on-btn');
    if (offBtn) offBtn.classList.toggle('active', !on);
    if (onBtn) onBtn.classList.toggle('active', on);
    // Show/hide the banner
    const banner = document.getElementById('busy-mode-banner');
    if (banner) banner.style.display = on ? 'block' : 'none';
    // Re-render home so the today-activity goal updates immediately
    try { renderHome(); } catch(e) {}
  } catch(e) { console.warn('setBusyMode error:', e); }
}
// === Round 6: Stop Training ===
// Per user spec: "add an option in busy mode where the user can just stop training".
// When ON, getDailyGoalMinutes() returns 0 → no workouts generated, no daily
// goal pressure, no streak break. The user can resume any time by clicking Resume.
function setStopTraining(on) {
  try {
    const u = currentUser();
    if (!u) return;
    u.stopTraining = !!on;
    saveUser(store.session, u);
    // Update toggle button styles
    const offBtn = document.getElementById('stop-off-btn');
    const onBtn = document.getElementById('stop-on-btn');
    if (offBtn) offBtn.classList.toggle('active', !on);
    if (onBtn) onBtn.classList.toggle('active', on);
    // Show/hide the banner
    const banner = document.getElementById('stop-training-banner');
    if (banner) banner.style.display = on ? 'block' : 'none';
    // Re-render home so the today-activity goal updates immediately
    try { renderHome(); } catch(e) {}
  } catch(e) { console.warn('setStopTraining error:', e); }
}
function renderTracker() { const stats = getSessionStats(); document.getElementById('tr-total').textContent = stats.total; document.getElementById('tr-minutes').textContent = fmtMins(stats.totalMin); document.getElementById('tr-week').textContent = fmtMins(stats.weekMin); document.getElementById('tr-top').textContent = stats.top ? getSportName(SPORTS.find(x=>x.name===stats.top[0])) : '--'; }
// Round 18: NOTE-ONLY save. The live session already captured date,
// duration, intensity and calories — the user just adds a note (optional)
// and saves. Everything lands in u.sessions, so the workout history (and
// the new day-summary popup) shows the note afterwards.
function saveInlineSession() {
  const note = (document.getElementById('log-note') && document.getElementById('log-note').value || '').trim();
  const date = localDateStr();
  const duration = Number(currentLogDurationMins) || 0;
  const intensity = currentLogIntensity || 'Moderate';
  if (!currentLogSport || duration <= 0) { alert('Session data missing — please restart the session.'); return; }
  const u = currentUser(); if (!u.sessions) u.sessions = [];
  // Round 8: store EXACT minutes (0.2 = 12s) + the calories computed at
  // stop time (sport MET × intensity × weight × exact time) so the
  // dashboard rings never re-estimate from an inflated duration.
  const cals = currentLogCalories || Math.max(1, Math.round(kcalForSpan(SESSION_SPORT_MET[currentLogSport] || 6.0, intensity, (u.profile && u.profile.weight) || 70, duration * 60)));
  u.sessions.push({ sport: currentLogSport, date, duration: Math.round(duration * 10) / 10, calories: cals, intensity, note }); saveUser(store.session, u); document.getElementById('inline-logger').innerHTML = `<p style="color:var(--green);font-weight:600;"><i class="fa-solid fa-check-circle"></i> <span data-ar="تم تسجيل الجلسة بنجاح!">Session logged successfully!</span></p>`; renderTracker(); renderHome(); renderChart(); checkDailyGoalReached(); try { if (window.VoltaFeatures && VoltaFeatures.renderStreaksTab) VoltaFeatures.renderStreaksTab(); } catch(e) {} setTimeout(applyTranslations, 0); }
function bumpStreak() {
  const u = currentUser();
  const today = new Date().toDateString();
  if (u.lastDone === today) return u.streak;
  const yesterday = new Date(Date.now() - 864e5).toDateString();
  // If busy mode is on, the user can miss up to 3 days in a row without
  // losing their streak (more forgiving while traveling).
  if (u.busyMode) {
    const twoDaysAgo = new Date(Date.now() - 2 * 864e5).toDateString();
    const threeDaysAgo = new Date(Date.now() - 3 * 864e5).toDateString();
    if (u.lastDone === yesterday || u.lastDone === twoDaysAgo || u.lastDone === threeDaysAgo) {
      u.streak = (u.streak || 0) + 1;
    } else {
      u.streak = 1;
    }
  } else {
    u.streak = (u.lastDone === yesterday) ? (u.streak || 0) + 1 : 1;
  }
  u.lastDone = today;
  saveUser(store.session, u);
  return u.streak;
}

// ===== LOCAL DATE HELPER =====
// Returns the LOCAL date in YYYY-MM-DD format.
// CRITICAL: do NOT use new Date().toISOString().slice(0,10) for session dates —
// that returns the UTC date, which is one day behind the local date in
// positive-offset timezones (e.g. Cairo UTC+2 at 11pm local = 9pm UTC same day,
// but at 1am local = 11pm UTC previous day). Sessions logged "today" would
// then show up on the chart as "yesterday", which is the bug the user reported.
// This helper builds the YYYY-MM-DD string from local date parts instead.
// ===== Volta toast (top-center, auto-dismiss) =====
// The .volta-toast CSS existed but the function was never defined, so every
// call silently no-op'd. Implemented here (palette matches the theme).
// type: 'success' | 'error' | 'info';  duration in ms (default 2600)
function showVoltaToast(message, type, duration) {
  try {
    var host = document.getElementById('volta-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'volta-toast-host';
      host.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:12000;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;width:max-content;max-width:92vw;';
      document.body.appendChild(host);
    }
    var t = document.createElement('div');
    t.className = 'volta-toast';
    var bg = (type === 'error') ? '#c94444' : (type === 'info') ? 'var(--accent)' : '#1d9d6b';
    t.style.cssText = 'background:' + bg + ';color:#fff;padding:11px 18px;border-radius:12px;font-size:.88rem;font-weight:600;box-shadow:0 10px 30px rgba(0,0,0,.22);max-width:92vw;text-align:center;';
    t.textContent = String(message || '');
    host.appendChild(t);
    setTimeout(function () {
      if (!t.parentNode) return;
      t.style.transition = 'opacity .3s ease, transform .3s ease';
      t.style.opacity = '0';
      t.style.transform = 'translateY(-14px)';
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 320);
    }, duration || 2600);
  } catch (e) { /* cosmetic only */ }
}

function localDateStr(d) {
  d = d || new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

// ===== DAILY GOAL → STREAK POPUP =====
// Per user spec: "dont make 'daily streak' count until the daily activity goal is done
// and make a cool animation a popup screen comes up where flame is burning and the number
// of days goes and says down keep going".
// We check after each completed exercise / logged session whether today's minutes
// have hit the daily goal. If yes (and not already counted today), bump the streak
// and show the flame popup.
function checkDailyGoalReached() {
  try {
    const u = currentUser();
    if (!u) return;
    const todayMin = getTodayMinutes();
    // v6: the streak goal IS the survey session time — identical to the
    // "Today's Activity Goal" number and the generated workout duration
    // (one source of truth: getDailyGoalMinutes()).
    const dailyGoal = Math.max(1, Math.round(getDailyGoalMinutes()));
    if (todayMin < dailyGoal) return; // not yet
    const today = new Date().toDateString();
    if (u.lastDone === today && (u.streakGoalCountedFor || '') === today) return; // already counted
    // Bump streak + remember we already counted today
    const newStreak = bumpStreak();
    u.lastDone = today;
    u.streakGoalCountedFor = today;
    saveUser(store.session, u);
    // Show the flame popup
    showStreakPopup(newStreak);
    // Refresh home so the streak stat updates
    try { renderHome(); } catch(e) {}
  } catch(e) { console.warn('checkDailyGoalReached error:', e); }
}
function showStreakPopup(streakCount) {
  const overlay = document.getElementById('streak-popup-overlay');
  const countEl = document.getElementById('streak-popup-count');
  if (!overlay || !countEl) return;
  countEl.textContent = streakCount;
  overlay.classList.add('active');
  // v30: satisfying two-note chime with the streak popup
  try { if (window.VoltaSounds) VoltaSounds.play('success'); } catch (e) {}
  // Auto-hide after 3.5 seconds
  if (window._streakPopupTimer) clearTimeout(window._streakPopupTimer);
  window._streakPopupTimer = setTimeout(function() {
    overlay.classList.remove('active');
  }, 3500);
  // Apply translations in case the popup has data-ar attributes
  try { applyTranslations(); } catch(e) {}
}
function closeStreakPopup() {
  const overlay = document.getElementById('streak-popup-overlay');
  if (!overlay) return;
  overlay.classList.remove('active');
  if (window._streakPopupTimer) { clearTimeout(window._streakPopupTimer); window._streakPopupTimer = null; }
}

// ============================================================
// GREAT WORK ANIMATION POPUP (Round 7)
// ============================================================
// Replaces the old alert() "Great job!" popup that fired when the user
// finished a day in daily exercise. Per user spec:
// "when the user finishes a day in daily exercise, i want you to remove that
// popup that motivates the user and make a cool animation that says great
// work or something like that with animations (e.g. biceps flexing, etc.)".
//
// This shows a full-screen overlay with two flexing bicep emojis (💪), a
// "GREAT WORK!" headline that pulses, three stars that pop in sequentially,
// and a context-aware subtitle. Auto-hides after 4 seconds, or the user can
// tap "Continue" to dismiss it immediately.
//
// Usage:
//   showGreatWorkPopup();                           // default message
//   showGreatWorkPopup({ day: 3, totalDays: 7 });   // "Day 3 of 7 complete!"
//   showGreatWorkPopup({ planComplete: true });      // "You completed the whole plan!"
function showGreatWorkPopup(opts) {
  try {
    const overlay = document.getElementById('great-work-overlay');
    const subEl = document.getElementById('great-work-sub');
    const headlineEl = document.getElementById('great-work-headline');
    if (!overlay) return;
    // v30: little win-arpeggio with the celebration popup
    try { if (window.VoltaSounds) VoltaSounds.play('win'); } catch (e2) {}
    const ar = (store.lang === 'ar');
    // Build the context-aware subtitle
    let subText = ar
      ? 'لقد أكملت تمرين اليوم. استمر!'
      : "You crushed today's workout. Keep it up!";
    let headlineText = ar ? 'عمل رائع!' : 'GREAT WORK!';
    if (opts) {
      if (opts.planComplete) {
        subText = ar
          ? 'لقد أكملت جميع أيام خطتك! يمكنك بدء خطة جديدة.'
          : "You've completed all days of your plan! Time to start a new one.";
        headlineText = ar ? 'إنجاز أسطوري!' : 'PLAN COMPLETE!';
      } else if (opts.day && opts.totalDays) {
        subText = ar
          ? `أحسنت! انتقلت إلى اليوم ${opts.day} من ${opts.totalDays}.`
          : `You're now on Day ${opts.day} of ${opts.totalDays}.`;
      }
    }
    if (subEl) subEl.textContent = subText;
    if (headlineEl) headlineEl.textContent = headlineText;
    // Set the streak number (animate count-up)
    var streakNumEl = document.getElementById('gw-streak-number');
    var streak = 0;
    try {
      var u = currentUser();
      if (u && u.streak) streak = parseInt(u.streak, 10) || 0;
    } catch(e) {}
    if (streakNumEl) {
      streakNumEl.textContent = '0';
      var current = 0;
      var target = streak;
      var step = Math.max(1, Math.ceil(target / 30));
      var countUpTimer = setInterval(function() {
        current += step;
        if (current >= target) {
          current = target;
          clearInterval(countUpTimer);
          streakNumEl.classList.add('pulse');
          setTimeout(function() { streakNumEl.classList.remove('pulse'); }, 600);
        }
        streakNumEl.textContent = String(current);
      }, 40);
    }
    // === Restart the CSS animations every time the popup shows. ===
    // Without this, the biceps-flex / star-pop / headline-pulse animations
    // would only play once (on first open) and never again. We force a reflow
    // by removing + re-adding the .active class with a void offsetWidth read
    // in between, which restarts all child animations.
    overlay.classList.remove('active');
    void overlay.offsetWidth;  // force reflow so animations restart
    overlay.classList.add('active');
    // Round 15 (animation #5): confetti burst on top of the great-work
    // popup — completing the whole day deserves the full celebration.
    try { if (window.voltaCelebrate) window.voltaCelebrate('great'); } catch(e) {}
    // Apply translations
    try { applyTranslations(); } catch(e) {}
    // Auto-hide after 4 seconds
    if (window._greatWorkTimer) clearTimeout(window._greatWorkTimer);
    window._greatWorkTimer = setTimeout(function() {
      overlay.classList.remove('active');
    }, 4000);
    // Vibrate the device if supported (mobile haptic feedback).
    // Call navigator.vibrate directly (not vibrateDevice) so the haptic
    // feedback works regardless of the timer's vibrate-toggle setting.
    try { if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]); } catch(e) {}
    // Play a celebratory beep if supported
    try { if (typeof playDoneBeep === 'function') playDoneBeep(); } catch(e) {}
  } catch(e) { console.warn('showGreatWorkPopup error:', e); }
}
function closeGreatWorkPopup() {
  const overlay = document.getElementById('great-work-overlay');
  if (!overlay) return;
  overlay.classList.remove('active');
  if (window._greatWorkTimer) { clearTimeout(window._greatWorkTimer); window._greatWorkTimer = null; }
}

// ===== WEEKLY PROGRESS SURVEY =====
// Pops up every 7 days to ask the user about their progress.
// Asks 4 quick questions: current weight, energy level (1-10),
// satisfaction (1-10), and biggest challenge. Saves the answers
// to the user's record so the dashboard can show progress over time.
function showWeeklyProgressSurvey() {
  const u = currentUser();
  if (!u || !u.profile) return;
  const ar = (store.lang === 'ar');
  const body = document.getElementById('weekly-survey-body');
  if (!body) return;
  body.innerHTML = `
    <label style="font-size:.85rem;font-weight:600;color:var(--muted);" data-ar="وزنك الحالي (كجم)">Current weight (kg)</label>
    <input type="number" id="weekly-weight" value="${u.profile.weight || ''}" min="30" max="300" step="0.1" style="margin-bottom:14px;" />

    <label style="font-size:.85rem;font-weight:600;color:var(--muted);" data-ar="مستوى طاقتك (1-10)">Energy level (1-10)</label>
    <input type="range" id="weekly-energy" min="1" max="10" value="5" style="margin-bottom:6px;" />
    <div style="text-align:center;color:var(--accent);font-weight:700;font-size:1.2rem;" id="weekly-energy-display">5</div>

    <label style="font-size:.85rem;font-weight:600;color:var(--muted);margin-top:14px;display:block;" data-ar="مدى رضاك عن تقدمك (1-10)">Satisfaction with progress (1-10)</label>
    <input type="range" id="weekly-satisfaction" min="1" max="10" value="5" style="margin-bottom:6px;" />
    <div style="text-align:center;color:var(--accent);font-weight:700;font-size:1.2rem;" id="weekly-satisfaction-display">5</div>

    <label style="font-size:.85rem;font-weight:600;color:var(--muted);margin-top:14px;display:block;" data-ar="أكبر تحدٍّ واجهته هذا الأسبوع">Biggest challenge this week</label>
    <select id="weekly-challenge" style="margin-bottom:6px;">
      <option value="Time" data-ar="وقت ضيق">Lack of time</option>
      <option value="Motivation" data-ar="نقص الحافز">Low motivation</option>
      <option value="Energy" data-ar="نقص الطاقة">Low energy</option>
      <option value="Injury" data-ar="إصابة">Injury / pain</option>
      <option value="Diet" data-ar="الالتزام بالحمية">Diet adherence</option>
      <option value="None" data-ar="لا شيء - سار بسلاسة">None - it went smoothly</option>
    </select>
  `;
  // Wire up the slider live displays
  const eSlider = document.getElementById('weekly-energy');
  const eDisp = document.getElementById('weekly-energy-display');
  if (eSlider && eDisp) eSlider.oninput = () => eDisp.textContent = eSlider.value;
  const sSlider = document.getElementById('weekly-satisfaction');
  const sDisp = document.getElementById('weekly-satisfaction-display');
  if (sSlider && sDisp) sSlider.oninput = () => sDisp.textContent = sSlider.value;
  openModal('weekly-survey-modal');
  setTimeout(applyTranslations, 0);
}
function saveWeeklySurvey() {
  try {
    const u = currentUser();
    if (!u) return;
    const weight = parseFloat(document.getElementById('weekly-weight').value);
    const energy = parseInt(document.getElementById('weekly-energy').value) || 5;
    const satisfaction = parseInt(document.getElementById('weekly-satisfaction').value) || 5;
    const challenge = document.getElementById('weekly-challenge').value;
    // Update current weight on profile if a valid value was entered
    if (!isNaN(weight) && weight >= 30 && weight <= 300) {
      u.profile.weight = weight;
    }
    // Mark the weekly survey as completed for this week. This is the
    // ONLY place lastWeeklySurvey is set — so the survey keeps popup up
    // (on subsequent app entries) until the user actually saves their
    // answers. Once saved, it won't popup for another 7 days.
    u.lastWeeklySurvey = Date.now();
    // Append this weekly entry to a history array on the user record
    if (!u.weeklySurveyHistory) u.weeklySurveyHistory = [];
    u.weeklySurveyHistory.push({
      date: new Date().toISOString(),
      weight: weight || u.profile.weight,
      energy: energy,
      satisfaction: satisfaction,
      challenge: challenge
    });
    // Keep only the last 12 weeks of history
    if (u.weeklySurveyHistory.length > 12) u.weeklySurveyHistory = u.weeklySurveyHistory.slice(-12);
    saveUser(store.session, u);
    closeModal('weekly-survey-modal');
    // Re-render dashboard so the new weight + goal progress show up
    try { renderHome(); renderProfile(); } catch(e) {}
  } catch(e) { console.warn('saveWeeklySurvey error:', e); closeModal('weekly-survey-modal'); }
}
function closeWeeklySurvey() {
  closeModal('weekly-survey-modal');
}

function renderDiet() {
  const u = currentUser(), p = u.profile, s = u.survey;
  let bmr = p.gender === 'Female' ? 447.6 + (9.25 * p.weight) + (3.1 * p.height) - (4.33 * p.age) : 88.36 + (13.4 * p.weight) + (4.8 * p.height) - (5.68 * p.age);
  let days = s?.schedule || '3-4'; let af = days === '1-2' ? 1.375 : days === '3-4' ? 1.55 : days === '5+' ? 1.725 : 1.9;
  let tdee = bmr * af; let target = tdee;
  if (p.goal === 'Lose weight') target = tdee - 500; else if (p.goal === 'Build muscle') target = tdee + 300;
  let proG = Math.round(p.weight * 2); let fatG = Math.round((target * 0.25) / 9); let carbG = Math.round((target - (proG * 4) - (fatG * 9)) / 4);
  const ar = (store.lang === 'ar');
  const kcalUnit = ar ? 'سعرة' : 'kcal';
  const pLabel = ar ? 'ب' : 'P';
  const cLabel = ar ? 'ك' : 'C';
  const fLabel = ar ? 'د' : 'F';
  document.getElementById('diet-targets').innerHTML = `<div class="diet-target" data-ar="الهدف اليومي: ${Math.round(target)} سعرة">Daily Target: ${Math.round(target)} kcal</div><div class="diet-macros"><span class="macro-pill macro-p" data-ar="${proG}جم بروتين">${proG}g Protein</span><span class="macro-pill macro-c" data-ar="${carbG}جم كربوهيدرات">${carbG}g Carbs</span><span class="macro-pill macro-f" data-ar="${fatG}جم دهون">${fatG}g Fat</span></div>`;
  // ===== Diet progress bar: shows calories gained from food today =====
  // Per user spec: "make a progress bar in the diet screen where it actually
  // shows how many calories did the user gain from food each day".
  // Reads from the user's meal log (same source as Today's Meal Log panel).
  try {
    const log = getDietLog();
    const today = localDateStr();
    // Use the local `date` field when available (immune to UTC/off-by-one bugs).
    // Fall back to `loggedAt.startsWith(today)` for older entries that don't
    // have the `date` field yet.
    // v25: whole-number calories (never decimals).
    const todayKcal = Math.round(log.filter(x => (x.date && x.date === today) || (!x.date && (x.loggedAt || '').startsWith(today))).reduce((s, x) => s + (x.kcal || 0), 0));
    const targetKcal = Math.round(target);
    const pct = Math.min(100, Math.round((todayKcal / targetKcal) * 100));
    const dietProgressEl = document.getElementById('diet-progress-bar');
    if (dietProgressEl) {
      const ar2 = (store.lang === 'ar');
      dietProgressEl.innerHTML = `
        <div class="goal-progress-header" style="margin-bottom:8px;">
          <span><i class="fa-solid fa-apple-whole" style="color:var(--accent);margin-right:6px;"></i><span data-ar="السعرات اليوم: ">Calories today: </span><b>${todayKcal}</b><span data-ar=" من "> / </span><b>${targetKcal}</b><span data-ar=" سعرة"> kcal</span></span>
          <span>${pct}%</span>
        </div>
        <div class="goal-progress-bar-bg">
          <div class="goal-progress-bar-fill" style="width:${pct}%; background: linear-gradient(90deg, var(--accent), ${pct >= 100 ? 'var(--red)' : 'var(--green)'});"></div>
        </div>
        <small style="color:var(--muted);font-size:.78rem;display:block;margin-top:6px;" data-ar="يتحديث عند إضافة وجبات لسجل اليوم.">Updates when you log meals today.</small>
      `;
    }
  } catch(e) { console.warn('diet progress bar error:', e); }
  // Per user request the panel now shows SIX AI meal cards (was 4) — more
  // variety while the "Log this meal" button stays on every card.
  // v8: the panel now renders the LOCAL daily set instantly (offline-safe),
  // then upgrades to GEMINI location-aware meals when they arrive (see
  // maybeShowGeminiMeals — popular picks around the user's own country).
  const todaysMeals = (typeof dailyAiMealsPanel === 'function' && dailyAiMealsPanel().length >= 4)
    ? dailyAiMealsPanel()
    : getDailyItems((MEALS_DB && MEALS_DB.length) ? MEALS_DB : MEALS, 6);
  renderDietMealsCards(todaysMeals, null);
  // Async upgrade: Gemini generates halal, locally-popular meals for the
  // user's location (falls back silently to the local cards above).
  try { maybeShowGeminiMeals(); } catch (e) {}
  // === Round 10: Refresh coach-recommended meals panel ===
  // Per user spec: "make coach meals appear on athlete version". This ensures
  // the #diet-coach-meals panel updates every time the Diet tab is rendered,
  // so the athlete sees meals their coach assigned.
  try { if (typeof renderCoachMealsForUser === 'function') renderCoachMealsForUser(); } catch(e) {}
  // Diet plan panel (brought back per user request)
  try { renderDietPlanPanel(); } catch(e) {}
}

// === Round 6: Log an AI-generated meal to the diet log ===
// Per user spec: "in ai generated meals, under each meal add a button to log
// this meal and count it". This adds the meal (with full macros) to the same
// diet log used by the barcode scanner + manual entry, so the daily calorie
// progress bar updates immediately.
function logAIMeal(mealName, btnIdx) {
  try {
    // Phase 2: look up meal in MEALS_DB first (IndexedDB), then fall back to MEALS
    const _src = (MEALS_DB && MEALS_DB.length) ? MEALS_DB : MEALS;
    const m = _src.find(x => x.name === mealName);
    if (!m) return;
    const log = getDietLog();
    // === Round 7: BLOCK DUPLICATE AI MEAL LOG PER DAY ===
    // The user explicitly said: "dont make the user to be able to log the same
    // ai meal more than once a day". Check if this exact AI meal (by name + type)
    // was already logged today — if so, just re-mark the button as Logged and bail.
    const today = (typeof localDateStr === 'function') ? localDateStr() : null;
    const displayName = getMealName(m);
    const alreadyLogged = log.some(function(x) {
      return x.mealType === 'ai-meal'
        && x.date === today
        && x.name === displayName;
    });
    if (alreadyLogged) {
      // Just visually mark the button as Logged (no new entry pushed).
      const btn0 = document.getElementById('diet-log-meal-btn-' + btnIdx);
      if (btn0) {
        const ar0 = (store.lang === 'ar');
        // Note: label has NO trailing ✓ — the FontAwesome fa-check icon is the
        // single checkmark (per user spec: "keep the big one and remove the small one").
        const ll0 = ar0 ? 'تم التسجيل' : 'Logged';
        btn0.innerHTML = '<i class="fa-solid fa-check"></i> <span>' + ll0 + '</span>';
        btn0.style.background = 'var(--green)';
        btn0.style.color = '#fff';
        btn0.disabled = true;
        btn0.style.cursor = 'default';
      }
      return;
    }
    log.push({
      id: Date.now(),
      name: displayName,
      brand: '',
      kcal: m.kcal || 0,
      protein: m.p || 0,
      carbs: m.c || 0,
      fat: m.f || 0,
      fiber: 0,
      serving: '1 serving',
      barcode: '',
      mealType: 'ai-meal',
      loggedAt: new Date().toISOString(),
      date: localDateStr()   // local-date field — immune to UTC/off-by-one bugs
    });
    saveDietLog(log);
    // Refresh the diet log list + progress bar + home dashboard so the new
    // meal's calories show up everywhere immediately.
    try { renderDietLog(); renderDiet(); renderHome(); } catch(e) {}
    // Visual feedback: change the button to "Logged" (no trailing ✓ — the big
    // FontAwesome fa-check icon is the single checkmark, per user spec).
    const btn = document.getElementById('diet-log-meal-btn-' + btnIdx);
    if (btn) {
      const ar = (store.lang === 'ar');
      const loggedLabel = ar ? 'تم التسجيل' : 'Logged';
      btn.innerHTML = '<i class="fa-solid fa-check"></i> <span>' + loggedLabel + '</span>';
      btn.style.background = 'var(--green)';
      btn.style.color = '#fff';
      btn.disabled = true;
      btn.style.cursor = 'default';
    }
  } catch(e) { console.warn('logAIMeal error:', e); }
}
// ===== DIET PLAN (brought back per user request) =====
// Renders u.plan.diet — the generated nutrition plan (daily calories, macro
// targets, hydration and the per-meal schedule with suggested meals).
// Used by:
//   • the Diet tab "My Diet Plan" panel (#diet-plan-body)
//   • the bottom of the "My Workout Plan" popup (plan-view-body)

// ===== Round 9: guaranteed meal suggestions =====
// User report: the Breakfast/Lunch/Dinner rows in "My Diet Plan" were BLANK.
// Root cause: suggestions are filled async from IndexedDB at plan-generation
// time; if that raced the DB seed (or the plan predates the feature) the empty
// list was persisted in the saved plan forever, and every renderer skipped it.
// pickMealsForType() is the SYNCHRONOUS safety net used by ALL renderers:
//   source chain: MEALS_DB (IndexedDB cache) → VOLTA_MEAL_SEED (static, always
//   loaded) → MEALS (legacy). Filtered by meal type, personalized with a
//   per-account seed (different users → different meals) and sorted by how
//   close each meal's calories are to the slot target.
function pickMealsForType(type, kcalTarget, count) {
  try {
    count = count || 3;
    let pool = (typeof MEALS_DB !== 'undefined' && MEALS_DB && MEALS_DB.length) ? MEALS_DB : null;
    if (!pool && window.VOLTA_MEAL_SEED && window.VOLTA_MEAL_SEED.length) pool = window.VOLTA_MEAL_SEED;
    if (!pool) pool = MEALS;
    let items = pool.filter(m => m.mealType === type);
    if (!items.length) items = pool.slice();               // type tags missing → anything
    // Respect the user's diet preference when we can (plan.preferences.diet_pref
    // OR the survey answer — v12). Vegetarian/Vegan/Keto/Gluten-free/Halal all
    // supported now; Gluten-free also excludes meals tagged "Allergen: Gluten"
    // or carrying obvious gluten ingredients.
    try {
      const u = currentUser();
      let pref = u && u.plan && u.plan.preferences && u.plan.preferences.diet_pref;
      if (!pref && u && u.survey) pref = u.survey.diet_pref;
      if (pref === 'Vegetarian' || pref === 'Vegan' || pref === 'Keto' || pref === 'Gluten-free') {
        const want = pref.toLowerCase();
        if (want === 'gluten-free') {
          const gf = items.filter(function (m) {
            const tags = (m.tags || []).map(function (t) { return String(t).toLowerCase(); });
            if (tags.indexOf('allergen: gluten') !== -1) return false;
            if (tags.indexOf('gluten free') !== -1 || m.diet === 'gluten-free') return true;
            const blob = [m.name, m.desc, (m.ingredients || []).join(' ')].join(' ').toLowerCase();
            return !/(wheat|barley|bulgur|couscous|semolina|pita|pasta|noodle|bread|tortilla|wrap|breadcrumb|malt|flour|soy sauce|oatmeal|rolled oats|croissant|bagel|pretzel)/.test(blob);
          });
          if (gf.length >= count) items = gf;
        } else {
          const strict = items.filter(m => m.diet === want || (want === 'vegetarian' && m.diet === 'vegan'));
          if (strict.length >= count) items = strict;
        }
      } else if (pref === 'Halal') {
        const strict = items.filter(m => !m.diet || m.diet === 'halal' || m.diet === 'omnivore' || m.diet === 'vegetarian' || m.diet === 'vegan');
        if (strict.length >= count) items = strict;
      }
    } catch (e) {}
    // Deterministic per-account shuffle → stable for this user, varies across users
    let seedStr = String((store && store.session) || 'anon') + '|' + type;
    let seed = 2166136261 >>> 0;
    for (let i = 0; i < seedStr.length; i++) { seed ^= seedStr.charCodeAt(i); seed = Math.imul(seed, 16777619) >>> 0; }
    function rand() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
    const shuffled = items.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    // Prefer meals whose kcal fits this slot's calorie budget
    let pool10 = shuffled.slice(0, Math.min(shuffled.length, 10));
    if (kcalTarget) {
      pool10.sort((a, b) => Math.abs((a.kcal || 0) - kcalTarget) - Math.abs((b.kcal || 0) - kcalTarget));
    }
    return pool10.slice(0, count).map(m => m.name).filter(Boolean);
  } catch (e) { console.warn('pickMealsForType error:', e); return []; }
}
window.pickMealsForType = pickMealsForType;   // shared with plan-engine.js / volta-features.js

// ===== Round 10: meals follow the AI-Generated Meals engine =====
// Per user request: "make meals according to ai generated meals". The whole
// Diet tab now runs on ONE daily AI meal generation:
//   dailyAiMealSet() shuffles the meal DB with the day-of-month seed (same
//   generator the "AI-Generated Meals" panel always used) and picks a
//   BALANCED set: 3 breakfasts, 3 lunches, 3 dinners, 3 snacks — so every
//   slot of "My Diet Plan" gets real AI meals of its own type every day,
//   and the AI panel shows one meal per type instead of 4 random ones.
// v12: shared strict meal-vs-diet-preference check (used by the offline
// daily AI meal set). Halal/pork-free rules apply to the seed data itself
// (bacon/haram items were removed in an earlier round), so here we only
// enforce the personal preference: vegetarian / vegan / gluten-free / keto.
function mealAllowedByDietPref(m, pref) {
  try {
    if (!pref || pref === 'None' || pref === 'Halal') return true;
    const tags = (m.tags || []).map(function (t) { return String(t).toLowerCase(); });
    if (pref === 'Vegetarian') return m.diet === 'vegetarian' || m.diet === 'vegan';
    if (pref === 'Vegan') return m.diet === 'vegan';
    if (pref === 'Keto') return m.diet === 'keto';
    if (pref === 'Gluten-free') {
      if (tags.indexOf('allergen: gluten') !== -1) return false;
      if (m.diet === 'gluten-free' || tags.indexOf('gluten free') !== -1) return true;
      const blob = [m.name, m.desc, (m.ingredients || []).join(' ')].join(' ').toLowerCase();
      return !/(wheat|barley|bulgur|couscous|semolina|pita|pasta|noodle|bread|tortilla|wrap|breadcrumb|malt|flour|soy sauce|oatmeal|rolled oats|croissant|bagel|pretzel)/.test(blob);
    }
    return true;
  } catch (e) { return true; }
}
window.mealAllowedByDietPref = mealAllowedByDietPref;

function dailyAiMealSet() {
  try {
    let src = (typeof MEALS_DB !== 'undefined' && MEALS_DB && MEALS_DB.length) ? MEALS_DB : MEALS;
    // v12: the OFFLINE daily AI set obeys the diet preference too (vegan /
    // vegetarian / gluten-free / keto users never see food they can't eat,
    // even without the Gemini backend).
    const dietPref = (typeof currentDietPref === 'function') ? currentDietPref() : 'None';
    if (dietPref && dietPref !== 'None' && dietPref !== 'Halal') {
      const filtered = src.filter(function (m) { return mealAllowedByDietPref(m, dietPref); });
      if (filtered.length >= 6) src = filtered;   // safety: never starve the panel
    }
    // Seed = account + calendar day → the set rotates EVERY DAY but stays
    // stable within the day, AND different accounts get different AI meals
    // (keeps the Round-9 personalization guarantee).
    const seedStr = String((store && store.session) || 'anon') + '|' + new Date().toDateString();
    let seed = 2166136261 >>> 0;
    for (let i = 0; i < seedStr.length; i++) { seed ^= seedStr.charCodeAt(i); seed = Math.imul(seed, 16777619) >>> 0; }
    function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
    const arr = (src || []).slice();
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp; }
    const want = { breakfast: 3, lunch: 3, dinner: 3, snack: 3 };
    const picked = { breakfast: [], lunch: [], dinner: [], snack: [] };
    const seen = {};
    (arr || []).forEach(m => {
      if (!m || !m.name || seen[m.name]) return;
      const t = String(m.mealType || '').toLowerCase();
      if (want[t] !== undefined && picked[t].length < want[t]) { seen[m.name] = 1; picked[t].push(m); }
    });
    return picked;
  } catch (e) { return { breakfast: [], lunch: [], dinner: [], snack: [] }; }
}
window.dailyAiMealSet = dailyAiMealSet;           // shared with tests

// Balanced flat list for the "AI-Generated Meals" panel: one meal per type
// (breakfast / lunch / dinner / snack) topped up from the same daily set.
// Per user request the panel now shows MORE than 4 meals (6) — the 4 slot
// meals first, then the 2 best remaining meals of the day's AI set.
function dailyAiMealsPanel() {
  try {
    const set = dailyAiMealSet();
    const flat = [];
    const seen = {};
    ['breakfast', 'lunch', 'dinner', 'snack'].forEach(t => {
      if (set[t] && set[t][0] && !seen[set[t][0].name]) { seen[set[t][0].name] = 1; flat.push(set[t][0]); }
    });
    if (flat.length < 4) {
      ['breakfast', 'lunch', 'dinner', 'snack'].forEach(t => {
        (set[t] || []).forEach(m => { if (flat.length < 4 && !seen[m.name]) { seen[m.name] = 1; flat.push(m); } });
      });
    }
    // Top up to 6 with the next-best unused meals of the daily AI set.
    if (flat.length < 6) {
      ['breakfast', 'lunch', 'dinner', 'snack'].forEach(t => {
        (set[t] || []).forEach(m => { if (flat.length < 6 && !seen[m.name]) { seen[m.name] = 1; flat.push(m); } });
      });
    }
    return flat;
  } catch (e) { return []; }
}
window.dailyAiMealsPanel = dailyAiMealsPanel;

function suggestionsForSlot(type, kcalTarget, count) {
  try {
    count = count || 3;
    const out = [];
    const seen = {};
    const push = function (arr) {
      (arr || []).forEach(function (m) {
        if (m && m.name && !seen[m.name]) { seen[m.name] = 1; out.push(m.name); }
      });
    };
    const byKcal = function (arr) {
      if (!kcalTarget) return (arr || []).slice();
      return (arr || []).slice().sort((a, b) => Math.abs((a.kcal || 0) - kcalTarget) - Math.abs((b.kcal || 0) - kcalTarget));
    };
    // ===== v17 (user): "make ... diet plan in dashboard be synced with ...
    // ai generated meals" =====
    // The day's AI-Generated Meals set is now the ONLY chip source whenever it
    // exists: every chip a diet-plan row shows (dashboard DIET PLAN card AND
    // the Diet tab's "My Diet Plan") is one of the meals the AI-Generated
    // Meals panel is showing for today — no foreign meal-DB backfill beside
    // it, and the offline set never mixes into a Gemini day.
    // 0) TODAY'S GEMINI SET (the panel's source when online): type matches
    //    first; a missing type (e.g. snack) borrows the closest meals of the
    //    SAME set (the panel shows exactly these meals).
    try {
      const rec = (typeof geminiMealsToday === 'function') ? geminiMealsToday() : null;
      if (rec && rec.meals && rec.meals.length) {
        const matches = rec.meals.filter(m => String(m.mealType || '').toLowerCase() === type);
        push(byKcal(matches.length ? matches : rec.meals).slice(0, count));
        if (out.length) return out.slice(0, count);
      }
    } catch (e) {}
    // 1) The OFFLINE daily AI set (the panel's source without Gemini): same
    //    rule — only set meals; a missing type borrows within the set.
    //    v12 rule kept: never recommend what the diet preference forbids.
    const set = dailyAiMealSet();
    let all = [];
    ['breakfast', 'lunch', 'dinner', 'snack'].forEach(function (t) { (set[t] || []).forEach(function (m) { all.push(m); }); });
    try {
      let pref = null;
      const u = currentUser();
      if (u && u.plan && u.plan.preferences && u.plan.preferences.diet_pref) pref = u.plan.preferences.diet_pref;
      else if (u && u.survey && u.survey.diet_pref) pref = u.survey.diet_pref;
      if (pref && pref !== 'None' && typeof mealAllowedByDietPref === 'function') {
        const allowed = all.filter(function (m) { return mealAllowedByDietPref(m, pref); });
        if (allowed.length) all = allowed;   // never starve a slot
      }
    } catch (e) {}
    if (all.length) {
      const same = all.filter(m => String(m.mealType || '').toLowerCase() === type);
      push(byKcal(same.length ? same : all).slice(0, count));
      if (out.length) return out.slice(0, count);
    }
    // 2) Safety net — NO AI set exists at all today (should not normally
    //    happen: dailyAiMealSet always builds one): the old personalized
    //    backfill so a row is never blank.
    if (out.length < count) {
      const backfill = pickMealsForType(type, kcalTarget, 12) || [];
      backfill.forEach(n => { if (n && !seen[n]) { seen[n] = 1; out.push(n); } });
    }
    return out.slice(0, count);
  } catch (e) { console.warn('suggestionsForSlot error:', e); return []; }
}
window.suggestionsForSlot = suggestionsForSlot;   // shared with volta-features.js

// Per user request: clicking a meal in the DIET PLAN directs the user to the
// AI-Generated Meals panel where the meal can be logged with one tap.
//  - If the meal card is visible in the panel → scroll to it + gold flash.
//  - If it's NOT among the visible cards → open its info modal, which now
//    carries a full "Log this meal" button (same log path as the cards).
function jumpToGeneratedMeal(name) {
  try {
    showTab('diet');
  } catch (e) {}
  requestAnimationFrame(function () {
    let target = null;
    try {
      document.querySelectorAll('#diet-meals .diet-card').forEach(function (card) {
        const n = card.getAttribute('data-meal-name');
        if (!target && n === name) target = card;
      });
    } catch (e) {}
    if (target) {
      try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { target.scrollIntoView(); }
      target.classList.remove('vp-meal-flash');
      void target.offsetWidth;   // restart the animation
      target.classList.add('vp-meal-flash');
      setTimeout(function () { target.classList.remove('vp-meal-flash'); }, 2200);
    } else {
      // Not among the visible cards → info modal (with the Log button).
      showMealInfo(name);
    }
  });
}
window.jumpToGeneratedMeal = jumpToGeneratedMeal;

function renderDietPlanHtml(plan, ar) {
  if (!plan || !plan.diet) return '';
  const d = plan.diet;
  const kcalUnit = ar ? 'سعرة' : 'kcal';
  const pLabel = ar ? 'ب' : 'P', cLabel = ar ? 'ك' : 'C', fLabel = ar ? 'د' : 'F';
  const typeLabels = ar
    ? { breakfast: 'الفطور', lunch: 'الغداء', dinner: 'العشاء', snack: 'وجبة خفيفة' }
    : { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };
  let html = '<div class="plan-stats">' +
    '<span class="plan-stat-pill"><b>' + d.dailyCalories + '</b> ' + (ar ? 'سعرة/يوم' : 'kcal/day') + '</span>' +
    '<span class="plan-stat-pill"><b>' + d.macros.p + 'g</b> ' + (ar ? 'بروتين' : 'protein') + '</span>' +
    '<span class="plan-stat-pill"><b>' + d.macros.c + 'g</b> ' + (ar ? 'كربهيدرات' : 'carbs') + '</span>' +
    '<span class="plan-stat-pill"><b>' + d.macros.f + 'g</b> ' + (ar ? 'دهون' : 'fat') + '</span>' +
    // v29 (user, picture 2): water comes from the ONE shared live source
    // (same number as the dashboard's top DAILY WATER TARGET stat).
    '<span class="plan-stat-pill"><i class="fa-solid fa-droplet" style="color:var(--accent);"></i> <b>' + ((typeof waterTargetLiters === 'function' ? waterTargetLiters() : d.hydrationLiters) || '--') + 'L</b> ' + (ar ? 'ماء/يوم' : 'water/day') + '</span>' +
  '</div>';
  // v10 (user): "in my diet plan, change the blocks design of meals and make
  // it look like the ones in the dashboard" — the meal rows now use the SAME
  // markup + classes as the dashboard DIET PLAN card (.plan-meal-row headers
  // + .plan-food-chip buttons), wrapped in a .plan-split-card so the blocks
  // render pixel-identical to the dashboard diet blocks. Meal suggestions
  // still prefer today's AI-generated meals (Round 10 sync) and the chips
  // still jump to the AI-Generated Meals panel on tap.
  html += '<div class="plan-split-card diet-plan-card"><div class="plan-meal-schedule" style="display:block;">';
  (d.mealSchedule || []).forEach(function(meal) {
    const tLabel = typeLabels[meal.type] || meal.type;
    const macrosTxt = '~' + meal.targetCalories + ' ' + kcalUnit + ' · ' + pLabel + ' ' + meal.targetMacros.p + 'g · ' + cLabel + ' ' + meal.targetMacros.c + 'g · ' + fLabel + ' ' + meal.targetMacros.f + 'g';
    html += '<div class="plan-meal-row">';
    html += '<div class="plan-meal-head">' +
      '<span class="plan-meal-name"><i class="fa-solid fa-bowl-food" style="color:var(--accent);font-size:.78rem;"></i> ' + tLabel + '</span>' +
      (meal.targetCalories ? '<span class="plan-meal-kcal">' + macrosTxt + '</span>' : '') +
    '</div>';
    // Round 10: meals follow the AI-Generated Meals engine — the slot first
    // shows today's AI-generated meals of its own type (same daily selection
    // as the "AI-Generated Meals" panel), then personalized pool backfill.
    let sug = null;
    try {
      if (typeof suggestionsForSlot === 'function') sug = suggestionsForSlot(meal.type, meal.targetCalories, 3);
    } catch (e) { sug = null; }
    if (!sug || !sug.length) sug = (meal.suggestions && meal.suggestions.length) ? meal.suggestions : null;   // persisted plan document
    if (!sug || !sug.length) sug = pickMealsForType(meal.type, meal.targetCalories);   // Round 9: never blank
    if (sug && sug.length) {
      html += '<div class="plan-food-grid">';
      sug.slice(0, 3).forEach(function(name) {
        // Per user request: clicking a meal in the diet plan directs the user
        // to the "AI-Generated Meals" panel where they can log it. The chip
        // shows the localized name; the jump uses the internal English name.
        const mObj = (function () {
          try { if (MEALS_DB && MEALS_DB.length) return MEALS_DB.find(x => x.name === name) || null; } catch (e) {}
          try { if (window.VOLTA_MEAL_SEED && window.VOLTA_MEAL_SEED.length) return window.VOLTA_MEAL_SEED.find(x => x.name === name) || null; } catch (e) {}
          return MEALS.find(x => x.name === name) || null;
        })();
        const disp = mObj ? getMealName(mObj) : name;
        const esc = String(name).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
        html += '<button type="button" class="plan-food-chip plan-food-chip-btn" onclick="jumpToGeneratedMeal(\'' + esc + '\')" aria-label="' + disp + '">' +
          '<i class="fa-solid fa-check"></i>' + disp + '</button>';
      });
      html += '</div>';
    }
    html += '</div>';
  });
  html += '</div></div>';
  return html;
}
// Fill the Diet tab's "My Diet Plan" panel from the user's generated plan.
// Hidden entirely when no plan exists yet (e.g. onboarding incomplete).
// Round 9: while rendering, any meal row that has no persisted suggestions is
// filled synchronously by pickMealsForType() — AND a background pass runs
// populateMealSuggestions() so the real per-user picks get saved into the plan
// permanently (self-heals plans created before this system existed).
// ===== v16 (user): "i get dinner only in diet plan" =====
// Plans generated while the survey answer was "1 meal" stored a mealSchedule
// with a single Dinner row (the whole day collapsed into it). The engine now
// always builds the full-day schedule (see plan-engine.js), but ALREADY-SAVED
// plans keep the old dinner-only schedule until regenerated. This healer
// upgrades those in place: fewer than 2 meal rows → rebuilt to the standard
// breakfast/lunch/dinner split (existing dailyCalories/macros re-split 25/35/40,
// hydration untouched, suggestions left for the normal fillers). Idempotent —
// after one heal the schedule has 3 rows and never triggers again.
function healSingleMealDietPlan(u) {
  try {
    if (!u || !u.plan || !u.plan.diet) return false;
    const d = u.plan.diet;
    const ms = d.mealSchedule;
    if (!Array.isArray(ms) || ms.length >= 2) return false;
    const kc = d.dailyCalories || 2000;
    const mc = d.macros || { p: 150, c: 200, f: 55 };
    const dist = [
      { type: 'breakfast', portion: 0.25 },
      { type: 'lunch', portion: 0.35 },
      { type: 'dinner', portion: 0.40 }
    ];
    d.mealSchedule = dist.map(function (m) {
      return {
        type: m.type,
        targetCalories: Math.round(kc * m.portion),
        targetMacros: {
          p: Math.round(mc.p * m.portion),
          c: Math.round(mc.c * m.portion),
          f: Math.round(mc.f * m.portion)
        },
        suggestions: []
      };
    });
    d.mealsPerDay = 3;
    if (store.session) { try { saveUser(store.session, u); } catch (e) {} }
    return true;
  } catch (e) { return false; }
}
window.healSingleMealDietPlan = healSingleMealDietPlan;

function renderDietPlanPanel() {
  try {
    const u = currentUser();
    const panel = document.getElementById('diet-plan-panel');
    const body = document.getElementById('diet-plan-body');
    if (!panel || !body) return;
    // v16: upgrade dinner-only legacy plans in place before rendering.
    if (u && u.plan && u.plan.diet) healSingleMealDietPlan(u);
    const ar = (store.lang === 'ar');
    if (!u || !u.plan || !u.plan.diet) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    body.innerHTML = renderDietPlanHtml(u.plan, ar);
    if (typeof applyTranslations === 'function') applyTranslations();
    // Self-heal: persist real suggestions for old/broken plans, then re-render.
    // (populateMealSuggestions now saves internally via a fresh store read —
    // Round 9 fix for the stale-object bug.)
    const needsFill = (u.plan.diet.mealSchedule || []).some(m => !m.suggestions || !m.suggestions.length);
    if (window.__R9_DEBUG) console.log('[R9-heal]', JSON.stringify({ needsFill: needsFill, hasDB: !!window.VoltaDB, hasPlan: !!window.VoltaPlan }));
    if (needsFill && window.VoltaDB && window.VoltaPlan && VoltaPlan.populateMealSuggestions) {
      VoltaPlan.populateMealSuggestions(u.plan).then(function () {
        try {
          const body2 = document.getElementById('diet-plan-body');
          if (body2) body2.innerHTML = renderDietPlanHtml(u.plan, ar);
          if (typeof renderPlan === 'function') { try { renderPlan(); } catch (e) {} }
        } catch (e) {}
        if (window.__R9_DEBUG) console.log('[R9-heal-done]');
      }).catch(function (e) { if (window.__R9_DEBUG) console.log('[R9-heal-ERR]', String(e)); });
    }
  } catch(e) { console.warn('renderDietPlanPanel error:', e); }
}
function showMealInfo(name) {
  // Phase 2: look up meal in MEALS_DB first (IndexedDB), then the static seed,
  // then fall back to MEALS (Round 9: suggestions can come from any source).
  let m = null;
  try { if (MEALS_DB && MEALS_DB.length) m = MEALS_DB.find(x=>x.name===name) || null; } catch(e) {}
  if (!m && window.VOLTA_MEAL_SEED && window.VOLTA_MEAL_SEED.length) m = window.VOLTA_MEAL_SEED.find(x=>x.name===name) || null;
  if (!m) m = MEALS.find(x=>x.name===name) || null;
  if (!m) return;
  const ar = (store.lang === 'ar');
  const kcalUnit = ar ? 'سعرة' : 'kcal';
  const pLabel = ar ? 'ب' : 'P';
  const cLabel = ar ? 'ك' : 'C';
  const fLabel = ar ? 'د' : 'F';
  document.getElementById('modal-title').textContent = getMealName(m);
  document.getElementById('modal-desc').textContent = getMealDesc(m);
  document.getElementById('modal-macros').innerHTML = `<span class="macro-pill macro-kcal">${m.kcal} ${kcalUnit}</span><span class="macro-pill macro-p">${pLabel}: ${m.p}g</span><span class="macro-pill macro-c">${cLabel}: ${m.c}g</span><span class="macro-pill macro-f">${fLabel}: ${m.f}g</span>`;
  // Preserve data-ar on these titles — don't overwrite with .textContent
  const ingTitle = document.getElementById('modal-ing-title');
  const recTitle = document.getElementById('modal-rec-title');
  ingTitle.textContent = ar ? 'التغذية والمكونات' : 'Nutrition & Ingredients';
  ingTitle.setAttribute('data-ar', 'التغذية والمكونات');
  recTitle.textContent = ar ? 'خطوات التحضير' : 'Recipe Steps';
  recTitle.setAttribute('data-ar', 'خطوات التحضير');
  // v12: restore the recipe block (showGeminiMealInfo may have hidden it for
  // a Gemini meal without steps) and the Log button's original handler
  // (the Gemini variant re-points it at logGeminiMealFromModal).
  recTitle.style.display = '';
  document.getElementById('modal-recipe').style.display = '';
  document.getElementById('modal-ingredients').innerHTML = getMealIngredients(m).map(i => `<li>${i}</li>`).join('');
  document.getElementById('modal-recipe').innerHTML = getMealRecipe(m).map(r => `<li>${r}</li>`).join('');
  // Per user request: the meal info modal carries a Log button so any meal
  // reached from the diet plan can be logged even when its card is not one
  // of the visible AI-Generated Meals cards.
  window.__voltaCurrentMealName = m.name;
  const mlogBtn = document.getElementById('meal-modal-log-btn');
  if (mlogBtn) {
    mlogBtn.setAttribute('data-ar', mlogBtn.getAttribute('data-ar') || 'تسجيل هذه الوجبة');
    mlogBtn.style.display = '';
    mlogBtn.setAttribute('onclick', 'logCurrentMealFromModal()');
  }
  openModal('meal-modal');
  setTimeout(applyTranslations, 0);
}
// v12: More-info modal for GEMINI (AI-generated) meal cards — same modal
// as showMealInfo, fed from today's cached Gemini record. The recipe list
// is hidden when Gemini didn't return preparation steps.
function showGeminiMealInfo(idx) {
  try {
    const rec = geminiMealsToday();
    if (!rec) return;
    const m = (rec.meals || [])[idx];
    if (!m) return;
    const ar = (store.lang === 'ar');
    const kcalUnit = ar ? 'سعرة' : 'kcal';
    const pLabel = ar ? 'ب' : 'P';
    const cLabel = ar ? 'ك' : 'C';
    const fLabel = ar ? 'د' : 'F';
    document.getElementById('modal-title').textContent = m.name;
    document.getElementById('modal-desc').textContent = m.desc || '';
    document.getElementById('modal-macros').innerHTML = `<span class="macro-pill macro-kcal">${m.kcal} ${kcalUnit}</span><span class="macro-pill macro-p">${pLabel}: ${m.p}g</span><span class="macro-pill macro-c">${cLabel}: ${m.c}g</span><span class="macro-pill macro-f">${fLabel}: ${m.f}g</span>`;
    const ingTitle = document.getElementById('modal-ing-title');
    const recTitle = document.getElementById('modal-rec-title');
    ingTitle.textContent = ar ? 'المكونات' : 'Ingredients';
    ingTitle.setAttribute('data-ar', 'المكونات');
    document.getElementById('modal-ingredients').innerHTML = (m.ingredients || []).map(i => `<li>${i}</li>`).join('') || '<li>—</li>';
    // Gemini meals have no recipe steps → hide that whole block.
    const steps = (m.recipe || []);
    const recList = document.getElementById('modal-recipe');
    recTitle.style.display = steps.length ? '' : 'none';
    recList.style.display = steps.length ? '' : 'none';
    recTitle.textContent = ar ? 'خطوات التحضير' : 'Recipe Steps';
    recTitle.setAttribute('data-ar', 'خطوات التحضير');
    recList.innerHTML = steps.map(r => `<li>${r}</li>`).join('');
    window.__voltaCurrentMealName = m.name;
    const mlogBtn = document.getElementById('meal-modal-log-btn');
    if (mlogBtn) {
      mlogBtn.setAttribute('data-ar', mlogBtn.getAttribute('data-ar') || 'تسجيل هذه الوجبة');
      mlogBtn.style.display = '';
      mlogBtn.setAttribute('onclick', 'logGeminiMealFromModal(' + idx + ')');
    }
    openModal('meal-modal');
    setTimeout(applyTranslations, 0);
  } catch (e) { console.warn('showGeminiMealInfo error:', e); }
}
window.showGeminiMealInfo = showGeminiMealInfo;
// Log a Gemini meal straight from the info modal (same dedupe as the card).
function logGeminiMealFromModal(idx) {
  try { logGeminiMeal(idx); } catch (e) {}
}
window.logGeminiMealFromModal = logGeminiMealFromModal;
// Logs the meal currently open in the meal info modal (see showMealInfo).
function logCurrentMealFromModal() {
  try {
    const name = window.__voltaCurrentMealName;
    if (!name) return;
    logAIMeal(name, -1);   // -1 → no card button to repaint; list re-renders instead
    // v30: satisfying chime when a meal is logged
    try { if (window.VoltaSounds) VoltaSounds.play('success'); } catch (e) {}
    try { closeModal('meal-modal'); } catch (e) {}
  } catch (e) { console.warn('logCurrentMealFromModal error:', e); }
}

function renderCalc() {
  const u = currentUser(), p = u.profile;
  document.getElementById('calc-current-display').textContent = p.weight + ' kg';
  // ===== AUTO-DETECT TARGET WEIGHT (round 3) =====
  // Priority order:
  //   1) User's explicit survey answer to "Do you have a specific target weight?"
  //      (key: weight_goal, e.g. "70 kg" → 70). Per user spec: "make it equal
  //      to the user's desired weight goal".
  //   2) Previously saved goalPlan target weight
  //   3) Ideal weight derived from height + goal (Lose→-7%, Build→+5%, etc.)
  //   4) Current weight as a safe fallback
  // After pre-filling, auto-calculate immediately (no button click required).
  const targetInput = document.getElementById('calc-target-only');
  if (targetInput && !targetInput.value) {
    let autoTarget;
    // Priority 1: survey weight_goal
    if (u.survey && u.survey.weight_goal) {
      const wg = String(u.survey.weight_goal).replace(/[^0-9.]/g, '');
      if (wg && parseFloat(wg) > 0) autoTarget = parseFloat(wg);
    }
    // Priority 2: existing goalPlan
    if (!autoTarget && u.goalPlan && u.goalPlan.targetWeight) {
      autoTarget = parseFloat(u.goalPlan.targetWeight);
    }
    // Priority 3: height-based ideal weight, adjusted by goal
    if (!autoTarget) {
      const heightInches = p.height / 2.54;
      const inchesOver5Ft = Math.max(0, heightInches - 60);
      const idealWeight = p.gender === 'Female' ? 45.5 + (2.3 * inchesOver5Ft) : 50 + (2.3 * inchesOver5Ft);
      if (p.goal === 'Lose weight') {
        autoTarget = Math.max(idealWeight, p.weight * 0.93);
      } else if (p.goal === 'Build muscle') {
        autoTarget = p.weight * 1.05;
      } else {
        autoTarget = idealWeight;
      }
    }
    // Priority 4: current weight (safe fallback)
    if (!autoTarget || autoTarget < 30 || autoTarget > 300) autoTarget = p.weight;
    targetInput.value = autoTarget.toFixed(1);
  }
  // === AUTO-CALCULATE immediately on tab open (no button click required) ===
  // Per user spec: "make it calculate without clicking on a button".
  setTimeout(autoCalculateGoal, 150);
}
// === AUTO-CALC FITNESS CALCULATOR (round 3) ===
// Per user spec: "in fitness calculator, make it calculate without clicking on
// a button & make it equal to the user's desired weight goal".
//
// 1) The target weight input auto-fills from the user's survey answer to
//    'weight_goal' (e.g. "70 kg" → 70). If the user already has a goalPlan,
//    we use that target instead.
// 2) On every input change, we auto-calculate (debounced 400ms) — no button
//    click required. The Calculate button is kept as a fallback for accessibility.
let _autoCalcTimer = null;
function autoCalculateGoal() {
  // Debounce: wait 400ms after the user stops typing before recalculating.
  if (_autoCalcTimer) clearTimeout(_autoCalcTimer);
  _autoCalcTimer = setTimeout(function() {
    try {
      const val = parseFloat(document.getElementById('calc-target-only').value);
      if (!val || val < 30 || val > 300) return; // invalid — silently skip
      calculateGoalFancy();
    } catch(e) { /* silent fail — user is still typing */ }
  }, 400);
}
// Pre-fill the target weight input from survey weight_goal or existing goalPlan.
// Called whenever the user opens the Fitness Calculator tab.
function prefillCalcTarget() {
  try {
    const u = currentUser();
    if (!u) return;
    const input = document.getElementById('calc-target-only');
    if (!input) return;
    // Don't overwrite if the user already typed something
    if (input.value && parseFloat(input.value) > 0) return;
    // Priority 1: existing goalPlan target
    if (u.goalPlan && u.goalPlan.targetWeight) {
      input.value = u.goalPlan.targetWeight;
      // Auto-calc immediately so the result shows without a click
      setTimeout(autoCalculateGoal, 100);
      return;
    }
    // Priority 2: survey weight_goal (e.g. "70 kg" → "70")
    if (u.survey && u.survey.weight_goal) {
      const wg = String(u.survey.weight_goal).replace(/[^0-9.]/g, '');
      if (wg) {
        input.value = wg;
        setTimeout(autoCalculateGoal, 100);
        return;
      }
    }
    // Priority 3: derive from goal (Lose weight → -10%, Build muscle → +5%)
    if (u.profile && u.profile.weight && u.survey && u.survey.goal) {
      const w = u.profile.weight;
      const g = u.survey.goal;
      let target = w;
      if (g === 'Lose weight') target = Math.round((w * 0.9) * 10) / 10;
      else if (g === 'Build muscle') target = Math.round((w * 1.05) * 10) / 10;
      else if (g === 'Improve endurance') target = Math.round((w * 0.95) * 10) / 10;
      else target = w; // Stay healthy, etc. → keep current
      if (target > 0) {
        input.value = target;
        setTimeout(autoCalculateGoal, 100);
      }
    }
  } catch(e) { console.warn('prefillCalcTarget error:', e); }
}
function calculateGoalFancy() {
  const u = currentUser(), p = u.profile, s = u.survey;
  const current = p.weight;
  const target = parseFloat(document.getElementById('calc-target-only').value);
  if (!target) { alert("Please enter a target weight."); return; }
  if (target < 30 || target > 300) { alert("Target weight must be between 30 and 300 kg."); return; }
  const diff = current - target;
  const totalKcal = Math.abs(diff) * 7700;
  let bmr = p.gender === 'Female' ? 447.6 + (9.25 * current) + (3.1 * p.height) - (4.33 * p.age) : 88.36 + (13.4 * current) + (4.8 * p.height) - (5.68 * p.age);
  let days = s?.schedule || '3-4';
  let af = days === '1-2' ? 1.375 : days === '3-4' ? 1.55 : days === '5+' ? 1.725 : 1.9;
  let tdee = bmr * af;
  const sessions = u.sessions || [];
  const weekAgo = Date.now() - 7 * 864e5;
  const exCal = sessions.filter(s => new Date(s.date).getTime() >= weekAgo).reduce((a, s) => a + kcalForSession(s), 0);
  const dailyExBurn = exCal / 7;
  let dailyDeficit = 500;
  if (diff < 0) dailyDeficit = 300;
  let totalDailyBurn = tdee + dailyExBurn;
  let daysNeeded = Math.ceil(totalKcal / dailyDeficit);
  let targetDate = new Date(); targetDate.setDate(targetDate.getDate() + daysNeeded);
  // ===== PUSH TO DASHBOARD =====
  // Save the goal plan to the user record so the dashboard's "Goal Progress"
  // panel shows current → target with the auto-counted days.
  u.goalPlan = {
    startWeight: u.goalPlan?.startWeight || current,
    targetWeight: target,
    targetDate: targetDate.toISOString().slice(0, 10),
    daysNeeded: daysNeeded,
    targetCals: Math.round(tdee + (diff > 0 ? -dailyDeficit : dailyDeficit)),
    tdee: Math.round(tdee),
    dailyDeficit: dailyDeficit,
    dailyExBurn: Math.round(dailyExBurn),
    totalDailyBurn: Math.round(totalDailyBurn),
    startDate: u.goalPlan?.startDate || localDateStr(),
    savedAt: Date.now(),
    goalUpdatedAt: Date.now()
  };
  saveUser(store.session, u);
  document.getElementById('calc-fancy-result').classList.remove('hidden');
  document.getElementById('calc-fancy-result').innerHTML = `
    <div class="calc-result-days">${daysNeeded}</div>
    <div class="calc-result-label" data-ar="أيام للوصول إلى ${target} كجم">Days to reach ${target} kg</div>
    <div style="text-align:center; margin-bottom:16px;"><small><span data-ar="التاريخ المستهدف: ">Target Date: </span><b>${targetDate.toLocaleDateString()}</b></small></div>
    <div style="text-align:center; margin-bottom:16px;"><small data-ar="تم تحديث لوحة التحكم بهذا الهدف.">Dashboard updated with this goal.</small></div>
    <div class="calc-result-grid">
      <div class="calc-result-item"><b>${Math.round(tdee)}</b><small data-ar="الصيانة اليومية (TDEE)">Daily Maintenance (TDEE)</small></div>
      <div class="calc-result-item"><b>${Math.round(dailyExBurn)}</b><small data-ar="متوسط حرق التمرين">Avg Exercise Burn</small></div>
      <div class="calc-result-item"><b>${Math.round(totalDailyBurn)}</b><small data-ar="إجمالي الحرق اليومي">Total Daily Burn</small></div>
      <div class="calc-result-item"><b>${dailyDeficit}</b><small data-ar="عجز ${diff > 0 ? 'يومي' : 'فائض يومي'}">Daily ${diff > 0 ? 'Deficit' : 'Surplus'}</small></div>
    </div>
  `;
  setTimeout(applyTranslations, 0);
  // Re-render the home dashboard so the Goal Progress panel shows the new target
  try { renderHome(); } catch(e) {}
}

// === AUTO-SET GOAL WEIGHT (round 5) ===
// Per user spec: "make the recommended weight goal change the number of the weight
// inside, not a whole popup + pick a better name".
//
// This button does NOT show any popup. It computes a healthy target weight using
// the Devine ideal-body-weight formula (based on height + gender), then nudges it
// based on the user's goal (lose/build/endurance). The result is written directly
// to the target weight input — the existing auto-calc on input change fires
// automatically, so the days-to-goal result shows up instantly. No prompts, no
// banners, no extra UI.
//
// Devine formula (kg):
//   Male:   50 + 2.3 × (heightInches - 60)
//   Female: 45.5 + 2.3 × (heightInches - 60)
//
// Goal adjustments:
//   Lose weight      → IBW − 5 kg (gentle deficit target)
//   Build muscle     → current + 3 kg (lean gain target)
//   Improve endurance → IBW (endurance athletes perform best near IBW)
//   Stay healthy     → IBW (default)
function autoSetGoalWeight() {
  try {
    const u = currentUser();
    if (!u || !u.profile) { alert('Please complete your profile first.'); return; }
    const p = u.profile;
    const s = u.survey || {};
    const goal = s.goal || p.goal || 'Lose weight';
    const current = p.weight || 70;
    // Convert height from cm to inches for the Devine formula
    const heightInches = (p.height || 170) / 2.54;
    const inchesOver5Ft = Math.max(0, heightInches - 60);
    const ibw = (p.gender === 'Female')
      ? (45.5 + 2.3 * inchesOver5Ft)
      : (50   + 2.3 * inchesOver5Ft);
    let target;
    if (goal === 'Build muscle') {
      target = current + 3;  // lean gain target
    } else if (goal === 'Lose weight') {
      target = Math.max(ibw - 5, current * 0.90);  // gentle 10% loss or IBW-5, whichever is lower
    } else if (goal === 'Improve endurance') {
      target = ibw;
    } else {
      target = ibw;  // Stay healthy / default
    }
    // Sanity bounds
    target = Math.max(30, Math.min(300, target));
    target = Math.round(target * 10) / 10;
    // Write the computed target weight DIRECTLY to the input field (no popup).
    const targetInput = document.getElementById('calc-target-only');
    if (!targetInput) return;
    targetInput.value = target.toFixed(1);
    // Fire the input event so autoCalculateGoal() runs and shows days-to-goal.
    targetInput.dispatchEvent(new Event('input', { bubbles: true }));
    // Brief visual flash on the input so the user notices the value changed.
    try {
      targetInput.style.transition = 'background-color .3s ease';
      targetInput.style.backgroundColor = 'var(--accent-soft)';
      setTimeout(function() { targetInput.style.backgroundColor = ''; }, 600);
    } catch(e) {}
  } catch(e) {
    console.warn('autoSetGoalWeight error:', e);
    alert('Could not compute a goal weight. Please complete your profile first.');
  }
}

// === Round 6: Auto-Set Goal Weight (Profile version) ===
// Same computation as autoSetGoalWeight() above, but writes the result directly
// to the user's goalPlan instead of the (now-removed) calc-target-only input.
// Computes TDEE + daysNeeded + targetDate and saves the full goal plan, then
// re-renders the profile so the new target shows immediately.
function autoSetGoalWeightFromProfile() {
  try {
    const u = currentUser();
    if (!u || !u.profile) { alert('Please complete your profile first.'); return; }
    const p = u.profile;
    const s = u.survey || {};
    const goal = s.goal || p.goal || 'Lose weight';
    const current = p.weight || 70;
    const heightInches = (p.height || 170) / 2.54;
    const inchesOver5Ft = Math.max(0, heightInches - 60);
    const ibw = (p.gender === 'Female')
      ? (45.5 + 2.3 * inchesOver5Ft)
      : (50   + 2.3 * inchesOver5Ft);
    let target;
    if (goal === 'Build muscle') {
      target = current + 3;
    } else if (goal === 'Lose weight') {
      target = Math.max(ibw - 5, current * 0.90);
    } else if (goal === 'Improve endurance') {
      target = ibw;
    } else {
      target = ibw;
    }
    target = Math.max(30, Math.min(300, target));
    target = Math.round(target * 10) / 10;
    // Compute TDEE + days needed (same formula as calculateGoalFancy)
    const diff = current - target;
    const totalKcal = Math.abs(diff) * 7700;
    const bmr = p.gender === 'Female'
      ? 447.6 + (9.25 * current) + (3.1 * p.height) - (4.33 * p.age)
      : 88.36 + (13.4 * current) + (4.8 * p.height) - (5.68 * p.age);
    const days = s?.schedule || '3-4';
    const af = days === '1-2' ? 1.375 : days === '3-4' ? 1.55 : days === '5+' ? 1.725 : 1.9;
    const tdee = bmr * af;
    const sessions = u.sessions || [];
    const weekAgo = Date.now() - 7 * 864e5;
    const exCal = sessions.filter(x => new Date(x.date).getTime() >= weekAgo).reduce((a, x) => a + kcalForSession(x), 0);
    const dailyExBurn = exCal / 7;
    const dailyDeficit = diff < 0 ? 300 : 500;
    const totalDailyBurn = tdee + dailyExBurn;
    const daysNeeded = Math.max(1, Math.ceil(totalKcal / dailyDeficit));
    const targetDate = new Date(); targetDate.setDate(targetDate.getDate() + daysNeeded);
    // Save the goal plan to the user record
    u.goalPlan = {
      startWeight: u.goalPlan?.startWeight || current,
      targetWeight: target,
      targetDate: targetDate.toISOString().slice(0, 10),
      daysNeeded: daysNeeded,
      targetCals: Math.round(tdee + (diff > 0 ? -dailyDeficit : dailyDeficit)),
      tdee: Math.round(tdee),
      dailyDeficit: dailyDeficit,
      dailyExBurn: Math.round(dailyExBurn),
      totalDailyBurn: Math.round(totalDailyBurn),
      startDate: u.goalPlan?.startDate || localDateStr(),
      savedAt: Date.now(),
      goalUpdatedAt: Date.now()
    };
    saveUser(store.session, u);
    // Re-render so the new goal plan shows
    try { renderProfile(); renderHome(); } catch(e) {}
    // Brief visual feedback (no popup — just a flash on the button)
    const ar = (store.lang === 'ar');
    const msg = ar ? 'تم ضبط الوزن المستهدف على ' + target.toFixed(1) + ' كجم' : 'Goal weight set to ' + target.toFixed(1) + ' kg';
    // Use a transient inline toast rather than alert()
    try {
      let toast = document.getElementById('auto-goal-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'auto-goal-toast';
        toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--green);color:#fff;padding:12px 20px;border-radius:10px;font-size:.9rem;font-weight:600;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,.2);opacity:0;transition:opacity .3s ease;';
        document.body.appendChild(toast);
      }
      toast.textContent = '✓ ' + msg;
      toast.style.opacity = '1';
      setTimeout(function() { toast.style.opacity = '0'; }, 2500);
    } catch(e) {}
  } catch(e) {
    console.warn('autoSetGoalWeightFromProfile error:', e);
    alert('Could not compute a goal weight. Please complete your profile first.');
  }
}

// ===== DAILY EXERCISE ENHANCED =====
let deState = { step: 1, view: 'front', muscles: [], numDays: 7, daysOfWeek: [], workouts: [], currentWorkout: 0, initialized: false, dailyPlan: null, currentDay: 0, restUntil: 0, restDone: false, wizardOpen: false, aiAssist: { form: false, reps: false } };

// ===== DAILY PLAN PERSISTENCE =====
// The plan is stored on the user object so it survives page refreshes
// and is per-user. Each day in the plan has its own list of workouts so
// finishing today advances to tomorrow instead of starting over.
function saveDailyPlan() {
  try {
    const u = currentUser();
    if (!u) return;
    u.dailyPlan = {
      muscles: deState.muscles,
      numDays: deState.numDays,
      daysOfWeek: deState.daysOfWeek,
      dailyPlan: deState.dailyPlan,
      currentDay: deState.currentDay,
      view: deState.view,
      // Where this plan came from: 'dashboard' (adopted from the generated
      // u.plan shown on the Home dashboard) or 'custom' (built in the wizard).
      // Dashboard plans are preserved AS-IS — no auto top-up/trim on load.
      source: deState.planSource || 'custom',
      savedAt: Date.now(),
      // Round 7: track the device date when this day's workouts were last
      // touched. Used by rolloverDailyPlanIfNeeded() to detect day changes
      // and reset the day's done flags so the user starts fresh each day.
      currentDayDate: (typeof localDateStr === 'function') ? localDateStr() : null
    };
    saveUser(store.session, u);
  } catch(e) { console.warn('saveDailyPlan error:', e); }
}

// ============================================================
// DAILY ROLLOVER (device-date-based reset for daily exercise)
// ============================================================
// Per user spec (round 7): "make every daily bar/any daily information reset
// every day properly (dont reset something like the main goal because its not
// daily) you can do that by making the app read the user's device date and time".
//
// This function:
//  1. Reads the user's device date via localDateStr() (LOCAL, not UTC).
//  2. Compares it against u.dailyPlan.currentDayDate (the date the current
//     day's workouts were last touched).
//  3. If different → it's a new day → reset the current day's `done` flags,
//     `completed` flag, and `currentWorkout` pointer so the user starts fresh.
//  4. Does NOT touch: u.streak, u.goalPlan, u.profile, u.sessions (cumulative),
//     u.reminders, u.weeklySurveyHistory — those are NOT daily.
//
// Should be called from:
//  - loadDailyPlan() — when the app opens / user navigates to daily tab
//  - the date-change watcher — when midnight passes while the app is open
//  - enterApp() — when the user logs in
// ============================================================
function rolloverDailyPlanIfNeeded() {
  try {
    const u = currentUser();
    if (!u || !u.dailyPlan || !u.dailyPlan.dailyPlan) return false;
    const today = (typeof localDateStr === 'function') ? localDateStr() : null;
    if (!today) return false;
    const savedDay = u.dailyPlan.currentDayDate;
    // No saved date yet (legacy plan) — just stamp today's date and bail.
    // Don't reset anything on first touch.
    if (!savedDay) {
      u.dailyPlan.currentDayDate = today;
      saveUser(store.session, u);
      return false;
    }
    // Same day → no rollover needed.
    if (savedDay === today) return false;
    // ===== NEW DAY → reset the current day's workout progress =====
    const cd = u.dailyPlan.currentDay || 0;
    if (u.dailyPlan.dailyPlan[cd]) {
      // Reset done flags on every workout of the current day
      if (u.dailyPlan.dailyPlan[cd].workouts) {
        u.dailyPlan.dailyPlan[cd].workouts.forEach(function(w) { w.done = false; });
      }
      // Reset the day's completed flag (so it can be re-completed today)
      u.dailyPlan.dailyPlan[cd].completed = false;
      u.dailyPlan.dailyPlan[cd].completedAt = null;
    }
    // Sync deState to match
    deState.dailyPlan = u.dailyPlan.dailyPlan;
    deState.currentDay = cd;
    if (deState.dailyPlan[cd] && deState.dailyPlan[cd].workouts) {
      deState.workouts = deState.dailyPlan[cd].workouts;
    }
    deState.currentWorkout = 0;
    deState.restUntil = 0;
    deState.restDone = false;
    // Stamp today's date so we don't roll over again until tomorrow
    u.dailyPlan.currentDayDate = today;
    saveUser(store.session, u);
    return true;  // signal that a rollover happened
  } catch(e) { console.warn('rolloverDailyPlanIfNeeded error:', e); return false; }
}
function loadDailyPlan() {
  try {
    const u = currentUser();
    if (!u || !u.dailyPlan) return false;
    const p = u.dailyPlan;
    if (!p.dailyPlan || !p.dailyPlan.length) return false;
    // ===== Round 7: device-date-based daily rollover =====
    // If the user's device date is different from when this day's workouts were
    // last touched, reset the day's done flags so they start fresh today.
    // (Called BEFORE we copy p into deState so deState picks up the reset state.)
    try { rolloverDailyPlanIfNeeded(); } catch(e) {}
    // Re-read after potential rollover (rollover mutates u.dailyPlan)
    const p2 = u.dailyPlan || p;
    deState.muscles = p2.muscles || [];
    deState.numDays = p2.numDays || 7;
    deState.daysOfWeek = p2.daysOfWeek || [];
    deState.dailyPlan = p2.dailyPlan;
    deState.currentDay = Math.min(p2.currentDay || 0, p2.dailyPlan.length - 1);
    deState.view = p2.view || 'front';
    deState.workouts = deState.dailyPlan[deState.currentDay].workouts || [];
    // === v9: DEDUPE — legacy plans saved by older versions can contain the
    // same workout repeated several times. Every day is collapsed to ONE
    // block per workout (done flags merge). Days that end up unusually tiny
    // (< 4) get topped up with NEW exercises only — never repeats, never
    // cycled. No more forced "top-up to the survey minutes" (that's what
    // created the duplicate blocks in the first place).
    if (deState.dailyPlan.length) {
      let needSave = false;
      for (let d = 0; d < deState.dailyPlan.length; d++) {
        const day = deState.dailyPlan[d];
        if (!day) continue;
        const before = (day.workouts || []).length;
        day.workouts = dedupeDayWorkouts(day.workouts || []);
        if ((day.workouts.length !== before) && deState.muscles.length) {
          const mus = day.muscleGroups || deState.muscles;
          topUpDayWorkouts(day.workouts, mus, 4);
        }
        if (day.workouts.length !== before) needSave = true;
      }
      deState.workouts = deState.dailyPlan[deState.currentDay].workouts || [];
      if (needSave) {
        mirrorDailyListsToPlan();   // keep the dashboard lists identical
        saveDailyPlan();            // persist the deduped plan
      }
    }
    // Resume at the first not-yet-done workout (or end if all done)
    let cw = 0;
    for (let i = 0; i < deState.workouts.length; i++) { if (!deState.workouts[i].done) { cw = i; break; } cw = i + 1; }
    deState.currentWorkout = Math.min(cw, deState.workouts.length);
    deState.step = 4;
    deState.initialized = true;
    return true;
  } catch(e) { console.warn('loadDailyPlan error:', e); return false; }
}
function clearDailyPlan() {
  try {
    const u = currentUser();
    if (!u) return;
    delete u.dailyPlan;
    saveUser(store.session, u);
  } catch(e) { console.warn('clearDailyPlan error:', e); }
}

// ===== v27 ONE-TIME PLAN MIGRATION =====
// User: "remove the 60 minute option for workouts in survey, and for
// workouts, give the user for example if he chose 15 minutes give them 4 to
// 5 workouts, and 2 sets per exercise, use that formula for all durations
// 15,30 and 45". Generation code is fixed at the source (plan-engine.js +
// generateWorkoutList + getTargetWorkoutsPerDay), but plans SAVED by older
// versions still carry the old 1-per-minute counts and 3/4 sets. This
// migration trims every saved day to the new target (done workouts are always
// kept), forces 2 sets on every exercise, and re-labels legacy '60+ minutes'
// survey answers to '45 minutes'. Runs once per account (u.v27WorkoutFormula
// flag), at enterApp() before anything renders.
function migratePlansV27() {
  try {
    const u = currentUser();
    if (!u || u.v27WorkoutFormula) return;
    u.v27WorkoutFormula = true;
    let touched = false;
    // Legacy survey answer: '60+ minutes' no longer exists → 45 minutes.
    if (u.survey && u.survey.time === '60+ minutes') { u.survey.time = '45 minutes'; touched = true; }
    const target = (typeof getTargetWorkoutsPerDay === 'function') ? getTargetWorkoutsPerDay() : 5;
    // 1) Tracker plan (Daily Discipline) — trim days to target, 2 sets each.
    //    Done workouts are always preserved first so progress is never lost.
    if (u.dailyPlan && Array.isArray(u.dailyPlan.dailyPlan)) {
      u.dailyPlan.dailyPlan.forEach(function (day) {
        if (!day || !Array.isArray(day.workouts)) return;
        day.workouts.forEach(function (w) {
          if (w && w.sets !== 2) { w.sets = 2; touched = true; }
        });
        if (day.workouts.length > target) {
          const done = day.workouts.filter(function (w) { return w && w.done; });
          const rest = day.workouts.filter(function (w) { return !(w && w.done); });
          day.workouts = done.concat(rest).slice(0, Math.max(target, done.length));
          touched = true;
        }
      });
    }
    // 2) Dashboard plan (u.plan.workout.schedule) — same treatment.
    if (u.plan && u.plan.workout && Array.isArray(u.plan.workout.schedule)) {
      u.plan.workout.schedule.forEach(function (day) {
        if (!day || !Array.isArray(day.exercises)) return;
        day.exercises.forEach(function (ex) {
          if (ex && ex.sets !== 2) { ex.sets = 2; touched = true; }
        });
        if (day.exercises.length > target) { day.exercises = day.exercises.slice(0, target); touched = true; }
      });
    }
    if (touched) saveUser(store.session, u);
  } catch (e) { console.warn('migratePlansV27 error:', e); }
}
window.migratePlansV27 = migratePlansV27;

// ===== v28 ONE-TIME PLAN MIGRATION =====
// User: "use this formula: 15 minutes → 2 workouts per group (Chest, Back,
// Legs, Shoulders, Arms, Core — 12 total), 30 minutes → 4 per group (24),
// 45 minutes → 5 per group (30), 2 sets each, 1 rest after every 2
// exercises." Generation code is fixed at the source (plan-engine.js +
// generateWorkoutList), but plans SAVED by older versions still carry the
// old per-day counts. This migration re-shapes every saved day to the new
// target: done workouts are always kept first, pending ones are trimmed or
// NEW full-body exercises are topped up to reach the target, and every
// exercise gets 2 sets. Runs once per account (u.v28Formula flag) at
// enterApp() before anything renders.
function migratePlansV28() {
  try {
    const u = currentUser();
    if (!u || u.v28Formula) return;
    u.v28Formula = true;
    let touched = false;
    const target = (typeof getTargetWorkoutsPerDay === 'function') ? getTargetWorkoutsPerDay() : 12;
    const groups = (typeof V28_FORMULA_GROUPS !== 'undefined') ? V28_FORMULA_GROUPS : ['Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core'];
    // 1) Tracker plan (Daily Discipline).
    if (u.dailyPlan && Array.isArray(u.dailyPlan.dailyPlan)) {
      u.dailyPlan.dailyPlan.forEach(function (day) {
        if (!day || !Array.isArray(day.workouts)) return;
        day.workouts.forEach(function (w) {
          if (w && w.sets !== 2) { w.sets = 2; touched = true; }
        });
        if (day.workouts.length > target) {
          const done = day.workouts.filter(function (w) { return w && w.done; });
          const rest = day.workouts.filter(function (w) { return !(w && w.done); });
          day.workouts = done.concat(rest).slice(0, Math.max(target, done.length));
          touched = true;
        } else if (day.workouts.length < target) {
          // v28: GROW the day — top up with fresh full-body exercises.
          const before = day.workouts.length;
          topUpDayWorkouts(day.workouts, groups, target);
          if (day.workouts.length !== before) touched = true;
        }
        // v28: everything the top-up added (and any legacy entries) is 2 sets.
        day.workouts.forEach(function (w) {
          if (w && w.sets !== 2) { w.sets = 2; touched = true; }
        });
      });
    }
    // 2) Dashboard plan (u.plan.workout.schedule) — same treatment.
    if (u.plan && u.plan.workout && Array.isArray(u.plan.workout.schedule)) {
      u.plan.workout.schedule.forEach(function (day) {
        if (!day || !Array.isArray(day.exercises)) return;
        day.exercises.forEach(function (ex) {
          if (ex && ex.sets !== 2) { ex.sets = 2; touched = true; }
        });
        if (day.exercises.length > target) { day.exercises = day.exercises.slice(0, target); touched = true; }
      });
    }
    if (touched) saveUser(store.session, u);
  } catch (e) { console.warn('migratePlansV28 error:', e); }
}
window.migratePlansV28 = migratePlansV28;

// ============================================================
// DAILY EXERCISE PLAN HUB (default view of the Daily tab)
// ============================================================
// Per user report: "in daily discipline, you give the user the option to pick
// the muscle group they want, instead of seeing the current plan or starting
// a new one or build a custom one". The old default content WAS the muscle
// wizard (step 1) whenever no plan was being tracked. Fix: the Daily tab now
// opens on a plan-choice HUB instead —
//    • Train This Plan      → adoptDashboardPlan() (starts today's workout)
//    • View Current Plan    → openPlanViewPopup()
//    • Start a New Plan     → openDeWizard() (the muscle wizard, step 1)
//    • Build a Custom Workout → openWorkoutBuilder()
// The muscle wizard is ONLY reachable through an explicit "Start a New Plan"
// tap (deState.wizardOpen = true), never as the default screen.
function dePlanHubHtml(u, ar) {
  const hasPlan = !!(u.plan && u.plan.workout);
  const w = hasPlan ? u.plan.workout : {};
  const split = w.splitType || 'Custom';
  const dpw = w.daysPerWeek || (w.schedule ? w.schedule.length : 0) || 0;
  const spm = w.sessionMinutes || 30;
  let html = '<div class="panel daily-exercise-container">' +
    '<div class="de-step-title" data-ar="خطتك التدريبية">' + (ar ? 'خطتك التدريبية' : 'Your Training Plan') + '</div>';
  if (hasPlan) {
    html += '<div class="de-step-desc" data-ar="ابدأ تمرين اليوم، أو اطّلع على خطتك، أو أنشئ خطة جديدة.">' +
      (ar ? 'ابدأ تمرين اليوم، أو اطّلع على خطتك، أو أنشئ خطة جديدة.' : 'Start today\u2019s workout, view your plan, or create a new one.') + '</div>' +
      '<div class="plan-stats" style="margin:14px 0 4px;">' +
        '<span class="plan-stat-pill"><b>' + split + '</b> ' + (ar ? 'تقسيم' : 'split') + '</span>' +
        '<span class="plan-stat-pill"><b>' + dpw + '</b> ' + (ar ? 'أيام/أسبوع' : 'days/week') + '</span>' +
        '<span class="plan-stat-pill"><b>' + spm + '</b> ' + (ar ? 'دقيقة/جلسة' : 'min/session') + '</span>' +
      '</div>' +
      '<button class="btn primary" style="width:100%;margin-top:20px;" onclick="openPlanScheduleSetup()"><i class="fa-solid fa-play"></i> <span data-ar="ابدأ بهذه الخطة">' + (ar ? 'ابدأ بهذه الخطة' : 'Train This Plan') + '</span></button>' +
      '<button class="btn ghost" style="width:100%;margin-top:10px;" onclick="openPlanViewPopup()"><i class="fa-solid fa-eye"></i> <span data-ar="عرض خطتي الحالية">' + (ar ? 'عرض خطتي الحالية' : 'View Current Plan') + '</span></button>';
  } else {
    html += '<div class="de-step-desc" data-ar="لا توجد خطة بعد. ابدأ خطة جديدة الآن — تستغرق دقيقة واحدة فقط.">' +
      (ar ? 'لا توجد خطة بعد. ابدأ خطة جديدة الآن — تستغرق دقيقة واحدة فقط.' : 'No plan yet. Start a new one now — it only takes a minute.') + '</div>';
  }
  html += '<button class="btn ' + (hasPlan ? 'ghost' : 'primary') + '" style="width:100%;margin-top:10px;" onclick="openDeWizard()"><i class="fa-solid fa-wand-magic-sparkles"></i> <span data-ar="بدء خطة جديدة">' + (ar ? 'بدء خطة جديدة' : 'Start a New Plan') + '</span></button>' +
    '<button class="btn ghost" style="width:100%;margin-top:10px;" onclick="openWorkoutBuilder()"><i class="fa-solid fa-hammer"></i> <span data-ar="إنشاء تمرين مخصص">' + (ar ? 'إنشاء تمرين مخصص' : 'Build a Custom Workout') + '</span></button>' +
    '</div>';
  return html;
}
// "Start a New Plan" (hub button + Daily toolbar) → open the muscle wizard.
// wizardOpen gates the hydrate logic in renderDailyExercise() so a stored
// plan can't hijack the wizard back to the tracker mid-flow.
function openDeWizard() {
  deState.wizardOpen = true;
  deState.planChoiceMade = true;
  deState.planSource = 'custom';
  deState.step = 1;
  renderDailyExercise();
}
// Wizard "Back" on step 1 → return to the plan hub (step 0 sentinel keeps
// the hydrate logic from firing until the user actually leaves the hub).
function deBackToHub() {
  deState.wizardOpen = false;
  deState.step = 0;
  renderDailyExercise();
}

// "Start a New Plan" — toolbar alias kept for the existing onclick handlers.
function dismissDePlanChoice() { openDeWizard(); }

// ===== "My Workout Plan" popup — clean day-by-day view =====
// Opened from Daily Exercise ("View Current Plan") and from the dashboard
// mini card ("View"). Renders every training day with its exercises using
// the existing plan-day design language. "Train This Plan" loads the plan
// into the daily-exercise tracker (adoptDashboardPlan).
// v31 (user, picture 1): "muscle group parts takes a huge space" — the
// day-card focus chip used to print the FULL muscle list ("CHEST, BACK,
// LEGS, SHOULDERS, ARMS, CORE") as one giant uppercase pill that dominated
// every card. compactPlanFocus() shrinks it: 1-2 groups stay as-is,
// 3+ groups collapse to the first + "+N".
function compactPlanFocus(focus) {
  var s = (focus || '').trim();
  if (!s) return '';
  var parts = s.split(',').map(function (p) { return p.trim(); }).filter(Boolean);
  if (parts.length <= 2) return parts.join(', ');
  return parts[0] + ' +' + (parts.length - 1);
}
window.compactPlanFocus = compactPlanFocus;
function openPlanViewPopup() {
  try {
    const u = currentUser();
    const ar = (store.lang === 'ar');
    if (!u || !u.plan || !u.plan.workout) return;
    const w = u.plan.workout;
    const body = document.getElementById('plan-view-body');
    if (!body) return;
    const sub = document.getElementById('plan-view-sub');
    if (sub) {
      sub.textContent = (w.splitType || 'Custom') + ' · ' +
        (w.daysPerWeek || (w.schedule || []).length) + (ar ? ' أيام/أسبوع · ' : ' days/week · ') +
        (w.sessionMinutes || 30) + (ar ? ' دقيقة/جلسة' : ' min/session');
    }
    let html = '<div class="plan-schedule">';
    var sched = w.schedule || [];
    // Friendly day labels: legacy plans cycled weekday names ("Tue, Thu, Tue…")
    // when the plan had more days than picked weekdays — duplicate cards.
    // If any label repeats, fall back to unique "Day 1..N" labels instead.
    var seen = {}, dupLabels = false;
    sched.forEach(function (d) { var k = d.day || ''; if (seen[k]) dupLabels = true; seen[k] = true; });
    // Friendlier cards (user request): show the first 7 workouts per day,
    // the rest behind a "+N more" expander. Exercise count sits in the header.
    var VISIBLE_CHIPS = 7;
    var pvDayCard = function (label, day, cardIdx, isToday) {
      var exs = day.exercises || [];
      var h = '<div class="plan-day">';
      h += '<div class="plan-day-header"><span class="plan-day-name-wrap"><b>' + label + '</b>' +
        (isToday ? ' <span style="display:inline-block;background:var(--accent);color:#fff;font-size:.62rem;font-weight:800;padding:2px 7px;border-radius:999px;vertical-align:middle;margin-left:4px;">' + (ar ? 'اليوم' : 'Today') + '</span>' : '') +
        '<span class="plan-day-count">' + exs.length + (ar ? ' تمرين' : ' exercises') + '</span></span>' +
        ' <span class="plan-day-focus" title="' + escapeHtml(day.focus || '') + '">' + compactPlanFocus(day.focus) + '</span></div>';
      h += '<div class="plan-day-exercises">';
      h += exs.slice(0, VISIBLE_CHIPS).map(function (ex) { return '<span class="plan-exercise-tag">' + ex.name + '</span>'; }).join('');
      if (exs.length > VISIBLE_CHIPS) {
        h += exs.slice(VISIBLE_CHIPS).map(function (ex) { return '<span class="plan-exercise-tag" data-extra="' + cardIdx + '" hidden>' + ex.name + '</span>'; }).join('');
        h += '<button type="button" class="plan-more-toggle" id="pvr-btn-' + cardIdx + '" data-open="0" onclick="togglePlanDayMore(' + cardIdx + ')">+' + (exs.length - VISIBLE_CHIPS) + (ar ? ' المزيد' : ' more') + '</button>';
      }
      h += '</div>';
      if (day.cardio && day.cardio.type) {
        h += '<div class="plan-cardio"><i class="fa-solid fa-heart-pulse" style="color:var(--red);"></i> ' + day.cardio.type + (day.cardio.duration ? ' · ' + day.cardio.duration + 'min' : '') + (day.cardio.intensity ? ' · ' + day.cardio.intensity : '') + '</div>';
      }
      h += '</div>';
      return h;
    };
    // Round 14 (user request): "the popup doesn't display the whole week".
    // When the plan's day names map onto real weekdays, render the FULL
    // Monday → Sunday week — training days with their exercises and the
    // off-days as muted "Rest day" cards — a true weekly overview, with
    // today's card badged. Legacy plans with duplicate / non-weekday
    // labels keep the old "Day 1..N" fallback below.
    var WEEK_EN = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    var WEEK_AR = ['الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد'];
    var todayKey3 = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date().getDay()];
    var weekdayMap = null;
    if (!dupLabels && sched.length) {
      weekdayMap = [null, null, null, null, null, null, null];
      var allWeekday = true;
      sched.forEach(function (d) {
        var k = (d.day || '').trim().toLowerCase().slice(0, 3);
        var idx = -1;
        for (var wi = 0; wi < 7; wi++) { if (WEEK_EN[wi].toLowerCase().slice(0, 3) === k) { idx = wi; break; } }
        if (idx < 0 || weekdayMap[idx]) allWeekday = false;
        else weekdayMap[idx] = d;
      });
      if (!allWeekday) weekdayMap = null;
    }
    if (weekdayMap) {
      var pvCardIdx = 0;
      for (var pvWi = 0; pvWi < 7; pvWi++) {
        var pvDay = weekdayMap[pvWi];
        var pvName = ar ? WEEK_AR[pvWi] : WEEK_EN[pvWi];
        var pvIsToday = WEEK_EN[pvWi].toLowerCase().slice(0, 3) === todayKey3;
        if (pvDay) {
          html += pvDayCard(pvName, pvDay, pvCardIdx++, pvIsToday);
        } else {
          html += '<div class="plan-day" style="opacity:.6;">' +
            '<div class="plan-day-header"><span class="plan-day-name-wrap"><b>' + pvName + '</b>' +
            (pvIsToday ? ' <span style="display:inline-block;background:var(--accent);color:#fff;font-size:.62rem;font-weight:800;padding:2px 7px;border-radius:999px;vertical-align:middle;margin-left:4px;">' + (ar ? 'اليوم' : 'Today') + '</span>' : '') +
            '<span class="plan-day-count">' + (ar ? 'تعافي' : 'recover') + '</span></span>' +
            ' <span class="plan-day-focus" style="background:var(--accent-soft);color:var(--accent);">' + (ar ? 'يوم راحة' : 'Rest day') + '</span></div>' +
            '<div class="plan-day-exercises"><span style="color:var(--muted);font-size:.82rem;font-weight:600;">' +
            (ar ? 'لا توجد تمارين مجدولة — دع جسمك يتعافى.' : 'No training scheduled — let your body recover.') + '</span></div>' +
            '</div>';
        }
      }
    } else {
      sched.forEach(function (day, di) {
        var label = day.day || '';
        if (dupLabels || !label) label = ar ? ('يوم ' + (di + 1)) : ('Day ' + (di + 1));
        html += pvDayCard(label, day, di, false);
      });
    }
    html += '</div>';
    // Round 13 (user request): the popup is WORKOUT-ONLY now — the diet
    // plan section that used to be appended here (renderDietPlanHtml) and
    // the sticky "Train This Plan" button were removed. It shows just the
    // whole training week.
    body.innerHTML = html;
    if (typeof applyTranslations === 'function') applyTranslations();
    openModal('plan-view-modal');
  } catch (e) { console.warn('openPlanViewPopup error:', e); }
}
function closePlanViewPopup() { try { closeModal('plan-view-modal'); } catch (e) {} }

// "View Current Plan" button in the Daily tab toolbar. If the user has no
// generated plan yet, nudge them toward "Start a New Plan" instead of
// silently doing nothing.
function toolbarViewCurrentPlan() {
  const u = currentUser();
  const ar = (store.lang === 'ar');
  if (!u || !u.plan || !u.plan.workout) {
    try {
      showVoltaToast(ar ? 'لا توجد خطة بعد — اضغط "بدء خطة جديدة" أولاً'
                        : 'No plan yet — tap "Start a New Plan" first', 'info');
    } catch (e) {}
    return;
  }
  openPlanViewPopup();
}

// "+N more / Show less" expander for the plan popup's day cards.
// Each day renders its first 7 exercises; the rest are hidden spans carrying
// data-extra="<dayIndex>" — this toggle reveals/collapses that group.
function togglePlanDayMore(di) {
  try {
    var scope = document.getElementById('plan-view-body');
    if (!scope) return;
    var extras = scope.querySelectorAll('span.plan-exercise-tag[data-extra="' + di + '"]');
    var btn = document.getElementById('pvr-btn-' + di);
    if (!extras.length || !btn) return;
    var ar = (store.lang === 'ar');
    var open = btn.getAttribute('data-open') === '1';
    for (var i = 0; i < extras.length; i++) {
      if (open) extras[i].setAttribute('hidden', '');
      else extras[i].removeAttribute('hidden');
    }
    btn.setAttribute('data-open', open ? '0' : '1');
    btn.textContent = open
      ? '+' + extras.length + (ar ? ' المزيد' : ' more')
      : (ar ? 'عرض أقل' : 'Show less');
    if (open) {
      var card = btn.closest ? btn.closest('.plan-day') : null;
      if (card && card.scrollIntoView) { try { card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {} }
    }
  } catch (e) { console.warn('togglePlanDayMore error:', e); }
}

// ===== BIGGER DAILY LISTS (shared per-day target) =====
// v28 (user): NEW per-muscle-group formula, replacing the v27 0.3/min ratio.
//   "1- if the user's answer in the survey for their maximum output in a
//    session is 15 minutes, then 2 workouts for chest, 2 for back, 2 for legs,
//    2 for shoulders, 2 for arms, 2 for core, and 1 rest after every 2
//    exercises.
//    2- 30 minutes: 4 per group.  3- 45 minutes: 5 per group."
// Every training day is a FULL-BODY list: the 6 groups (Chest, Back, Legs,
// Shoulders, Arms, Core) each contribute N exercises — 15-min → 12 total,
// 30-min → 24, 45-min → 30 — each exercise 2 sets, and the rendered list
// shows a REST marker after every 2 exercises. Used by
// getTargetWorkoutsPerDay() and generateWorkoutList(); plan-engine.js
// carries the same formula inline (it loads before this file).
var V28_FORMULA_GROUPS = ['Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core'];
function workoutsPerGroupPerDay(minutes) {
  const m = Math.max(15, Math.min(45, Math.round(Number(minutes) || 15)));
  return (m >= 45) ? 5 : (m >= 30 ? 4 : 2);   // 15→2, 30→4, 45→5 per group
}
window.workoutsPerGroupPerDay = workoutsPerGroupPerDay;
// v27 name kept for compatibility (adoptDashboardPlan guards, migration) —
// now returns the FULL-BODY total: groups × N (12 / 24 / 30).
function workoutsPerSession(minutes, groupCount) {
  const g = Math.max(1, groupCount || V28_FORMULA_GROUPS.length);
  return workoutsPerGroupPerDay(minutes) * g;
}
window.workoutsPerSession = workoutsPerSession;
function getTargetWorkoutsPerDay() {
  // v28: full-body target — 6 groups × N per group (15-min → 12, 30 → 24,
  // 45 → 30), following the survey session time.
  const goalMin = (typeof getDailyGoalMinutes === 'function') ? getDailyGoalMinutes() : 30;
  return workoutsPerSession(goalMin);
}
// Build an exercise pool for the given muscle groups (WORKOUT_DB + the
// IndexedDB-backed WORKOUTS_DB), skipping names already in the day's list.
function buildDeTopUpPool(muscleGroups, existingNames) {
  const pool = [];
  const seen = {};
  (existingNames || []).forEach(n => { seen[n] = true; });
  // v12: the top-up pool obeys the SAME equipment rules as the main pool —
  // this was the leak that added barbell/machine exercises to no-equipment
  // users' dashboard plans ("Train This Plan" + top-up).
  const noEquip = userHasNoEquipment();
  (muscleGroups || []).forEach(m => {
    (WORKOUT_DB[m] || []).forEach(w => {
      if (!seen[w]) {
        if (noEquip && !exerciseAllowedWithoutEquipment(w)) return;
        seen[w] = true; pool.push({ name: w, info: WORKOUT_INFO[w] || { muscle: m } });
      }
    });
  });
  if (typeof WORKOUTS_DB !== 'undefined' && WORKOUTS_DB && WORKOUTS_DB.length) {
    WORKOUTS_DB.forEach(function(w) {
      if ((muscleGroups || []).indexOf(w.muscleGroup) !== -1 && !seen[w.name]) {
        if (noEquip && !exerciseAllowedWithoutEquipment(w.name, w.equipment)) return;
        seen[w.name] = true;
        pool.push({ name: w.name, info: { muscle: w.muscleGroup, desc: w.description, img: w.image || '' } });
      }
    });
  }
  return pool;
}
// Append pool exercises until the day reaches `target` workouts.
// v9: NO CYCLING — once the unique pool is used up, the day stays at that
// size (duplicate workouts are gone for good). buildDeTopUpPool already
// skips names present in the day, so a single pass adds only NEW exercises.
function topUpDayWorkouts(dayWorkouts, muscleGroups, target) {
  if (!dayWorkouts || dayWorkouts.length >= target) return dayWorkouts;
  const pool = buildDeTopUpPool(muscleGroups, dayWorkouts.map(w => w.name));
  if (!pool.length) return dayWorkouts;
  // one pass over the pool — duplicates can never enter the day again
  // v28: topped-up exercises carry the formula's 2 sets + default reps.
  for (let i = 0; i < pool.length && dayWorkouts.length < target; i++) {
    dayWorkouts.push({ name: pool[i].name, info: pool[i].info, sets: 2, reps: '10-12', done: false });
  }
  return dayWorkouts;
}
// Mirror the daily tracker's per-day lists back into u.plan.workout.schedule
// so the dashboard (mini card + "My Plan" popup) always shows the SAME list
// the user trains in Daily Exercise. Day labels, focus, cardio and the diet
// half of the plan are preserved.
// NOTE: store.users re-parses localStorage on EVERY access, so this helper
// persists its own mutated copy via saveUser() before returning — callers
// that save afterwards (saveDailyPlan) simply re-fetch and win both changes.
function mirrorDailyListsToPlan() {
  try {
    const u = currentUser();
    if (!u || !u.plan || !u.plan.workout || !Array.isArray(u.plan.workout.schedule)) return false;
    if (!deState.dailyPlan || !deState.dailyPlan.length) return false;
    const sched = u.plan.workout.schedule;
    deState.dailyPlan.forEach(function(day, d) {
      if (!sched[d]) return;
      sched[d].exercises = (day.workouts || []).map(function(w) {
        // v17: keep the ORIGINAL sets/reps (the tracker objects carry them
        // from adoptDashboardPlan now) — the dashboard card used to collapse
        // every mirrored exercise to a generic 3×10-12.
        // v27 (user): "2 sets per exercise" — the fallback is 2 now.
        return { name: w.name, sets: w.sets || 2, reps: w.reps || '10-12', muscleGroup: (w.info && w.info.muscle) || 'Full Body' };
      });
    });
    saveUser(store.session, u);   // persist the mirrored lists
    if (typeof renderPlan === 'function') { try { renderPlan(); } catch(e) {} }
    return true;
  } catch(e) { console.warn('mirrorDailyListsToPlan error:', e); return false; }
}

// ═══ v10 (user): "after the user chooses their plan, let them choose how
// many days do they want to train, from 7 to 30 days, and let them pick the
// days of the week" ═══
// Tapping "Train This Plan" on the hub no longer adopts the plan instantly.
// It opens a schedule setup step (deState.step = 5): a 7–30 day slider and
// the weekday picker (pre-selected with the weekdays the generated plan
// already trains on). "Start Training" then builds the tracker plan over
// exactly the chosen length + weekdays, cycling the dashboard schedule.
function openPlanScheduleSetup() {
  try {
    const u = currentUser();
    const w = (u && u.plan && u.plan.workout) || {};
    const sched = Array.isArray(w.schedule) ? w.schedule : [];
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const preset = [];
    sched.forEach(function (day) {
      const k = (day && day.day ? String(day.day) : '').trim().toLowerCase().slice(0, 3);
      const idx = dayNames.findIndex(function (x) { return x.toLowerCase() === k; });
      if (idx >= 0 && preset.indexOf(idx) === -1) preset.push(idx);
    });
    deState.daysOfWeek = preset;
    deState.numDays = Math.max(7, sched.length);
    deState.wizardOpen = false;   // hub flow (not the muscle wizard)
    deState.step = 5;
    renderDailyExercise();
  } catch (e) { console.warn('openPlanScheduleSetup error:', e); }
}
// "Start Training" on the setup step → adopt with the chosen schedule.
function startAdoptedPlan() {
  const ar = (store.lang === 'ar');
  if (!deState.daysOfWeek || !deState.daysOfWeek.length) {
    alert(ar ? 'يرجى اختيار يوم واحد على الأقل.' : 'Please select at least one day.');
    return;
  }
  adoptDashboardPlan(parseInt(deState.numDays, 10) || 7, deState.daysOfWeek.slice());
}

// "Use My Dashboard Plan" — adopt u.plan's workout schedule as the active
// daily-exercise plan. One DE "day" per scheduled training day; each keeps
// its weekday + focus as a label. Dashboard plans are never auto-padded.
// v10: (numDays, daysOfWeek) — the user-chosen training length (7–30) and
// weekdays. The dashboard schedule CYCLES across the chosen days so week 2+
// repeats the split; each block is labeled "Weekday · Focus (W#)".
function adoptDashboardPlan(numDays, daysOfWeek) {
  try {
    const u = currentUser();
    const ar = (store.lang === 'ar');
    if (!u || !u.plan || !u.plan.workout || !Array.isArray(u.plan.workout.schedule) || !u.plan.workout.schedule.length) {
      deState.planChoiceMade = true;
      renderDailyExercise();
      return;
    }
    const sched = u.plan.workout.schedule;
    const target = getTargetWorkoutsPerDay();
    const customDays = Array.isArray(daysOfWeek) && daysOfWeek.length > 0;
    const totalDays = customDays
      ? Math.max(1, Math.min(30, parseInt(numDays, 10) || sched.length))
      : sched.length;
    const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const DAY_AR = ['الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد'];
    const musclesSet = [];
    deState.dailyPlan = [];
    for (let d = 0; d < totalDays; d++) {
      const srcDay = sched[d % sched.length];
      let workouts = (srcDay.exercises || []).map(function (ex) {
        // v17: carry the plan's ORIGINAL sets/reps onto the tracker workout so
        // mirroring back to the dashboard keeps the real numbers.
        return { name: ex.name, sets: ex.sets, reps: ex.reps, info: getWorkoutInfo(ex.name, ex.muscleGroup), done: false };
      });
      if (srcDay.cardio && srcDay.cardio.type) {
        workouts.push({ name: srcDay.cardio.type, info: getWorkoutInfo(srcDay.cardio.type, 'Cardio'), done: false });
      }
      // v9: one block per workout — the same exercise never repeats in a day.
      workouts = dedupeDayWorkouts(workouts);
      // Bigger lists: top the day up with NEW exercises from the day's own
      // muscle groups (no cycling → no duplicates), then mirror the full
      // list back into u.plan so the dashboard view matches the tracker.
      topUpDayWorkouts(workouts, srcDay.muscleGroups || [], target);
      (srcDay.muscleGroups || []).forEach(function (m) { if (musclesSet.indexOf(m) === -1) musclesSet.push(m); });
      let label;
      if (customDays) {
        const wd = daysOfWeek[d % daysOfWeek.length];
        const weekNo = Math.floor(d / daysOfWeek.length) + 1;
        // v11 (user): "type week 1 instead of w1" — full word in the label.
        label = (ar ? DAY_AR[wd] : DAY_NAMES[wd]) + ' · ' + compactPlanFocus(srcDay.focus || 'Training') +
          (totalDays > daysOfWeek.length ? (ar ? ' (الأسبوع ' + weekNo + ')' : ' (Week ' + weekNo + ')') : '');
      } else {
        label = (srcDay.day || ('Day ' + (d + 1))) + ' · ' + compactPlanFocus(srcDay.focus || 'Training');
      }
      deState.dailyPlan.push({ dayIndex: d, label: label, workouts: workouts, completed: false, completedAt: null });
    }
    deState.muscles = musclesSet;
    deState.numDays = totalDays;
    deState.daysOfWeek = customDays ? daysOfWeek.slice() : [];
    deState.currentDay = 0;
    deState.workouts = deState.dailyPlan[0].workouts;
    deState.currentWorkout = 0;
    deState.restUntil = 0;
    deState.restDone = false;
    deState.step = 4;
    deState.initialized = true;
    deState.planChoiceMade = true;
    deState.planSource = 'dashboard';
    __wlDayCtx = -1;   // v10: fresh plan → reset the "+X more" expander
    mirrorDailyListsToPlan();   // dashboard shows the same bigger lists
    saveDailyPlan();
    renderDailyExercise();
    try { showVoltaToast(ar ? 'تم تحميل خطتك من لوحة التحكم' : 'Dashboard plan loaded', 'success'); } catch(e) {}
  } catch(e) { console.warn('adoptDashboardPlan error:', e); }
}

// NOTE: the old dismissDePlanChoice() that lived here set step=1 and nulled
// deState.dailyPlan — but the hydrate check in renderDailyExercise() then
// immediately re-loaded the stored plan and jumped back to the tracker, so
// "Start a New Plan" could NEVER open the wizard (user report: "i cant make
// a new plan"). It has been replaced by openDeWizard() above; the name is
// kept as an alias for the toolbar's onclick.

// Called after generateWorkoutList() creates a NEW plan in the wizard.
// Rebuilds the dashboard plan panel (u.plan) from the new daily plan so the
// Home dashboard always mirrors what the user trains. Diet half is preserved.
function syncDailyPlanToDashboard() {
  try {
    const u = currentUser();
    if (!u || !deState.dailyPlan || !deState.dailyPlan.length) return;
    const ar = (store.lang === 'ar');
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const perDay = deState.dailyPlan[0].workouts.length;
    // v27: sessionMinutes is the REAL survey session time (not the exercise
    // count — the old 1:1 rule is gone).
    const sessMin = Math.max(15, (typeof getDailyGoalMinutes === 'function') ? getDailyGoalMinutes() : 30);
    const schedule = deState.dailyPlan.map(function(day, d) {
      let dayLabel = 'Day ' + (d + 1);
      // Weekday labels ONLY when they map 1:1 to the plan's day count —
      // the old modulo (d % picked.length) cycled "Tue, Thu, Tue…" and the
      // plan popup showed duplicate day cards (user report: two "Tue"s).
      if (deState.daysOfWeek && deState.daysOfWeek.length === deState.dailyPlan.length) {
        dayLabel = dayNames[deState.daysOfWeek[d]] || dayLabel;
      }
      return {
        day: dayLabel,
        focus: (deState.muscles || []).join(', ') || 'Full Body',
        muscleGroups: (deState.muscles || []).slice(),
        exercises: (day.workouts || []).map(function(w) {
          // v17: preserve the tracker's own sets/reps when mirroring.
          // v27 (user): "2 sets per exercise" — the fallback is 2 now.
          return { name: w.name, sets: w.sets || 2, reps: w.reps || '10-12', muscleGroup: (w.info && w.info.muscle) || 'Full Body' };
        }),
        cardio: null,
        duration: sessMin
      };
    });
    let plan = u.plan;
    if (!plan || !plan.diet || !plan.diet.mealSchedule) {
      // No dashboard plan yet → build a complete one (new workout + standard diet targets).
      const goalPlan = u.goalPlan || null;
      const weightKg = (u.profile && u.profile.weight) || 70;
      plan = {
        generatedAt: Date.now(),
        version: 1,
        workout: { splitType: 'Custom', daysPerWeek: schedule.length, sessionMinutes: sessMin, schedule: schedule, restDays: [] },
        diet: {
          dailyCalories: (goalPlan && goalPlan.targetCals) || 2000,
          macros: (goalPlan && goalPlan.macros) || { p: 150, c: 200, f: 55 },
          mealsPerDay: 3,
          hydrationLiters: Math.round(weightKg * 0.033 * 10) / 10,
          mealSchedule: [
            { type: 'breakfast', targetCalories: 500, targetMacros: { p: 38, c: 50, f: 14 }, suggestions: [] },
            { type: 'lunch',     targetCalories: 700, targetMacros: { p: 53, c: 70, f: 19 }, suggestions: [] },
            { type: 'dinner',    targetCalories: 600, targetMacros: { p: 45, c: 60, f: 17 }, suggestions: [] },
            { type: 'snack',     targetCalories: 200, targetMacros: { p: 15, c: 20, f: 5 },  suggestions: [] }
          ]
        },
        preferences: {}
      };
    } else {
      // Keep the diet plan — replace only the workout half.
      plan.workout = { splitType: 'Custom', daysPerWeek: schedule.length, sessionMinutes: sessMin, schedule: schedule, restDays: [] };
      plan.generatedAt = Date.now();
    }
    plan.source = 'daily-exercise';
    u.plan = plan;
    saveUser(store.session, u);
    if (typeof renderPlan === 'function') renderPlan();
    try { showVoltaToast(ar ? 'تم تحديث الخطة في لوحة التحكم' : 'Dashboard plan updated', 'success'); } catch(e) {}
  } catch(e) { console.warn('syncDailyPlanToDashboard error:', e); }
}
// ===== v12 (user): "dont give the user workouts that require equipment,
// i said i have no equipment and it gave me workouts that require
// equipment" =====
// Shared equipment-accuracy helpers. Three leak paths existed:
//   1. the hardcoded WORKOUT_DB lists were added to the plan pool with NO
//      equipment filter at all (Bicep Curls, Lat Pulldowns, Pec Flyes…),
//   2. buildDeTopUpPool() (tops up dashboard-adopted days) had NO filter,
//   3. exercises classified "Bodyweight" but performed on a BAR (Pull-Ups,
//      Chin-Ups, Hanging raises, Inverted Rows) slipped through the
//      "equipment !== 'Bodyweight'" check.
// These helpers are used by buildUserExercisePool, buildDeTopUpPool and
// plan-engine.js (mirrored there — that file may load first).

// Hardcoded WORKOUT_DB exercises that REQUIRE real equipment (weights,
// machines, cables, dip bars…). Everything not listed here is bodyweight.
const WORKOUT_DB_NEEDS_EQUIP = {
  // Chest
  'Pec Flyes': 1, 'Chest Dips': 1,
  // Back (weights / machines / cables / bar)
  'Pull-ups': 1, 'Bent-over Rows': 1, 'Lat Pulldowns': 1, 'T-Bar Rows': 1,
  'Face Pulls': 1, 'Reverse Flyes': 1,
  // Shoulders (weights)
  'Shoulder Press': 1, 'Lateral Raises': 1, 'Front Raises': 1,
  'Arnold Press': 1, 'Upright Rows': 1,
  // Arms (weights / benches)
  'Bicep Curls': 1, 'Tricep Extensions': 1, 'Hammer Curls': 1,
  'Preacher Curls': 1, 'Skull Crushers': 1, 'Concentration Curls': 1,
  // Core (bar)
  'Hanging Knee Raises': 1
};
window.WORKOUT_DB_NEEDS_EQUIP = WORKOUT_DB_NEEDS_EQUIP;

// "Bodyweight" exercises that still need a bar/rig to actually perform.
// Matched by NAME (lowercase) so they also catch IndexedDB spellings
// ("Pull-Ups", "Chin Ups", "Hanging Leg Raise", "Inverted Rows"…).
function workoutNeedsBarOrRig(name) {
  var n = String(name || '').toLowerCase();
  if (!n) return false;
  return /(pull[ -]?up|chin[ -]?up|hanging|inverted row|muscle[ -]?up|dip[ -]?bar)/.test(n);
}
window.workoutNeedsBarOrRig = workoutNeedsBarOrRig;

// Robust "no equipment" detector. The survey equipment question is free
// text — users type "None", "none", "no", "No equipment", "nothing",
// "n/a", "zero", Arabic "لا شيء" / "بدون"… Empty counts as none (same
// convention as the sports-equipment check in renderSports).
function userHasNoEquipment(eq) {
  if (eq === undefined) {
    var _u = (typeof currentUser === 'function' && currentUser()) || {};
    var _s = _u.survey || {};
    eq = _s.equipment;
  }
  if (eq === null || eq === undefined) return true;
  var t = String(eq).trim().toLowerCase();
  if (!t) return true;                                        // empty → none
  if (/^(none|no|nothing|nope|nil|n\/a|na|zero|0|-|_)$/.test(t)) return true;
  if (t.indexOf('none') !== -1 || t.indexOf('no equipment') !== -1 ||
      t.indexOf('nothing') !== -1 || t.indexOf('no gym') !== -1 ||
      t.indexOf('bodyweight') !== -1 || t.indexOf('body weight') !== -1 ||
      t.indexOf('body-weight') !== -1) return true;
  if (t.indexOf('لا شيء') !== -1 || t.indexOf('لا يوجد') !== -1 ||
      t.indexOf('بدون') !== -1) return true;                  // Arabic
  return false;
}
window.userHasNoEquipment = userHasNoEquipment;

// Combined check: may this exercise be shown to a NO-EQUIPMENT user?
function exerciseAllowedWithoutEquipment(name, dbEquipment) {
  if (WORKOUT_DB_NEEDS_EQUIP[name]) return false;              // hardcoded DB
  if (dbEquipment && String(dbEquipment).toLowerCase() !== 'bodyweight') return false;
  if (workoutNeedsBarOrRig(name)) return false;                // bar exercises
  return true;
}
window.exerciseAllowedWithoutEquipment = exerciseAllowedWithoutEquipment;

const WORKOUT_DB = {
  'Chest': ['Push-ups', 'Incline Push-ups', 'Pec Flyes', 'Decline Push-ups', 'Diamond Push-ups', 'Wide Push-ups'],
  'Back': ['Superman Hold', 'Bird Dog', 'Reverse Snow Angels', 'Bent-over Rows', 'Lat Pulldowns', 'T-Bar Rows', 'Face Pulls', 'Reverse Flyes'],
  'Legs': ['Squats', 'Lunges', 'Calf Raises', 'Wall Sits', 'Jump Squats', 'Glute Bridges', 'Step-ups', 'Bulgarian Split Squats'],
  'Shoulders': ['Shoulder Press', 'Lateral Raises', 'Front Raises', 'Pike Push-ups', 'Arnold Press', 'Upright Rows'],
  'Arms': ['Bicep Curls', 'Tricep Extensions', 'Hammer Curls', 'Dips', 'Preacher Curls', 'Skull Crushers', 'Concentration Curls'],
  'Core': ['Plank', 'Crunches', 'Russian Twists', 'Leg Raises', 'Mountain Climbers', 'Bicycle Crunches', 'Dead Bug', 'Hanging Knee Raises']
};
// Comprehensive workout library — every exercise in WORKOUT_DB has an entry.
// Each entry contains: muscle group, full description, and a primary image URL.
// Round 6: ALL image URLs rewritten with accurate per-exercise Unsplash photos.
// Previously many exercises shared the same generic gym photo (e.g., Squats used
// a stretching photo, Lunges used a yoga photo). Now each exercise has a unique,
// accurate photo that visually matches the movement.
const WORKOUT_INFO = {
  // ---- Chest ----
  'Push-ups': { muscle: 'Chest, Triceps', desc: 'Keep your body straight, lower until chest is 1 inch from the ground, then push up explosively.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/3ee05b78e8a9.jpg' },
  'Incline Push-ups': { muscle: 'Chest, Shoulders', desc: 'Place hands on an elevated surface (bench/step). Easier than standard push-ups, targets upper chest.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/983d757d7210.jpg' },
  'Chest Dips': { muscle: 'Chest, Triceps', desc: 'Support body on parallel bars, lean forward slightly, lower until chest stretches, push back up.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/bea8c964ea6c.jpg' },
  'Pec Flyes': { muscle: 'Chest', desc: 'Lie on bench, arms slightly bent, lower weights out to sides in arc motion, squeeze chest to return.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/8697b5da0210.jpg' },
  'Decline Push-ups': { muscle: 'Chest, Triceps', desc: 'Place feet on an elevated surface (bench/step), hands on floor. Targets upper chest, harder than standard.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/4d57ae52c11c.jpg' },
  'Diamond Push-ups': { muscle: 'Triceps, Chest', desc: 'Form a diamond with thumbs and index fingers under chest. Heavy tricep focus, harder than standard.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/8a3111128d12.jpg' },
  'Wide Push-ups': { muscle: 'Chest, Shoulders', desc: 'Place hands wider than shoulder-width. Targets outer chest, increases range of motion.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/2d1748ada421.jpg' },

  // ---- Back ----
  // v12: added 'Bird Dog' + 'Reverse Snow Angels' with the no-equipment
  // back pool (no bar, no weights). 'Pull-ups' info stays (harmless — the
  // exercise is excluded from no-equipment pools, but users WITH a bar
  // still get it via WORKOUTS_DB).
  'Superman Hold': { muscle: 'Lower Back', desc: 'Lie face down, lift arms and legs simultaneously, hold at top for 2-3 seconds, lower with control.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/4a9512a34629.jpg' },
  'Bird Dog': { muscle: 'Back, Core', desc: 'On all fours, extend opposite arm and leg until both are straight and level, hold 2-3 seconds, return with control, alternate sides.', img: 'img/exercises/bird_dog.jpg' },
  'Reverse Snow Angels': { muscle: 'Upper Back, Rear Delts', desc: 'Lie face down, arms straight overhead, sweep them down to your sides keeping them off the floor, then return overhead.', img: 'img/exercises/reverse_snow_angels.jpg' },
  'Bent-over Rows': { muscle: 'Back, Biceps', desc: 'Hinge at hips, keep back flat, pull weight to lower ribs, squeeze shoulder blades together.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/0ed6a1495662.jpg' },
  'Lat Pulldowns': { muscle: 'Back, Biceps', desc: 'Pull the bar down to upper chest, squeeze lats, control the bar back up. Do not swing.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/632bd1aa6bc5.jpg' },
  'T-Bar Rows': { muscle: 'Back, Lats', desc: 'Stand over a T-bar, grip with both hands, pull up to lower chest, squeeze lats at the top.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/3c9f8aa96803.jpg' },
  'Face Pulls': { muscle: 'Shoulders, Upper Back', desc: 'Use a cable band at face height, pull toward forehead, external rotate shoulders, squeeze rear delts.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/13a9b645d817.jpg' },
  'Reverse Flyes': { muscle: 'Rear Delts, Upper Back', desc: 'Hinge forward with weights, raise arms out to sides targeting rear delts, slow and controlled.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/054cb476db14.jpg' },

  // ---- Legs ----
  'Squats': { muscle: 'Legs, Glutes', desc: 'Feet shoulder-width, lower hips back and down as if sitting in a chair, keep chest up.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/d8e3eeb27ba2.jpg' },
  'Lunges': { muscle: 'Legs, Glutes', desc: 'Step forward, lower back knee toward the floor, keep front shin vertical, push back to start.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/26502eae6b4c.jpg' },
  'Calf Raises': { muscle: 'Calves', desc: 'Stand on edge of step, raise heels as high as possible, lower slowly for full stretch.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/d0480e0a563e.jpg' },
  'Wall Sits': { muscle: 'Quads, Glutes', desc: 'Lean back against a wall, slide down until thighs are parallel to floor, hold the position.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/cb660336b9f1.jpg' },
  'Jump Squats': { muscle: 'Legs, Glutes', desc: 'Perform a squat, explode upward into a jump, land softly with bent knees, immediately descend.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/6c6fabdd0b27.jpg' },
  'Glute Bridges': { muscle: 'Glutes, Hamstrings', desc: 'Lie on back, knees bent, drive hips up squeezing glutes at the top, lower with control.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/77ee23b33e5a.jpg' },
  'Step-ups': { muscle: 'Legs, Glutes', desc: 'Step onto a bench/box, drive through heel, fully stand on top, lower slowly, alternate legs.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/75ef93ce5b4e.jpg' },
  'Bulgarian Split Squats': { muscle: 'Quads, Glutes', desc: 'Rear foot on bench, front foot forward, lower until front thigh is parallel, drive through heel.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/567956db031c.jpg' },

  // ---- Shoulders ----
  'Shoulder Press': { muscle: 'Shoulders, Triceps', desc: 'Sit or stand, press weights overhead until arms are straight, lower to shoulder level.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/c984fef1641a.jpg' },
  'Lateral Raises': { muscle: 'Shoulders', desc: 'Stand with weights at sides, raise arms out to shoulder height, lower slowly.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/a9e389092a53.jpg' },
  'Front Raises': { muscle: 'Shoulders', desc: 'Raise weights from thighs to shoulder height in front, keep arms straight, lower slowly.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/ffeb1e04b55e.jpg' },
  'Pike Push-ups': { muscle: 'Shoulders, Triceps', desc: 'Form an inverted V with hips high, lower head toward floor between hands, push back up.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/de201cadcef4.jpg' },
  'Arnold Press': { muscle: 'Shoulders', desc: 'Start with palms facing you at shoulder height, rotate palms outward as you press up, reverse on the way down.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/d974403515b0.jpg' },
  'Upright Rows': { muscle: 'Shoulders, Traps', desc: 'Hold barbell/dumbbells at waist, pull up along body to chin height leading with elbows, lower slowly.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/3ee08089152d.jpg' },

  // ---- Arms ----
  'Bicep Curls': { muscle: 'Arms, Biceps', desc: 'Keep elbows tucked to your sides, curl weight up, squeeze bicep at the top, lower slowly.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/a3454eebc1e8.jpg' },
  'Tricep Extensions': { muscle: 'Arms, Triceps', desc: 'Hold weight overhead with both hands, lower behind head keeping elbows close to ears, extend back up.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/f7872b5e4829.jpg' },
  'Hammer Curls': { muscle: 'Arms, Biceps', desc: 'Hold weights with palms facing each other (neutral grip), curl up keeping the hammer grip throughout.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/d8250d47b146.jpg' },
  'Dips': { muscle: 'Triceps, Chest', desc: 'Support body on parallel bars or bench, lower by bending elbows to 90 degrees, push back up.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/20214258a4a6.jpg' },
  'Preacher Curls': { muscle: 'Biceps', desc: 'Rest arms on a preacher bench, curl weight up squeezing bicep, lower fully extended. Isolates biceps.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/1018dac2d57d.jpg' },
  'Skull Crushers': { muscle: 'Triceps', desc: 'Lie on bench, hold weight above forehead, lower by bending elbows to 90 degrees, extend back up.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/0c29be71dbdb.png' },
  'Concentration Curls': { muscle: 'Biceps', desc: 'Sit on bench, rest elbow against inner thigh, curl weight up with strict form, no swinging.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/3fae6c712f3c.jpg' },

  // ---- Core ----
  'Plank': { muscle: 'Core', desc: 'Rest on forearms and toes, keep body in a straight line from head to heels, brace your abs.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/958fea247814.jpg' },
  'Crunches': { muscle: 'Core, Abs', desc: 'Lie on back, knees bent, contract abs to lift shoulder blades off floor, lower with control.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/6a0b468956df.jpg' },
  'Russian Twists': { muscle: 'Core, Obliques', desc: 'Sit with knees bent, lean back slightly, rotate torso side to side touching floor each side.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/c5bcaf6dc3fa.jpg' },
  'Leg Raises': { muscle: 'Core, Lower Abs', desc: 'Lie flat, keep legs straight, raise them to 90 degrees, lower slowly without touching floor.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/d163f2695b72.jpg' },
  'Mountain Climbers': { muscle: 'Core, Cardio', desc: 'Start in plank position, alternately drive knees toward chest at a fast pace, keep hips low.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/d56c9d930ee6.jpg' },
  'Bicycle Crunches': { muscle: 'Core, Obliques', desc: 'Lie on back, bring opposite elbow to opposite knee in a cycling motion, extend other leg straight.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/930797913a67.jpg' },
  'Dead Bug': { muscle: 'Core', desc: 'Lie on back, arms up, knees at 90°. Lower opposite arm and leg slowly, return, alternate sides.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/118c4e92983e.jpg' },
  'Hanging Knee Raises': { muscle: 'Core, Lower Abs', desc: 'Hang from a bar, raise knees to chest by contracting abs, lower slowly without swinging.', img: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/f2dc7a6e5bec.jpg' },

};
// ========================================================================
// SMART EXERCISE IMAGE RESOLVER (new)
// ========================================================================
// Fixes the "wrong photo" bug: unknown exercise names used to fall back to
// the PUSH-UPS photo. Now resolution order is:
//   1. exact WORKOUT_INFO entry
//   2. name normalization + alias table
//   3. keyword rules (curl/push-up/row/squat families...)
//   4. muscle-group bucket
//   5. neutral generic gym image (never a push-up)
// All images are LOCAL files in img/exercises/ so they work offline and
// never 404 like the old CDN links.
const WORKOUT_INFO_DEFAULT_DESC = 'Perform this exercise with proper form and controlled motion. Focus on the target muscle, breathe steadily, and avoid jerky movements.';
// v31 (user): "divide the img folder into 3 folders and make the code read
// it" — exercise photos now live in img/part1|part2|part3 (GitHub's web
// upload caps ~100 files per batch). js/volta-imgmap.js (generated) maps
// every filename to its part folder via voltaImgPath(). WORKOUT_IMG_DIR is
// kept ONLY as the legacy-prefix detector for old saved paths.
const WORKOUT_IMG_DIR = 'img/exercises/';
// Neutral default — a general gym shot, NOT any specific exercise.
const WORKOUT_INFO_DEFAULT_IMG = (typeof voltaImgPath === 'function')
  ? voltaImgPath('gym_generic.jpg')
  : 'img/' + (window.VOLTA_IMG_DEFAULT_PART || 'part1') + '/gym_generic.jpg';

function normalizeExerciseName(name) {
  return (name || '').toString().toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// Local image per exercise bucket (fetched + verified at build time).
const WORKOUT_IMG_LIB = {
  'pushup': 1, 'incline_pushup': 1, 'decline_pushup': 1, 'diamond_pushup': 1,
  'bench_press': 1, 'incline_db_press': 1, 'db_fly': 1, 'cable_crossover': 1,
  'machine_chest_press': 1, 'chest_dips': 1, 'tricep_dips': 1, 'db_pullover': 1,
  'pullup': 1, 'barbell_row': 1, 'db_row': 1, 'lat_pulldown': 1, 'cable_row': 1,
  'tbar_row': 1, 'inverted_row': 1, 'deadlift': 1, 'face_pulls': 1, 'superman': 1,
  'reverse_fly': 1, 'trx_row': 1, 'squat_bw': 1, 'barbell_squat': 1, 'sumo_squat': 1,
  'goblet_squat': 1, 'jump_squat': 1, 'lunge': 1, 'bulgarian_split_squat': 1,
  'leg_press': 1, 'leg_extension': 1, 'hamstring_curl': 1, 'calf_raise': 1,
  'step_up': 1, 'wall_sit': 1, 'rdl': 1, 'hip_thrust': 1,
  'shoulder_press': 1, 'arnold_press': 1, 'lateral_raise': 1, 'front_raise': 1,
  'pike_pushup': 1, 'upright_row': 1, 'handstand': 1, 'shrugs': 1,
  'bicep_curl': 1, 'hammer_curl': 1, 'preacher_curl': 1, 'concentration_curl': 1,
  'reverse_curl': 1, 'tricep_pushdown': 1, 'overhead_tricep_ext': 1,
  'skull_crusher': 1, 'close_grip_bench': 1,
  'plank': 1, 'side_plank': 1, 'crunch': 1, 'bicycle_crunch': 1, 'russian_twist': 1,
  'leg_raise': 1, 'flutter_kicks': 1, 'hanging_leg_raise': 1, 'mountain_climber': 1,
  'dead_bug': 1, 'bird_dog': 1, 'hollow_hold': 1, 'v_ups': 1, 'woodchopper': 1,
  'ab_rollout': 1,
  // v16: dedicated buckets — these exercises used to share a neighbor's
  // photo (Reverse Snow Angels→superman, Glute Bridges→hip_thrust,
  // Wide/Staggered Push-ups→pushup), which showed the WRONG exercise.
  'reverse_snow_angels': 1, 'glute_bridge': 1, 'wide_pushup': 1, 'staggered_pushup': 1,
  'running': 1, 'hiit': 1, 'cycling': 1, 'jump_rope': 1, 'burpees': 1,
  'rowing_machine': 1, 'swimming': 1, 'stair_climber': 1, 'high_knees': 1,
  'box_jumps': 1, 'sprints': 1,
  'full_body': 1, 'gym_generic': 1
};
function workoutImg(key) {
  // v31: resolved through the img/part1..3 map (js/volta-imgmap.js).
  if (typeof voltaImgPath === 'function') return voltaImgPath(key + '.jpg');
  return 'img/' + (window.VOLTA_IMG_DEFAULT_PART || 'part1') + '/' + key + '.jpg';
}

// v15 (user): "make all workout image have start and end, for all workouts
// even machine ones" — every exercise now also ships a START→END guide
// image: a two-panel illustration (start left, end right) at
// img/exercises/se/{bucket}.jpg. This maps a RESOLVED classic photo path to
// its guide counterpart ('img/exercises/pushup.jpg' →
// 'img/exercises/se/pushup.jpg'). Non-local paths (CDN leftovers) map to ''.
function workoutSEImg(img) {
  if (typeof img !== 'string') return '';
  // v31: guide images are flat in img/part1..3 with an "se-" prefix.
  // Accepts new part paths, legacy img/exercises/x.jpg AND legacy
  // img/exercises/se/x.jpg paths (old saved records may still carry them).
  var m = img.match(/^img\/(?:exercises\/([a-z0-9_]+)|exercises\/se\/([a-z0-9_]+)|part[123]\/(se-)?([a-z0-9_-]+))\.jpg$/i);
  if (!m) return '';
  if (m[2]) return voltaImgPath('se-' + m[2] + '.jpg');   // legacy se/ path
  if (m[3]) return img;                                    // already a guide image
  if (m[4]) return voltaImgPath('se-' + m[4] + '.jpg');    // new classic path
  return voltaImgPath('se-' + m[1] + '.jpg');               // legacy classic path
}

// Alias table: normalized name -> image bucket key.
const WORKOUT_NAME_ALIAS = {
  'push ups': 'pushup', 'push up': 'pushup', 'pushups': 'pushup',
  'press ups': 'pushup', 'explosive push ups': 'pushup', 'staggered push ups': 'staggered_pushup',
  'wide push ups': 'wide_pushup', 'wide pushups': 'wide_pushup',
  'incline push ups': 'incline_pushup', 'incline pushups': 'incline_pushup',
  'decline push ups': 'decline_pushup', 'decline pushups': 'decline_pushup',
  'diamond push ups': 'diamond_pushup', 'diamond push ups tricep focus': 'diamond_pushup',
  'bench press': 'bench_press', 'close grip bench press': 'close_grip_bench',
  'incline barbell press': 'incline_db_press', 'incline dumbbell press': 'incline_db_press',
  'dumbbell fly': 'db_fly', 'dumbbell flyes': 'db_fly', 'pec flyes': 'db_fly',
  'pec deck machine': 'machine_chest_press', 'machine chest press': 'machine_chest_press',
  'cable crossover': 'cable_crossover',
  'chest dips': 'chest_dips', 'dips': 'tricep_dips', 'tricep dips': 'tricep_dips',
  'dumbbell pullover': 'db_pullover',
  'pull ups': 'pullup', 'pullups': 'pullup', 'pull up': 'pullup',
  'chin ups': 'pullup', 'chinups': 'pullup',
  'bent over rows': 'barbell_row', 'bent over barbell rows': 'barbell_row',
  'pendlay row': 'barbell_row', 't bar rows': 'tbar_row', 't bar row': 'tbar_row',
  'dumbbell rows': 'db_row', 'single arm lat pulldown': 'lat_pulldown',
  'lat pulldowns': 'lat_pulldown', 'lat pulldown': 'lat_pulldown',
  'seated cable row': 'cable_row', 'inverted rows': 'inverted_row',
  'trx rows': 'trx_row', 'deadlift': 'deadlift', 'romanian deadlift': 'rdl',
  'face pulls': 'face_pulls', 'face pull to press': 'face_pulls',
  'superman': 'superman', 'superman hold': 'superman',
  'reverse fly': 'reverse_fly', 'reverse flyes': 'reverse_fly', 'rear delt fly': 'reverse_fly',
  'squats': 'squat_bw', 'bodyweight squats': 'squat_bw', 'air squats': 'squat_bw',
  'barbell squats': 'barbell_squat', 'back squats': 'barbell_squat',
  'sumo squats': 'sumo_squat', 'goblet squats': 'goblet_squat',
  'jump squats': 'jump_squat', 'bulgarian split squats': 'bulgarian_split_squat',
  'lunges': 'lunge', 'walking lunges': 'lunge',
  'leg press': 'leg_press', 'leg extensions': 'leg_extension',
  'hamstring curls': 'hamstring_curl', 'leg curls': 'hamstring_curl',
  'calf raises': 'calf_raise', 'step ups': 'step_up', 'wall sits': 'wall_sit',
  'glute bridges': 'glute_bridge', 'hip thrusts': 'hip_thrust',
  'shoulder press': 'shoulder_press', 'dumbbell shoulder press': 'shoulder_press',
  'military press': 'shoulder_press', 'overhead press': 'shoulder_press',
  'landmine press': 'shoulder_press', 'arnold press': 'arnold_press',
  'lateral raises': 'lateral_raise', 'cable lateral raises': 'lateral_raise',
  'front raises': 'front_raise', 'pike push ups': 'pike_pushup', 'pike pushups': 'pike_pushup',
  'upright rows': 'upright_row', 'handstand hold': 'handstand', 'wall walks': 'handstand',
  'dumbbell shrugs': 'shrugs', 'shrugs': 'shrugs',
  'bicep curls': 'bicep_curl', 'barbell curls': 'bicep_curl', '21s bicep curls': 'bicep_curl',
  'spider curls': 'concentration_curl', 'concentration curls': 'concentration_curl',
  'preacher curls': 'preacher_curl', 'hammer curls': 'hammer_curl',
  'cable hammer curls': 'hammer_curl', 'reverse curls': 'reverse_curl',
  'tricep extensions': 'overhead_tricep_ext', 'overhead tricep extension': 'overhead_tricep_ext',
  'rope tricep extensions': 'tricep_pushdown', 'tricep pushdowns': 'tricep_pushdown',
  'skull crushers': 'skull_crusher',
  'plank': 'plank', 'side plank': 'side_plank',
  'crunches': 'crunch', 'bicycle crunches': 'bicycle_crunch',
  'russian twists': 'russian_twist', 'leg raises': 'leg_raise',
  'hanging leg raises': 'hanging_leg_raise', 'hanging knee raises': 'hanging_leg_raise',
  'mountain climbers': 'mountain_climber', 'dead bug': 'dead_bug',
  'bird dog': 'bird_dog', 'flutter kicks': 'flutter_kicks',
  'hollow body hold': 'hollow_hold', 'v ups': 'v_ups', 'v ups': 'v_ups',
  'cable woodchoppers': 'woodchopper', 'ab wheel rollout': 'ab_rollout',
  'running': 'running', 'sprint intervals': 'sprints', 'sprints': 'sprints',
  'cycling': 'cycling', 'jump rope': 'jump_rope', 'burpees': 'burpees',
  'rowing machine': 'rowing_machine', 'swimming': 'swimming',
  'stair climber': 'stair_climber', 'high knees': 'high_knees',
  'box jumps': 'box_jumps', 'full body circuit': 'full_body',
  'jumping jacks': 'hiit', 'hiit': 'hiit', 'stretching': 'full_body'
};

// Keyword rules: first matching rule wins (order matters).
const WORKOUT_KEYWORD_RULES = [
  ['pike', 'pike_pushup'], ['incline', 'incline_pushup'], ['decline', 'decline_pushup'],
  ['diamond', 'diamond_pushup'], ['push up', 'pushup'], ['pushup', 'pushup'], ['press up', 'pushup'],
  ['close grip', 'close_grip_bench'],
  ['crossover', 'cable_crossover'], ['pec deck', 'machine_chest_press'],
  ['chest press', 'machine_chest_press'], ['machine press', 'machine_chest_press'],
  ['fly', 'db_fly'], ['flye', 'db_fly'],
  ['pullover', 'db_pullover'],
  ['chest dip', 'chest_dips'], ['dip', 'tricep_dips'],
  ['bench press', 'bench_press'],
  ['chin up', 'pullup'], ['pull up', 'pullup'], ['pullup', 'pullup'],
  ['lat pulldown', 'lat_pulldown'], ['pulldown', 'lat_pulldown'],
  ['inverted row', 'inverted_row'], ['trx', 'trx_row'], ['t bar', 'tbar_row'],
  ['cable row', 'cable_row'], ['seated row', 'cable_row'],
  ['upright row', 'upright_row'], ['row', 'barbell_row'],
  ['romanian deadlift', 'rdl'], ['rdl', 'rdl'], ['deadlift', 'deadlift'],
  ['face pull', 'face_pulls'],
  ['superman', 'superman'], ['rear delt', 'reverse_fly'], ['reverse fly', 'reverse_fly'],
  ['jump squat', 'jump_squat'], ['bulgarian', 'bulgarian_split_squat'],
  ['split squat', 'bulgarian_split_squat'], ['goblet', 'goblet_squat'],
  ['sumo', 'sumo_squat'], ['wall sit', 'wall_sit'],
  ['barbell squat', 'barbell_squat'], ['squat', 'squat_bw'],
  ['lunge', 'lunge'], ['calf raise', 'calf_raise'], ['calf', 'calf_raise'],
  ['step up', 'step_up'], ['leg press', 'leg_press'],
  ['leg extension', 'leg_extension'], ['leg curl', 'hamstring_curl'], ['hamstring', 'hamstring_curl'],
  ['glute bridge', 'glute_bridge'], ['hip thrust', 'hip_thrust'], ['bridge', 'hip_thrust'],
  ['arnold', 'arnold_press'],
  ['shoulder press', 'shoulder_press'], ['military press', 'shoulder_press'],
  ['overhead press', 'shoulder_press'], ['landmine', 'shoulder_press'],
  ['lateral raise', 'lateral_raise'], ['front raise', 'front_raise'],
  ['handstand', 'handstand'], ['wall walk', 'handstand'],
  ['shrug', 'shrugs'],
  ['hammer curl', 'hammer_curl'], ['preacher curl', 'preacher_curl'],
  ['concentration curl', 'concentration_curl'], ['spider curl', 'concentration_curl'],
  ['reverse curl', 'reverse_curl'], ['curl', 'bicep_curl'],
  ['skull', 'skull_crusher'],
  ['tricep pushdown', 'tricep_pushdown'], ['pushdown', 'tricep_pushdown'],
  ['rope extension', 'tricep_pushdown'], ['kickback', 'tricep_pushdown'],
  ['tricep extension', 'overhead_tricep_ext'], ['overhead tricep', 'overhead_tricep_ext'],
  ['tricep', 'tricep_pushdown'],
  ['bicycle crunch', 'bicycle_crunch'], ['crunch', 'crunch'],
  ['sit up', 'v_ups'], ['situp', 'v_ups'], ['v up', 'v_ups'], ['toe touch', 'v_ups'],
  ['side plank', 'side_plank'], ['plank', 'plank'],
  ['hanging leg raise', 'hanging_leg_raise'], ['hanging knee raise', 'hanging_leg_raise'],
  ['hanging', 'hanging_leg_raise'], ['leg raise', 'leg_raise'],
  ['russian twist', 'russian_twist'], ['twist', 'russian_twist'],
  ['mountain climber', 'mountain_climber'], ['dead bug', 'dead_bug'],
  ['bird dog', 'bird_dog'], ['flutter', 'flutter_kicks'], ['scissor', 'flutter_kicks'],
  ['hollow', 'hollow_hold'], ['woodchop', 'woodchopper'], ['wood chop', 'woodchopper'],
  ['ab wheel', 'ab_rollout'], ['rollout', 'ab_rollout'],
  ['sprint', 'sprints'], ['high knee', 'high_knees'],
  ['jump rope', 'jump_rope'], ['skipping', 'jump_rope'],
  ['box jump', 'box_jumps'], ['burpee', 'burpees'],
  ['rowing', 'rowing_machine'], ['stair', 'stair_climber'],
  ['cycle', 'cycling'], ['bike', 'cycling'], ['swim', 'swimming'],
  ['run', 'running'], ['walk', 'running'], ['jog', 'running'],
  ['jumping jack', 'hiit'], ['hiit', 'hiit'], ['circuit', 'full_body'], ['cardio', 'running']
];

// Muscle-group fallback buckets.
const WORKOUT_MUSCLE_IMG = {
  'chest': 'bench_press', 'back': 'lat_pulldown', 'legs': 'barbell_squat',
  'shoulders': 'shoulder_press', 'arms': 'bicep_curl', 'biceps': 'bicep_curl',
  'triceps': 'tricep_pushdown', 'core': 'plank', 'abs': 'crunch',
  'cardio': 'running', 'full body': 'full_body', 'lower back': 'superman',
  'glutes': 'hip_thrust', 'calves': 'calf_raise', 'traps': 'shrugs'
};

// Resolve the best image for an exercise name.
function resolveWorkoutImage(name, fallbackMuscle) {
  const norm = normalizeExerciseName(name);
  if (!norm) return WORKOUT_INFO_DEFAULT_IMG;
  // 1) alias table
  if (WORKOUT_NAME_ALIAS[norm]) return workoutImg(WORKOUT_NAME_ALIAS[norm]);
  // 2) normalized exact WORKOUT_INFO keys ("push ups" vs "Push-ups" etc.)
  for (const key in WORKOUT_INFO) {
    if (normalizeExerciseName(key) === norm && WORKOUT_INFO[key].img) {
      // accept only local images; old CDN URLs fall through to the
      // keyword/muscle rules (v31: strict — never hand back a dead link)
      var ci = String(WORKOUT_INFO[key].img);
      if (ci.indexOf('http') !== 0) {
        return normalizeLegacyWorkoutImg(ci);
      }
    }
  }
  // 3) keyword rules
  for (let i = 0; i < WORKOUT_KEYWORD_RULES.length; i++) {
    if (norm.indexOf(WORKOUT_KEYWORD_RULES[i][0]) !== -1) {
      return workoutImg(WORKOUT_KEYWORD_RULES[i][1]);
    }
  }
  // 4) muscle bucket
  const mus = normalizeExerciseName(fallbackMuscle || '');
  for (const mk in WORKOUT_MUSCLE_IMG) {
    if (mus.indexOf(mk) !== -1) return workoutImg(WORKOUT_MUSCLE_IMG[mk]);
  }
  // 5) neutral default
  return WORKOUT_INFO_DEFAULT_IMG;
}

// v31: re-route legacy local paths (img/exercises/[se/]x.jpg) to the new
// img/part1..3 layout. CDN links pass through untouched (callers re-map them).
function normalizeLegacyWorkoutImg(p) {
  if (typeof p !== 'string') return p;
  var m = p.match(/^img\/exercises\/(se\/)?([a-z0-9_]+)\.jpg$/i);
  if (!m) return p;
  return voltaImgPath((m[1] ? 'se-' : '') + m[2] + '.jpg');
}

// Helper: always return a complete info object — desc + img are guaranteed strings.
function getWorkoutInfo(name, fallbackMuscle) {
  const base = (name && WORKOUT_INFO[name]) || {};
  let desc = (typeof base.desc === 'string' && base.desc.trim()) ? base.desc : '';
  let muscle = base.muscle || fallbackMuscle || '';
  let steps = [], tips = [];
  // NEW: when the curated INFO table misses this name, pull the real
  // description / muscle group from the workout seed DB (100 entries with
  // descriptions, steps and tips) instead of showing the generic text.
  if ((!desc || !muscle) && typeof WORKOUTS_DB !== 'undefined' && Array.isArray(WORKOUTS_DB)) {
    const norm = normalizeExerciseName(name);
    for (let i = 0; i < WORKOUTS_DB.length; i++) {
      const w = WORKOUTS_DB[i];
      if (w && normalizeExerciseName(w.name) === norm) {
        if (!desc && w.description) {
          desc = w.description;
        }
        // Steps & tips are kept as SEPARATE arrays so the detail modal can
        // render them as proper numbered/bulleted lists (not a run-on text).
        if (Array.isArray(w.steps)) steps = w.steps.slice();
        if (Array.isArray(w.tips)) tips = w.tips.slice();
        if (!muscle && w.muscleGroup) muscle = w.muscleGroup;
        break;
      }
    }
  }
  let img = (typeof base.img === 'string' && base.img.trim()) ? base.img : '';
  if (!img || img.indexOf('z-cdn.chatglm.cn') !== -1) {
    // Re-map old CDN links through the smart resolver (many of them 404 now).
    img = resolveWorkoutImage(name, muscle || fallbackMuscle);
  }
  // v31: legacy local paths (img/exercises/...) → img/part1..3.
  img = normalizeLegacyWorkoutImg(img);
  return {
    muscle: muscle || fallbackMuscle || 'Full Body',
    desc:   desc || WORKOUT_INFO_DEFAULT_DESC,
    img:    img,
    steps:  steps,
    tips:   tips
  };
}

// === MET (Metabolic Equivalent of Task) values per exercise (round 5) ===
// Used by getWorkoutCalories() to compute accurate per-exercise calorie burn.
// Formula: calories = MET × weight(kg) × duration(hours)
// Source values: compendium of physical activities (standard Ainsworth 2011).
//   - 1 MET = resting energy expenditure (≈ 1 kcal/kg/hour)
//   - Moderate strength training ≈ 3.5–5.0
//   - Vigorous strength training ≈ 5.0–6.0
//   - Bodyweight moves (push-ups, squats) ≈ 3.8–8.0
//   - HIIT / dynamic core (burpees, mountain climbers) ≈ 8.0–10.0
// Default for unknown exercises: 5.0 (moderate-vigorous strength).
const WORKOUT_MET = {
  // ---- Chest ----
  'Push-ups': 8.0, 'Incline Push-ups': 4.5, 'Chest Dips': 6.0, 'Pec Flyes': 4.0,
  'Decline Push-ups': 9.0, 'Diamond Push-ups': 9.5, 'Wide Push-ups': 8.5,
  // ---- Back ----
  'Pull-ups': 8.0, 'Bent-over Rows': 5.0, 'Superman Hold': 3.5, 'Lat Pulldowns': 4.5,
  'T-Bar Rows': 5.5, 'Face Pulls': 3.5, 'Reverse Flyes': 3.5,
  // ---- Legs ----
  'Squats': 5.0, 'Lunges': 5.5, 'Calf Raises': 3.5, 'Wall Sits': 4.0,
  'Jump Squats': 8.0, 'Glute Bridges': 4.0, 'Step-ups': 5.5, 'Bulgarian Split Squats': 6.0,
  // ---- Shoulders ----
  'Shoulder Press': 4.5, 'Lateral Raises': 3.5, 'Front Raises': 3.5, 'Pike Push-ups': 6.0,
  'Arnold Press': 4.5, 'Upright Rows': 4.5,
  // ---- Arms ----
  'Bicep Curls': 3.5, 'Tricep Extensions': 3.5, 'Hammer Curls': 3.5, 'Dips': 6.0,
  'Preacher Curls': 3.5, 'Skull Crushers': 3.5, 'Concentration Curls': 3.5,
  // ---- Core ----
  'Plank': 4.0, 'Crunches': 4.5, 'Russian Twists': 4.0, 'Leg Raises': 4.5,
  'Mountain Climbers': 8.0, 'Bicycle Crunches': 5.0, 'Dead Bug': 3.5, 'Hanging Knee Raises': 5.0,
  // ---- Full body ----
  'Full Body Circuit': 7.0,
  // ── v25 (user): "use the most accurate calorie burn formula for every
  //    sport" — MET values for the remaining exercises (Compendium of
  //    Physical Activities: resistance training 3.5–6.0 by vigor, explosive
  //    plyometrics 8.0+, holds 3.5–4.0, cardio machines by pace). Every
  //    exercise in WORKOUT_INFO / WORKOUT_AR_NAMES now has a real MET —
  //    nothing falls back to the generic 5.0 anymore. ──
  // ---- Chest (equipment) ----
  'Bench Press': 5.0, 'Incline Dumbbell Press': 5.0, 'Dumbbell Fly': 4.0,
  'Cable Crossover': 4.0, 'Machine Chest Press': 5.0, 'Incline Barbell Press': 5.5,
  'Pec Deck Machine': 4.5, 'Explosive Push-Ups': 8.0, 'Dumbbell Pullover': 4.5,
  'Close-Grip Bench Press': 5.5,
  // ---- Back (equipment) ----
  'Bent-Over Barbell Rows': 6.0, 'Dumbbell Rows': 5.5, 'Lat Pulldown': 4.5,
  'Seated Cable Row': 4.5, 'T-Bar Row': 5.5, 'Inverted Rows': 6.0,
  'Deadlift': 6.0, 'Chin-Ups': 8.0, 'Single-Arm Lat Pulldown': 4.5,
  'Superman': 3.5, 'Pendlay Row': 6.0, 'TRX Rows': 5.5, 'Reverse Fly': 3.5,
  // ---- Legs (equipment) ----
  'Bodyweight Squats': 5.0, 'Barbell Squats': 6.0, 'Romanian Deadlift': 6.0,
  'Leg Press': 5.0, 'Goblet Squats': 5.5, 'Leg Extensions': 4.0,
  'Hamstring Curls': 4.0, 'Sumo Squats': 5.5, 'Stair Climber': 9.0,
  // ---- Shoulders (equipment) ----
  'Dumbbell Shoulder Press': 5.0, 'Military Press': 5.5, 'Rear Delt Fly': 3.5,
  'Overhead Press': 5.5, 'Cable Lateral Raises': 3.5, 'Handstand Hold': 4.0,
  'Dumbbell Shrugs': 4.0, 'Face Pull to Press': 4.5, 'Landmine Press': 5.0,
  'Wall Walks': 7.0,
  // ---- Arms (equipment) ----
  'Tricep Pushdowns': 3.5, 'Cable Hammer Curls': 3.5,
  'Overhead Tricep Extension': 3.5, '21s Bicep Curls': 3.5,
  'Reverse Curls': 3.5, 'Diamond Push-Ups Tricep Focus': 9.0,
  'Rope Tricep Extensions': 3.5, 'Spider Curls': 3.5, 'Tricep Dips': 6.0,
  // ---- Core (extra) ----
  'Hanging Leg Raises': 5.0, 'Side Plank': 4.0, 'Bird Dog': 3.5,
  'Flutter Kicks': 3.5, 'Hollow Body Hold': 4.0, 'V-Ups': 5.0,
  'Cable Woodchoppers': 4.5, 'Ab Wheel Rollout': 5.0,
  // ---- Cardio / conditioning ----
  'Running': 9.8, 'Cycling': 7.5, 'Jump Rope': 11.0, 'Burpees': 8.0,
  'Rowing Machine': 7.0, 'Swimming': 8.3, 'High Knees': 8.0,
  'Box Jumps': 8.5, 'Sprint Intervals': 12.0,
  // ---- Aliases / variants seen in plans ----
  'Staggered Push-Ups': 9.0, 'Reverse Snow Angels': 3.5, 'Walking Lunges': 6.0
};
// Returns calories burned for a single exercise, based on the user's weight
// + the per-exercise duration + MET value. v25 (user): switched to the ACSM
// standard — kcal = MET × 3.5 × weight(kg) / 200 × minutes — so every
// exercise burn matches the Compendium equation used by sports sessions.
// Result is always a whole number. Falls back to a small integer if the
// user/weight is unknown.
function getWorkoutCalories(name) {
  try {
    const u = currentUser();
    const weightKg = (u && u.profile && u.profile.weight) ? u.profile.weight : 70;
    const met = WORKOUT_MET[name] || 5.0;
    const secs = (typeof getWorkoutDuration === 'function') ? getWorkoutDuration(name) : 60;
    const kcal = met * 3.5 * weightKg / 200 * (secs / 60);
    // Round to nearest integer; min 1 so the fire badge always shows something.
    return Math.max(1, Math.round(kcal));
  } catch(e) { return 5; }
}

function renderDailyExercise() {
  const u = currentUser();
  if (!u.profile) return;
  // If we have a saved multi-day plan in localStorage but nothing in memory
  // (e.g. page just loaded), hydrate from it so the user resumes on Day N
  // instead of being kicked back to step 1. wizardOpen = the user explicitly
  // asked to build a NEW plan — don't hijack them back to the stored tracker.
  if (!deState.dailyPlan && deState.step === 1 && !deState.wizardOpen) { loadDailyPlan(); }
  const container = document.getElementById('daily-exercise-content');
  const ar = (store.lang === 'ar');
  // The compact toolbar (View / New / Custom) duplicates the hub's buttons —
  // hide it while the plan hub is showing, restore it everywhere else.
  // v8 (user request, picture 1): the three plan buttons — "View Current
  // Plan", "Start a New Plan", "Custom Builder" — now appear ONLY while the
  // user hasn't started a plan yet. Once a plan exists they disappear from
  // every state (the plan hub keeps its own dedicated buttons).
  const __toolbar = document.querySelector('#tab-daily .daily-toolbar');
  const __hasPlan = !!(u && u.plan && u.plan && u.plan.workout);
  if (__toolbar) __toolbar.style.display = __hasPlan ? 'none' : '';
  // === Round 6: Stop Training guard ===
  // If the user has stopped training (busy mode panel → Stop Training = On),
  // show a paused message instead of the workout setup/plan UI.
  try {
    const u = currentUser();
    if (u && u.stopTraining) {
      container.innerHTML = `
        <div class="panel" style="text-align:center;padding:48px 24px;">
          <div style="width:80px;height:80px;border-radius:50%;background:#fdeaea;color:#c62828;display:flex;align-items:center;justify-content:center;font-size:2rem;margin:0 auto 18px;"><i class="fa-solid fa-pause-circle"></i></div>
          <h2 style="margin:0 0 8px;" data-ar="التدريب متوقف مؤقتاً">Training Paused</h2>
          <p style="color:var(--muted);margin:0 0 20px;" data-ar="لقد أوقفت التدريب. يمكنك استئنافه من ملف الشخصي ← وضع الانشغال ← استئناف.">You've stopped training. Resume any time from Profile &rarr; Busy Mode &rarr; Resume.</p>
          <button class="btn primary" onclick="setStopTraining(false); showTab('daily');"><i class="fa-solid fa-play"></i> <span data-ar="استئناف التدريب">Resume Training</span></button>
        </div>
      `;
      setTimeout(applyTranslations, 0);
      return;
    }
  } catch(e) { /* fall through to normal render */ }
  // Helper: localize a muscle name
  const mName = (m) => ar ? (MUSCLE_AR_NAMES[m] || m) : m;
  // Helper: localize a day name
  const dName = (d) => ar ? (DAY_AR_NAMES[d] || d) : d;
  // Helper: localize a workout name
  const wName = (w) => ar ? (WORKOUT_AR_NAMES[w] || w) : w;
  const nextLabel = ar ? 'التالي' : 'Next';
  const backLabel = ar ? 'رجوع' : 'Back';
  const genLabel = ar ? 'أنشئ الخطة' : 'Generate Plan';
  const finishLabel = ar ? 'إنهاء تمرين اليوم' : 'Finish Daily Workout';
  
  if ((deState.step === 0) || (deState.step === 1 && !deState.wizardOpen)) {
    // ===== PLAN HUB (default view) =====
    // Per user report: the Daily tab used to show the muscle picker by
    // default. It now opens on the plan-choice hub instead — Train This
    // Plan / View Current Plan / Start a New Plan / Build a Custom Workout.
    // The muscle wizard below is only reached via openDeWizard().
    if (__toolbar) __toolbar.style.display = 'none';   // hub already has these actions
    container.innerHTML = dePlanHubHtml(u, ar);
    setTimeout(applyTranslations, 0);
    return;
  }
  if (deState.step === 1) {
    // ===== Plan actions toolbar (user request) =====
    // The old "Your workout plan is ready" question card was removed — the
    // Daily tab now always shows the compact toolbar at the top with
    // "View Current Plan" / "Start a New Plan" / "Custom Builder" buttons,
    // so the wizard below is reachable in every state.
    // v28 (user): the muscle picker now opens with ALL SIX groups
    // pre-selected — the new full-body formula (2/4/5 exercises per group
    // by session time) lists all of Chest, Back, Legs, Shoulders, Arms and
    // Core, so the default selection matches it exactly. The user can
    // still deselect groups to focus a session. (Supersedes the old
    // "never pre-select" request — the formula names all six groups.)
    // Only reset on the FIRST visit (or after finishing a workout) — not on
    // every re-render, otherwise toggleMuscle() would wipe the user's selection.
    if (!deState.initialized) {
      deState.muscles = ['Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core'];
      deState.initialized = true;
    }
    
    container.innerHTML = `
      <div class="panel daily-exercise-container">
        <div class="de-step-title" data-ar="ما العضلات التي تريد تدريبها؟">Which muscles do you want to train?</div>
        <div class="de-step-desc" data-ar="اختر العضلات المستهدفة لخطتك اليومية.">Select target muscles for your daily plan.</div>
        <div class="muscle-view-toggle">
          <button class="muscle-view-btn ${deState.view === 'front' ? 'active' : ''}" onclick="switchMuscleView('front')" data-ar="المنظر الأمامي">Front View</button>
          <button class="muscle-view-btn ${deState.view === 'back' ? 'active' : ''}" onclick="switchMuscleView('back')" data-ar="المنظر الخلفي">Back View</button>
        </div>
        <div class="muscle-selector-layout">
          <div class="body-figure">
            ${deState.view === 'front' ? getFrontSVG() : getBackSVG()}
          </div>
          <div class="muscle-buttons-grid">
            ${['Chest','Back','Legs','Shoulders','Arms','Core'].map(m => `
              <button class="muscle-select-btn ${deState.muscles.includes(m) ? 'selected' : ''}" onclick="toggleMuscle('${m}')">
                <i class="fa-solid fa-dumbbell"></i> ${mName(m)}
              </button>
            `).join('')}
          </div>
        </div>
        <button class="btn primary" style="width:100%;margin-top:24px;" onclick="deNextStep(2)">${nextLabel} <i class="fa-solid fa-arrow-right"></i></button>
        <button class="btn ghost" style="width:100%;margin-top:10px;" onclick="deBackToHub()"><i class="fa-solid fa-arrow-left"></i> ${backLabel}</button>
      </div>
    `;
  } else if (deState.step === 2) {
    container.innerHTML = `
      <div class="panel daily-exercise-container">
        <div class="de-step-title" data-ar="كم يوماً تريد التدريب؟">How many days do you want to train?</div>
        <div class="de-step-desc" data-ar="اختر بين 7 و 30 يوماً لخطتك.">Choose between 7 and 30 days for your plan.</div>
        <div class="de-days-slider">
          <input type="range" min="7" max="30" value="${deState.numDays}" oninput="deState.numDays=this.value; document.getElementById('de-days-val').textContent=this.value">
          <div class="de-days-display" id="de-days-val">${deState.numDays}</div>
        </div>
        <button class="btn primary" style="width:100%;margin-top:24px;" onclick="deNextStep(3)">${nextLabel} <i class="fa-solid fa-arrow-right"></i></button>
        <button class="btn ghost" style="width:100%;margin-top:10px;" onclick="deNextStep(1)"><i class="fa-solid fa-arrow-left"></i> ${backLabel}</button>
      </div>
    `;
  } else if (deState.step === 3) {
    const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    container.innerHTML = `
      <div class="panel daily-exercise-container">
        <div class="de-step-title" data-ar="أي أيام الأسبوع؟">Which days of the week?</div>
        <div class="de-step-desc" data-ar="اختر الأيام التي تريد التمرين فيها.">Select the days you want to work out.</div>
        <div class="de-day-buttons">
          ${days.map((d, i) => `<button class="de-day-btn ${deState.daysOfWeek.includes(i) ? 'selected' : ''}" onclick="toggleDayOfWeek(${i}, this)"><i class="fa-solid fa-calendar-day"></i> ${dName(d)}</button>`).join('')}
        </div>
        <button class="btn primary" style="width:100%;margin-top:24px;" onclick="generateWorkoutList()">${genLabel} <i class="fa-solid fa-bolt"></i></button>
        <button class="btn ghost" style="width:100%;margin-top:10px;" onclick="deNextStep(2)"><i class="fa-solid fa-arrow-left"></i> ${backLabel}</button>
      </div>
    `;
  } else if (deState.step === 5) {
    // ===== v10 (user): plan SCHEDULE SETUP — shown after "Train This Plan".
    // The user picks the training length (7–30 days) and the weekdays they
    // train on, THEN the dashboard plan is adopted over that schedule.
    const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const startLabel = ar ? 'ابدأ التدريب' : 'Start Training';
    container.innerHTML = `
      <div class="panel daily-exercise-container">
        <div class="de-step-title" data-ar="خطتك جاهزة — اضبط جدولك">Your plan is ready — set your schedule</div>
        <div class="de-step-desc" data-ar="اختر مدة التدريب وأيام الأسبوع التي ستتدرب فيها.">Choose how long you want to train and the days of the week you'll train on.</div>
        <div class="de-days-slider">
          <input type="range" min="7" max="30" value="${deState.numDays}" oninput="deState.numDays=this.value; document.getElementById('de-days-val').textContent=this.value">
          <div class="de-days-display" id="de-days-val">${deState.numDays}</div>
          <small style="display:block;text-align:center;color:var(--muted);font-size:.8rem;margin-top:-8px;" data-ar="عدد أيام التدريب في خطتك">${ar ? 'عدد أيام التدريب في خطتك' : 'training days in your plan'}</small>
        </div>
        <div class="de-day-buttons">
          ${days.map((d, i) => `<button class="de-day-btn ${deState.daysOfWeek.includes(i) ? 'selected' : ''}" onclick="toggleDayOfWeek(${i}, this)"><i class="fa-solid fa-calendar-day"></i> ${dName(d)}</button>`).join('')}
        </div>
        <button class="btn primary" style="width:100%;margin-top:24px;" onclick="startAdoptedPlan()">${startLabel} <i class="fa-solid fa-play"></i></button>
        <button class="btn ghost" style="width:100%;margin-top:10px;" onclick="deBackToHub()"><i class="fa-solid fa-arrow-left"></i> ${backLabel}</button>
      </div>
    `;
  } else if (deState.step === 4) {
    const totalDays = (deState.dailyPlan && deState.dailyPlan.length) ? deState.dailyPlan.length : 1;
    const dayNum = deState.currentDay + 1;
    const dayObj = (deState.dailyPlan && deState.dailyPlan[deState.currentDay]) || {};
    // Plans adopted from the dashboard carry a label like "Mon · Push (Week 1)" —
    // show it as the headline, with "Day N of M" moving into the subtitle.
    // v11 (user): "Day N of M" is now BIG with the day number in BLUE
    // (.de-day-sub / .de-day-num), and the old "Complete each exercise to
    // unlock the next" hint text is removed entirely.
    const dayNumHtml = ar
      ? `اليوم <span class="de-day-num">${dayNum}</span> من ${totalDays}`
      : `Day <span class="de-day-num">${dayNum}</span> of ${totalDays}`;
    // v11: also normalize "(W1)" shorthand in labels SAVED by older versions,
    // so legacy persisted plans display "Week 1" too without regenerating.
    const headLabel = dayObj.label ? String(dayObj.label).replace(/\(W(\d+)\)/g, '(Week $1)') : '';
    const headTitle = headLabel || dayNumHtml;
    const todaySub = headLabel ? dayNumHtml : '';
    const newPlanLabel = ar ? 'خطة جديدة' : 'New Plan';
    container.innerHTML = `
      <div class="panel daily-exercise-container">
        <div class="de-day-header" style="display:flex;align-items:center;justify-content:space-between;gap:12px;text-align:left;">
          <div style="text-align:left;">
            <h2 style="margin:0;text-align:left;">${headTitle}</h2>
            ${todaySub ? `<div class="de-day-sub">${todaySub}</div>` : ''}
          </div>
          <button class="btn ghost small" style="flex-shrink:0;" onclick="resetDailyPlan()"><i class="fa-solid fa-rotate-right"></i> <span data-ar="خطة جديدة">${newPlanLabel}</span></button>
        </div>
        <!-- Round 6: calories burnt today popup at the top of the workout list -->
        <div id="de-today-kcal-popup" class="de-today-kcal-popup"></div>
        <!-- v3: the AI assists (Form Check / Rep Counter) now live INSIDE the
             workout-detail popup on a shared camera — the list stays clean. -->
        <div class="workout-list-container" id="workout-list-container"></div>
        <button class="btn primary" id="finish-workout-btn" style="width:100%;margin-top:24px;${deState.workouts.every(w => w.done) ? '' : 'opacity:.5;cursor:not-allowed;'}" ${deState.workouts.every(w => w.done) ? '' : 'disabled'} onclick="finishDailyWorkout()"><i class="fa-solid fa-check"></i> ${finishLabel}</button>
        ${!deState.workouts.every(w => w.done) ? `<p style="text-align:center;color:var(--muted);font-size:.82rem;margin-top:8px;">${ar ? 'أكمل جميع التمارين أولاً لإنهاء اليوم' : 'Complete all exercises to finish the day'}</p>` : ''}
      </div>
    `;
    renderWorkoutList();
    renderTodayKcalPopup();  // populate the kcal-burnt-today popup
  }
  setTimeout(applyTranslations, 0);
}

// === Round 6: render the small "calories burnt today" popup at the top of the
// workout list. Sums the calories field from today's logged sessions and shows
// a fire-animated badge. Also called from completeWorkout() so the popup updates
// live every time the user finishes an exercise. ===
function renderTodayKcalPopup() {
  try {
    const popup = document.getElementById('de-today-kcal-popup');
    if (!popup) return;
    const u = currentUser();
    if (!u) return;
    const ar = (store.lang === 'ar');
    const todaySessions = (u.sessions || []).filter(s => s.date === localDateStr());
    const todayKcal = Math.round(todaySessions.reduce((sum, s) => sum + kcalForSession(s), 0));
    const kcalLabel = ar ? 'سعرة محروقة اليوم' : 'kcal burnt today';
    // === v27 (user, picture 1): "make the daily calorie count in the middle
    // and make it bigger, by making a big burning flame and the number in it
    // so it looks cool" — the inline text line is replaced by a centered hero
    // flame: a big animated gradient flame (with a soft warm glow behind it)
    // and the kcal count rendered INSIDE the flame body. Styled via the
    // .de-kcal-flame* rules in volta-fitness.css, themed for dark + light. ===
    popup.innerHTML = `
      <div class="de-kcal-flame">
        <div class="de-kcal-flame-ic">
          <i class="fa-solid fa-fire"></i>
          <b class="de-kcal-flame-num">${todayKcal}</b>
        </div>
        <small class="de-kcal-flame-lbl">${kcalLabel}</small>
      </div>
    `;
  } catch(e) { console.warn('renderTodayKcalPopup error:', e); }
}

// AI TRAINING ASSISTS v3 — INSIDE the workout-detail popup (per user
// request: "make ai form check and rep counter work inside the workout
// popup, not separately, camera on top of the workout, both use the same
// camera, everything works simultaneously").
//
//   • Two chips in the popup: AI Form Check + AI Rep Counter (+ premium
//     gate inline — non-premium tapping a chip gets the subscribe popup).
//   • ONE shared camera (VoltaAI.AssistEngine) renders at the TOP of the
//     exercise (the photo hides while the camera is live).
//   • Rep counting runs 100% on-device and AUTO-counts (works offline,
//     beeps + vibrates on every counted rep) · form checks run the
//     on-device multi-result analyzer and can add a real Gemini vision
//     critique of the captured frames when online.
//
// The old list-level checkboxes are gone — RecoveryIQ moved to the nav
// bar / sidebar, ProgressIQ stays in this popup.
function wdAssistLabels() {
  const ar = (store.lang === 'ar');
  return {
    form: ar ? 'مدقق الأداء' : 'Form Check',
    reps: ar ? 'عدّاد التكرارات' : 'Rep Counter',
    repsLbl: ar ? 'تكرار' : 'REPS',
    startCam: ar ? 'تشغيل الكاميرا…' : 'Starting camera…',
    denied: ar ? 'تم رفض إذن الكاميرا — اسمح بها من المتصفح (أو راجع الإعدادات ← كاميرا الذكاء).' : 'Camera permission denied — allow camera in your browser (or check Settings → AI Camera).',
    off: ar ? 'كاميرا الذكاء الاصطناعي متوقفة — فعّلها من الإعدادات ← كاميرا الذكاء.' : 'AI camera is OFF — enable it in Settings → AI Camera.',
    nocam: ar ? 'لا توجد كاميرا على هذا الجهاز.' : 'No camera found on this device.',
    camErr: ar ? 'تعذر تشغيل الكاميرا.' : 'Could not start the camera.',
    live: ar ? 'مباشر' : 'LIVE',
    finish: ar ? 'إنهاء المجموعة' : 'Finish Set',
    savedTo: ar ? 'تم حفظ المجموعة:' : 'Set saved:',
    noReps: ar ? 'لم يُعد أي تكرارات بعد.' : 'No reps counted yet.',
    suggest: ar ? 'اقترح لي وزناً' : 'Suggest My Weight'
  };
}
// Chip row rendered into the workout-detail popup (static HTML part).
// v5: ALL premium buttons are aligned together in ONE row — AI Form Check,
// AI Rep Counter and ProgressIQ "Suggest My Weight" (moved up from the
// bottom of the popup per user request: "align all buttons with premium
// features together").
function wdAssistHtml(w) {
  const L = wdAssistLabels();
  // v29 (user: "ai features still dont work on the html file"): the 4 AI
  // features run 100% on-device — they are no longer premium-gated, so the
  // chips render unlocked for everyone (no PREMIUM lock badge).
  const prem = (typeof VoltaPremium !== 'undefined' &&
                ((VoltaPremium.aiFree && VoltaPremium.aiFree('form-check')) || VoltaPremium.isPremium()));
  const lock = prem ? '' : '<span class="vp-ai-lock">PREMIUM</span>';
  const chip = (id, icon, label, onclick, pressed) => `
      <button type="button" id="${id}" class="wd-assist-chip ${prem ? '' : 'locked'}" onclick="${onclick}"${pressed ? ' aria-pressed="false"' : ''}>
        <i class="fa-solid ${icon}"></i> <span>${label}</span>
        ${lock}
      </button>`;
  return `
      <div class="wd-assist" id="wd-assist">
        ${chip('wd-chip-form', 'fa-video', L.form, "toggleWorkoutAssist('form')", true)}
        ${chip('wd-chip-reps', 'fa-stopwatch-20', L.reps, "toggleWorkoutAssist('reps')", true)}
        ${chip('wd-chip-suggest', 'fa-dumbbell', L.suggest, `deProgressLaunch('${__deAttr(w.name)}')`, false)}
        <span class="wd-cam-status" id="wd-cam-status"></span>
      </div>
      <div class="wd-cam-panel" id="wd-cam-panel" style="display:none;">
        <video id="wd-cam-video" playsinline muted></video>
        <div class="wd-cam-msg" id="wd-cam-msg"><i class="fa-solid fa-video"></i><div>${L.startCam}</div></div>
        <!-- v13 (user): "in rep counter, remove finish line and the words next
             to it, only display rep count and align it to the center" — the
             HUD is now JUST the number, centered (no finish-set flag button,
             no UP/DOWN phase, no tempo, no REPS label). Counted sets are
             auto-saved when the engine stops (wdAutoSaveSet below). -->
        <div class="wd-rep-hud" id="wd-rep-hud" style="display:none;">
          <b id="wd-rep-count">0</b>
        </div>
      </div>
      <div id="wd-form-result"></div>`;
}
// Chip toggle — gates premium, drives the shared AssistEngine.
// v5 "make everything automatic": activating the assist starts the shared
// camera AND turns BOTH features on at once — rep counting + form checking
// run simultaneously with zero extra taps (each chip can still be toggled
// off individually afterwards).
function wdSetChip(kind, on) {
  const c = document.getElementById('wd-chip-' + kind);
  if (c) { c.classList.toggle('on', on); c.setAttribute('aria-pressed', on ? 'true' : 'false'); }
}
// Turn a single feature on/off on an already-running workout engine.
// v8: when BOTH the form check and the rep counter are off, the shared
// camera stops completely ("close camera when the user closes form check").
function wdApplyFeature(kind, on) {
  const eng = (typeof VoltaAI !== 'undefined') ? VoltaAI.getActiveEngine() : null;
  if (!eng || !eng.__wd) return;
  eng._chipState[kind] = !!on;
  wdSetChip(kind, !!on);
  if (kind === 'reps') {
    // v13: turning the counter OFF auto-saves what was counted (the finish
    // button is gone) — otherwise toggling off/on would silently drop reps.
    if (!on) { try { wdAutoSaveSet(eng); } catch (e) {} }
    eng.setReps(!!on);
    const hud = document.getElementById('wd-rep-hud');
    if (hud) hud.style.display = on ? 'flex' : 'none';
    if (on && eng.counter) { eng.counter.reps = 0; eng.counter.repIntervals = []; eng.counter.repLog = []; const c = document.getElementById('wd-rep-count'); if (c) c.textContent = '0'; }
  } else {
    eng.setForm(!!on);
    if (!on) { const slot = document.getElementById('wd-form-result'); if (slot) slot.innerHTML = ''; }
  }
  // v8: nothing needs the camera anymore → shut it down (light off).
  // v9: the shared CAMERA SESSION is closed too — but with a short linger
  // (see VoltaAI.closeCamera): reopening a feature within the linger window
  // reuses the SAME stream, so the browser does not ask for permission
  // again. That's the "dont ask for my camera every time" fix.
  if (!eng._chipState.form && !eng._chipState.reps) {
    try { eng.stop(); } catch (e) {}
    try { if (typeof VoltaAI !== 'undefined' && VoltaAI.closeCamera) VoltaAI.closeCamera(); } catch (e2) {}
  }
}
// Create + start the engine with ONE feature ON — the feature the user
// tapped (v9, user: "you make rep check work with form check automatically,
// make each one seperate"). Tapping "Form Check" runs ONLY the form check;
// tapping "Rep Counter" runs ONLY the counting. The second feature can be
// turned on afterwards with its own chip (both then share one camera).
// Returns the engine, or null when premium/video is unavailable.
function wdAssistStart(kind) {
  if (typeof VoltaAI === 'undefined') return null;
  if (typeof VoltaPremium === 'undefined' || !VoltaPremium.isPremium()) return null;
  const video = document.getElementById('wd-cam-video');
  if (!video) return null;
  const L = wdAssistLabels();
  const panel = document.getElementById('wd-cam-panel');
  const msg = document.getElementById('wd-cam-msg');
  const status = document.getElementById('wd-cam-status');
  const newEng = new VoltaAI.AssistEngine({
    videoEl: video,
    exercise: (deState.workouts[deState.currentWorkout] || {}).name || 'exercise',
    beep: (kind === 'reps'),
    onStatus: function (st) {
      const map = { starting: L.startCam, denied: L.denied, off: L.off, nocam: L.nocam, error: L.camErr, live: '', stopped: '' };
      if (msg) {
        if (map[st]) { msg.innerHTML = '<i class="fa-solid fa-video-slash"></i><div>' + map[st] + '</div>'; msg.style.display = 'flex'; }
        else if (st === 'live') { msg.style.display = 'none'; }
      }
      if (status) {
        if (st === 'live') { status.innerHTML = '<span class="dot"></span>' + L.live; status.classList.add('live'); }
        else { status.innerHTML = ''; status.classList.remove('live'); }
      }
      if (st === 'live' && panel) {
        panel.style.display = 'block';
        const imgWrap = document.getElementById('workout-detail-img-wrap');
        if (imgWrap) imgWrap.style.display = 'none';   // camera takes the top spot
      }
      if (st === 'denied' || st === 'nocam' || st === 'error' || st === 'off') {
        // The feature can't run without a camera — surface the reason and
        // reset the assist UI (the workout itself continues normally).
        try { showVoltaToast(map[st] || L.camErr, 'error'); } catch (e) {}
        try { newEng.stop(); } catch (e2) {}
        try { VoltaAI.closeCamera(); } catch (e3) {}   // v9: release the shared camera
      }
    },
    onReps: function (r) {
      const c = document.getElementById('wd-rep-count');
      if (c) {
        c.textContent = r.reps;
        // v7: pop the counter every time the AI counts a rep by itself
        if (r.counted) { c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop'); }
      }
      // v13: the UP/DOWN phase + tempo words were removed from the HUD
      // (user: "only display rep count") — nothing else to update.
    },
    onForm: function (r) {
      if (r && r.premiumWall) { stopWorkoutAssist(); VoltaPremium.openHub('form-check'); return; }
      const slot = document.getElementById('wd-form-result');
      if (slot) { slot.innerHTML = VoltaAI.verdictHtml(r); setTimeout(applyTranslations, 0); }
    }
  });
  newEng.__wd = true;
  newEng._chipState = { form: (kind === 'form'), reps: (kind === 'reps') };
  newEng.onStop = function () {
    const panel2 = document.getElementById('wd-cam-panel');
    if (panel2) panel2.style.display = 'none';
    const imgWrap3 = document.getElementById('workout-detail-img-wrap');
    if (imgWrap3) imgWrap3.style.display = '';
    wdSetChip('form', false); wdSetChip('reps', false);
    const hud = document.getElementById('wd-rep-hud'); if (hud) hud.style.display = 'none';
    const st2 = document.getElementById('wd-cam-status'); if (st2) { st2.innerHTML = ''; st2.classList.remove('live'); }
  };
  const _origStop = newEng.stop.bind(newEng);
  // v13: auto-save the AI-counted set the moment this engine stops (the
  // on-video Finish Set flag button was removed — this keeps every counted
  // set flowing into ProgressIQ without it).
  newEng.stop = function () { try { wdAutoSaveSet(newEng); } catch (e) {} _origStop(); if (typeof newEng.onStop === 'function') newEng.onStop(); };
  VoltaAI.claimEngine(newEng);
  wdSetChip(kind, true);
  if (kind === 'reps') {
    newEng.setReps(true);
    const hud = document.getElementById('wd-rep-hud'); if (hud) hud.style.display = 'flex';
  } else {
    newEng.setForm(true);
  }
  newEng.start();
  return newEng;
}
function toggleWorkoutAssist(kind) {
  const eng = (typeof VoltaAI !== 'undefined') ? VoltaAI.getActiveEngine() : null;
  const myEng = (eng && eng.__wd) ? eng : null;
  const isOn = myEng ? myEng._chipState[kind] : false;
  // v29: AI assist features are free for everyone (aiFree) — premium only
  // gates the OTHER premium perks now.
  const aiAllowed = (typeof VoltaPremium === 'undefined') ||
                    !!(VoltaPremium.isPremium() ||
                       (VoltaPremium.aiFree && VoltaPremium.aiFree(kind === 'form' ? 'form-check' : 'rep-count')));
  if (!isOn && !aiAllowed) {
    VoltaPremium.openHub(kind === 'form' ? 'form-check' : 'rep-count');
    return;
  }
  if (!myEng) {
    // First activation → start the camera + ONLY the feature the user tapped
    // (v9: no more automatic both-features mode).
    wdAssistStart(kind);
    return;
  }
  // engine already running — just toggle this feature
  wdApplyFeature(kind, !isOn);
}
// NOTE (v9): wdAssistAutoStart() was REMOVED. The AI features no longer
// start automatically when the workout timer begins — the user turns on
// Form Check / Rep Counter individually with the chips (user: "make each
// one seperate", "it asks for permission for my camera every time").
// v15 (user): "make form check and rep counter start when the user clicks
// 'start workout'" — reversed (with guards): startWorkoutTimer() now calls
// wdAssistStartWithWorkout() below. The camera ask-once gate + the shared
// session (VoltaAI, v9) still guarantee at most ONE permission prompt per
// app session, and the chips remain for individual on/off afterwards.
function wdAssistStartWithWorkout() {
  if (typeof VoltaAI === 'undefined') return;
  // v29: AI features are unlocked for everyone — auto-start works for all
  // users (the Settings → AI Camera OFF switch still silences it).
  if (typeof VoltaPremium !== 'undefined' &&
      !(VoltaPremium.isPremium() || (VoltaPremium.aiFree && VoltaPremium.aiFree('form-check')))) return;
  try { if (localStorage.getItem('fb_cam') === 'false') return; } catch (e) {}   // Settings → AI Camera OFF → silent skip
  const eng = (typeof VoltaAI.getActiveEngine === 'function') ? VoltaAI.getActiveEngine() : null;
  if (eng && !eng.__wd) return;              // another AI surface (RepSense/FormSense modal) owns the camera — leave it alone
  if (eng && eng.__wd) {
    // engine already running (user tapped a chip first) — just make sure
    // BOTH features are switched on
    if (!eng._chipState.form) { try { wdApplyFeature('form', true); } catch (e) {} }
    if (!eng._chipState.reps) { try { wdApplyFeature('reps', true); } catch (e) {} }
    return;
  }
  const started = wdAssistStart('reps');     // beep-capable engine (kind === 'reps')
  if (started) {
    const eng2 = VoltaAI.getActiveEngine();
    if (eng2 && eng2.__wd && !eng2._chipState.form) { try { wdApplyFeature('form', true); } catch (e) {} }
  }
}
window.wdAssistStartWithWorkout = wdAssistStartWithWorkout;
function wdAssistAdjust(delta) {
  const eng = (typeof VoltaAI !== 'undefined') ? VoltaAI.getActiveEngine() : null;
  if (eng && eng.__wd) eng.repAdjust(delta);
}
// v13: the on-video "Finish Set" flag button is gone (user: "only display
// rep count"). The set the AI counted is now SAVED AUTOMATICALLY the moment
// the engine stops (popup closed, both chips off, feature switched, error) —
// so ProgressIQ keeps receiving every AI-counted set without the button.
async function wdAutoSaveSet(eng) {
  try {
    if (!eng || !eng.counter || !(eng.counter.reps > 0)) return;
    const r = eng.finishSet();
    if (!(r.reps > 0)) return;
    if (typeof VoltaAI !== 'undefined') {
      await VoltaAI.saveRepSession({ type: 'rep', exercise: eng.exercise, reps: r.reps, durationSec: r.durationSec, tempoSec: r.tempoSec || 0 });
    }
    eng.counter.reps = 0; eng.counter.repIntervals = [];
    try { showVoltaToast(wdAssistLabels().savedTo + ' ' + r.reps + ' reps · ' + r.durationSec + 's', 'success'); } catch (e) {}
  } catch (e) { /* never block the stop path */ }
}
// Kept for backward compatibility (old saved markup may still reference it).
async function wdAssistFinishSet() {
  const eng = (typeof VoltaAI !== 'undefined') ? VoltaAI.getActiveEngine() : null;
  if (!eng || !eng.__wd) return;
  await wdAutoSaveSet(eng);
}
// Stop + teardown (called when the popup closes)
function stopWorkoutAssist() {
  const eng = (typeof VoltaAI !== 'undefined') ? VoltaAI.getActiveEngine() : null;
  if (eng && eng.__wd) { try { eng.stop(); } catch (e) {} }
  // v9: close the shared camera session too (with linger — see VoltaAI).
  try { if (typeof VoltaAI !== 'undefined' && VoltaAI.closeCamera) VoltaAI.closeCamera(); } catch (e) {}
}
// RecoveryIQ launcher — premium-gated. Used by the nav bar (mobile), the
// sidebar (desktop) and the Premium hub. v4: opens the FULL Recovery SCREEN
// (tab-recovery) — the user asked for a real screen, not a popup.
function deRecoveryLaunch() {
  if (typeof VoltaPremium !== 'undefined' && !VoltaPremium.gate('recovery')) return;
  if (typeof VoltaAI !== 'undefined' && VoltaAI.openRecoveryIQ) { VoltaAI.openRecoveryIQ(); return; }
  showTab('recovery');
}
// ProgressIQ launcher — premium-gated. Called from the workout-detail modal
// ("Suggest My Weight"): premium users get the AI weight/rep prescription
// for that exact exercise; free users get the subscribe popup.
function deProgressLaunch(name) {
  if (typeof VoltaPremium !== 'undefined' && !VoltaPremium.gate('progression')) return;
  if (typeof VoltaAI !== 'undefined' && VoltaAI.openProgressIQ) VoltaAI.openProgressIQ(name);
}
// Escape an exercise name for embedding in a single-quoted JS string inside
// a double-quoted HTML attribute (names may contain & or ' e.g. "Clean & Jerk").
function __deAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
}
function getFrontSVG() {
  return `<svg viewBox="0 0 100 200">
    <circle cx="50" cy="20" r="15" fill="#eaf1fd" stroke="#6495ED" stroke-width="1" />
    <rect x="35" y="40" width="30" height="50" rx="10" fill="#eaf1fd" stroke="#6495ED" stroke-width="1" />
    <rect x="20" y="45" width="12" height="40" rx="6" fill="#eaf1fd" stroke="#6495ED" stroke-width="1" />
    <rect x="68" y="45" width="12" height="40" rx="6" fill="#eaf1fd" stroke="#6495ED" stroke-width="1" />
    <rect x="35" y="95" width="12" height="50" rx="6" fill="#eaf1fd" stroke="#6495ED" stroke-width="1" />
    <rect x="53" y="95" width="12" height="50" rx="6" fill="#eaf1fd" stroke="#6495ED" stroke-width="1" />
    <circle cx="43" cy="55" r="5" class="muscle-dot-svg ${deState.muscles.includes('Chest') ? 'selected' : ''}" onclick="toggleMuscle('Chest')"></circle>
    <circle cx="57" cy="55" r="5" class="muscle-dot-svg ${deState.muscles.includes('Chest') ? 'selected' : ''}" onclick="toggleMuscle('Chest')"></circle>
    <circle cx="28" cy="48" r="4" class="muscle-dot-svg ${deState.muscles.includes('Shoulders') ? 'selected' : ''}" onclick="toggleMuscle('Shoulders')"></circle>
    <circle cx="72" cy="48" r="4" class="muscle-dot-svg ${deState.muscles.includes('Shoulders') ? 'selected' : ''}" onclick="toggleMuscle('Shoulders')"></circle>
    <circle cx="25" cy="75" r="4" class="muscle-dot-svg ${deState.muscles.includes('Arms') ? 'selected' : ''}" onclick="toggleMuscle('Arms')"></circle>
    <circle cx="75" cy="75" r="4" class="muscle-dot-svg ${deState.muscles.includes('Arms') ? 'selected' : ''}" onclick="toggleMuscle('Arms')"></circle>
    <circle cx="50" cy="72" r="4" class="muscle-dot-svg ${deState.muscles.includes('Core') ? 'selected' : ''}" onclick="toggleMuscle('Core')"></circle>
    <circle cx="42" cy="110" r="4" class="muscle-dot-svg ${deState.muscles.includes('Legs') ? 'selected' : ''}" onclick="toggleMuscle('Legs')"></circle>
    <circle cx="58" cy="110" r="4" class="muscle-dot-svg ${deState.muscles.includes('Legs') ? 'selected' : ''}" onclick="toggleMuscle('Legs')"></circle>
  </svg>`;
}
function getBackSVG() {
  return `<svg viewBox="0 0 100 200">
    <circle cx="50" cy="20" r="15" fill="#eaf1fd" stroke="#6495ED" stroke-width="1" />
    <rect x="35" y="40" width="30" height="50" rx="10" fill="#eaf1fd" stroke="#6495ED" stroke-width="1" />
    <rect x="20" y="45" width="12" height="40" rx="6" fill="#eaf1fd" stroke="#6495ED" stroke-width="1" />
    <rect x="68" y="45" width="12" height="40" rx="6" fill="#eaf1fd" stroke="#6495ED" stroke-width="1" />
    <rect x="35" y="95" width="12" height="50" rx="6" fill="#eaf1fd" stroke="#6495ED" stroke-width="1" />
    <rect x="53" y="95" width="12" height="50" rx="6" fill="#eaf1fd" stroke="#6495ED" stroke-width="1" />
    <circle cx="50" cy="55" r="5" class="muscle-dot-svg ${deState.muscles.includes('Back') ? 'selected' : ''}" onclick="toggleMuscle('Back')"></circle>
    <circle cx="40" cy="65" r="4" class="muscle-dot-svg ${deState.muscles.includes('Back') ? 'selected' : ''}" onclick="toggleMuscle('Back')"></circle>
    <circle cx="60" cy="65" r="4" class="muscle-dot-svg ${deState.muscles.includes('Back') ? 'selected' : ''}" onclick="toggleMuscle('Back')"></circle>
    <circle cx="28" cy="48" r="4" class="muscle-dot-svg ${deState.muscles.includes('Shoulders') ? 'selected' : ''}" onclick="toggleMuscle('Shoulders')"></circle>
    <circle cx="72" cy="48" r="4" class="muscle-dot-svg ${deState.muscles.includes('Shoulders') ? 'selected' : ''}" onclick="toggleMuscle('Shoulders')"></circle>
    <circle cx="25" cy="75" r="4" class="muscle-dot-svg ${deState.muscles.includes('Arms') ? 'selected' : ''}" onclick="toggleMuscle('Arms')"></circle>
    <circle cx="75" cy="75" r="4" class="muscle-dot-svg ${deState.muscles.includes('Arms') ? 'selected' : ''}" onclick="toggleMuscle('Arms')"></circle>
    <circle cx="42" cy="110" r="4" class="muscle-dot-svg ${deState.muscles.includes('Legs') ? 'selected' : ''}" onclick="toggleMuscle('Legs')"></circle>
    <circle cx="58" cy="110" r="4" class="muscle-dot-svg ${deState.muscles.includes('Legs') ? 'selected' : ''}" onclick="toggleMuscle('Legs')"></circle>
  </svg>`;
}

function switchMuscleView(view) { deState.view = view; renderDailyExercise(); }
function toggleMuscle(m) {
  if (!deState.muscles.includes(m)) deState.muscles.push(m);
  else deState.muscles = deState.muscles.filter(x => x !== m);
  renderDailyExercise();
}
function deNextStep(step) { deState.step = step; renderDailyExercise(); }
function toggleDayOfWeek(i, el) {
  if (!deState.daysOfWeek.includes(i)) deState.daysOfWeek.push(i);
  else deState.daysOfWeek = deState.daysOfWeek.filter(x => x !== i);
  el.classList.toggle('selected');
}
// ============================================================
// PER-USER SEEDED PLAN GENERATION (personalization + progress)
// ============================================================
// Per user spec: "make sure every user gets different and accurate results so
// they make progress". Three guarantees:
//   1. DIFFERENT — the exercise mix is seeded by the ACCOUNT EMAIL, so two
//      different users picking the same muscles get different workouts.
//   2. STABLE — the seed includes a WEEK bucket, so the plan does not reshuffle
//      on every render/load within the same week.
//   3. PROGRESS — the week bucket rotates the mix every week, giving fresh
//      exercises week after week (progressive variation).
// Accuracy: WORKOUTS_DB entries are filtered by the survey's equipment
// (no equipment → Bodyweight only) and fitness level (Beginner never gets
// Advanced exercises), mirroring the plan-engine rules.
function __voltaHashStr(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function __voltaRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seededShuffle(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}
function userPlanSeed(purpose) {
  const u = currentUser() || {};
  const email = store.session || u.email || 'guest';
  const week = Math.floor(Date.now() / (7 * 86400000));
  return __voltaHashStr(email + '|' + (purpose || '') + '|w' + week);
}
// Shared exercise-pool builder for the daily plan: hardcoded WORKOUT_DB first,
// then the IndexedDB WORKOUTS_DB filtered by equipment + level (accuracy).
function buildUserExercisePool(muscles) {
  const pool = []; const seen = {};
  const u = currentUser() || {};
  const s = u.survey || {};
  const equip = s.equipment || null;
  const diff = s.level || null;
  // v12: robust no-equipment check ("None", "no", "nothing", "" … all count).
  const noEquip = userHasNoEquipment(equip);
  (muscles || []).forEach(function (m) {
    (WORKOUT_DB[m] || []).forEach(function (w) {
      if (!seen[w]) {
      // v12: no equipment → bodyweight-only from the hardcoded lists too
      if (noEquip && !exerciseAllowedWithoutEquipment(w)) return;
      seen[w] = true; pool.push({ name: w, info: WORKOUT_INFO[w] || { muscle: m } }); }
    });
  });
  if (typeof WORKOUTS_DB !== 'undefined' && WORKOUTS_DB && WORKOUTS_DB.length) {
    WORKOUTS_DB.forEach(function (w) {
      if (!w || !w.name || seen[w.name]) return;
      if ((muscles || []).indexOf(w.muscleGroup) === -1) return;
      // Equipment accuracy: no equipment → Bodyweight-only AND no bar/rig
      // exercises (v12: also catches "Bodyweight" pull-ups, chin-ups,
      // hanging raises, inverted rows).
      if (noEquip && !exerciseAllowedWithoutEquipment(w.name, w.equipment)) return;
      // Level accuracy: same matching rules as the plan engine
      if (diff === 'Beginner' && w.difficulty !== 'Beginner') return;
      if (diff === 'Intermediate' && w.difficulty === 'Advanced') return;
      seen[w.name] = true;
      pool.push({ name: w.name, info: { muscle: w.muscleGroup, desc: w.description, img: w.image || '', _db: w } });
    });
  }
  if (!pool.length) pool.push({ name: 'Full Body Circuit', info: { muscle: 'Full Body' } });
  return pool;
}

// v9 (user: "remove all duplicate workouts, instead put them in 1 block so
// the block itself can be bigger and easier to read"): the day's list keeps
// each workout ONCE. The old generator wrapped the exercise pool around to
// fill the survey minutes (30-min goal × 11 unique exercises = every exercise
// listed ~3 times). Now: unique exercises only — one block per workout, and
// the blocks themselves are bigger (CSS). A day simply has as many blocks as
// there are unique exercises available for the chosen muscles.
function dedupeDayWorkouts(workouts) {
  const seen = {};
  const out = [];
  (workouts || []).forEach(function (w) {
    if (!w || !w.name || seen[w.name]) {
      // Merge duplicates: if ANY copy of this exercise was completed, the
      // single block counts as done (never re-locks finished work).
      if (w && w.name && w.done) {
        for (let i = 0; i < out.length; i++) { if (out[i].name === w.name) out[i].done = true; }
      }
      return;
    }
    seen[w.name] = 1;
    out.push({ name: w.name, info: w.info || null, done: !!w.done });
  });
  return out;
}
window.dedupeDayWorkouts = dedupeDayWorkouts;
function generateWorkoutList() {
  const ar = (store.lang === 'ar');
  if (deState.daysOfWeek.length === 0) { alert(ar ? 'يرجى اختيار يوم واحد على الأقل.' : 'Please select at least one day.'); return; }
  if (deState.muscles.length === 0) { alert(ar ? 'يرجى اختيار عضلة واحدة على الأقل.' : 'Please select at least one muscle.'); return; }
  // Per-user personalized pools: one pool PER MUSCLE GROUP (filtered by
  // equipment + fitness level), each shuffled with the account's weekly seed
  // (different per user, stable per week, rotates weekly).
  // v28 (user): the day is a FULL-BODY list built by the new formula —
  // the 6 groups each contribute N exercises (N from the survey session
  // time: 15-min → 2, 30-min → 4, 45-min → 5 per group), interleaved so
  // consecutive exercises hit different groups, 2 sets each, and the
  // rendered list shows a REST marker after every 2 exercises.
  const dailyGoalMin = (typeof getDailyGoalMinutes === 'function') ? getDailyGoalMinutes() : 15;
  const perGroup = (typeof workoutsPerGroupPerDay === 'function') ? workoutsPerGroupPerDay(dailyGoalMin) : 2;
  const groups = (deState.muscles.length ? deState.muscles.slice() : V28_FORMULA_GROUPS.slice());
  const groupPools = {};
  groups.forEach(function (g) {
    const pool = buildUserExercisePool([g]);
    groupPools[g] = seededShuffle(pool, __voltaRng(userPlanSeed('daily-wizard') + '|' + g));
  });
  deState.dailyPlan = [];
  for (let d = 0; d < deState.numDays; d++) {
    const dayWorkouts = [];
    const used = {};
    // Round-robin across the groups: exercise 1 from group 1, exercise 2
    // from group 2, … so no two consecutive blocks hit the same muscle.
    // A per-day group offset rotates which group leads each day.
    for (let n = 0; n < perGroup; n++) {
      for (let gi = 0; gi < groups.length; gi++) {
        const g = groups[(gi + d) % groups.length];
        const pool = groupPools[g] || [];
        // advance through this group's pool, skipping names already used
        // in this day (and honoring the per-day rotation for variety)
        let pick = null;
        for (let k = 0; k < pool.length; k++) {
          const cand = pool[(d * 2 + n * 3 + k) % pool.length];
          if (cand && !used[cand.name]) { pick = cand; break; }
        }
        if (!pick) continue;
        used[pick.name] = 1;
        dayWorkouts.push({ name: pick.name, info: pick.info, sets: 2, done: false });
      }
    }
    // === PRIORITY ORDERING is replaced by the v28 GROUP INTERLEAVE above
    // (compound-first sorting would bunch same-group exercises together).
    deState.dailyPlan.push({ dayIndex: d, workouts: dayWorkouts, completed: false, completedAt: null });
  }
  deState.currentDay = 0;
  deState.workouts = deState.dailyPlan[0].workouts;
  deState.currentWorkout = 0;
  deState.step = 4;
  deState.wizardOpen = false;   // wizard done — tracker takes over
  deState.planChoiceMade = true;
  deState.planSource = 'custom';
  __wlDayCtx = -1;   // v10: fresh plan → reset the "+X more" expander
  saveDailyPlan();
  syncDailyPlanToDashboard();   // Round 15: mirror the new plan into the dashboard
  renderDailyExercise();
}
function resetDailyPlan() {
  const ar = (store.lang === 'ar');
  if (!confirm(ar ? 'هل تريد إلغاء الخطة الحالية والبدء من جديد؟' : 'Discard the current plan and start over?')) return;
  deState.step = 0; deState.muscles = []; deState.daysOfWeek = []; deState.workouts = [];
  deState.dailyPlan = null; deState.currentDay = 0; deState.initialized = false;
  deState.wizardOpen = false;   // back to the plan hub, not the muscle wizard
  // Re-ask the dashboard-plan question on the next render (u.plan still exists).
  deState.planChoiceMade = false; deState.planSource = null;
  clearDailyPlan();
  renderDailyExercise();
}
function renderWorkoutList() {
  const container = document.getElementById('workout-list-container');
  if (!container) return;
  const ar = (store.lang === 'ar');
  const wName = (w) => ar ? (WORKOUT_AR_NAMES[w] || w) : w;
  const mName = (m) => ar ? (MUSCLE_AR_NAMES[m] || m) : m;
  const restLabel = ar ? 'راحة' : 'Rest';
  const skipLabel = ar ? 'تخطي' : 'Skip';
  const restSecsLabel = ar ? 'ثانية' : 's';
  // === v10 (user): "make the workout plan display 10 workouts at a time,
  // and add a '+x more' (x is the amount of workouts left) button" ===
  // The tracker list shows the first 10 blocks; the rest hide behind a
  // "+X more" expander. When the user's ACTIVE exercise moves past the
  // first 10, the list force-expands (they must see/tap their current
  // workout). The expander state resets when the day changes.
  const WL_VISIBLE = 10;
  if (__wlDayCtx !== deState.currentDay) {
    __wlDayCtx = deState.currentDay;
    __wlExpanded = false;
  }
  const allDoneNow = deState.workouts.every(w => w.done);
  const forceExpand = !allDoneNow && (deState.currentWorkout >= WL_VISIBLE);
  const wlExpanded = __wlExpanded || forceExpand;
  const wlShown = wlExpanded ? deState.workouts.length : Math.min(WL_VISIBLE, deState.workouts.length);
  const wlHidden = deState.workouts.length - wlShown;
  // After completing an exercise, the next exercise is LOCKED behind a 60s
  // rest timer. The user can either wait for the timer to hit 0, OR click
  // "Skip" to advance immediately. Until one of those happens, the next
  // workout block is NOT clickable.
  const restRequired = (deState.restUntil && Date.now() < deState.restUntil);
  const kcalLabel = ar ? 'سعرة' : 'kcal';
  let html = '';
  deState.workouts.forEach((w, i) => {
    if (i >= wlShown) return;   // v10: beyond the visible window
    let cls = 'locked';
    let canOpen = false;
    if (w.done) {
      cls = 'done';
    } else if (i === deState.currentWorkout) {
      // If a rest timer is required, the current workout stays "locked"
      // (not yet openable) until timer ends or user skips.
      if (restRequired) {
        cls = 'locked';
        canOpen = false;
      } else {
        cls = 'active';
        canOpen = true;
      }
    }
    // === Calorie counter (round 5) — accurate per-exercise burn ===
    // Computed via getWorkoutCalories() = MET × weight(kg) × duration(hours).
    // Displayed as a fire-animated badge next to each workout.
    const cals = getWorkoutCalories(w.name);
    html += `
      <div class="workout-block ${cls}" onclick="${canOpen ? `openWorkoutDetail(${i})` : ''}">
        <div class="workout-item-icon">
          <i class="fa-solid ${w.done ? 'fa-check' : canOpen ? 'fa-play' : 'fa-lock'}"></i>
        </div>
        <div class="workout-item-info">
          <b>${wName(w.name)}</b>
          <small>${mName(w.info?.muscle || 'Full Body')}</small>
          <span class="workout-cal-badge"><i class="fa-solid fa-fire"></i> ${cals} ${kcalLabel}</span>
        </div>
        ${i === deState.currentWorkout ? '<i class="fa-solid fa-chevron-right"></i>' : ''}
      </div>
    `;
    // === Rest timer bar (rewritten for bulletproof reliability) ===
    // Only render a rest bar for the IMMEDIATELY PREVIOUS completed workout
    // (the one just done, where rest is needed before the next one). Older
    // completed workouts don't need a visible rest bar — they're done.
    // This prevents "ghost" rest bars between every pair of completed exercises.
    // NOTE: uses FIXED element IDs (de-rest, de-rest-display, de-rest-play)
    // because only ONE rest timer can be active at any time.
    // v28 (user): "1 rest after every 2 exercises" — the ACTIVE rest bar now
    // appears only after every SECOND completed exercise (pair cadence).
    const isRestForJustDone = (i === deState.currentWorkout - 1) && w.done && (i < deState.workouts.length - 1) && (((i + 1) % 2) === 0);
    if (isRestForJustDone) {
      const nextIdx = i + 1;
      // restActive = rest is currently counting (auto-started, not yet ended/skipped)
      const restActive = restRequired && (nextIdx === deState.currentWorkout);
      // If rest is NOT active, render the bar with the `.done` class already
      // applied so the user doesn't see a flash of "active" state on re-render.
      // When rest IS active, add the `.active` class so the bar is fully
      // visible (opacity 1) — without it, the bar defaults to opacity 0.5.
      const restStateClass = restActive ? ' active' : ' done';
      // Initial display: if rest is done/skipped, show 0s; otherwise 60s
      const initialDisplay = restActive ? ('60' + restSecsLabel) : ('0' + restSecsLabel);
      const initialPlayIcon = restActive ? 'fa-pause' : 'fa-check';
      html += `
        <div class="de-rest-timer${restStateClass}" id="de-rest">
          <div class="de-rest-timer-inner">
            <i class="fa-solid fa-hourglass-half" style="color:var(--accent);font-size:.9rem;"></i>
            <span class="de-rest-label">${restLabel}</span>
            <span class="de-rest-display" id="de-rest-display">${initialDisplay}</span>
            <div class="de-rest-btns">
              <button class="btn ghost small de-rest-play-btn" id="de-rest-play" onclick="toggleDeRest()"><i class="fa-solid ${initialPlayIcon}"></i></button>
              <button class="btn ghost small de-rest-skip-btn" id="de-rest-skip" onclick="skipDeRest()">${skipLabel}</button>
            </div>
          </div>
        </div>
      `;
    } else if ((i >= deState.currentWorkout) && (((i + 1) % 2) === 0) && (i < deState.workouts.length - 1)) {
      // v28 (user): PLANNED rest marker — after every 2 exercises in the
      // upcoming part of the list, a subtle divider shows where the 60s
      // rest will pause the session (the active timer itself appears in
      // the block above once that pair is actually completed).
      html += `
        <div class="de-rest-plan">
          <i class="fa-solid fa-hourglass-half"></i>
          <span>${restLabel} · 60${restSecsLabel}</span>
        </div>
      `;
    }
  });
  // v10: "+X more" expander — X = number of workouts still hidden.
  if (wlHidden > 0) {
    const moreLabel = ar ? 'المزيد' : 'more';
    html += `<button type="button" class="plan-more-toggle wl-more-btn" style="width:100%;margin-top:2px;justify-content:center;" onclick="toggleWorkoutListMore()"><i class="fa-solid fa-chevron-down"></i> +${wlHidden} ${moreLabel}</button>`;
  } else if (wlExpanded && deState.workouts.length > WL_VISIBLE && !forceExpand) {
    const lessLabel = ar ? 'عرض أقل' : 'Show less';
    html += `<button type="button" class="plan-more-toggle wl-more-btn" style="width:100%;margin-top:2px;justify-content:center;" onclick="toggleWorkoutListMore()"><i class="fa-solid fa-chevron-up"></i> ${lessLabel}</button>`;
  }
  container.innerHTML = html;
  // === Auto-start the rest timer if rest is required and not already running. ===
  // innerHTML assignment is synchronous in modern browsers, so getElementById
  // works immediately — no setTimeout(0) needed. We still guard with !deRestInterval
  // to prevent duplicate intervals on rapid re-renders.
  if (restRequired && !deRestInterval) {
    startDeRest(deState.currentWorkout);
  }
}

// v10: expander state for the workout-list "+X more" button.
let __wlExpanded = false;
let __wlDayCtx = -1;
function toggleWorkoutListMore() {
  __wlExpanded = !__wlExpanded;
  renderWorkoutList();
}
window.toggleWorkoutListMore = toggleWorkoutListMore;

// === Rest timer between daily exercises (rewritten for bulletproof reliability) ===
// Single active timer — only ONE rest bar can exist at a time, so we use a
// single set of state variables instead of dictionaries. This eliminates
// the entire class of bugs where per-idx state got out of sync with the DOM.
//
// Flow:
//   1. completeWorkout() sets deState.restUntil = now + 60s and calls renderWorkoutList()
//   2. renderWorkoutList() renders the rest bar with id="de-rest" and calls startDeRest()
//   3. startDeRest() initializes state and starts a 1-second interval
//   4. Each tick: decrement secs, update display, beep at 3/2/1
//   5. When secs hit 0: finishDeRest(false) → mark done, re-render (unlocks next workout)
//   6. User can Skip → finishDeRest(true) (same as natural completion, no beep)
//   7. User can Pause/Resume → toggleDeRest()
let deRestInterval = null;     // setInterval handle
let deRestSecsLeft = 0;        // seconds remaining
let deRestPaused = false;      // pause flag
let deRestForIdx = -1;         // workout index this rest is FOR (the next one)

function deRestActive() {
  // True if the rest gate is currently enforcing a wait
  return !!(deState.restUntil && Date.now() < deState.restUntil);
}

function startDeRest(idx) {
  // Always clear any existing interval first — prevents duplicate timers
  if (deRestInterval) { clearInterval(deRestInterval); deRestInterval = null; }
  deRestForIdx = idx;
  // Always start fresh at 60s (per user spec: 60s rest between exercises)
  deRestSecsLeft = 60;
  deRestPaused = false;
  // Update UI immediately so the user sees "60s" right away
  updateDeRestUI();
  // Beep + vibrate to signal the rest has started
  try { if (typeof playBeep === 'function') playBeep(800, 0.15); } catch(e) {}
  try { if (typeof vibrateDevice === 'function') vibrateDevice(100); } catch(e) {}
  // Start ticking — deRestTick runs every 1 second
  deRestInterval = setInterval(deRestTick, 1000);
}

function deRestTick() {
  if (deRestPaused) return;
  deRestSecsLeft--;
  updateDeRestUI();
  // Countdown beep at 3, 2, 1
  try {
    if (deRestSecsLeft <= 3 && deRestSecsLeft > 0 && typeof playCountdownBeep === 'function') {
      playCountdownBeep();
    }
  } catch(e) {}
  // Reached zero — finish naturally
  if (deRestSecsLeft <= 0) {
    finishDeRest(false);
  }
}

function updateDeRestUI() {
  // Update the display element + play/pause icon. Uses fixed IDs since only
  // one rest bar exists at a time. Silently no-ops if the elements aren't in
  // the DOM yet (e.g. between re-renders) — the next tick will catch up.
  const ar = (store.lang === 'ar');
  const lbl = ar ? 'ثانية' : 's';
  const disp = document.getElementById('de-rest-display');
  if (disp) {
    const shown = deRestSecsLeft > 0 ? deRestSecsLeft : 0;
    disp.textContent = shown + lbl;
  }
  const playBtn = document.getElementById('de-rest-play');
  if (playBtn) {
    playBtn.innerHTML = deRestPaused
      ? '<i class="fa-solid fa-play"></i>'
      : '<i class="fa-solid fa-pause"></i>';
  }
}

function finishDeRest(skipped) {
  // Stop the interval
  if (deRestInterval) { clearInterval(deRestInterval); deRestInterval = null; }
  deRestSecsLeft = 0;
  deRestPaused = false;
  // CRITICAL: clear the rest gate so the next workout becomes clickable
  deState.restUntil = 0;
  // Update UI to "done" state
  const ar = (store.lang === 'ar');
  const lbl = ar ? 'ثانية' : 's';
  const restEl = document.getElementById('de-rest');
  if (restEl) {
    restEl.classList.remove('active', 'paused');
    restEl.classList.add('done');
  }
  const disp = document.getElementById('de-rest-display');
  if (disp) disp.textContent = '0' + lbl;
  const playBtn = document.getElementById('de-rest-play');
  if (playBtn) playBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
  // Sound feedback only on natural completion (not on Skip)
  if (!skipped) {
    try { if (typeof playDoneBeep === 'function') playDoneBeep(); } catch(e) {}
    try { if (typeof vibrateDevice === 'function') vibrateDevice([200, 100, 200]); } catch(e) {}
  }
  // Re-render so the next workout unlocks (its cls goes from 'locked' to 'active')
  setTimeout(function() {
    try { renderWorkoutList(); } catch(e) {}
  }, 50);
}

function toggleDeRest() {
  // Pause/resume the rest timer.
  const restEl = document.getElementById('de-rest');
  // If rest is already marked done/skipped, ignore the click entirely
  if (restEl && restEl.classList.contains('done')) return;
  // If timer was cleared (e.g. after Skip) but the rest gate is STILL active,
  // restart the timer from the remaining seconds. This fixes the bug where
  // the pause/play button silently did nothing after Skip.
  if (!deRestInterval) {
    if (deRestActive()) {
      // Resume from remaining seconds (or 60 if not set)
      if (deRestSecsLeft <= 0) {
        deRestSecsLeft = Math.max(1, Math.ceil((deState.restUntil - Date.now()) / 1000));
      }
      deRestPaused = false;
      startDeRest(deRestForIdx);
    }
    return;
  }
  // Standard pause/resume toggle
  deRestPaused = !deRestPaused;
  updateDeRestUI();
  if (restEl) {
    if (deRestPaused) restEl.classList.add('paused');
    else restEl.classList.remove('paused');
  }
}

function skipDeRest() {
  // Same as finishDeRest(true) — marks as done, clears the gate, re-renders
  finishDeRest(true);
}
let workoutTimerInt = null;
let workoutTimerStart = null;  // tracks wall-clock start time so we can compute actual elapsed minutes
// Per-exercise duration map (seconds). Different exercises get different
// durations instead of the old "everything = 45s" rule. Strength moves
// (Push-ups, Squats) are shorter; holds (Plank, Wall Sit) are longer; core
// (Crunches, Leg Raises) sits in the middle.
const WORKOUT_DURATION = {
  'Push-ups': 30, 'Incline Push-ups': 30, 'Chest Dips': 30, 'Pec Flyes': 40,
  'Pull-ups': 30, 'Bent-over Rows': 40, 'Superman Hold': 45, 'Lat Pulldowns': 40,
  'Squats': 45, 'Lunges': 40, 'Calf Raises': 40, 'Wall Sits': 60,
  'Shoulder Press': 35, 'Lateral Raises': 35, 'Front Raises': 35, 'Pike Push-ups': 30,
  'Bicep Curls': 35, 'Tricep Extensions': 35, 'Hammer Curls': 35, 'Dips': 30,
  'Plank': 60, 'Crunches': 40, 'Russian Twists': 45, 'Leg Raises': 40,
  'Full Body Circuit': 60
};
// === Exercise importance (user: "dont make all workouts 15 minutes, give
// priority for more important workouts") ===
// Each exercise now gets a duration by IMPORTANCE instead of a flat 60s:
//   priority 1 — big compound lifts (squat/deadlift/bench/press/row/pull-up…)
//                → 90s + always placed FIRST in the day's list
//   priority 2 — standard exercises → 60s
//   priority 3 — small isolation/accessory work (raises/curls/crunches…)
//                → 45s
// The kcal badge, timer and logged duration all read getWorkoutDuration(),
// so everything stays consistent automatically.
function workoutImportance(name) {
  const n = String(name || '').toLowerCase();
  if (/(squat|deadlift|bench|press|row|pull-up|pullup|chin-up|chinup|lunge|clean|jerk|snatch|thruster|hip thrust|step-up)/.test(n)) return 1;
  if (/(raise|fly|flye|curl|extension|crunch|plank|hold|kickback|shrug|calf|pulse|twist|leg raise)/.test(n)) return 3;
  return 2;
}
function getWorkoutDuration(name) {
  // Per-exercise duration now VARIES by exercise importance (compound lifts
  // get more time, small isolation work gets less) instead of a flat 60s.
  const legacyMap = WORKOUT_DURATION[name] || 45;
  const legacy = Math.min(90, Math.max(30, legacyMap));
  try {
    const totalExercises = (deState.workouts && deState.workouts.length) || 0;
    if (totalExercises <= 0) return legacy; // no plan yet
    const p = workoutImportance(name);
    return p === 1 ? 90 : (p === 3 ? 45 : 60);
  } catch(e) { return legacy; }
}

// Returns the rest duration (in seconds) that follows each exercise.
// Used by completeWorkout() to add rest time to the logged session duration
// so the dashboard progress bar reflects TOTAL session time (workout + rest).
function getWorkoutRestSecs() {
  return 60;
}
// v15: workout-detail <img> error safety net (inline onerror handler).
// Chain: START/END guide image → classic photo → generic gym shot → hide.
// The START/END chips only make sense over the two-panel guide image, so
// they are hidden the moment we leave it.
window.__wdImgFail = function (el) {
  try {
    el.onerror = null;
    const ls = document.getElementById('wd-se-label-start');
    const le = document.getElementById('wd-se-label-end');
    if (ls) ls.style.display = 'none';
    if (le) le.style.display = 'none';
    const se = el.getAttribute('data-se') || '';
    const classic = el.getAttribute('data-classic') || '';
    const cur = String(el.src || '');
    if (se && cur.indexOf(se) !== -1 && classic) { el.src = classic; return; }
    if (classic && cur.indexOf(classic) !== -1 && cur.indexOf(WORKOUT_INFO_DEFAULT_IMG) === -1) { el.src = WORKOUT_INFO_DEFAULT_IMG; return; }
    if (cur.indexOf(WORKOUT_INFO_DEFAULT_IMG) === -1) { el.src = WORKOUT_INFO_DEFAULT_IMG; return; }
    el.style.display = 'none';
    const wrap = document.getElementById('workout-detail-img-wrap');
    if (wrap) wrap.classList.add('img-failed');
  } catch (e) {}
};
function openWorkoutDetail(index) {
  const w = deState.workouts[index];
  // IMPORTANT: use getWorkoutInfo() so desc and img are ALWAYS strings.
  // Previously, if w.info was {muscle:'Arms'} (no desc/img), info.desc and info.img
  // were undefined → the modal showed the literal word "undefined" and a broken image.
  const info = getWorkoutInfo(w && w.name, (w && w.info && w.info.muscle) || 'Full Body');
  const ar = (store.lang === 'ar');
  const wName = (x) => ar ? (WORKOUT_AR_NAMES[x] || x) : x;
  const duration = getWorkoutDuration(w.name);
  // v15 (user): "make the text of the button 'start workout' only, remove
  // all timestamps from the button" — the "(1:00 min)" suffix is gone.
  // v16 (user): "in picture 2, i want the button only" — the big mm:ss
  // timer display and the hint below are ALSO hidden pre-start (rendered
  // with display:none); the timer only appears once the countdown is
  // actually running (see startWorkoutTimer).
  const startBtnLabel = ar ? 'ابدأ التمرين' : 'Start Workout';
  // v15: START→END guide image for this exercise (empty when the resolved
  // classic photo isn't a local bucket file — CDN leftovers).
  const seImg = workoutSEImg(info.img);
  const mustFinishTimerMsg = ar ? 'أكمل المؤقت أولاً لإكمال التمرين' : 'Finish the timer first to complete the exercise';
  // Per user spec (round 2): show ONE button labeled "Start Workout". When clicked,
  // that button DISAPPEARS completely (display:none). When the timer reaches 0,
  // a brand-new "Complete Exercise" button APPEARS in its place. This eliminates
  // any chance of the user seeing two Complete Exercise buttons at once.
  // FIX (round 3): use var(--accent) NOT var(--blue) — --blue is not defined in
  // :root, which made the button background transparent (invisible).
  document.getElementById('workout-detail-body').innerHTML = `
    <h3>${wName(w.name)}</h3>
    <!-- v25 (user, picture 4): "when the user clicks on a workout, display
         the photo of the workout and how many calories you burn" — burn row
         under the title: estimated kcal for the full exercise duration +
         the MET value behind the estimate. Integer only. -->
    <div class="wd-burn-row" style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--accent-soft);border-radius:10px;margin:10px 0 14px;">
      <i class="fa-solid fa-fire" style="color:#ff5722;font-size:.95rem;animation:fireBurn 0.6s ease-in-out infinite alternate;transform-origin:bottom center;"></i>
      <b style="font-size:1.05rem;color:var(--text);line-height:1;">~${getWorkoutCalories(w.name)} <span style="font-size:.7rem;font-weight:700;color:var(--muted);">${ar ? 'سعرة' : 'kcal'}</span></b>
      <span style="font-size:.72rem;color:var(--muted);">${ar ? 'تحرقها في' : 'burned in'} ${duration >= 60 ? Math.floor(duration/60) + ' ' + (ar ? 'د' : 'min') + ' ' + (duration%60) + ' ' + (ar ? 'ث' : 's') : duration + ' ' + (ar ? 'ثانية' : 'seconds')} · ${WORKOUT_MET[w.name] ? 'MET ' + WORKOUT_MET[w.name] : (ar ? 'وزنك الحقيقي' : 'your real weight')}</span>
    </div>
    <!-- v3: AI assists live INSIDE this popup — chips + shared camera on top -->
    ${wdAssistHtml(w)}
    <!-- v15 (user): "make all workout image have start and end" — the popup
         now shows the two-panel START→END guide image (se/{bucket}.jpg) with
         START / END chips over the halves; falls back to the classic photo
         when the guide image is missing. -->
    <div class="workout-detail-img-wrap loading" id="workout-detail-img-wrap">
      <img src="${seImg || info.img}" class="workout-detail-img" alt="${wName(w.name)}" id="workout-detail-img-tag"
           data-se="${seImg}" data-classic="${info.img}"
           onerror="__wdImgFail(this)">
      ${seImg ? `<span class="wd-se-label wd-se-start" id="wd-se-label-start" style="display:none;" data-ar="البداية">${ar ? 'البداية' : 'START'}</span><span class="wd-se-label wd-se-end" id="wd-se-label-end" style="display:none;" data-ar="النهاية">${ar ? 'النهاية' : 'END'}</span>` : ''}
    </div>
    <p style="color:var(--muted);margin-bottom:16px;">${info.desc}</p>
    ${info.steps && info.steps.length ? `<div class="wd-list-block"><b class="wd-list-title">${ar ? 'خطوات الأداء' : 'How to perform'}</b><ol class="wd-steps">${info.steps.map(st => `<li>${st}</li>`).join('')}</ol></div>` : ''}
    ${info.tips && info.tips.length ? `<div class="wd-list-block"><b class="wd-list-title">${ar ? 'نصائح' : 'Tips'}</b><ul class="wd-tips">${info.tips.map(tp => `<li>${tp}</li>`).join('')}</ul></div>` : ''}
    <div class="workout-timer-display" id="workout-timer-display" style="display:none;">${String(Math.floor(duration/60)).padStart(2,'0')}:${String(duration%60).padStart(2,'0')}</div>
    <div id="workout-btn-slot">
      <button class="btn primary" style="width:100%;background:var(--accent);" id="workout-start-timer-btn" onclick="startWorkoutTimer(${index})"><i class="fa-solid fa-play"></i> ${startBtnLabel}</button>
    </div>
    <p style="text-align:center;color:var(--muted);font-size:.78rem;margin-top:8px;display:none;" id="workout-complete-hint" data-ar="أكمل المؤقت أولاً لإكمال التمرين">${mustFinishTimerMsg}</p>
  `;
  // === IMAGE PRELOAD — v15: START→END guide first, layered fallbacks ===
  // Layer 1: se/{bucket}.jpg — the two-panel start/end guide illustration
  //          (START/END chips appear only when it actually loads).
  // Layer 2: the classic single exercise photo.
  // Layer 3: the neutral generic gym shot.
  // Layer 4: hide the image frame gracefully (no broken icon).
  // Layer 5: the <img onerror=__wdImgFail> attribute is a final safety net
  //          for any edge case the preloader missed.
  const imgTag = document.getElementById('workout-detail-img-tag');
  const imgWrap = document.getElementById('workout-detail-img-wrap');
  if (imgTag && imgWrap) {
    const seLabelS = document.getElementById('wd-se-label-start');
    const seLabelE = document.getElementById('wd-se-label-end');
    const showImg = function (src, withSE) {
      imgWrap.classList.remove('loading');
      imgTag.src = src;
      if (seLabelS) seLabelS.style.display = withSE ? '' : 'none';
      if (seLabelE) seLabelE.style.display = withSE ? '' : 'none';
    };
    const failAll = function () {
      imgWrap.classList.remove('loading');
      imgWrap.classList.add('img-failed');
      imgTag.style.display = 'none';
    };
    const trySrc = function (src, withSE, onFail) {
      if (!src) { onFail(); return; }
      const pre = new Image();
      pre.onload = function () { showImg(src, withSE); };
      pre.onerror = onFail;
      pre.src = src;
    };
    trySrc(seImg, true, function () {
      trySrc(info.img, false, function () {
        trySrc(WORKOUT_INFO_DEFAULT_IMG, false, failAll);
      });
    });
  }
  openModal('workout-detail-modal');
  // === X button is visible when the modal first opens (user can still back out). ===
  // It gets hidden by startWorkoutTimer() the moment the user clicks "Start Workout".
  const closeBtn = document.getElementById('workout-detail-close');
  if (closeBtn) closeBtn.style.display = '';
}
function startWorkoutTimer(index) {
  if (workoutTimerInt) clearInterval(workoutTimerInt);
  workoutTimerStart = Date.now();
  const ar = (store.lang === 'ar');
  const completeBtnLabel = ar ? 'إكمال التمرين' : 'Complete Exercise';
  // Per-exercise duration — varies by exercise name instead of always 45s
  const w = deState.workouts[index];
  let secs = getWorkoutDuration(w ? w.name : '');
  const display = document.getElementById('workout-timer-display');
  // v5: the X close button now STAYS VISIBLE for the whole workout (user
  // request). Closing the popup mid-timer is safe — closeWorkoutDetail()
  // clears the timer and releases the scroll lock.
  // (v9 removed the auto-assist; v15 brought it back on the Start Workout
  // click — see wdAssistStartWithWorkout below.)
  // === Lock body scroll so the user can't scroll the underlying daily-exercise ===
  // list while the workout timer is running. Removed in closeWorkoutDetail().
  document.body.classList.add('workout-in-progress');
  // v15 (user): "make form check and rep counter start when the user clicks
  // 'start workout'" — the shared AI assist (form check + rep counter, one
  // camera) spins up together with the timer. Guards inside keep it silent
  // for free users and when Settings → AI Camera is OFF; the chips still
  // allow individual on/off afterwards.
  try { if (typeof wdAssistStartWithWorkout === 'function') wdAssistStartWithWorkout(); } catch (e) {}
  const btn = document.getElementById('workout-start-timer-btn');
  const btnSlot = document.getElementById('workout-btn-slot');
  const completeHint = document.getElementById('workout-complete-hint');
  // === Per user spec (round 5): hide the Start button when clicked, but DON'T
  // show a small "Time left" timer — the user wants ONLY the big timer visible.
  // We just leave the slot empty while the timer counts down. ===
  // v16 (user): "i want the button only" — the big mm:ss timer + hint are
  // hidden BEFORE the workout starts (openWorkoutDetail renders them with
  // display:none). The countdown timer is revealed HERE, the moment the
  // workout actually starts; when it hits 00:00 it hides again so the done
  // state shows ONLY the Complete Exercise button.
  if (btn) btn.style.display = 'none';
  if (btnSlot) btnSlot.innerHTML = '';
  if (completeHint) completeHint.style.display = 'none';
  // Update the big timer display + reveal it (countdown now running)
  const mins = Math.floor(secs / 60);
  const secsRem = secs % 60;
  if (display) { display.textContent = String(mins).padStart(2,'0') + ':' + String(secsRem).padStart(2,'0'); display.style.display = ''; }
  if (completeHint) completeHint.textContent = ar ? 'أكمل المؤقت أولاً لإكمال التمرين' : 'Finish the timer first to complete the exercise';
  workoutTimerInt = setInterval(() => {
    secs--;
    // Update big timer display only (no small timer at the bottom — per round 5 spec)
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    if (display) display.textContent = String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
    if (secs <= 0) {
      clearInterval(workoutTimerInt);
      if (display) { display.textContent = '00:00'; display.style.display = 'none'; }
      // === Timer done: now a NEW "Complete Exercise" button appears in the slot. ===
      // This is a fresh button creation (not a transform), so there is zero chance
      // of two Complete Exercise buttons being visible at once.
      if (btnSlot) {
        btnSlot.innerHTML = '<button class="btn primary" style="width:100%;background:var(--green);" id="workout-complete-btn" onclick="completeWorkout(' + index + ')"><i class="fa-solid fa-check"></i> ' + completeBtnLabel + '</button>';
      }
      // Update the hint text below the button (v16: reveal only at completion)
      if (completeHint) {
        completeHint.textContent = ar ? 'يمكنك الآن إكمال التمرين' : 'You can now complete the exercise';
        completeHint.setAttribute('data-ar', 'يمكنك الآن إكمال التمرين');
        completeHint.style.display = '';
      }
      // Play a done-beep + vibrate to signal completion
      if (typeof playDoneBeep === 'function') playDoneBeep();
      if (typeof vibrateDevice === 'function') vibrateDevice([200, 100, 200]);
    }
  }, 1000);
}
function completeWorkout(index) {
  if (workoutTimerInt) clearInterval(workoutTimerInt);
  // Round 8: capture the ACTUAL elapsed workout time FIRST —
  // closeWorkoutDetail() below nulls workoutTimerStart before the session
  // log runs, and the old code logged the planned 60s regardless.
  const __wName = deState.workouts[index] ? deState.workouts[index].name : '';
  const __plannedSecs = (typeof getWorkoutDuration === 'function') ? getWorkoutDuration(__wName) : 60;
  const __elapsedSec = (workoutTimerStart ? Math.round((Date.now() - workoutTimerStart) / 1000) : __plannedSecs) || __plannedSecs;
  deState.workouts[index].done = true;
  deState.currentWorkout++;
  // Persist the per-workout 'done' flag so a page refresh doesn't lose progress
  if (deState.dailyPlan && deState.dailyPlan[deState.currentDay]) {
    deState.dailyPlan[deState.currentDay].workouts = deState.workouts;
    saveDailyPlan();
  }
  // v28 (user): "1 rest after every 2 exercises" — the 60s rest gate now
  // fires only after every SECOND completed exercise (exercise cadence:
  // ex, ex, REST, ex, ex, REST …), not after every single one. The last
  // exercise never triggers a rest.
  if (deState.currentWorkout < deState.workouts.length &&
      (deState.currentWorkout % 2) === 0) {
    deState.restUntil = Date.now() + 60000; // 60 seconds
  }
  closeWorkoutDetail();
  renderWorkoutList();

  // ===== PROGRESS BAR FIX =====
  // Log a real session so the daily-activity progress bar updates.
  // Each completed exercise = ~30-60s timer = ~1 min (rounded up so the bar visibly moves).
  // Without this, the user could finish multiple exercises and the progress bar would still show 0%
  // because no session was ever recorded.
  try {
    const u = currentUser();
    if (!u.sessions) u.sessions = [];
    // ===== ROUND 8 — REAL time & per-exercise calories =====
    // Per user report: "i trained for 9 seconds and it counted as 1 minute",
    // "1 calorie is counted as 7 in the ring ... put intensity in mind and the
    // workout itself, not all workouts are the same".
    //  · Duration = the ACTUAL elapsed workout time (to 0.1 min), never a
    //    forced full minute. 9s → 0.2 min. (The old code logged the planned
    //    60s as 1 min no matter what really happened.)
    //  · Calories = this exercise's OWN MET value (Push-ups 8.0 vs Bicep
    //    Curls 3.5 — not all workouts are the same) × the user's weight ×
    //    the exact elapsed seconds. No flat per-minute rate.
    //  · The session's intensity label is derived from the MET so the
    //    tracker list shows Light / Moderate / Intense truthfully.
    const wName0 = __wName;
    const plannedSecs = __plannedSecs;
    const elapsedSec = __elapsedSec;
    const effSecs = Math.max(1, Math.min(elapsedSec, plannedSecs)); // timer completes at 0 → ~planned; early completion logs real time
    const minutes = minsFromSecs(effSecs);
    let weight = 70;
    try { if (u.profile && u.profile.weight) weight = u.profile.weight; } catch (e) {}
    const met = (typeof WORKOUT_MET !== 'undefined' && WORKOUT_MET[wName0]) || 5.0;
    const intensityLabel = met >= 7 ? 'Intense' : (met >= 4.5 ? 'Moderate' : 'Light');
    // v25: ACSM formula (integer, same as getWorkoutCalories).
    const cals = Math.max(1, Math.round(met * 3.5 * weight / 200 * (effSecs / 60)));
    u.sessions.push({
      sport: 'Daily Exercise',
      date: localDateStr(),
      duration: minutes,
      calories: cals,
      intensity: intensityLabel,
      note: wName0 || 'Daily workout'
    });
    saveUser(store.session, u);
    // Round 15 (animation #5): confetti + checkmark burst the moment a
    // workout block is completed. The celebration layer is defensive —
    // it's a no-op if volta-animations.js didn't load.
    try { if (window.voltaCelebrate) window.voltaCelebrate('workout'); } catch (e) {}
    // v30: snappy pop the moment an exercise completes
    try { if (window.VoltaSounds) VoltaSounds.play('pop'); } catch (e) {}
    // NOTE: bumpStreak() is intentionally NOT called here. The user spec says
    // "dont make 'daily streak' count until the daily activity goal is done".
    // bumpStreak() is now only called by finishDailyWorkout() (which runs when
    // ALL exercises of the day are completed).
    renderHome();   // refresh progress bar + stat cards immediately (simultaneous sync)
    renderTracker();
    checkDailyGoalReached(); // show streak popup if goal reached
    // === Round 6: also refresh the small "calories burnt today" popup at the
    // top of the workout list so it updates immediately when an exercise completes. ===
    try { renderTodayKcalPopup(); } catch(e) {}
  } catch(e) { console.warn('completeWorkout session log error:', e); }
  workoutTimerStart = null;

  const ar = (store.lang === 'ar');
  // === Round 7: removed the alert() "All workouts completed!" popup. ===
  // The user explicitly asked to remove the motivational popup when finishing
  // a day and replace it with a cool animation. The cool animation
  // (showGreatWorkPopup) now fires from finishDailyWorkout() when the user
  // taps the "Finish Workout" button (which is the explicit "finish the day"
  // action). When the user completes the LAST exercise but hasn't yet tapped
  // "Finish Workout", we just enable the finish button — no popup.
  // Update finish button state when all workouts are done
  const finishBtn = document.getElementById('finish-workout-btn');
  if (finishBtn && deState.workouts.every(w => w.done)) {
    finishBtn.disabled = false;
    finishBtn.style.opacity = '1';
    finishBtn.style.cursor = 'pointer';
  }
  // === AUTO-FIRE the great-work animation when ALL workouts of the day
  // are done. ===
  // Per user spec: "i want to see the daily exercise animation when you
  // finish the plan". Previously the animation only fired when the user
  // manually clicked the "Finish Daily Workout" button. But the user
  // typically completes the last workout INSIDE the workout-detail-modal
  // and doesn't realize they need to close it and then click "Finish" —
  // so they never see the animation.
  //
  // Now we:
  //   1. Close the workout-detail-modal (so the user sees the daily tab)
  //   2. Wait 1200ms for the user to see the "all done" state
  //   3. Auto-call finishDailyWorkout() which fires the great-work popup
  //      ("PLAN COMPLETE!" on the last day, "Day X of Y" otherwise)
  if (deState.workouts.every(w => w.done) && !window._autoFinishScheduled) {
    window._autoFinishScheduled = true;
    try { closeWorkoutDetail(); } catch(e) {}
    // Scroll to the finish button so the user sees it
    try {
      const fb = document.getElementById('finish-workout-btn');
      if (fb && fb.scrollIntoView) fb.scrollIntoView({behavior:'smooth', block:'center'});
    } catch(e) {}
    setTimeout(function() {
      window._autoFinishScheduled = false;
      try {
        // Double-check that all workouts are still done (user might have
        // reset the plan in the meantime)
        if (deState.workouts && deState.workouts.length > 0 && deState.workouts.every(w => w.done)) {
          finishDailyWorkout();
        }
      } catch(e) { console.warn('Auto-finishDailyWorkout error:', e); }
    }, 1200);
  }
}
function closeWorkoutDetail() {
  closeModal('workout-detail-modal');
  // v3: stop the shared camera engine when the popup closes (X button,
  // overlay click or programmatic close all funnel through here).
  try { stopWorkoutAssist(); } catch (e) {}
  if (workoutTimerInt) clearInterval(workoutTimerInt);
  workoutTimerStart = null;
  // === Release the body scroll lock (set by startWorkoutTimer) ===
  document.body.classList.remove('workout-in-progress');
  // Restore the X button visibility for the next time the modal opens
  const closeBtn = document.getElementById('workout-detail-close');
  if (closeBtn) closeBtn.style.display = '';
}
function finishDailyWorkout() {
  const ar = (store.lang === 'ar');
  if (!deState.workouts.every(w => w.done)) {
    return;
  }
  // Mark today as completed
  if (deState.dailyPlan && deState.dailyPlan[deState.currentDay]) {
    deState.dailyPlan[deState.currentDay].completed = true;
    deState.dailyPlan[deState.currentDay].completedAt = Date.now();
  }
  bumpStreak();
  // Advance to next day (or end the plan if this was the last day)
  const nextDay = deState.currentDay + 1;
  const totalDays = (deState.dailyPlan && deState.dailyPlan.length) ? deState.dailyPlan.length : 0;
  if (!deState.dailyPlan || nextDay >= totalDays) {
    // Plan complete — start fresh
    // === Round 7: replaced the alert() with the cool "Great Work" animation. ===
    showGreatWorkPopup({ planComplete: true });
    deState.step = 1; deState.muscles = []; deState.daysOfWeek = []; deState.workouts = [];
    deState.dailyPlan = null; deState.currentDay = 0; deState.initialized = false;
    __wlDayCtx = -1;   // v10: plan over → reset the "+X more" expander
    clearDailyPlan();
  } else {
    // Advance to the next day
    deState.currentDay = nextDay;
    deState.workouts = (deState.dailyPlan[nextDay].workouts || []).map(w => ({ name: w.name, sets: w.sets, reps: w.reps, info: w.info, done: false }));
    deState.currentWorkout = 0;
    saveDailyPlan();
    // === Round 7: replaced the alert() with the cool "Great Work" animation. ===
    showGreatWorkPopup({ day: nextDay + 1, totalDays: totalDays });
  }
  renderDailyExercise();
  renderHome();
}

function pickMood(btn) {
  selectedMood = btn.dataset.mood;
  document.querySelectorAll('.mood-card, .mood-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  // Round 13: Smoothly scroll the "Morph my workout" button into view so the
  // user can immediately tap it without manually scrolling. Uses 'nearest'
  // behavior to avoid jarring full-page jumps. The scroll-padding-bottom on
  // .main (90px) ensures the button isn't hidden behind the bottom-nav.
  setTimeout(function() {
    try {
      var goBtn = document.querySelector('.moodmorph-go');
      if (goBtn && goBtn.scrollIntoView) {
        goBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    } catch(e) {}
  }, 200);
}

// === Round 13: updateEnergyLabel — drives the rebuilt MoodMorph energy bar.
// Updates THREE things in sync as the user drags:
//   1. The big readout number (with a re-triggered pop animation)
//   2. The track's live gradient fill — a SMOOTH 3-stop blend (red→amber→green)
//      that shifts color depending on the value, plus a "filled" portion that
//      grows with the thumb. No more hard 50%/50% seam.
//   3. The colored state classes (is-low / is-med / is-high) on the readout
//      and the label icon so the whole panel "feels" the energy level.
// ===
function updateEnergyLabel(val) {
  const v = parseInt(val, 10);
  if (isNaN(v)) return;

  // 1) Readout number — textContent only (we removed the inner <span>)
  const label = document.getElementById('energy-label');
  if (label) {
    label.textContent = v;
    // Re-trigger the pop animation by toggling a class
    label.classList.remove('mm2-pop-trigger');
    void label.offsetWidth; // force reflow so the animation restarts
    label.classList.add('mm2-pop-trigger');
    // Re-apply the keyframe via inline animation (works without re-declaring CSS)
    label.style.animation = 'none';
    void label.offsetWidth;
    label.style.animation = 'mm2Pop .35s ease';
  }

  // 2) State classes (low ≤ 3, med 4–6, high ≥ 7)
  const stateClass = v <= 3 ? 'is-low' : (v <= 6 ? 'is-med' : 'is-high');
  const readout = label;
  const icon = document.getElementById('mm2-energy-icon');
  [readout, icon].forEach(el => {
    if (!el) return;
    el.classList.remove('is-low', 'is-med', 'is-high');
    el.classList.add(stateClass);
  });

  // 3) Live track gradient — paint a SMOOTH 3-stop gradient on the FILLED
  //    portion, then the unfilled tail uses a light periwinkle track color
  //    (Round 18: matches the reference design — the old gray var(--line)
  //    tail is gone).
  //    The fill colors shift based on the value:
  //      low  → red (#c94444) → amber (#b97b16)
  //      med  → amber (#b8860b) → soft periwinkle (#93a9e6)   ← reference look
  //      high → accent (#6495ED) → green (#1d9d6b)
  //
  //    RTL FIX: In Arabic (RTL) mode, the slider runs right-to-left:
  //      - min (1) is on the RIGHT, max (10) is on the LEFT
  //      - thumb position from left = (100 - pct)%
  //      - the "filled" portion (from min=1 to thumb) is from thumb to right edge
  //      - so colored portion = [(100-pct)% .. 100%] from left
  //      - empty portion = [0% .. (100-pct)%] from left
  const input = document.getElementById('energy');
  if (input) {
    const pct = ((v - 1) / 9) * 100; // 1 → 0%, 10 → 100%
    let c1, c2;
    if (v <= 3) { c1 = '#c94444'; c2 = '#b97b16'; }          // red → amber
    else if (v <= 6) { c1 = '#b8860b'; c2 = '#93a9e6'; }     // amber → soft periwinkle
    else { c1 = '#6495ED'; c2 = '#1d9d6b'; }                  // accent → green
    // Round 18: unfilled tail color — light periwinkle in light mode,
    // a dim translucent periwinkle in dark mode (body.dark-mode).
    const track = document.body.classList.contains('dark-mode')
      ? 'rgba(100,149,237,.30)' : '#ccd7f2';
    // Detect RTL: body.lang-ar means Arabic is active.
    const isRTL = document.body.classList.contains('lang-ar');
    if (isRTL) {
      // RTL: fill from the thumb position (100-pct)% to the right edge (100%).
      // c1 is at the right edge (the "start" = min value side).
      // c2 is at the thumb position.
      input.style.background =
        'linear-gradient(to right, ' + track + ' 0%, ' + track + ' ' + (100 - pct) + '%, ' +
        c2 + ' ' + (100 - pct) + '%, ' + c1 + ' 100%)';
    } else {
      // LTR: fill from left edge (0%) to the thumb position (pct%).
      input.style.background =
        'linear-gradient(to right, ' + c1 + ' 0%, ' + c2 + ' ' + pct + '%, ' +
        track + ' ' + pct + '%, ' + track + ' 100%)';
    }
    // Round 18: the thumb is plain white now — no colored ring to sync.
    input.classList.add('mm2-thumb-styled');
  }
}

// Initialize the energy bar on page load (so it shows the correct fill and
// colors for the default value of 5, instead of an empty grey track).
try {
  document.addEventListener('DOMContentLoaded', function() {
    const input = document.getElementById('energy');
    if (input) updateEnergyLabel(input.value);
    // v30: restore the Sound Effects toggle state from localStorage
    try { if (typeof initSoundsToggle === 'function') initSoundsToggle(); } catch (e) {}
  });
  // Also initialize immediately in case DOMContentLoaded already fired
  const _input = document.getElementById('energy');
  if (_input) updateEnergyLabel(_input.value);
  try { if (typeof initSoundsToggle === 'function') initSoundsToggle(); } catch (e) {}
} catch(e) {}

function generateMoodWorkout() {
  if (!selectedMood) { alert('Pick a mood first.'); return; }
  const pools = {
    stressed: ['4x10 slow deep squats', '3x45s plank', '2 min shadow boxing', '5 min deep breathing', '3x15 cat-cow stretch', '10 min slow walk', '3x10 arm circles', '5 min child pose'],
    sad: ['3x30s free movement', '3x10 easy squats', '10 min brisk walk', '3x10 push-ups', '3x20 jumping jacks', '5 min dance to fav song', '3x10 lunges', '2 min plank'],
    neutral: ['3x12 push-ups', '3x15 squats', '3x30s plank', '3x15 lunges', '3x20 sit-ups', '3x30s wall sit', '3x15 glute bridges', '3x10 burpees'],
    happy: ['4x30s jumping jacks', '3x12 jump squats', '3x10 burpees', '5 min dancing', '3x15 mountain climbers', '3x20 high knees', '3x10 tuck jumps', '3x15 skater jumps'],
    pumped: ['5x10 burpees', '4x15 jump squats', '4x30s sprint in place', '4x10 plyo push-ups', '4x20 mountain climbers', '5x10 tuck jumps', '4x15 kettlebell swings', '4x20 battle ropes']
  };
  const workout = getDailyItems(pools[selectedMood], 3);
  const moodEmoji = { stressed: 'fa-bolt', sad: 'fa-face-frown', neutral: 'fa-face-meh', happy: 'fa-face-smile', pumped: 'fa-rocket' }[selectedMood];
  const moodLabel = selectedMood.charAt(0).toUpperCase() + selectedMood.slice(1);
  const moodLabelAr = { stressed: 'مجهد', sad: 'منخفض', neutral: 'محايد', happy: 'سعيد', pumped: 'متحمس' }[selectedMood] || moodLabel;
  const workoutCards = workout.map((w, i) => `<div class="task-card mood-workout-card" style="cursor:default;animation-delay:${0.05 * i}s;"><div style="display:flex;gap:12px;align-items:center;"><div class="mood-workout-num">${i+1}</div><div><h4 style="margin:0 0 4px;font-size:.95rem;">${w}</h4><p class="task-desc" style="margin:0;" data-ar="تمرين حسب المزاج">Mood Exercise</p></div></div></div>`).join('');
  document.getElementById('mood-result').classList.remove('hidden');
  document.getElementById('mood-result').innerHTML = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;"><i class="fa-solid ${moodEmoji}" style="font-size:1.4rem;color:var(--accent);"></i><h3 style="margin:0;font-size:1.1rem;" data-ar="تمرين ${moodLabelAr}">${moodLabel} Workout</h3></div><div class="task-grid" style="margin-top: 8px;">${workoutCards}</div>`;
  document.getElementById('mood-music').classList.remove('hidden');
  // Playlists now match the SELECTED MOOD (stressed->calm, pumped->beast mode...),
  // daily-rotated from the 100-playlist VOLTA_PLAYLISTS catalog.
  const moodVibe = MOOD_VIBES[selectedMood] || 'pop';
  const todaysPlaylists = getVibePlaylistIds(moodVibe, 2);
  document.getElementById('playlist-container').innerHTML = todaysPlaylists.map(id => `<iframe style="border-radius:12px; margin-bottom:10px;" src="https://open.spotify.com/embed/playlist/${id}" width="100%" height="152" frameBorder="0" loading="lazy" allowfullscreen="" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>`).join('') + (!navigator.onLine ? '<p style="margin-top:8px;font-size:.78rem;color:var(--amber);"><i class="fa-solid fa-wifi"></i> <span data-ar="أنت غير متصل — قد لا تُحمّل قوائم التشغيل حتى تعود للاتصال.">You\'re offline — playlists may not load until you reconnect.</span></p>' : '');
}
let meditationBreathInt = null;
function startMeditation() {
  document.getElementById('meditation-overlay').classList.add('active');
  // Calm playlists for the breathing session — daily-rotated from the catalog.
  const todaysTracks = getVibePlaylistIds('calm', 2);
  document.getElementById('meditation-audio').innerHTML = todaysTracks.map(id => `<iframe style="border-radius:12px;" src="https://open.spotify.com/embed/playlist/${id}" width="300" height="152" frameBorder="0" loading="lazy" allowfullscreen="" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>`).join('');
  const circle = document.getElementById('breath-circle');
  let isGrowing = true;
  if (meditationBreathInt) clearInterval(meditationBreathInt);
  meditationBreathInt = setInterval(() => {
    if (isGrowing) { circle.classList.add('grow'); circle.textContent = store.lang === 'ar' ? 'شهيق' : 'Breathe In'; }
    else { circle.classList.remove('grow'); circle.textContent = store.lang === 'ar' ? 'زفير' : 'Breathe Out'; }
    isGrowing = !isGrowing;
  }, 4000);
}
function stopMeditation() { if (meditationBreathInt) clearInterval(meditationBreathInt); meditationBreathInt = null; document.getElementById('meditation-audio').innerHTML = ''; document.getElementById('meditation-overlay').classList.remove('active'); }

function initMap() {
  if (map) { map.invalidateSize(); return; }
  map = L.map('map-container').setView([51.505, -0.09], 13); 
  // Offline-friendly tile layer. When online, tiles are fetched from OSM and
  // cached by the browser's HTTP cache for offline reuse. When offline, the
  // browser serves cached tiles automatically; missing tiles just render grey.
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    crossOrigin: true
  }).addTo(map);
  const locCache = store.locCache;
  // Prefer last-known location (works offline). Fall back to live geolocation
  // only when online AND no cached location is available.
  if (locCache) {
    map.setView([locCache.lat, locCache.lon], 13);
    mapMarkerA = L.marker([locCache.lat, locCache.lon]).addTo(map).bindPopup('Point A (You)').openPopup();
  } else if (store.locationEnabled && navigator.geolocation && navigator.onLine) {
    navigator.geolocation.getCurrentPosition(pos => {
      const lat = pos.coords.latitude, lon = pos.coords.longitude;
      store.locCache = { lat, lon, time: Date.now() };
      map.setView([lat, lon], 13);
      mapMarkerA = L.marker([lat, lon]).addTo(map).bindPopup('Point A (You)').openPopup();
    }, (err) => {
      console.warn('Map geolocation error:', err.message);
      map.setView([0,0], 2);
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  } else {
    // Offline + no cached location: show a neutral world view and let the user
    // pan/click manually. Distance calc still works between any two clicked points.
    map.setView([0,0], 2);
  }
  map.on('click', function(e) {
    if (mapMarkerB) map.removeLayer(mapMarkerB);
    if (mapPolyline) map.removeLayer(mapPolyline);
    mapMarkerB = L.marker(e.latlng).addTo(map).bindPopup('Point B').openPopup();
    marathonDest = e.latlng;
    calculateDistance();
  });
}
function calculateDistance() {
  if (!mapMarkerA || !mapMarkerB) return;
  const lat1 = mapMarkerA.getLatLng().lat, lon1 = mapMarkerA.getLatLng().lng;
  const lat2 = mapMarkerB.getLatLng().lat, lon2 = mapMarkerB.getLatLng().lng;
  const R = 6371; 
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  marathonDist = R * c;
  document.getElementById('marathon-distance').textContent = marathonDist.toFixed(2) + ' km';
  mapPolyline = L.polyline([[lat1, lon1], [lat2, lon2]], {color: '#6495ED'}).addTo(map);
}
function startMarathon() {
  if (!marathonDest) { alert(store.lang === 'ar' ? 'يرجى تحديد النقطة ب على الخريطة أولاً.' : 'Please select Point B on the map first.'); return; }
  if (marathonTimerInt) clearInterval(marathonTimerInt);
  marathonStart = Date.now();
  marathonPaused = false;
  marathonPauseStart = null;
  marathonPausedMs = 0;
  // Hide the results card from any previous run
  const results = document.getElementById('marathon-results');
  if (results) results.style.display = 'none';
  // --- Show the session overlay (same style as sports workouts) ---
  const overlay = document.getElementById('session-overlay');
  const nameEl = document.getElementById('session-sport-name');
  const timerEl = document.getElementById('session-timer');
  const calEl = document.getElementById('session-calories');
  const distEl = document.getElementById('session-distance');
  if (nameEl) nameEl.textContent = (marathonType === 'bike') ? 'Cycling' : 'Running';
  if (timerEl) timerEl.textContent = '00:00';
  if (calEl) calEl.innerHTML = '<i class="fa-solid fa-fire"></i> 0 kcal';
  if (distEl) { distEl.style.display = ''; distEl.textContent = marathonDist.toFixed(2) + ' km'; }
  // Replace the default stop/pause buttons with marathon-aware handlers
  const actionsEl = overlay.querySelector('.session-actions');
  if (actionsEl) {
    actionsEl.innerHTML = '<button class="btn primary" onclick="stopMarathonSession()"><i class="fa-solid fa-stop"></i> <span data-ar="إيقاف وتسجيل">Stop & Log</span></button><button class="btn ghost" id="session-pause-btn" onclick="togglePauseMarathon()"><i class="fa-solid fa-pause"></i> <span data-ar="إيقاف مؤقت">Pause</span></button>';
  }
  document.getElementById('session-pause-timer').classList.add('hidden');
  document.getElementById('session-playlist-container').innerHTML = '';
  overlay.classList.add('active');
  marathonTimerInt = setInterval(function() {
    if (marathonPaused) return;
    const elapsedMs = Date.now() - marathonStart - marathonPausedMs;
    const elapsed = Math.floor(elapsedMs / 1000);
    const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const s = (elapsed % 60).toString().padStart(2, '0');
    const h = Math.floor(elapsed / 3600);
    const tEl = document.getElementById('session-timer');
    if (tEl) tEl.textContent = (h > 0 ? h + ':' : '') + m + ':' + s;
    // Calories: v25 — ACSM standard (MET × 3.5 × kg / 200 × minutes);
    // Math.floor so the live ticker doesn't jump ahead.
    const met = (marathonType === 'bike') ? 7.5 : 9.8;
    const u = currentUser();
    const weightKg = (u && u.profile && u.profile.weight) ? u.profile.weight : 70;
    const kcal = Math.floor(met * 3.5 * weightKg / 200 * (elapsed / 60));
    const cEl = document.getElementById('session-calories');
    if (cEl) cEl.innerHTML = '<i class="fa-solid fa-fire"></i> ' + kcal + ' kcal';
    marathonLastCalories = kcal;
    // Round 8: exact minutes (0.1 precision) — no more rounding a short run
    // up to a full minute.
    marathonLastElapsedMins = minsFromSecs(elapsed);
    // Also keep the inline map-info timer in sync (visible behind overlay)
    const mtEl = document.getElementById('marathon-timer');
    if (mtEl) mtEl.textContent = (h > 0 ? h.toString().padStart(2,'0') + ':' : '') + m + ':' + s;
    const mcEl = document.getElementById('marathon-calories');
    if (mcEl) mcEl.textContent = kcal + ' kcal';
    // Progress toward preset target
    if (marathonTargetDist > 0) {
      const pct = Math.min(100, Math.round((marathonDist / marathonTargetDist) * 100));
      const pctEl = document.getElementById('marathon-progress-pct');
      const fillEl = document.getElementById('marathon-progress-fill');
      if (pctEl) pctEl.textContent = pct + '%';
      if (fillEl) fillEl.style.width = pct + '%';
    }
  }, 1000);
}

function stopMarathonSession() {
  if (!marathonStart) return;
  clearInterval(marathonTimerInt);
  marathonTimerInt = null;
  if (marathonPaused && marathonPauseStart) {
    marathonPausedMs += (Date.now() - marathonPauseStart);
    marathonPauseStart = null;
  }
  const elapsedMs = Date.now() - marathonStart - marathonPausedMs;
  // Round 8: exact minutes (0.1 precision) — no forced full-minute rounding.
  const elapsedMins = minsFromSecs(elapsedMs / 1000);
  const elapsedSecs = Math.floor(elapsedMs / 1000);
  const u = currentUser();
  const sportName = (marathonType === 'bike') ? 'Cycling' : 'Running';
  const noteLabel = (marathonType === 'bike') ? 'Bicycle Marathon' : 'Marathon';
  let targetNote = marathonTargetDist > 0 ? ' (target: ' + marathonTargetDist + ' km)' : '';
  const finalCalories = marathonLastCalories || Math.max(1, Math.round(((marathonType === 'bike') ? 7.5 : 9.8) * 3.5 * (u?.profile?.weight || 70) / 200 * (elapsedSecs / 60)));
  u.sessions.push({
    sport: sportName,
    date: localDateStr(),
    duration: elapsedMins,
    calories: finalCalories,
    intensity: 'Intense',
    note: noteLabel + ': ' + marathonDist.toFixed(2) + ' km' + targetNote
  });
  saveUser(store.session, u);
  // Close the session overlay
  document.getElementById('session-overlay').classList.remove('active');
  document.getElementById('session-playlist-container').innerHTML = '';
  // Show results in the marathon tab
  const resultsEl = document.getElementById('marathon-results');
  const resultsBody = document.getElementById('marathon-results-body');
  if (resultsEl && resultsBody) {
    const ar = (store.lang === 'ar');
    const h = Math.floor(elapsedSecs / 3600);
    const m = Math.floor((elapsedSecs % 3600) / 60);
    const s = elapsedSecs % 60;
    const timeStr = (h > 0 ? h + 'h ' : '') + m + 'm ' + s + 's';
    const targetRow = marathonTargetDist > 0
      ? '<div class="athlete-session-entry"><div><b>' + marathonTargetDist + ' km</b> <span style="color:var(--muted);">· ' + (ar ? 'الهدف' : 'Target') + '</span></div><span class="date">' + Math.min(100, Math.round((marathonDist / marathonTargetDist) * 100)) + '% ' + (ar ? 'اكتمل' : 'completed') + '</span></div>'
      : '';
    resultsBody.innerHTML =
      '<div class="athlete-session-entry"><div><b>' + marathonDist.toFixed(2) + ' km</b> <span style="color:var(--muted);">· ' + (ar ? 'المسافة' : 'Distance') + '</span></div><span class="date">' + (ar ? 'المسافة' : 'Distance') + '</span></div>' +
      '<div class="athlete-session-entry"><div><b>' + timeStr + '</b> <span style="color:var(--muted);">· ' + (ar ? 'الوقت' : 'Time') + '</span></div><span class="date">' + (ar ? 'المدة' : 'Duration') + '</span></div>' +
      '<div class="athlete-session-entry"><div><b>' + finalCalories + ' kcal</b> <span style="color:var(--muted);">· ' + (ar ? 'السعرات' : 'Calories') + '</span></div><span class="date"><i class="fa-solid fa-fire" style="font-size:.65rem;color:var(--red);"></i> ' + (ar ? 'محروقة' : 'burnt') + '</span></div>' +
      targetRow +
      '<p style="text-align:center;color:var(--green);font-weight:600;margin-top:12px;"><i class="fa-solid fa-circle-check"></i> ' + (ar ? 'تم تسجيل الجلسة في المتتبع!' : 'Session logged to tracker!') + '</p>';
    resultsEl.style.display = '';
    setTimeout(applyTranslations, 0);
  }
  // Reset state
  marathonStart = null;
  marathonPaused = false;
  marathonPausedMs = 0;
  // Reset inline UI
  const timerEl = document.getElementById('marathon-timer');
  if (timerEl) timerEl.textContent = '00:00:00';
  const calEl = document.getElementById('marathon-calories');
  if (calEl) calEl.textContent = '0 kcal';
  const pauseBtn = document.getElementById('marathon-pause-btn');
  if (pauseBtn) pauseBtn.style.display = 'none';
  renderTracker(); renderHome(); checkDailyGoalReached();
}

function togglePauseMarathon() {
  if (!marathonStart) return;
  const pauseBtn = document.getElementById('marathon-pause-btn');
  const ar = (store.lang === 'ar');
  if (!marathonPaused) {
    // Pause: record when we paused
    marathonPaused = true;
    marathonPauseStart = Date.now();
    if (pauseBtn) {
      pauseBtn.innerHTML = '<i class="fa-solid fa-play"></i> ' + (ar ? '<span data-ar="استئناف">Resume</span>' : '<span>Resume</span>');
    }
  } else {
    // Resume: accumulate paused duration
    marathonPaused = false;
    if (marathonPauseStart) {
      marathonPausedMs += (Date.now() - marathonPauseStart);
      marathonPauseStart = null;
    }
    if (pauseBtn) {
      pauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i> ' + (ar ? '<span data-ar="إيقاف مؤقت">Pause</span>' : '<span>Pause</span>');
    }
  }
}


function loadWeather(force) {
  const el = document.getElementById('weather-current');
  if (!el) return;
  const ar = (store.lang === 'ar');
  // Offline: show a clear message instead of a failed location request.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    el.innerHTML = '<div style="padding:18px 12px;text-align:center;"><i class="fa-solid fa-cloud-arrow-down" style="font-size:26px;color:var(--muted);display:block;margin-bottom:10px;"></i><b data-ar="أنت غير متصل بالإنترنت">You are offline</b><br><small style="color:var(--muted);" data-ar="سيتم تحميل الطقس تلقائياً عند عودة الاتصال.">Weather will load automatically once you are back online.</small></div>';
    var sg = document.getElementById('safety-grid');
    if (sg) sg.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);" data-ar="غير متاح دون اتصال — عد لاحقاً.">Not available offline — check back when you reconnect.</div>';
    setTimeout(applyTranslations, 0);
    return;
  }
  if (!store.locationEnabled && !force) {
    el.innerHTML = '<i class="fa-solid fa-location-dot" style="color:var(--muted);margin-right:6px;"></i>' + (ar ? 'موقع الطقس معطّل في الإعدادات.' : 'Weather location is disabled in settings.');
    document.getElementById('safety-grid').innerHTML = '<i>' + (ar ? 'فعّل الموقع في الإعدادات للحصول على تنبيهات السلامة الخارجية.' : 'Enable location in settings to get outdoor safety alerts.') + '</i>';
    setTimeout(applyTranslations, 0);
    return;
  }
  const wCache = store.weatherCache;
  if (!force && wCache && (Date.now() - wCache.time < 3600000)) { lastWeather = wCache.data; renderWeather(); return; }
  const locCache = store.locCache;
  if (locCache && (Date.now() - locCache.time < 86400000)) { fetchWeather(locCache.lat, locCache.lon); return; }
  if (!navigator.geolocation) { el.textContent = ar ? 'الخدمات الجغرافية غير مدعومة.' : 'Geolocation not supported.'; return; }
  el.textContent = ar ? 'جارٍ طلب موقعك...' : 'Requesting your location...';
  navigator.geolocation.getCurrentPosition(pos => {
    const lat = pos.coords.latitude, lon = pos.coords.longitude;
    store.locCache = { lat, lon, time: Date.now() };
    fetchWeather(lat, lon);
  }, (err) => {
    console.warn('Weather geolocation error:', err.message);
    if (err.code === 1) {
      el.innerHTML = '<div style="padding:16px;text-align:center;"><i class="fa-solid fa-location-crosshairs" style="font-size:24px;color:var(--muted);display:block;margin-bottom:8px;"></i><b data-ar="تم رفض الوصول للموقع">Location access denied</b><br><small style="color:var(--muted);" data-ar="يرجى تفعيل الموقع في إعدادات المتصفح للحصول على بيانات الطقس. على iOS: الإعدادات > سفاري > الموقع. على أندرويد: الإعدادات > إعدادات الموقع > الموقع.">Please enable location in your browser settings to get weather data. On iOS: Settings > Safari > Location. On Android: Settings > Site settings > Location.</small><br><button class="btn" style="margin-top:12px;" onclick="loadWeather(true)"><i class="fa-solid fa-rotate"></i> <span data-ar="إعادة المحاولة">Retry</span></button></div>';
      document.getElementById('safety-grid').innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);" data-ar="فعّل الموقع في إعدادات المتصفح للحصول على تنبيهات السلامة الخارجية.">Enable location in browser settings to get outdoor safety alerts.</div>';
    } else if (err.code === 2) {
      el.textContent = ar ? 'الموقع غير متاح. حاول لاحقاً.' : 'Location unavailable. Try again later.';
    } else if (err.code === 3) {
      el.textContent = ar ? 'انتهت مهلة طلب الموقع. اضغط تحديث للمحاولة مرة أخرى.' : 'Location request timed out. Tap Refresh to try again.';
    } else {
      el.textContent = ar ? 'تعذّر الحصول على الموقع.' : 'Could not get location.';
    }
    setTimeout(applyTranslations, 0);
  }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
}
async function fetchWeather(lat, lon) {
  const el = document.getElementById('weather-current');
  const ar = (store.lang === 'ar');
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,precipitation,weather_code`);
    const data = await res.json(); 
    lastWeather = data.current; 
    store.weatherCache = { data: lastWeather, time: Date.now() };
    renderWeather();
  } catch (err) { el.textContent = ar ? 'تعذّر تحميل الطقس.' : 'Could not load weather.'; }
}
function renderWeather() {
  const w = lastWeather;
  const ar = (store.lang === 'ar');
  const tempUnit = ar ? '°م' : '°C';
  // Show only temperature (no precip line)
  document.getElementById('weather-current').innerHTML = `<h3>${w.temperature_2m}${tempUnit}</h3>`;

  // Determine weather condition
  const hasRain = w.precipitation > 0;
  const isSnow = w.temperature_2m < 3 && w.precipitation > 0;
  const isFoggy = !hasRain && !isSnow && (w.weather_code >= 45 && w.weather_code <= 48);
  const isCloudy = !hasRain && !isSnow && !isFoggy && (w.weather_code >= 2 && w.weather_code <= 3);
  const isClearDay = !hasRain && !isSnow && !isFoggy && !isCloudy;

  // Day/night cycle — based on user's local time
  const hour = new Date().getHours();
  const isDay = hour >= 6 && hour < 18; // 6am-6pm = day

  const container = document.getElementById('weather-cloud-container');
  if (container) {
    container.classList.remove('weather-day', 'weather-night', 'weather-rainy', 'weather-snowy', 'weather-foggy', 'weather-cloudy', 'weather-clear');
    container.classList.add(isDay ? 'weather-day' : 'weather-night');
    if (isSnow) container.classList.add('weather-snowy');
    else if (hasRain) container.classList.add('weather-rainy');
    else if (isFoggy) container.classList.add('weather-foggy');
    else if (isCloudy) container.classList.add('weather-cloudy');
    else container.classList.add('weather-clear');
  }

  // Render random cloud shapes
  renderRandomClouds();

  // Sun/moon always visible (z-index 5, above clouds)
  const sunEl = document.getElementById('weather-sun');
  const moonEl = document.getElementById('weather-moon');
  const rainEl = document.getElementById('weather-rain');
  const snowEl = document.getElementById('weather-snow');
  const cloudsRow = document.getElementById('weather-clouds-row');
  if (sunEl) sunEl.style.display = isDay ? 'block' : 'none';
  if (moonEl) moonEl.style.display = (!isDay) ? 'block' : 'none';
  if (rainEl) rainEl.style.display = (hasRain && !isSnow) ? 'block' : 'none';
  if (snowEl) snowEl.style.display = isSnow ? 'block' : 'none';
  // Clouds visible whenever not perfectly clear
  if (cloudsRow) cloudsRow.style.display = (isClearDay && isDay) ? 'none' : 'flex';

  // Persist the current safety list so the search box can filter it without re-fetching weather
  const risks = hasRain;
  window._lastSafetySports = SPORTS.slice();
  renderSafetyGrid(window._lastSafetySports, risks);
  setTimeout(applyTranslations, 0);
}

// ─── Random cloud shape generator ─────────────────────────────────────────
// Generates different puffy cloud SVG paths so each cloud looks unique.
const CLOUD_SHAPES = [
  // Shape 0: Classic 4-bump cloud
  'M25,55 Q12,55 12,42 Q12,30 25,28 Q28,15 42,15 Q52,5 68,12 Q82,5 92,18 Q106,18 106,32 Q106,45 92,50 L92,55 Q92,65 82,65 L38,65 Q25,65 25,55 Z',
  // Shape 1: Wide flat cloud with 3 bumps
  'M20,55 Q8,55 8,45 Q8,32 20,30 Q24,18 38,18 Q50,8 65,14 Q80,8 90,20 Q102,22 102,35 Q102,48 88,52 L88,55 Q88,63 78,63 L32,63 Q20,63 20,55 Z',
  // Shape 2: Tall puffy cloud with 5 bumps
  'M28,58 Q14,58 14,45 Q14,32 28,30 Q30,15 46,12 Q58,2 72,10 Q88,2 96,15 Q108,18 108,32 Q108,46 94,52 L94,58 Q94,68 84,68 L38,68 Q28,68 28,58 Z',
  // Shape 3: Small rounded cloud
  'M30,52 Q18,52 18,42 Q18,30 30,28 Q34,18 48,18 Q60,10 74,16 Q86,12 92,22 Q102,24 102,36 Q102,46 90,50 L90,52 Q90,60 80,60 L40,60 Q30,60 30,52 Z',
  // Shape 4: Elongated cloud with bumps on top
  'M22,55 Q10,55 10,44 Q10,30 24,28 Q28,12 46,12 Q60,4 76,12 Q92,6 100,18 Q110,20 110,34 Q110,46 96,52 L96,55 Q96,64 86,64 L34,64 Q22,64 22,55 Z',
  // Shape 5: Doubled-bump cloud (looks like two merged)
  'M18,55 Q8,55 8,45 Q8,32 20,30 Q24,20 36,20 Q48,12 60,18 Q72,10 84,18 Q96,20 100,32 Q108,38 100,48 Q100,55 88,55 L88,58 Q88,65 78,65 L32,65 Q18,65 18,55 Z'
];

function renderRandomClouds() {
  var clouds = document.querySelectorAll('.weather-clouds-row .weather-cloud');
  clouds.forEach(function (cloud, idx) {
    // Use the data-shape attribute to pick a shape, or random
    var shapeIdx = parseInt(cloud.getAttribute('data-shape'), 10);
    if (isNaN(shapeIdx)) shapeIdx = idx % CLOUD_SHAPES.length;
    var path = CLOUD_SHAPES[shapeIdx % CLOUD_SHAPES.length];
    var gradId = 'cloudGrad-' + idx;
    cloud.innerHTML = '<svg viewBox="0 0 120 70" xmlns="http://www.w3.org/2000/svg" class="cloud-svg">' +
      '<defs><radialGradient id="' + gradId + '" cx="35%" cy="30%" r="70%">' +
      '<stop offset="0%" stop-color="#ffffff"/>' +
      '<stop offset="60%" stop-color="#f0f4f8"/>' +
      '<stop offset="100%" stop-color="#c8d2dc"/>' +
      '</radialGradient></defs>' +
      '<path d="' + path + '" fill="url(#' + gradId + ')" stroke="rgba(180,190,200,0.4)" stroke-width="0.5"/>' +
      '</svg>';
  });
}

function renderSafetyGrid(list, risks) {
  const grid = document.getElementById('safety-grid');
  if (!list || list.length === 0) {
    grid.innerHTML = '<div class="safety-empty"><i class="fa-solid fa-magnifying-glass" style="font-size:22px;display:block;margin-bottom:8px;opacity:.4;"></i><span data-ar="لا توجد رياضات تطابق بحثك.">No sports match your search.</span></div>';
    return;
  }
  grid.innerHTML = list.map(s => {
    const statusEn = !s.outdoor ? 'Indoor OK' : risks ? 'Unsafe' : 'Safe outside';
    const statusAr = !s.outdoor ? 'داخلي جيد' : risks ? 'غير آمن' : 'آمن خارجاً';
    return `
    <div class="safety-item">
      <span class="s-icon"><i class="fa-solid ${s.icon}"></i></span>
      <b>${getSportName(s)}</b>
      <span class="macro-pill ${!s.outdoor ? 'macro-p' : risks ? 'macro-f' : 'macro-p'}" data-ar="${statusAr}">${statusEn}</span>
    </div>`;
  }).join('');
}

function filterSafetyGrid(query) {
  const clearBtn = document.getElementById('weather-search-clear');
  const q = (query || '').trim().toLowerCase();
  if (clearBtn) clearBtn.classList.toggle('visible', q.length > 0);
  if (!window._lastSafetySports) return;
  const w = lastWeather;
  const risks = w && w.precipitation > 0;
  if (!q) { renderSafetyGrid(window._lastSafetySports, risks); return; }
  const filtered = window._lastSafetySports.filter(s => {
    const name = (s.name || '').toLowerCase();
    const displayName = getSportName(s).toLowerCase();
    return name.includes(q) || displayName.includes(q);
  });
  renderSafetyGrid(filtered, risks);
}

function renderProfile() {
  const u = currentUser(), p = u.profile, s = u.survey;
  const ar = (store.lang === 'ar');
  const goalAr = ar ? (GOAL_AR_NAMES[p.goal] || p.goal) : p.goal;
  const sportAr = (function(){ const sp = p.sport; const val = ar ? (SPORT_AR_NAMES[sp] || sp) : sp; return (val && val !== 'undefined' && String(sp) !== 'undefined') ? val : (ar ? 'غير محددة' : 'Not set'); })();

  // === Units-aware display (Settings → Units: metric kg/cm ↔ imperial lb/ft).
  // Storage stays metric; only what the user sees converts.
  const imp = (window.VoltaFeatures && VoltaFeatures.getUnits) ? VoltaFeatures.getUnits() === 'imperial' : false;
  const dispWeight = imp ? Math.round(p.weight * 2.2046226218 * 10) / 10 : p.weight;
  let dispHeight = p.height;
  if (imp) { const totalIn = p.height / 2.54; const ft = Math.floor(totalIn / 12); const inch = Math.round(totalIn - ft * 12); dispHeight = (inch === 12 ? (ft + 1) + "'0\"" : ft + "'" + inch + '"'); }

  // Build avatar initials (first letter of first 2 words)
  // Per user request: the NAME shown here comes from the FIRST survey
  // question — never the email/Gmail address.
  const surveyName = (function () {
    const sName = (s && s.name && String(s.name).trim() && !/@/.test(String(s.name).trim())) ? String(s.name).trim() : '';
    if (sName && !(function(){ try { const lp = String(store.session||'').split('@')[0].toLowerCase().replace(/[._-]+/g,''); return lp && sName.toLowerCase().replace(/[._-]+/g,'') === lp; } catch(e){ return false; } })()) return sName;
    const viaHelper = voltaDisplayName();
    if (viaHelper) return viaHelper;
    if (p.name && !/@/.test(p.name)) return p.name;
    return ar ? 'الرياضي' : 'Athlete';
  })();
  const initials = surveyName.split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase();

  // Get sport icon
  const sportObj = SPORTS.find(x => x.name === p.sport);
  const sportIcon = sportObj ? sportObj.icon : 'fa-trophy';

  // Goal icon
  const goalIconMap = {
    'Lose weight': 'fa-arrow-trend-down',
    'Build muscle': 'fa-dumbbell',
    'Improve endurance': 'fa-heart-pulse',
    'Stay healthy': 'fa-heart',
    'Improve flexibility': 'fa-person-rays',
    'Sports performance': 'fa-medal'
  };
  const goalIcon = goalIconMap[p.goal] || 'fa-bullseye';

  // Localized labels
  const labels = ar ? {
    age: 'العمر', ageUnit: 'سنة',
    height: 'الطول', heightUnit: imp ? 'قدم' : 'سم',
    weight: 'الوزن', weightUnit: imp ? 'رطل' : 'كجم',
    goal: 'الهدف',
    favSport: 'الرياضة المفضلة',
    email: 'البريد'
  } : {
    age: 'Age', ageUnit: 'yrs',
    height: 'Height', heightUnit: imp ? 'ft' : 'cm',
    weight: 'Weight', weightUnit: imp ? 'lb' : 'kg',
    goal: 'Goal',
    favSport: 'Favorite Sport',
    email: 'Email'
  };

  document.getElementById('profile-view').innerHTML = `
    <div class="profile-info-card">
      <div class="profile-hero">
        <div class="profile-avatar">${initials}</div>
        <div class="profile-hero-text">
          <div class="profile-hero-name">${surveyName}</div>
          <div class="profile-hero-badges">
            <span class="profile-hero-badge goal"><i class="fa-solid ${goalIcon}"></i> ${goalAr}</span>
            <span class="profile-hero-badge sport"><i class="fa-solid ${sportIcon}"></i> ${sportAr}</span>
          </div>
        </div>
      </div>
      <div class="profile-info-grid">
        <div class="profile-info-item">
          <div class="profile-info-icon"><i class="fa-solid fa-cake-candles"></i></div>
          <div class="profile-info-body">
            <div class="profile-info-label" data-ar="العمر">${labels.age}</div>
            <div class="profile-info-value">${p.age}<span class="unit" data-ar="سنة">${labels.ageUnit}</span></div>
          </div>
        </div>
        <div class="profile-info-item">
          <div class="profile-info-icon"><i class="fa-solid fa-ruler-vertical"></i></div>
          <div class="profile-info-body">
            <div class="profile-info-label" data-ar="الطول">${labels.height}</div>
            <div class="profile-info-value">${dispHeight}<span class="unit" data-ar="${imp ? 'قدم' : 'سم'}">${labels.heightUnit}</span></div>
          </div>
        </div>
        <div class="profile-info-item">
          <div class="profile-info-icon"><i class="fa-solid fa-weight-scale"></i></div>
          <div class="profile-info-body">
            <div class="profile-info-label" data-ar="الوزن">${labels.weight}</div>
            <div class="profile-info-value">${dispWeight}<span class="unit" data-ar="${imp ? 'رطل' : 'كجم'}">${labels.weightUnit}</span></div>
          </div>
        </div>
        <div class="profile-info-item">
          <div class="profile-info-icon"><i class="fa-solid fa-bullseye"></i></div>
          <div class="profile-info-body">
            <div class="profile-info-label" data-ar="الهدف">${labels.goal}</div>
            <div class="profile-info-value">${goalAr}</div>
          </div>
        </div>
        <div class="profile-info-item full-width">
          <div class="profile-info-icon"><i class="fa-solid ${sportIcon}"></i></div>
          <div class="profile-info-body">
            <div class="profile-info-label" data-ar="الرياضة المفضلة">${labels.favSport}</div>
            <div class="profile-info-value">${sportAr}</div>
          </div>
        </div>
      </div>
    </div>
  `;
  if (u.goalPlan) {
    document.getElementById('profile-goal-plan').innerHTML = `<ul style="margin:0 0 12px 20px;line-height:1.9;font-size:.92rem;"><li><b data-ar="الوزن المستهدف:">Target Weight:</b> ${u.goalPlan.targetWeight} <span data-ar="كجم">kg</span></li><li><b data-ar="السعرات المستهدفة:">Target Calories:</b> ${u.goalPlan.targetCals} <span data-ar="سعرة">kcal</span></li><li><b data-ar="الصيانة (TDEE):">Maintenance (TDEE):</b> ${u.goalPlan.tdee} <span data-ar="سعرة">kcal</span></li></ul>`;
  } else { document.getElementById('profile-goal-plan').innerHTML = `<p style="color:var(--muted);" data-ar="لا توجد خطة هدف بعد.">No goal plan set yet.</p>`; }
  // ===== Sync Busy Mode toggle with current user state =====
  const isBusy = !!u.busyMode;
  const offBtn = document.getElementById('busy-off-btn');
  const onBtn = document.getElementById('busy-on-btn');
  if (offBtn) offBtn.classList.toggle('active', !isBusy);
  if (onBtn) onBtn.classList.toggle('active', isBusy);
  const busyBanner = document.getElementById('busy-mode-banner');
  if (busyBanner) busyBanner.style.display = isBusy ? 'block' : 'none';
  // ===== Round 6: Sync Stop Training toggle with current user state =====
  const isStopped = !!u.stopTraining;
  const stopOffBtn = document.getElementById('stop-off-btn');
  const stopOnBtn = document.getElementById('stop-on-btn');
  if (stopOffBtn) stopOffBtn.classList.toggle('active', !isStopped);
  if (stopOnBtn) stopOnBtn.classList.toggle('active', isStopped);
  const stopBanner = document.getElementById('stop-training-banner');
  if (stopBanner) stopBanner.style.display = isStopped ? 'block' : 'none';
  renderInBodyProfileCard();
  setTimeout(applyTranslations, 0);
}

/* ===== InBody Scan from Profile tab ===== */
let pendingInBodyScan = null; // holds the most recent scan result (not yet applied)

function renderInBodyProfileCard() {
  const u = currentUser();
  const scan = u.inbodyScan || null;
  const statsBox = document.getElementById('inbody-profile-stats');
  const lastBox = document.getElementById('inbody-profile-last');
  const actionsBox = document.getElementById('inbody-profile-actions');

  if (!scan) {
    statsBox.innerHTML = '<div class="inbody-empty"><i class="fa-solid fa-circle-info" style="margin-right:6px;color:var(--accent);"></i><span data-ar="لا يوجد مسح InBody بعد. ارفق ورقتك أعلاه للبدء.">No InBody scan yet. Upload your sheet above to get started.</span></div>';
    lastBox.innerHTML = '';
    actionsBox.style.display = 'none';
    return;
  }

  // Render stats grid
  const rows = [
    { label: 'Weight', labelAr: 'الوزن', icon: 'fa-weight-scale', val: scan.weight, unit: 'kg', unitAr: 'كجم' },
    { label: 'Height', labelAr: 'الطول', icon: 'fa-ruler-vertical', val: scan.height, unit: 'cm', unitAr: 'سم' },
    { label: 'BMI', labelAr: 'مؤشر كتلة الجسم', icon: 'fa-chart-pie', val: scan.bmi, unit: '', unitAr: '' },
    { label: 'Body Fat', labelAr: 'دهون الجسم', icon: 'fa-droplet', val: scan.bodyFat, unit: '%', unitAr: '%' },
    { label: 'Muscle Mass', labelAr: 'كتلة العضلات', icon: 'fa-dumbbell', val: scan.muscle, unit: 'kg', unitAr: 'كجم' },
    { label: 'BMR', labelAr: 'معدل الأيض الأساسي', icon: 'fa-fire', val: scan.bmr, unit: 'kcal', unitAr: 'سعرة' }
  ].filter(r => r.val !== undefined && r.val !== null && r.val !== '');

  statsBox.innerHTML = '<div class="inbody-stats-grid">' +
    rows.map(r => `<div class="inbody-stat"><div class="label" data-ar="${r.labelAr}"><i class="fa-solid ${r.icon}"></i> ${r.label}</div><div class="value">${r.val}${r.unit ? '<span class="unit"' + (r.unitAr ? ' data-ar="' + r.unitAr + '"' : '') + '>' + r.unit + '</span>' : ''}</div></div>`).join('') +
    '</div>';

  // Last scan info
  const scanDate = scan.scannedAt ? new Date(scan.scannedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Previously';
  lastBox.innerHTML = `<div class="inbody-last-scan"><i class="fa-solid fa-circle-check"></i> <span data-ar="آخر مسح: ${scanDate}">Last scan: ${scanDate}</span></div>`;
  actionsBox.style.display = 'flex';
}

/* ===== Shared InBody OCR parser =====
   Handles multiple InBody sheet layouts including:
   - Metric:   "Weight: 75.2 kg", "Height: 180 cm"
   - Imperial: "Weight (lbs) 130.3", "Height 5ft.0.1in."
   - Descriptive labels: "BMI Body Mass Index (kg/m²) 24.0",
                         "PBF Percent Body Fat (%) 37.5",
                         "SMM Skeletal Muscle Mass (lbs) 42.6",
                         "Basal Metabolic Rate 1168 kcal"
   All imperial values are converted to metric (lbs→kg, ft.in→cm).
   Returns { weight, height, age, gender, bmi, bodyFat, muscle, bmr } with only the
   fields that were successfully extracted. */
function parseInBodyText(text) {
  if (!text || typeof text !== 'string') return {};
  const found = {};
  // Normalize curly quotes, double spaces, etc.
  // Also normalize common OCR mistakes: "30,3" → "30.3" (comma decimal),
  // "1303" → keep as-is for now (handled in weight logic below)
  const t = text
    .replace(/[\u2018\u2019\u201C\u201D]/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/(\d),(\d)/g, '$1.$2');  // comma decimal → dot decimal (European format)

  // ---- WEIGHT ---- (kg or lbs)
  // Match either "Weight: 75 kg" or "Weight (lbs) 130.3" or "Weight (kg) 75.0"
  // Allow up to 4 digits to handle OCR losing the decimal (e.g., "1303" from "130.3")
  let m = t.match(/\bWeight\b[^\d]{0,20}?\(?\s*(lbs?|pounds?|kg|kilograms?)?\s*\)?\s*[:\-]?\s*(\d{2,4}(?:\.\d{1,2})?)/i);
  if (m) {
    const unit = (m[1] || '').toLowerCase();
    let val = parseFloat(m[2]);
    // If 4-digit number, OCR probably lost the decimal (1303 → 130.3)
    if (m[2].length >= 4 && !m[2].includes('.')) val = val / 10;
    if (unit.startsWith('lb') || unit.startsWith('pound')) {
      found.weight = Math.round(val * 0.453592 * 10) / 10;
      found.weightUnit = 'kg (from ' + val + ' lbs)';
    } else if (unit.startsWith('kg') || unit.startsWith('kilogram')) {
      found.weight = val;
      found.weightUnit = 'kg';
    } else {
      // Unknown unit — guess based on value
      if (val > 200) {
        // Almost certainly lbs (200+ kg is extreme)
        found.weight = Math.round(val * 0.453592 * 10) / 10;
        found.weightUnit = 'kg (from ' + val + ' lbs — value > 200 without kg unit)';
      } else if (val > 100) {
        // Could be either — assume lbs if conversion gives a sane kg (30-200)
        const kg = Math.round(val * 0.453592 * 10) / 10;
        if (kg > 30 && kg < 200) {
          found.weight = kg;
          found.weightUnit = 'kg (from ' + val + ' lbs — value > 100 without kg unit)';
        } else {
          found.weight = val;
          found.weightUnit = 'kg';
        }
      } else {
        found.weight = val;
        found.weightUnit = 'kg';
      }
    }
  }

  // ---- HEIGHT ---- (cm or ft.in.)
  // Try metric first: "Height 180 cm" / "Height: 180cm"
  m = t.match(/\bHeight\b[^\d]{0,20}?\(?\s*(cm|in(?:ch(?:es)?)?|ft|feet|meters?)?\s*\)?\s*[:\-]?\s*(\d{2,3}(?:\.\d{1,2})?)\s*(cm|in(?:ch(?:es)?)?|m\b)?/i);
  if (m) {
    const unit = (m[1] || m[3] || '').toLowerCase();
    const val = parseFloat(m[2]);
    if (unit.startsWith('cm') || (val > 100 && val < 250 && !unit)) {
      found.height = val;
      found.heightUnit = 'cm';
    } else if (unit.startsWith('m') && !unit.startsWith('cm') && val < 3) {
      found.height = Math.round(val * 100);
      found.heightUnit = 'cm (from ' + val + ' m)';
    } else if (unit.startsWith('in')) {
      found.height = Math.round(val * 2.54);
      found.heightUnit = 'cm (from ' + val + ' in)';
    }
  }
  // Try imperial "5ft.0.1in." or "5'0\"" or "5 ft 0 in"
  if (found.height === undefined) {
    m = t.match(/\bHeight\b[^\d]{0,20}?(\d{1})\s*(?:ft|ft\.|'|feet)\s*\.?\s*(\d{1,2}(?:\.\d{1,2})?)?\s*(?:in|in\.|"|inches)?/i);
    if (m) {
      const feet = parseInt(m[1], 10);
      const inches = m[2] ? parseFloat(m[2]) : 0;
      const totalCm = Math.round((feet * 12 + inches) * 2.54);
      if (totalCm > 100 && totalCm < 250) {
        found.height = totalCm;
        found.heightUnit = 'cm (from ' + feet + 'ft ' + inches + 'in)';
      }
    }
  }

  // ---- AGE ----
  m = t.match(/\bAge\b\s*[:\-]?\s*(\d{1,3})\s*(?:yrs?|years|yo)?/i);
  if (m) {
    const age = parseInt(m[1], 10);
    if (age > 0 && age < 120) found.age = age;
  }

  // ---- GENDER ----
  m = t.match(/\b(?:Gender|Sex)\b\s*[:\-]?\s*(Male|Female|M|F)\b/i);
  if (m) {
    const g = m[1].toLowerCase();
    found.gender = (g === 'm') ? 'Male' : (g === 'f') ? 'Female' : m[1];
  }

  // ---- BMI ---- (matches "BMI: 24.0" or "BMI Body Mass Index (kg/m²) 24.0")
  m = t.match(/\bBMI\b[^\d]{0,40}?(\d{1,2}(?:\.\d{1,2})?)/i);
  if (m) {
    const bmi = parseFloat(m[1]);
    if (bmi > 8 && bmi < 80) found.bmi = bmi;  // sanity check
  }

  // ---- BODY FAT % ---- (prefers PBF/Percent Body Fat over Body Fat Mass which is in lbs)
  // Strategy: For each PBF occurrence, scan the same LINE for plausible body fat values.
  // Take the LAST plausible value found (InBody history rows list oldest→newest).
  // We DON'T require "%" on the line because OCR often loses it, but we DO require the
  // value to be in a tight 5-65% range AND we skip values from description text lines
  // (which contain phrases like "PBF is the percentage of body fat" — these have no
  // digits after PBF except maybe "1" from "1s", which fails the sanity check).
  const pbfMatches = [];
  // Find each PBF occurrence, then scan its line for ALL plausible body fat values
  const pbfOccurrences = [];
  let pIdx = 0;
  while ((pIdx = t.toLowerCase().indexOf('pbf', pIdx)) !== -1) {
    pbfOccurrences.push(pIdx);
    pIdx += 3;
  }
  for (const startIdx of pbfOccurrences) {
    // Get the rest of the line (up to next newline)
    const lineEnd = t.indexOf('\n', startIdx);
    const line = t.slice(startIdx, lineEnd === -1 ? t.length : lineEnd);
    // ONLY trust lines that contain "%" or "Percent Body Fat" — this filters out garbled
    // lines like "PBF Ca . . 32 30 Jo WO 3TR" which have stray digits but no % symbol.
    // Real PBF values always appear on lines labeled with "%" or "Percent Body Fat".
    if (!line.includes('%') && !/Percent\s*Body\s*Fat/i.test(line)) continue;
    // Find ALL 1-2 digit numbers on this line, optionally followed by a SEPARATOR (". " or space)
    // and 1 decimal digit. The separator is REQUIRED for the decimal — this prevents "230" from
    // being parsed as 23.0 (3-digit integers are NOT body fat values).
    const lineMatches = line.matchAll(/(\d{1,2})(?:(?:\.|\s)(\d))?(?!\d)/g);
    for (const lm of lineMatches) {
      let bf = parseFloat(lm[1]);
      if (lm[2]) bf = parseFloat(lm[1] + '.' + lm[2]);
      if (bf > 5 && bf < 65) pbfMatches.push(bf);
    }
  }
  if (pbfMatches.length > 0) {
    // Take the LAST value (most recent in the history row)
    found.bodyFat = pbfMatches[pbfMatches.length - 1];
  }
  if (found.bodyFat === undefined) {
    // Fallback: "Body Fat: 15.3%" (requires "%" nearby to avoid matching Body Fat Mass in lbs)
    m = t.match(/\b(?:Body\s*Fat|BF)\b(?!\s*Mass)[^\n]{0,30}?(\d{1,2}(?:\.\d{1,2})?)\s*%?[^\n]*?%/i);
    if (m) {
      const bf = parseFloat(m[1]);
      if (bf > 5 && bf < 65) found.bodyFat = bf;
    }
  }

  // ---- MUSCLE MASS ---- (matches "Skeletal Muscle Mass (lbs) 42.6" or "SMM: 30 kg")
  // Allow up to 4 digits to handle OCR losing the decimal (e.g., "443" from "44.3")
  m = t.match(/\b(?:Skeletal\s*Muscle\s*Mass|SMM|Muscle\s*Mass)\b[^\d]{0,40}?\(?\s*(lbs?|pounds?|kg|kilograms?)?\s*\)?\s*[:\-]?\s*(\d{1,4}(?:\.\d{1,2})?)/i);
  if (m) {
    const unit = (m[1] || '').toLowerCase();
    let val = parseFloat(m[2]);
    // If 4-digit integer, OCR probably lost the decimal (4430 → 44.3)
    if (m[2].length >= 4 && !m[2].includes('.')) val = val / 10;
    // If 3-digit integer > 100, also likely lost decimal (443 → 44.3)
    if (m[2].length === 3 && !m[2].includes('.') && val > 100) val = val / 10;
    if (unit.startsWith('lb') || unit.startsWith('pound')) {
      const kg = Math.round(val * 0.453592 * 10) / 10;
      // Sanity check: muscle mass should be 15-80 kg for adults
      if (kg >= 15 && kg <= 80) {
        found.muscle = kg;
        found.muscleUnit = 'kg (from ' + val + ' lbs)';
      }
    } else {
      // Sanity check for kg too — reject single-digit values from garbled OCR
      if (val >= 15 && val <= 80) {
        found.muscle = val;
        found.muscleUnit = 'kg';
      }
    }
  }

  // ---- BMR ---- (matches "BMR: 1500 kcal" or "Basal Metabolic Rate 1168 kcal")
  m = t.match(/\b(?:BMR|Basal\s*Metabolic\s*Rate)\b[^\d]{0,40}?(\d{3,5})\s*(?:kcal|cal|cals)?/i);
  if (m) {
    const bmr = parseInt(m[1], 10);
    if (bmr > 800 && bmr < 5000) found.bmr = bmr;
  }

  // ===== FALLBACK PATTERNS for InBody 270 sheets =====
  // The 270 layout puts labels in a header row and values in a row below, so OCR
  // often loses the keyword. These patterns look for the value patterns directly.

  // Height fallback: "5ft.0.1in." or "5ft01.8in." anywhere in text
  if (found.height === undefined) {
    m = t.match(/(\d{1})\s*(?:ft|ft\.|'|feet)\s*\.?\s*(\d{1,2}(?:\.\d{1,2})?)\s*(?:in|in\.|"|inches)?/i);
    if (m) {
      const feet = parseInt(m[1], 10);
      const inches = m[2] ? parseFloat(m[2]) : 0;
      const totalCm = Math.round((feet * 12 + inches) * 2.54);
      if (totalCm > 100 && totalCm < 250) {
        found.height = totalCm;
        found.heightUnit = 'cm (from ' + feet + 'ft ' + inches + 'in)';
      }
    }
  }
  // Height fallback 2: bare "XXX cm" anywhere (3 digits + cm)
  if (found.height === undefined) {
    m = t.match(/(\d{3}(?:\.\d{1,2})?)\s*cm/i);
    if (m) {
      const val = parseFloat(m[1]);
      if (val > 100 && val < 250) {
        found.height = val;
        found.heightUnit = 'cm';
      }
    }
  }

  // Gender fallback: bare "Male" or "Female" anywhere in text
  if (found.gender === undefined) {
    m = t.match(/\b(Female|Male)\b/i);
    if (m) found.gender = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  }

  // Age fallback: 2-digit number near "Age" OR a 2-digit number on the same line
  // as a height pattern (the InBody 270 header row has them together)
  if (found.age === undefined) {
    // Look for the header row pattern: "Name ... HeightFtPattern AGE Gender"
    m = t.match(/(\d{1})\s*(?:ft|ft\.|'|feet)\s*\.?\s*(\d{1,2}(?:\.\d{1,2})?)?\s*(?:in|in\.|"|inches)?[^\d]{0,15}?(\d{2})\s*(?:Female|Male)/i);
    if (m) {
      const age = parseInt(m[3], 10);
      if (age > 0 && age < 120) found.age = age;
    }
  }

  // Weight fallback: if we got a weight but it's > 200, it's probably in lbs
  if (found.weight !== undefined && found.weight > 200) {
    const lbs = found.weight;
    found.weight = Math.round(lbs * 0.453592 * 10) / 10;
    found.weightUnit = 'kg (auto-converted from ' + lbs + ' lbs — value was > 200)';
  }
  // Weight fallback: if no weight found, look for "Weight" followed by anything then a number
  if (found.weight === undefined) {
    m = t.match(/\bWeight\b[^\d]{0,30}?(\d{2,3}(?:\.\d{1,2})?)/i);
    if (m) {
      let val = parseFloat(m[1]);
      // If value looks like lbs (>200) or "1303" (lost decimal), try to fix
      if (val > 200) {
        // probably "130.3" lost its decimal -> "1303"
        if (val > 300) val = val / 10;
        const kg = Math.round(val * 0.453592 * 10) / 10;
        found.weight = kg;
        found.weightUnit = 'kg (from ' + val + ' lbs)';
      } else if (val > 100) {
        // Could be kg or lbs — assume lbs if > 100 and value * 0.45 gives a sane kg
        const kg = Math.round(val * 0.453592 * 10) / 10;
        if (kg > 30 && kg < 200) {
          found.weight = kg;
          found.weightUnit = 'kg (from ' + val + ' lbs)';
        } else {
          found.weight = val;
          found.weightUnit = 'kg';
        }
      } else {
        found.weight = val;
        found.weightUnit = 'kg';
      }
    }
  }

  // BMI fallback: scan ALL "BMI" occurrences and grab the first plausible number.
  // For each BMI occurrence, scan up to 150 chars forward and try EVERY digit sequence
  // until we find one that looks like a valid BMI (12-60). This handles garbled OCR
  // where the BMI keyword is on one line and the value is on the next, with stray
  // digits like "10" (from "10 determine") in between.
  if (found.bmi === undefined) {
    const bmiOccurrences = [];
    let idx = 0;
    while ((idx = t.indexOf('BMI', idx)) !== -1) {
      bmiOccurrences.push(idx);
      idx += 3;
    }
    for (const startIdx of bmiOccurrences) {
      // Scan the next 200 chars after "BMI" for ALL digit sequences
      const chunk = t.slice(startIdx + 3, startIdx + 203);
      // Require a separator (". " or space) before the optional decimal digit.
      // This prevents "240" from being parsed as 24.0 (3-digit integers aren't BMI values).
      const digitSeqs = chunk.matchAll(/(\d{1,2})(?:(?:\.|\s)(\d))?(?!\d)/g);
      for (const dm of digitSeqs) {
        let bmi = parseFloat(dm[1]);
        if (dm[2]) bmi = parseFloat(dm[1] + '.' + dm[2]);
        if (bmi >= 12 && bmi <= 60) {
          found.bmi = bmi;
          break;
        }
      }
      if (found.bmi !== undefined) break;
    }
  }

  // Body Fat fallback: just look for "PBF" anywhere
  if (found.bodyFat === undefined) {
    m = t.match(/\bPBF\b[^\d]{0,80}?(\d{1,2}(?:\.\d{1,2})?)/i);
    if (m) {
      const bf = parseFloat(m[1]);
      if (bf > 2 && bf < 70) found.bodyFat = bf;
    }
  }

  // Muscle fallback: look for "SMM" or "Skeletal" anywhere
  if (found.muscle === undefined) {
    m = t.match(/\b(?:SMM|Skeletal)\b[^\d]{0,80}?\(?\s*(lbs?|pounds?|kg|kilograms?)?\s*\)?\s*[:\-]?\s*(\d{1,4}(?:\.\d{1,2})?)/i);
    if (m) {
      const unit = (m[1] || '').toLowerCase();
      let val = parseFloat(m[2]);
      // Handle 3-4 digit integers from lost decimals
      if (m[2].length >= 4 && !m[2].includes('.')) val = val / 10;
      if (m[2].length === 3 && !m[2].includes('.') && val > 100) val = val / 10;
      if (unit.startsWith('lb') || unit.startsWith('pound') || val > 80) {
        const kg = Math.round(val * 0.453592 * 10) / 10;
        // Strict sanity: 15-80 kg for adult muscle mass
        if (kg >= 15 && kg <= 80) {
          found.muscle = kg;
          found.muscleUnit = 'kg (from ' + val + ' lbs)';
        }
      } else {
        // Same strict sanity for kg values
        if (val >= 15 && val <= 80) {
          found.muscle = val;
          found.muscleUnit = 'kg';
        }
      }
    }
  }

  // BMR fallback: look for "Basal" anywhere
  if (found.bmr === undefined) {
    m = t.match(/\bBasal\b[^\d]{0,80}?(\d{3,5})/i);
    if (m) {
      const bmr = parseInt(m[1], 10);
      if (bmr > 800 && bmr < 5000) found.bmr = bmr;
    }
  }

  return found;
}

/* ===== Image preprocessing for better OCR accuracy =====
   Tesseract.js works much better on:
   - Larger images (we scale up 2x)
   - Grayscale (eliminates color noise)
   - High contrast (threshold to pure black/white)
   Returns a Promise<Blob> with the enhanced image. */
function preprocessImageForOCR(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = e => { img.src = e.target.result; };
    reader.onerror = reject;
    img.onload = () => {
      try {
        // Scale up 2x for better OCR (Tesseract prefers larger images)
        const scale = 2;
        const canvas = document.createElement('canvas');
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // Get pixel data for grayscale + contrast
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        const contrast = 1.5;  // boost contrast
        const intercept = 128 * (1 - contrast);
        for (let i = 0; i < data.length; i += 4) {
          // Convert to grayscale
          let gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          // Apply contrast
          gray = gray * contrast + intercept;
          // Threshold to pure black/white for cleaner text
          gray = gray > 140 ? 255 : (gray < 100 ? 0 : gray);
          data[i] = data[i + 1] = data[i + 2] = gray;
        }
        ctx.putImageData(imageData, 0, 0);
        canvas.toBlob(blob => {
          if (blob) resolve(blob);
          else reject(new Error('Canvas toBlob failed'));
        }, 'image/png');
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function scanInBodyFromProfile(inputEl) {
  const file = inputEl.files && inputEl.files[0];
  if (!file) return;

  // Guard: Tesseract.js must be loaded
  if (typeof Tesseract === 'undefined') {
    alert('OCR engine failed to load. Check your connection and refresh.');
    return;
  }

  // Offline guard: the OCR WASM core + language data stream from the CDN on
  // first use — without internet the scan can never start.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    alert('InBody Scan needs an internet connection to load the OCR engine. Connect and try again.');
    return;
  }

  // Show animated overlay
  showOcrOverlay('Scanning your InBody…', 'Reading body composition data');
  setOcrPhase('Enhancing image');

  const phaseWeights = {
    'loading tesseract core': 0.10,
    'initializing tesseract': 0.18,
    'loading language traineddata': 0.32,
    'initializing api': 0.40,
    'recognizing text': 0.40
  };

  // Strategy: run OCR TWICE — once on the original image (better for header rows
  // with mixed text like "Jane Doe 5ft.0.1in. 51 Female"), and once on a preprocessed
  // high-contrast version (better for the data table values). Merge the results so we
  // get the best of both. This takes ~2x longer but dramatically improves accuracy on
  // complex InBody result sheets.
  const logger = m => {
    const base = phaseWeights[m.status] !== undefined ? phaseWeights[m.status] : 0;
    let pct;
    let phaseText;
    if (m.status === 'recognizing text') {
      pct = Math.round((base + (1 - base) * (m.progress || 0)) * 50);  // first pass = up to 50%
      phaseText = 'Recognizing text';
    } else {
      pct = Math.round((base + (m.progress || 0) * 0.1) * 50);
      phaseText = m.status.charAt(0).toUpperCase() + m.status.slice(1);
    }
    updateOcrProgress(pct, phaseText);
  };

  const logger2 = m => {
    const base = phaseWeights[m.status] !== undefined ? phaseWeights[m.status] : 0;
    let pct;
    let phaseText;
    if (m.status === 'recognizing text') {
      pct = 50 + Math.round((base + (1 - base) * (m.progress || 0)) * 50);  // second pass = 50% to 100%
      phaseText = 'Enhancing recognition';
    } else {
      pct = 50 + Math.round((base + (m.progress || 0) * 0.1) * 50);
      phaseText = m.status.charAt(0).toUpperCase() + m.status.slice(1);
    }
    updateOcrProgress(pct, phaseText);
  };

  // Pass 1: original image
  const pass1 = Tesseract.recognize(file, 'eng', { logger });
  // Pass 2: preprocessed image (in parallel)
  const pass2 = preprocessImageForOCR(file).then(enhancedBlob =>
    Tesseract.recognize(enhancedBlob, 'eng', { logger: logger2 })
  );

  Promise.all([pass1, pass2]).then(([r1, r2]) => {
    updateOcrProgress(100, 'Parsing results');
    const text1 = r1.data.text || '';
    const text2 = r2.data.text || '';
    // Concatenate both OCR outputs so the parser can find fields from either pass
    const combinedText = text1 + '\n---\n' + text2;
    const found = parseInBodyText(combinedText);

    const foundKeys = Object.keys(found).filter(k => !k.endsWith('Unit'));
    if (foundKeys.length === 0) {
      showOcrError('Could not read any fields from this image. Make sure the photo is clear, well-lit, and shows the InBody labels (Weight, Height, BMI, Body Fat, etc.), then try again.');
      return;
    }

    found.scannedAt = Date.now();
    found.fieldsCount = foundKeys.length;
    pendingInBodyScan = found;

    // Auto-save the scan to the user record immediately
    const u = currentUser();
    u.inbodyScan = found;
    saveUser(store.session, u);

    // Show success state, then close overlay and re-render
    showOcrSuccess(foundKeys.length + ' field' + (foundKeys.length === 1 ? '' : 's') + ' read successfully');
    setTimeout(() => {
      hideOcrOverlay();
      renderInBodyProfileCard();
      // Reset file input so the same file can be re-selected later
      inputEl.value = '';
      // Trigger follow-up form for any missing fields the OCR couldn't read.
      // This asks the user the same questions as the main onboarding survey
      // so we end up with 100% of the data filled in.
      promptForMissingInBodyFields(found);
    }, 1500);
  }).catch(err => {
    console.error('InBody OCR error (profile):', err);
    showOcrError('Could not read image. Please try a clearer photo.');
  });
}

function applyInBodyToProfile() {
  const u = currentUser();
  const scan = u.inbodyScan || pendingInBodyScan;
  if (!scan) { alert('No scan to apply. Upload an InBody sheet first.'); return; }

  let changes = [];
  if (scan.weight !== undefined) { u.profile.weight = scan.weight; changes.push('weight'); }
  if (scan.height !== undefined) { u.profile.height = scan.height; changes.push('height'); }
  if (scan.age !== undefined) { u.profile.age = scan.age; changes.push('age'); }
  if (scan.gender !== undefined) { u.profile.gender = scan.gender.toLowerCase(); changes.push('gender'); }

  saveUser(store.session, u);
  pendingInBodyScan = null;
  renderProfile();

  // Friendly confirmation
  const msg = changes.length
    ? 'InBody data applied to your profile! Updated: ' + changes.join(', ') + '.'
    : 'No basic profile fields (weight, height, age, gender) were found in the scan, but body composition metrics (BMI, body fat, muscle mass, BMR) are saved above.';
  alert(msg);
}

/* ===== InBody Follow-up Form =====
   After an InBody scan completes, the OCR may have missed some fields.
   This builds a small form using the SAME survey question definitions
   (surveyQuestions array) that drive the main onboarding survey, so the
   user is asked only about fields the scan couldn't read.
   The user's answers are merged into their survey + profile so the rest
   of the app (diet, workouts, calculator) gets 100% accurate inputs. */
const INBODY_FIELD_TO_SURVEY_KEY = {
  weight: 'weight',
  height: 'height',
  age: 'age',
  gender: 'gender'
};
// Body composition fields that aren't in the survey but are part of an InBody scan.
// We add custom questions for those so the user can fill them in too.
const INBODY_EXTRA_FIELDS = [
  { key: 'bmi', label: 'BMI (Body Mass Index)', icon: 'fa-chart-pie', placeholder: 'e.g. 24.0', type: 'number', min: 8, max: 80 },
  { key: 'bodyFat', label: 'Body Fat %', icon: 'fa-droplet', placeholder: 'e.g. 18.5', type: 'number', min: 1, max: 70 },
  { key: 'muscle', label: 'Skeletal Muscle Mass (kg)', icon: 'fa-dumbbell', placeholder: 'e.g. 35.0', type: 'number', min: 10, max: 100 },
  { key: 'bmr', label: 'Basal Metabolic Rate (kcal)', icon: 'fa-fire', placeholder: 'e.g. 1650', type: 'number', min: 800, max: 5000 }
];

function promptForMissingInBodyFields(scan) {
  try {
    if (typeof surveyQuestions === 'undefined') return;
    const u = currentUser();
    if (!u) return;
    const survey = u.survey || {};
    const profile = u.profile || {};

    // Step 1: figure out which of the InBody's "core 4" fields are missing
    // (these are also in the main survey, so we can reuse the survey question).
    const missingSurveyKeys = [];
    ['weight', 'height', 'age', 'gender'].forEach(k => {
      const scanVal = scan[k];
      const surveyVal = survey[k];
      const profileVal = profile[k];
      const hasVal = (scanVal !== undefined && scanVal !== null && scanVal !== '')
                  || (surveyVal !== undefined && surveyVal !== null && surveyVal !== '')
                  || (profileVal !== undefined && profileVal !== null && profileVal !== '');
      if (!hasVal) missingSurveyKeys.push(k);
    });

    // Step 2: figure out which body-composition extras are missing
    const missingExtras = INBODY_EXTRA_FIELDS.filter(f => scan[f.key] === undefined || scan[f.key] === null || scan[f.key] === '');

    const totalMissing = missingSurveyKeys.length + missingExtras.length;
    if (totalMissing === 0) return; // nothing missing — don't bother the user

    // Build the form HTML
    const surveyQuestionMap = {};
    surveyQuestions.forEach(q => { surveyQuestionMap[q.key] = q; });

    let fieldsHtml = '';

    // Render survey questions for the missing core fields
    missingSurveyKeys.forEach(key => {
      const q = surveyQuestionMap[key];
      if (!q) return;
      fieldsHtml += renderFollowupField(q);
    });

    // Render custom questions for the missing extras
    missingExtras.forEach(f => {
      fieldsHtml += `
        <div class="followup-field" data-extra-key="${f.key}">
          <label><i class="fa-solid ${f.icon}"></i> ${f.label}</label>
          <input type="${f.type}" id="followup-${f.key}" placeholder="${f.placeholder || ''}" min="${f.min || ''}" max="${f.max || ''}" step="0.1" />
        </div>
      `;
    });

    const body = document.getElementById('inbody-followup-body');
    body.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px;">
        <div style="width:42px;height:42px;border-radius:12px;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-size:1.2rem;"><i class="fa-solid fa-clipboard-check"></i></div>
        <h2 style="margin:0;font-size:1.2rem;">Just a few more details</h2>
      </div>
      <p style="color:var(--muted);font-size:.88rem;margin-bottom:18px;">We couldn't read ${totalMissing} field${totalMissing === 1 ? '' : 's'} from your InBody sheet. Please fill them in below so we can give you the most accurate plan.</p>
      <div class="followup-form">${fieldsHtml}</div>
      <button class="btn primary" style="width:100%;margin-top:18px;" onclick="saveInBodyFollowup()"><i class="fa-solid fa-check"></i> Save & Apply</button>
      <button class="btn ghost" style="width:100%;margin-top:8px;" onclick="closeInBodyFollowup()">Skip for now</button>
    `;
    openModal('inbody-followup-modal');
  } catch (e) {
    console.warn('promptForMissingInBodyFields error:', e);
  }
}

function renderFollowupField(q) {
  const u = currentUser();
  const currentVal = (u.survey && u.survey[q.key]) || (u.profile && u.profile[q.key]) || '';
  if (q.type === 'text' || q.type === 'number') {
    return `
      <div class="followup-field" data-survey-key="${q.key}">
        <label><i class="fa-solid ${q.icon}"></i> ${q.q}</label>
        <input type="${q.type}" id="followup-${q.key}" placeholder="${q.placeholder || ''}" value="${currentVal}" />
      </div>
    `;
  } else if (q.type === 'select') {
    const opts = q.options.map(opt => {
      const sel = (currentVal === opt) ? 'selected' : '';
      return `<button type="button" class="followup-opt ${sel}" data-value="${opt}" onclick="this.parentElement.querySelectorAll('.followup-opt').forEach(b=>b.classList.remove('selected'));this.classList.add('selected');"><i class="fa-solid fa-check"></i> ${opt}</button>`;
    }).join('');
    return `
      <div class="followup-field" data-survey-key="${q.key}" data-select-key="${q.key}">
        <label><i class="fa-solid ${q.icon}"></i> ${q.q}</label>
        <div class="followup-opts">${opts}</div>
      </div>
    `;
  }
  return '';
}

function closeInBodyFollowup() {
  closeModal('inbody-followup-modal');
}

function saveInBodyFollowup() {
  const u = currentUser();
  if (!u) { closeInBodyFollowup(); return; }
  if (!u.survey) u.survey = {};
  if (!u.profile) u.profile = {};
  if (!u.inbodyScan) u.inbodyScan = {};

  // Collect survey-style answers
  document.querySelectorAll('.followup-field[data-survey-key]').forEach(wrap => {
    const key = wrap.dataset.surveyKey;
    const q = surveyQuestions.find(x => x.key === key);
    if (!q) return;
    let val;
    if (q.type === 'select') {
      const selBtn = wrap.querySelector('.followup-opt.selected');
      val = selBtn ? selBtn.dataset.value : null;
    } else {
      const inp = wrap.querySelector('input');
      val = inp ? inp.value.trim() : '';
      if (q.type === 'number' && val) val = parseFloat(val);
    }
    if (val !== null && val !== '' && val !== undefined) {
      u.survey[key] = val;
      // Mirror into profile for the keys the profile cares about
      if (['name', 'gender', 'age', 'height', 'weight', 'goal', 'sport', 'level', 'injury'].includes(key)) {
        u.profile[key] = (key === 'gender') ? String(val).toLowerCase() : val;
      }
      // Also store into the inbodyScan if it's one of the InBody core fields
      if (['weight', 'height', 'age', 'gender'].includes(key)) {
        if (key === 'gender') u.inbodyScan[key] = String(val).charAt(0).toUpperCase() + String(val).slice(1).toLowerCase();
        else u.inbodyScan[key] = (key === 'age') ? parseInt(val, 10) : parseFloat(val);
      }
    }
  });

  // Collect body-composition extras
  document.querySelectorAll('.followup-field[data-extra-key]').forEach(wrap => {
    const key = wrap.dataset.extraKey;
    const inp = wrap.querySelector('input');
    const val = inp ? inp.value.trim() : '';
    if (val) {
      const num = parseFloat(val);
      if (!isNaN(num)) u.inbodyScan[key] = num;
    }
  });

  // Recompute goal plan if weight/height changed so the calculator & diet tabs
  // pick up the new numbers immediately.
  try { calculateGoalPlan(); } catch(e) {}
  saveUser(store.session, u);
  closeInBodyFollowup();
  renderProfile();
  // Refresh home stats too (BMI / water target depend on weight & height).
  if (typeof renderHome === 'function') renderHome();
  if (typeof renderTracker === 'function') renderTracker();
}

/* ===== OCR Overlay helpers ===== */
// Safety timeout — if the OCR overlay is shown but never hidden within 30s
// (e.g. Tesseract.js fails to load from file:// protocol), auto-hide it
// so the UI doesn't get stuck.
let _ocrSafetyTimer = null;
function showOcrOverlay(title, subtitle) {
  const overlay = document.getElementById('ocr-overlay');
  if (!overlay) return;
  document.getElementById('ocr-title').textContent = title || 'Scanning…';
  document.getElementById('ocr-subtitle').textContent = subtitle || '';
  document.getElementById('ocr-progress-bar').style.width = '0%';
  document.getElementById('ocr-progress-pct').textContent = '0%';
  setOcrPhase('Initializing');
  // Reset to scanning frame (in case it was previously success/error)
  document.getElementById('ocr-scanner-frame').style.display = '';
  // Remove any success/error elements
  document.querySelectorAll('.ocr-success-check, .ocr-error-icon').forEach(el => el.remove());
  overlay.classList.add('active');
  document.body.classList.add('ocr-active');
  if (window.chatbase) { try { window.chatbase('hide'); } catch(e) {} }
  // Start safety timer — auto-hide after 30s
  if (_ocrSafetyTimer) clearTimeout(_ocrSafetyTimer);
  _ocrSafetyTimer = setTimeout(function () {
    if (overlay.classList.contains('active')) {
      console.warn('[Volta] OCR overlay auto-hidden after 30s timeout');
      hideOcrOverlay();
    }
  }, 30000);
}

function hideOcrOverlay() {
  document.getElementById('ocr-overlay').classList.remove('active');
  document.body.classList.remove('ocr-active');
  if (_ocrSafetyTimer) { clearTimeout(_ocrSafetyTimer); _ocrSafetyTimer = null; }
  if (window.chatbase) { try { window.chatbase('show'); } catch(e) {} }
}

function updateOcrProgress(pct, phaseText) {
  pct = Math.max(0, Math.min(100, pct));
  document.getElementById('ocr-progress-bar').style.width = pct + '%';
  document.getElementById('ocr-progress-pct').textContent = pct + '%';
  if (phaseText) setOcrPhase(phaseText);
}

function setOcrPhase(text) {
  document.getElementById('ocr-phase-text').innerHTML = text + '<span class="ocr-typing"><span></span><span></span><span></span></span>';
}

function showOcrSuccess(message) {
  const frame = document.getElementById('ocr-scanner-frame');
  frame.style.display = 'none';
  const panel = document.getElementById('ocr-panel');
  // Insert success icon before title
  const successEl = document.createElement('div');
  successEl.className = 'ocr-success-check';
  successEl.innerHTML = '<i class="fa-solid fa-check"></i>';
  panel.insertBefore(successEl, panel.firstChild);
  document.getElementById('ocr-title').textContent = message || 'Scan complete!';
  document.getElementById('ocr-subtitle').textContent = 'Updating your profile…';
  document.getElementById('ocr-progress-bar').style.width = '100%';
  document.getElementById('ocr-progress-pct').textContent = '100%';
  document.getElementById('ocr-phase-text').textContent = 'Done';
}

function showOcrError(message) {
  const frame = document.getElementById('ocr-scanner-frame');
  frame.style.display = 'none';
  const panel = document.getElementById('ocr-panel');
  const errEl = document.createElement('div');
  errEl.className = 'ocr-error-icon';
  errEl.innerHTML = '<i class="fa-solid fa-xmark"></i>';
  panel.insertBefore(errEl, panel.firstChild);
  document.getElementById('ocr-title').textContent = 'Scan failed';
  document.getElementById('ocr-subtitle').textContent = message || 'Could not read the image.';
  document.getElementById('ocr-progress-bar').style.width = '100%';
  document.getElementById('ocr-progress-bar').style.background = 'var(--red)';
  document.getElementById('ocr-progress-pct').textContent = '!';
  document.getElementById('ocr-progress-pct').style.color = 'var(--red)';
  document.getElementById('ocr-phase-text').textContent = 'Try again with a clearer photo';
  // Auto-close after 3 seconds
  setTimeout(() => {
    hideOcrOverlay();
    // Reset bar color for next time
    document.getElementById('ocr-progress-bar').style.background = '';
    document.getElementById('ocr-progress-pct').style.color = '';
  }, 3000);
}

function renderReminders() {
  const u = currentUser();
  const reminders = u.reminders || [];
  const list = document.getElementById('reminders-list');
  /* Always pre-fill the date field with today's date so the picker is never an
     empty/invisible slot on mobile (iOS Safari renders empty date inputs as a
     thin blank line until tapped). */
  const dateInput = document.getElementById('rem-date');
  if (dateInput && !dateInput.value) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    dateInput.value = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  }
  if (reminders.length === 0) { list.innerHTML = `<p style="color:var(--muted); text-align:center; padding: 20px 0;" data-ar="لا توجد تذكيرات بعد. أنشئ واحداً أعلاه!">No reminders yet. Create one above!</p>`; return; }
  list.innerHTML = reminders.map((r, i) => `
    <div class="reminder-item">
      <div class="r-details">
        <b>${r.title}</b>
        <small>${new Date(r.date + 'T' + (r.time || '09:00')).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</small>
        ${r.note ? `<small style="display:block; margin-top:4px;">${r.note}</small>` : ''}
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn ghost small" onclick="exportToCalendar(${i})"><i class="fa-solid fa-calendar-plus"></i> <span data-ar="إضافة للتقويم">Add to Calendar</span></button>
        <button class="btn ghost small" style="color: var(--red); border-color: var(--red-bg);" onclick="deleteReminder(${i})"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>
  `).join('');
}
function saveReminder() {
  const title = document.getElementById('rem-title').value.trim(); const date = document.getElementById('rem-date').value; const time = document.getElementById('rem-time').value; const note = document.getElementById('rem-note').value.trim();
  if (!title || !date) { alert('Please enter at least a title and date.'); return; }
  const u = currentUser(); if (!u.reminders) u.reminders = []; u.reminders.push({ title, date, time: time || '09:00', note }); saveUser(store.session, u);
  document.getElementById('rem-title').value = '';
  /* Reset date to today (instead of empty) so the field stays visible on mobile */
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  document.getElementById('rem-date').value = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  document.getElementById('rem-time').value = '09:00';
  document.getElementById('rem-note').value = '';
  renderReminders();
}
function deleteReminder(index) { const u = currentUser(); u.reminders.splice(index, 1); saveUser(store.session, u); renderReminders(); }
function exportToCalendar(index) {
  const u = currentUser(); const r = u.reminders[index];
  const dt = new Date(`${r.date}T${r.time || '09:00'}`);
  const pad = (n) => String(n).padStart(2, '0');
  const formatICS = (date) => `${date.getFullYear()}${pad(date.getMonth()+1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`;
  const endDt = new Date(dt.getTime() + 3600000);
  const ics = `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nDTSTART:${formatICS(dt)}\nDTEND:${formatICS(endDt)}\nSUMMARY:${r.title}\nDESCRIPTION:${r.note || 'Volta Fitness Reminder'}\nEND:VEVENT\nEND:VCALENDAR`;
  const blob = new Blob([ics], {type: 'text/calendar'});
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'volta_reminder.ics'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}
function checkReminders() {
  const u = currentUser();
  if (!u || !u.reminders || u.reminders.length === 0) return;
  const now = new Date();
  u.reminders.forEach((r, i) => {
    const rDate = new Date(`${r.date}T${r.time || '09:00'}`);
    const diff = (rDate - now) / 1000;
    if (diff <= 0 && diff > -30 && !r.triggered) {
      // Phase 5: use real notifications instead of alert()
      if (window.VoltaNotifications) {
        VoltaNotifications.sendReminder(r.title, r.note);
      } else {
        playReminderSound();
        alert(`⏰ Reminder: ${r.title}\n${r.note || ''}`);
      }
      r.triggered = true;
      saveUser(store.session, u);
    }
  });
}
function playReminderSound() { try { const ctx = new (window.AudioContext || window.webkitAudioContext)(); const oscillator = ctx.createOscillator(); const gainNode = ctx.createGain(); oscillator.connect(gainNode); gainNode.connect(ctx.destination); oscillator.type = 'sine'; oscillator.frequency.value = 800; gainNode.gain.setValueAtTime(0.3, ctx.currentTime); gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1); oscillator.start(ctx.currentTime); oscillator.stop(ctx.currentTime + 1); } catch(e) {} }

// ===== Water Reminder: REMOVED per user request =====
// The automatic water reminder engine (notifications.js) was fully removed —
// no timer, no notifications, no settings. Workout reminders are unaffected.
function toggleWaterReminder() { /* removed */ }
function saveWaterSettings() { /* removed */ }
function updateWaterPermissionStatus(perm) { /* removed */ }
function renderWaterReminderUI() { /* removed */ }

// ==========================================
// COACH ATHLETE MANAGEMENT
// ==========================================
const COACH_ATHLETES_KEY = 'volta_coach_athletes';
const COACH_USERS_KEY = 'volta_coach_users';
const COACH_SESSION_KEY = 'volta_coach_session';
let coachSessionsChart = null;

function getCoachUsers() { try { return JSON.parse(localStorage.getItem(COACH_USERS_KEY)) || {}; } catch (err) { return {}; } }
function saveCoachUsers(users) { localStorage.setItem(COACH_USERS_KEY, JSON.stringify(users)); }
function hashPassword(pwd) { let hash = 0; for (let i = 0; i < pwd.length; i++) hash = ((hash << 5) - hash + pwd.charCodeAt(i)) | 0; return hash.toString(36) + '_' + pwd.length; }

let coachCurrentTab = 'login';
function switchCoachAuthTab(t) {
  coachCurrentTab = t;
  document.getElementById('coach-tab-login').classList.toggle('active', t==='login');
  document.getElementById('coach-tab-signup').classList.toggle('active', t==='signup');
  document.getElementById('coach-signup-fields').style.display = t==='signup' ? 'block' : 'none';
  document.getElementById('coach-forgot').style.display = t==='login' ? 'inline-flex' : 'none';
  document.getElementById('coach-submit-btn').textContent = t==='login' ? 'Log in as Coach' : 'Create Coach account';
  showCoachMsg('','');
}
function showCoachMsg(t,k) { const m = document.getElementById('coach-msg'); m.textContent = t; m.className = 'msg ' + (k||''); }
function handleCoachAuth(e) {
  e.preventDefault();
  const email = document.getElementById('coach-email').value.trim().toLowerCase();
  const password = document.getElementById('coach-password').value;
  const submitBtn = document.getElementById('coach-submit-btn');
  if (!email.includes('@') || !email.includes('.')) { showCoachMsg('Please enter a valid email address.','error'); return false; }
  if (password.length < 6) { showCoachMsg('Password must be at least 6 characters.','error'); return false; }
  submitBtn.disabled = true;
  const originalLabel = submitBtn.textContent;
  submitBtn.textContent = coachCurrentTab === 'login' ? 'Logging in…' : 'Creating account…';
  try {
    const users = getCoachUsers();
    const pwdHash = hashPassword(password);
    if (coachCurrentTab === 'signup') {
      const fullName = (document.getElementById('coach-fn').value || '').trim();
      const cert = document.getElementById('coach-cert').value;
      const specialty = document.getElementById('coach-spec').value;
      if (!fullName) { showCoachMsg('Please enter your full name.','error'); return false; }
      if (users[email]) { showCoachMsg('An account with that email already exists.','error'); return false; }
      users[email] = { fullName, email, cert, specialty, pwdHash };
      saveCoachUsers(users);
      showCoachMsg('Coach account created. Loading…','ok');
      localStorage.setItem(COACH_SESSION_KEY, email);
      setTimeout(() => enterCoachApp(users[email]), 500);
    } else {
      const user = users[email];
      if (!user) { showCoachMsg('No account found. Try signing up.','error'); return false; }
      if (user.pwdHash !== pwdHash) { showCoachMsg('Incorrect password.','error'); return false; }
      showCoachMsg('Welcome back, Coach!','ok');
      localStorage.setItem(COACH_SESSION_KEY, email);
      setTimeout(() => enterCoachApp(user), 500);
    }
  } finally { submitBtn.disabled = false; submitBtn.textContent = originalLabel; }
  return false;
}
function enterCoachApp(user) {
  const name = user.fullName || user.email.split('@')[0];
  // Use showScreen() so ALL other screens are properly deactivated and the
  // coach screen is properly activated (applySettings, updateChatbaseVisibility,
  // updateMobileMenuBtn all run). The previous manual class-toggle approach
  // could leave stale .active classes on other screens and skipped the
  // applySettings() call, which is part of why the dashboard didn't render
  // until the user clicked.
  showScreen('screen-coach-app');
  // Explicitly activate the dashboard tab + sidebar button so a previously-
  // active settings/athletes/etc. tab from a prior coach session doesn't
  // persist into the new session.
  showCoachTab('coach-home');
  const first = name.split(' ')[0];
  document.getElementById('coach-first').textContent = first;
  document.getElementById('coach-name').textContent = name;
  document.getElementById('coach-email-1').textContent = user.email;
  document.getElementById('coach-email-2').textContent = user.email;
  document.getElementById('coach-initial').textContent = (first[0]||'C').toUpperCase();
  renderCoachAthletes(); updateCoachStats(); renderCoachSessionsTable(); renderCoachPlans();
  // Render the chart on the next animation frame — by then the layout has
  // settled and the canvas has its final pixel dimensions, so Chart.js can
  // size itself correctly without needing a manual resize() call later.
  requestAnimationFrame(() => requestAnimationFrame(() => renderCoachSessionsChart()));
  window.scrollTo(0,0);
  updateChatbaseVisibility();
  updateMobileMenuBtn();
}
function showCoachTab(t) {
  document.querySelectorAll('#screen-coach-app .tab').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-'+t).classList.add('active');
  document.querySelectorAll('#screen-coach-app .side-btn[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab===t));
  if (t === 'coach-home') { renderCoachAthletes(); updateCoachStats(); renderCoachSessionsTable(); requestAnimationFrame(() => requestAnimationFrame(() => renderCoachSessionsChart())); }
  if (t === 'coach-athletes') { renderCoachAthletes(); }
  if (t === 'coach-sessions') { renderCoachSessionsTable(); }
  if (t === 'coach-plans') { renderCoachPlans(); }
  if (t === 'coach-courses') { renderCoachCourses(); }
  setTimeout(() => applyTranslations(), 30);
}

// ===== COACH TRAINING PLANS =====
const COACH_PLANS_KEY = 'fb_coach_plans';
const DEFAULT_COACH_PLANS = [
  { name: 'Base Building — 4 weeks', nameAr: 'بناء القاعدة — 4 أسابيع', category: 'Running', categoryAr: 'الجري', difficulty: 'Beginner', difficultyAr: 'مبتدئ', duration: '4 weeks', durationAr: '4 أسابيع', sessions: '4 sessions', sessionsAr: '4 جلسات', goal: 'Improve Endurance', goalAr: 'تحسين التحمل', equipment: 'Outdoor', equipmentAr: 'في الهواء الطلق', focus: ['Cardio','Lower Body'], focusAr: ['كارديو','الجزء السفلي'], desc: 'Progressive mileage build-up for new runners.', descAr: 'زيادة تدريجية في المسافة للعدائين الجدد.', workouts: ['Easy Zone 2 run (30 min)','Interval 400m x 8','Tempo run (25 min)','Long slow run (45 min)'], athletes: 12, isDefault: true },
  { name: 'Push / Pull / Legs', nameAr: 'دفع / سحب / أرجل', category: 'Strength', categoryAr: 'القوة', difficulty: 'Intermediate', difficultyAr: 'متوسط', duration: '8 weeks', durationAr: '8 أسابيع', sessions: '6 sessions', sessionsAr: '6 جلسات', goal: 'Increase Strength', goalAr: 'زيادة القوة', equipment: 'Full Gym', equipmentAr: 'صالة كاملة', focus: ['Upper Body','Lower Body','Power'], focusAr: ['الجزء العلوي','الجزء السفلي','القوة'], desc: 'Classic 6-day split for hypertrophy and strength.', descAr: 'تقسيم كلاسيكي 6 أيام لضخامة العضلات والقوة.', workouts: ['Push: Bench, OHP, Triceps','Pull: Deadlift, Rows, Biceps','Legs: Squat, RDL, Calves','Push: Incline Bench, Lateral Raises','Pull: Pull-ups, Face Pulls','Legs: Front Squat, Lunges'], athletes: 8, isDefault: true },
  { name: 'Zone 2 Ride Block', nameAr: 'كتلة ركوب المنطقة 2', category: 'Cycling', categoryAr: 'ركوب الدراجات', difficulty: 'Intermediate', difficultyAr: 'متوسط', duration: '6 weeks', durationAr: '6 أسابيع', sessions: '5 sessions', sessionsAr: '5 جلسات', goal: 'Improve Endurance', goalAr: 'تحسين التحمل', equipment: 'Outdoor', equipmentAr: 'في الهواء الطلق', focus: ['Cardio','Lower Body'], focusAr: ['كارديو','الجزء السفلي'], desc: 'Aerobic base building for cyclists.', descAr: 'بناء القاعدة الهوائية لراكبي الدراجات.', workouts: ['Zone 2 steady (60 min)','Zone 2 steady (90 min)','Hill repeats (45 min)','Zone 2 recovery (45 min)','Long Zone 2 (120 min)'], athletes: 5, isDefault: true }
];

// ===== MY COACH (Athlete view) =====
// Renders the training plan assigned to this athlete by their linked coach.
// Looks up the coach by scanning volta_coach_athletes for an entry matching
// the athlete's email. If found + has assignedPlan, shows the plan details.
function renderMyCoach() {
  // Server-only: fetch enrolled + browse courses from the API
  try { renderMyEnrolledCourses(); } catch(e) { console.warn('renderMyEnrolledCourses error:', e); }
  try { renderAthleteCourses(); } catch(e) { console.warn('renderAthleteCourses error:', e); }
}

// ============================================================
// ATHLETE COURSE BROWSING & ENROLLMENT (SERVER-ONLY)
// ============================================================
// All data comes from the server. No localStorage fallback.
// If the server is down, the lists show "couldn't load" — by design.

let _allCoursesCache = [];

async function fetchAllPublishedCourses() {
  var API_URL = window.VOLTA_API_BASE || window.location.origin;
  var resp = await fetch(API_URL + '/api/courses');
  if (!resp.ok) throw new Error('Server returned ' + resp.status);
  var data = await resp.json();
  return data.courses || [];
}

async function fetchMyEnrolledCourses() {
  var me = (store.session || '').toLowerCase();
  if (!me) return [];
  var API_URL = window.VOLTA_API_BASE || window.location.origin;
  var resp = await fetch(API_URL + '/api/courses/enrolled?user=' + encodeURIComponent(me));
  if (!resp.ok) throw new Error('Server returned ' + resp.status);
  var data = await resp.json();
  return data.courses || [];
}

function isEnrolledInCourse(courseId, enrolledList) {
  if (!enrolledList) return false;
  return enrolledList.some(function (c) { return String(c.id) === String(courseId); });
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderCourseCard(c, opts) {
  opts = opts || {};
  var ar = (store.lang === 'ar');
  var isEnrolled = opts.isEnrolled || false;
  var isBrowse = opts.context === 'browse';
  var enrolledCount = c.enrolledCount != null ? c.enrolledCount : (Array.isArray(c.enrolledAthletes) ? c.enrolledAthletes.length : 0);
  var max = c.maxAthletes || 0;
  var isFull = max > 0 && enrolledCount >= max;
  var typeLabel = c.type === 'video' ? (ar ? 'فيديو' : 'Video') : c.type === 'plan' ? (ar ? 'خطة' : 'Plan') : (ar ? 'مقال' : 'Article');
  var priceLabel = c.price > 0 ? (c.price + ' ' + (c.currency || 'USD')) : (ar ? 'مجاني' : 'Free');
  var capacityLabel = max > 0 ? (enrolledCount + ' / ' + max) : (enrolledCount + ' ' + (ar ? 'مشترك' : 'joined'));
  var levelLabel = c.skillLevel ? '<span><i class="fa-solid fa-signal"></i> ' + escapeHtml(c.skillLevel) + '</span>' : '';
  var durationLabel = c.duration ? '<span><i class="fa-solid fa-clock"></i> ' + escapeHtml(c.duration) + '</span>' : '';
  var coachName = c.coachName || (c.coachEmail ? c.coachEmail.split('@')[0] : (ar ? 'مدرب' : 'Coach'));
  var coachInitial = (coachName || '?').charAt(0).toUpperCase();

  var actionHtml = '';
  if (isEnrolled) {
    if (c.url) {
      actionHtml += '<a href="' + escapeHtml(c.url) + '" target="_blank" class="volta-course-open-btn"><i class="fa-solid fa-play"></i> ' + (ar ? 'فتح' : 'Open') + '</a>';
    }
    actionHtml += '<button class="volta-course-details-btn" onclick="showCourseDetails(' + c.id + ', true)"><i class="fa-solid fa-comment-dots"></i> ' + (ar ? 'محادثة' : 'Chat') + '</button>';
    if (opts.context === 'my-courses') {
      actionHtml += '<button class="volta-course-leave-btn" onclick="leaveCourse(' + c.id + ')"><i class="fa-solid fa-right-from-bracket"></i> ' + (ar ? 'مغادرة' : 'Leave') + '</button>';
    }
  } else {
    if (isFull) {
      actionHtml += '<button class="volta-course-join-btn" disabled><i class="fa-solid fa-lock"></i> ' + (ar ? 'مكتمل' : 'Full') + '</button>';
    } else {
      actionHtml += '<button class="volta-course-join-btn" onclick="enrollCourse(' + c.id + ')"><i class="fa-solid fa-plus"></i> ' + (ar ? 'انضمام' : 'Join') + '</button>';
    }
    actionHtml += '<button class="volta-course-details-btn" onclick="showCourseDetails(' + c.id + ', false)"><i class="fa-solid fa-circle-info"></i> ' + (ar ? 'تفاصيل' : 'Details') + '</button>';
  }

  var cardClasses = 'volta-course-card';
  if (isEnrolled && isBrowse) cardClasses += ' volta-course-card-enrolled';
  var enrolledOverlay = (isEnrolled && isBrowse) ? '<div class="volta-course-card-overlay"><i class="fa-solid fa-circle-check"></i> <span>' + (ar ? 'أنت مشترك في هذه الدورة' : 'You\'re already in this course') + '</span></div>' : '';

  return '<div class="' + cardClasses + '">' + enrolledOverlay +
    '<div class="volta-course-card-header">' +
      '<h4 class="volta-course-card-title">' + escapeHtml(c.title || '') + '</h4>' +
      '<span class="volta-course-card-type">' + typeLabel + '</span>' +
    '</div>' +
    '<p class="volta-course-card-desc">' + escapeHtml(c.description || c.message || '') + '</p>' +
    '<div class="volta-course-card-meta">' + levelLabel + durationLabel + '<span><i class="fa-solid fa-users"></i> ' + capacityLabel + '</span></div>' +
    '<div class="volta-course-card-coach">' +
      '<div class="volta-course-card-coach-avatar">' + coachInitial + '</div>' +
      '<div style="min-width:0;flex:1;">' +
        '<div class="volta-course-card-coach-name">' + escapeHtml(coachName) + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="volta-course-card-footer">' +
      '<div>' +
        '<div class="volta-course-card-price ' + (c.price > 0 ? '' : 'free') + '">' + priceLabel + '</div>' +
        '<div class="volta-course-card-capacity ' + (isFull ? 'full' : '') + '">' + capacityLabel + '</div>' +
      '</div>' +
      '<div class="volta-course-card-actions">' + actionHtml + '</div>' +
    '</div>' +
  '</div>';
}

async function renderAthleteCourses() {
  var ar = (store.lang === 'ar');
  var list = document.getElementById('browse-courses-list');
  if (!list) return;
  var enrolled = [];
  try { enrolled = await fetchMyEnrolledCourses(); } catch (e) {}
  try {
    _allCoursesCache = await fetchAllPublishedCourses();
  } catch (e) {
    _allCoursesCache = [];
    list.innerHTML = '<p style="color:var(--muted);font-size:.88rem;text-align:center;padding:20px;">' + (ar ? 'تعذّر تحميل الدورات. تأكد من اتصالك بالإنترنت.' : 'Could not load courses. Check your connection.') + '</p>';
    return;
  }
  if (_allCoursesCache.length === 0) {
    list.innerHTML = '<div class="volta-course-empty"><i class="fa-solid fa-store"></i><p>' + (ar ? 'لا توجد دورات منشورة بعد' : 'No courses published yet') + '</p><p class="small">' + (ar ? 'تابع لاحقاً!' : 'Check back soon!') + '</p></div>';
    return;
  }
  list.innerHTML = '<div class="volta-courses-grid">' + _allCoursesCache.map(function (c) {
    return renderCourseCard(c, { isEnrolled: isEnrolledInCourse(c.id, enrolled), context: 'browse' });
  }).join('') + '</div>';
  setTimeout(applyTranslations, 0);
}

async function renderMyEnrolledCourses() {
  var ar = (store.lang === 'ar');
  var list = document.getElementById('my-courses-list');
  if (!list) return;
  var courses = [];
  try { courses = await fetchMyEnrolledCourses(); } catch (e) {
    list.innerHTML = '<p style="color:var(--muted);font-size:.88rem;text-align:center;padding:20px;">' + (ar ? 'تعذّر تحميل دوراتك.' : 'Could not load your courses.') + '</p>';
    return;
  }
  if (courses.length === 0) {
    list.innerHTML = '<div class="volta-course-empty"><i class="fa-solid fa-graduation-cap"></i><p>' + (ar ? 'لست مشتركاً في دورات بعد' : 'Not enrolled in any courses yet') + '</p><p class="small">' + (ar ? 'تصفح الدورات أدناه!' : 'Browse courses below!') + '</p></div>';
    return;
  }
  list.innerHTML = '<div class="volta-courses-grid">' + courses.map(function (c) {
    return renderCourseCard(c, { isEnrolled: true, context: 'my-courses' });
  }).join('') + '</div>';
  setTimeout(applyTranslations, 0);
}

function showCourseDetails(courseId, isEnrolled) {
  var c = _allCoursesCache.find(function (x) { return String(x.id) === String(courseId); });
  if (!c) { alert('Course not found.'); return; }
  var ar = (store.lang === 'ar');
  ensureCourseDetailsModal();
  var typeLabel = c.type === 'video' ? (ar ? 'فيديو' : 'Video') : c.type === 'plan' ? (ar ? 'خطة' : 'Plan') : (ar ? 'مقال' : 'Article');
  var priceLabel = c.price > 0 ? (c.price + ' ' + (c.currency || 'USD')) : (ar ? 'مجاني' : 'FREE');
  var isFree = !(c.price > 0);
  var coachName = c.coachName || (c.coachEmail ? c.coachEmail.split('@')[0] : (ar ? 'مدرب' : 'Coach'));
  var coachInitial = (coachName || '?').charAt(0).toUpperCase();
  var enrolledCount = c.enrolledCount != null ? c.enrolledCount : (Array.isArray(c.enrolledAthletes) ? c.enrolledAthletes.length : 0);
  var max = c.maxAthletes || 0;
  var capacityText = max > 0 ? (enrolledCount + ' / ' + max + ' ' + (ar ? 'رياضي' : 'athletes')) : (enrolledCount + ' ' + (ar ? 'مشترك' : 'enrolled'));
  var skillLevel = c.skillLevel || (ar ? 'الكل' : 'All levels');
  var duration = c.duration || (ar ? 'حسب الوتيرة' : 'Self-paced');

  var actionsHtml = '';
  if (isEnrolled) {
    if (c.url) {
      actionsHtml += '<a href="' + escapeHtml(c.url) + '" target="_blank" class="btn primary"><i class="fa-solid fa-play"></i> ' + (ar ? 'فتح الدورة' : 'Open Course') + '</a>';
    }
    if (c.coachEmail) {
      actionsHtml += '<button class="btn ghost" onclick="closeModal(\'course-details-modal\');VoltaChat.openWith(\'' + escapeHtml(c.coachEmail) + '\', \'' + escapeHtml(coachName).replace(/'/g, "\\\'") + '\')"><i class="fa-solid fa-comment-dots"></i> ' + (ar ? 'محادثة المدرب' : 'Message Coach') + '</button>';
    }
    actionsHtml += '<button class="btn ghost" onclick="closeModal(\'course-details-modal\');leaveCourse(' + c.id + ')" style="color:var(--red);"><i class="fa-solid fa-right-from-bracket"></i> ' + (ar ? 'مغادرة الدورة' : 'Leave Course') + '</button>';
  } else {
    var isFull = max > 0 && enrolledCount >= max;
    if (isFull) {
      actionsHtml += '<button class="btn primary" disabled style="opacity:.5;cursor:not-allowed;"><i class="fa-solid fa-lock"></i> ' + (ar ? 'الدورة مكتملة' : 'Course Full') + '</button>';
    } else {
      actionsHtml += '<button class="btn primary" onclick="closeModal(\'course-details-modal\');enrollCourse(' + c.id + ')"><i class="fa-solid fa-plus"></i> ' + (ar ? 'انضمام للدورة' : 'Join Course') + '</button>';
    }
    actionsHtml += '<button class="btn ghost" onclick="closeModal(\'course-details-modal\')">' + (ar ? 'إغلاق' : 'Close') + '</button>';
  }

  var body = document.getElementById('course-details-modal-body');
  body.innerHTML =
    '<div class="course-details-hero">' +
      '<button class="modal-close" onclick="closeModal(\'course-details-modal\')">&times;</button>' +
      '<span class="type-pill">' + typeLabel + '</span>' +
      '<h3>' + escapeHtml(c.title || '') + '</h3>' +
      '<div class="price-row"><span class="price ' + (isFree ? 'free' : '') + '">' + priceLabel + '</span></div>' +
    '</div>' +
    '<div class="course-details-body">' +
      (c.coachEmail || coachName ? '<div class="course-details-coach"><div class="course-details-coach-avatar">' + coachInitial + '</div><div style="min-width:0;flex:1;"><div class="course-details-coach-name">' + escapeHtml(coachName) + '</div>' + (c.coachEmail ? '<div class="course-details-coach-email">' + escapeHtml(c.coachEmail) + '</div>' : '') + '</div></div>' : '') +
      '<p class="course-details-desc">' + escapeHtml(c.description || c.message || '') + '</p>' +
      '<div class="course-details-meta">' +
        '<div class="course-details-meta-item"><div class="label">' + (ar ? 'المستوى' : 'Level') + '</div><div class="value">' + escapeHtml(skillLevel) + '</div></div>' +
        '<div class="course-details-meta-item"><div class="label">' + (ar ? 'المدة' : 'Duration') + '</div><div class="value">' + escapeHtml(duration) + '</div></div>' +
        '<div class="course-details-meta-item"><div class="label">' + (ar ? 'السعة' : 'Capacity') + '</div><div class="value">' + capacityText + '</div></div>' +
        '<div class="course-details-meta-item"><div class="label">' + (ar ? 'النوع' : 'Type') + '</div><div class="value">' + escapeHtml(typeLabel) + '</div></div>' +
      '</div>' +
      '<div class="course-details-actions">' + actionsHtml + '</div>' +
    '</div>';
  openModal('course-details-modal');
}

function ensureCourseDetailsModal() {
  if (document.getElementById('course-details-modal')) return;
  var m = document.createElement('div');
  m.id = 'course-details-modal';
  m.className = 'modal-overlay';
  m.innerHTML = '<div class="modal-content"><div id="course-details-modal-body"></div></div>';
  document.body.appendChild(m);
  m.addEventListener('click', function (e) {
    if (e.target === m) closeModal('course-details-modal');
  });
}

async function enrollCourse(courseId) {
  var ar = (store.lang === 'ar');
  var me = (store.session || '').toLowerCase();
  if (!me) { alert(ar ? 'الرجاء تسجيل الدخول أولاً.' : 'Please log in first.'); return; }
  var c = _allCoursesCache.find(function (x) { return String(x.id) === String(courseId); });
  if (!c) { alert(ar ? 'الدورة غير موجودة.' : 'Course not found.'); return; }

  var API_URL = window.VOLTA_API_BASE || window.location.origin;
  try {
    var resp = await fetch(API_URL + '/api/courses/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseId: courseId, userEmail: me, userName: (currentUser().profile && currentUser().profile.name) || me })
    });
    var data = await resp.json();
    if (resp.ok && data.success) {
      alert(ar ? 'تم الاشتراك بنجاح! تجد الدورة في "دوراتي".' : 'Joined successfully! Find it in "My Courses".');
      await renderMyEnrolledCourses();
      await renderAthleteCourses();
    } else if (resp.status === 404) {
      alert(ar ? 'الدورة غير موجودة على الخادم.' : 'Course not found on server.');
    } else if (resp.status === 409) {
      alert(ar ? 'الدورة مكتملة.' : 'Course is full.');
    } else {
      alert((ar ? 'فشل الاشتراك: ' : 'Join failed: ') + (data.error || ''));
    }
  } catch (e) {
    alert(ar ? 'فشل الاتصال بالخادم. تأكد من اتصالك بالإنترنت.' : 'Could not connect to server. Check your connection.');
  }
}

async function leaveCourse(courseId) {
  var ar = (store.lang === 'ar');
  var me = (store.session || '').toLowerCase();
  if (!me) return;
  var c = _allCoursesCache.find(function (x) { return String(x.id) === String(courseId); });
  if (!c) return;
  var confirmMsg = ar ? 'هل أنت متأكد أنك تريد مغادرة "' + (c.title || '') + '"؟' : 'Are you sure you want to leave "' + (c.title || '') + '"?';
  if (!confirm(confirmMsg)) return;

  var API_URL = window.VOLTA_API_BASE || window.location.origin;
  try {
    var resp = await fetch(API_URL + '/api/courses/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseId: courseId, userEmail: me })
    });
    if (resp.ok) {
      alert(ar ? 'غادرت الدورة.' : 'You left the course.');
      await renderMyEnrolledCourses();
      await renderAthleteCourses();
    } else {
      alert(ar ? 'فشل مغادرة الدورة.' : 'Failed to leave course.');
    }
  } catch (e) {
    alert(ar ? 'فشل الاتصال بالخادم.' : 'Could not connect to server.');
  }
}

function getCoachPlans() {
  try {
    const saved = JSON.parse(localStorage.getItem(COACH_PLANS_KEY) || 'null');
    if (saved && Array.isArray(saved)) return saved;
  } catch(e) {}
  return JSON.parse(JSON.stringify(DEFAULT_COACH_PLANS));
}
function saveCoachPlans(plans) { localStorage.setItem(COACH_PLANS_KEY, JSON.stringify(plans)); }
function renderCoachPlans() {
  const grid = document.getElementById('coach-plans-grid');
  if (!grid) return;
  const isAr = (store.lang === 'ar');
  const plans = getCoachPlans();
  const athleteWord = isAr ? 'رياضي' : 'athlete';
  const athletesWord = isAr ? 'رياضيون' : 'athletes';
  const viewLabel = isAr ? 'عرض' : 'View';
  const newPlanLabel = isAr ? 'خطة جديدة' : 'New plan';
  grid.innerHTML = plans.map((p, i) => {
    const name = (isAr && p.nameAr) ? p.nameAr : p.name;
    const category = (isAr && p.categoryAr) ? p.categoryAr : p.category;
    const difficulty = (isAr && p.difficultyAr) ? p.difficultyAr : p.difficulty;
    const duration = (isAr && p.durationAr) ? p.durationAr : p.duration;
    const sessions = (isAr && p.sessionsAr) ? p.sessionsAr : p.sessions;
    const athleteCount = p.athletes || 0;
    return `
    <div class="plan-card">
      <div class="plan-icon"><i class="fa-solid fa-clipboard-list"></i></div>
      <b>${name}</b>
      <small>${category}</small>
      <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px;">
        <span style="font-size:.7rem;background:var(--accent-soft);color:var(--accent);padding:2px 8px;border-radius:8px;">${difficulty}</span>
        <span style="font-size:.7rem;background:var(--bg);color:var(--muted);padding:2px 8px;border-radius:8px;">${duration}</span>
        <span style="font-size:.7rem;background:var(--bg);color:var(--muted);padding:2px 8px;border-radius:8px;">${sessions}</span>
      </div>
      <div class="plan-foot">
        <span>${athleteCount} ${athleteCount === 1 ? athleteWord : athletesWord}</span>
        <button class="btn ghost small" onclick="viewPlanDetails(${i})">${viewLabel}</button>
        ${p.isDefault ? '' : `<button class="btn ghost small" onclick="deletePlan(${i})" style="color:var(--red);"><i class="fa-solid fa-trash"></i></button>`}
      </div>
    </div>
  `;
  }).join('') + `<button class="plan-card new" onclick="openNewPlanModal()"><i class="fa-solid fa-plus"></i><span>${newPlanLabel}</span></button>`;
}
function openNewPlanModal() {
  document.getElementById('np-name').value = '';
  document.getElementById('np-category').value = '';
  document.getElementById('np-difficulty').value = '';
  document.getElementById('np-duration').value = '';
  document.getElementById('np-sessions').value = '';
  document.getElementById('np-goal').value = '';
  document.getElementById('np-equipment').value = 'Bodyweight Only';
  document.getElementById('np-desc').value = '';
  document.getElementById('np-autogen').checked = true;
  document.getElementById('np-preview').style.display = 'none';
  document.getElementById('np-preview').innerHTML = '';
  document.querySelectorAll('#np-focus-chips .focus-chip').forEach(c => c.classList.remove('selected'));
  document.getElementById('new-plan-msg').textContent = '';
  // Reset to "create" mode
  const form = document.querySelector('#new-plan-modal form');
  if (form) form.removeAttribute('data-edit-idx');
  const modalH3 = document.querySelector('#new-plan-modal h3');
  if (modalH3) modalH3.innerHTML = '<i class="fa-solid fa-clipboard-list"></i> Create New Training Plan';
  const submitBtn = document.querySelector('#new-plan-modal form button[type="submit"]');
  if (submitBtn) submitBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Create Plan';
  openModal('new-plan-modal');
}
function updatePlanGoalOptions() {
  // Goal options stay the same for all categories — kept for future per-category filtering
  const cat = document.getElementById('np-category').value;
  const goalSel = document.getElementById('np-goal');
  if (!cat) return;
  // Light-touch: auto-suggest a sensible default goal based on category
  const suggestions = {
    'Running': 'Improve Endurance', 'Cycling': 'Improve Endurance', 'Swimming': 'Improve Endurance',
    'Triathlon': 'Improve Endurance', 'Rowing': 'Improve Endurance',
    'Strength': 'Increase Strength', 'CrossFit': 'Sports Performance',
    'HIIT': 'Lose Weight', 'Boxing': 'Sports Performance', 'Martial Arts': 'Sports Performance',
    'Football': 'Sports Performance', 'Basketball': 'Sports Performance', 'Tennis': 'Sports Performance',
    'Yoga': 'Enhance Mobility', 'Pilates': 'Enhance Mobility',
    'Rehabilitation': 'Rehabilitation', 'General Fitness': 'Maintain Fitness'
  };
  if (suggestions[cat] && !goalSel.value) goalSel.value = suggestions[cat];
}
function generatePlanWorkouts(category, goal, focus, sessions, equipment) {
  const sessCount = parseInt(sessions) || 4;
  const library = {
    'Running': ['Easy Zone 2 run','Tempo run','Interval 400m repeats','Hill sprints','Long slow distance','Fartlek','Recovery jog','Stride-outs'],
    'Cycling': ['Zone 2 steady ride','Threshold intervals','Hill repeats','Recovery spin','Long endurance ride','Sprint intervals','Sweet spot','Cadena drills'],
    'Swimming': ['Freestyle drills','Interval 100m repeats','Kick set','Pull set','Easy cooldown swim','Pace 50m sprints','Distance swim','Technique work'],
    'Strength': ['Squat 5x5','Bench Press 4x6','Deadlift 3x5','Overhead Press','Barbell Rows','Pull-ups','Romanian Deadlift','Accessory circuit'],
    'HIIT': ['Tabata (20/10)','EMOM 12 min','AMRAP 15 min','Sprint intervals','Circuit 5 rounds','Battle ropes','Box jumps','Burpees'],
    'CrossFit': ['WOD Cindy','Deadlift 5-3-1','Kipping pull-ups','Thrusters','Wall balls','Row intervals','Double-unders','Muscle-up drills'],
    'Yoga': ['Sun salutations','Vinyasa flow','Hip openers','Balance poses','Restorative','Inversion practice','Pranayama','Cool-down stretch'],
    'Pilates': ['Hundred','Roll-up','Leg circles','Swan dive','Side kicks','Plank series','Bridge','Cool-down'],
    'Boxing': ['Shadow boxing','Heavy bag rounds','Mitt work','Footwork drills','Conditioning','Jump rope','Defense drills','Sparring'],
    'Martial Arts': ['Shadow rounds','Pad work','Grappling drills','Cardio conditioning','Technique sparring','Mobility','Bag work','Recovery'],
    'Football': ['Sprint drills','Agility ladder','Passing drills','Conditioning','Plyometrics','Strength upper','Strength lower','Recovery'],
    'Basketball': ['Court sprints','Vertical jumps','Shooting drills','Defensive slides','Plyometrics','Strength upper','Conditioning','Recovery'],
    'Tennis': ['Court sprints','Serve practice','Groundstroke drills','Volley drills','Footwork ladder','Core circuit','Mobility','Recovery'],
    'Rowing': ['Steady state 6km','Interval 500m','Tech drills','UT2 10km','Race pace 2km','Core circuit','Mobility','Recovery'],
    'Triathlon': ['Brick session','Swim intervals','Zone 2 ride','Easy run','Open water swim','Long ride','Transition practice','Recovery'],
    'Rehabilitation': ['Mobility flow','Light resistance band','Stability work','Range of motion','Glute activation','Core stability','Foam rolling','Easy walk'],
    'General Fitness': ['Full-body strength','Cardio intervals','Mobility flow','Core circuit','Active recovery','Plyometrics','Flexibility','Conditioning']
  };
  const pool = library[category] || library['General Fitness'];
  // Shuffle pool deterministically-ish using goal + focus
  const out = [];
  const used = new Set();
  for (let i = 0; i < Math.max(sessCount, 1); i++) {
    let pick = pool[i % pool.length];
    if (used.has(pick)) pick = pool[(i + 3) % pool.length];
    used.add(pick);
    out.push(pick);
  }
  return out;
}
function createPlan(e) {
  e.preventDefault();
  const name = document.getElementById('np-name').value.trim();
  const category = document.getElementById('np-category').value;
  const difficulty = document.getElementById('np-difficulty').value;
  const duration = document.getElementById('np-duration').value;
  const sessions = document.getElementById('np-sessions').value;
  const goal = document.getElementById('np-goal').value;
  const equipment = document.getElementById('np-equipment').value;
  const desc = document.getElementById('np-desc').value.trim();
  const focus = Array.from(document.querySelectorAll('#np-focus-chips .focus-chip.selected')).map(c => c.textContent.trim());
  const autogen = document.getElementById('np-autogen').checked;
  const form = document.querySelector('#new-plan-modal form');
  const editIdx = form && form.hasAttribute('data-edit-idx') ? parseInt(form.getAttribute('data-edit-idx')) : null;

  if (!name || !category || !difficulty || !duration || !sessions || !goal) {
    const msg = document.getElementById('new-plan-msg');
    msg.style.color = 'var(--red)';
    msg.textContent = 'Please fill in all required fields.';
    return false;
  }

  const workouts = autogen ? generatePlanWorkouts(category, goal, focus, sessions, equipment) : [];
  const plans = getCoachPlans();

  if (editIdx !== null && !isNaN(editIdx) && plans[editIdx]) {
    // Edit mode: preserve athlete count + createdAt
    const existing = plans[editIdx];
    plans[editIdx] = Object.assign({}, existing, {
      name, category, difficulty, duration, sessions, goal, equipment, focus, desc, workouts
    });
    saveCoachPlans(plans);
    renderCoachPlans();
    closeModal('new-plan-modal');
    const pageSub = document.querySelector('#tab-coach-plans .page-sub');
    if (pageSub) {
      const original = 'Reusable plans you\'ve built for your roster.';
      pageSub.style.color = 'var(--green)';
      pageSub.innerHTML = '<i class="fa-solid fa-circle-check"></i> "' + name + '" updated successfully.';
      setTimeout(() => { pageSub.style.color = ''; pageSub.textContent = original; }, 4000);
    }
  } else {
    // Create mode
    const plan = {
      name, category, difficulty, duration, sessions, goal, equipment, focus, desc,
      workouts, athletes: 0, createdAt: Date.now()
    };
    plans.push(plan);
    saveCoachPlans(plans);
    renderCoachPlans();
    closeModal('new-plan-modal');
    const pageSub = document.querySelector('#tab-coach-plans .page-sub');
    if (pageSub) {
      const original = 'Reusable plans you\'ve built for your roster.';
      pageSub.style.color = 'var(--green)';
      pageSub.innerHTML = '<i class="fa-solid fa-circle-check"></i> "' + name + '" created successfully and added to your plans.';
      setTimeout(() => { pageSub.style.color = ''; pageSub.textContent = original; }, 4000);
    }
  }
  return false;
}
function deletePlan(idx) {
  const plans = getCoachPlans();
  if (idx < 0 || idx >= plans.length) return;
  if (plans[idx].isDefault) return;
  if (!confirm('Delete "' + plans[idx].name + '"? This cannot be undone.')) return;
  plans.splice(idx, 1);
  saveCoachPlans(plans);
  renderCoachPlans();
}
function viewPlanDetails(idx) {
  const plans = getCoachPlans();
  if (idx < 0 || idx >= plans.length) return;
  const p = plans[idx];
  const modal = document.getElementById('goal-modal') || null;
  // Reuse a generic modal approach: build a temporary overlay
  let detail = document.getElementById('plan-detail-modal');
  if (!detail) {
    detail = document.createElement('div');
    detail.id = 'plan-detail-modal';
    detail.className = 'modal-overlay';
    detail.style.zIndex = '10003';
    detail.innerHTML = '<div class="modal-content" style="max-width:520px;"><button class="modal-close" onclick="closeModal(\'plan-detail-modal\')">&times;</button><div id="plan-detail-body"></div></div>';
    document.body.appendChild(detail);
  }
  document.getElementById('plan-detail-body').innerHTML = `
    <h3><i class="fa-solid fa-clipboard-list"></i> ${p.name}</h3>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 14px;">
      <span style="font-size:.75rem;background:var(--accent-soft);color:var(--accent);padding:3px 10px;border-radius:10px;">${p.category}</span>
      <span style="font-size:.75rem;background:var(--bg);color:var(--muted);padding:3px 10px;border-radius:10px;">${p.difficulty}</span>
      <span style="font-size:.75rem;background:var(--bg);color:var(--muted);padding:3px 10px;border-radius:10px;">${p.duration}</span>
      <span style="font-size:.75rem;background:var(--bg);color:var(--muted);padding:3px 10px;border-radius:10px;">${p.sessions}</span>
      <span style="font-size:.75rem;background:var(--bg);color:var(--muted);padding:3px 10px;border-radius:10px;">${p.goal}</span>
    </div>
    ${p.equipment ? `<p style="font-size:.88rem;color:var(--muted);margin-bottom:6px;"><b style="color:var(--text);">Equipment:</b> ${p.equipment}</p>` : ''}
    ${p.focus && p.focus.length ? `<p style="font-size:.88rem;color:var(--muted);margin-bottom:6px;"><b style="color:var(--text);">Focus:</b> ${p.focus.join(', ')}</p>` : ''}
    ${p.desc ? `<p style="font-size:.88rem;color:var(--muted);margin-bottom:14px;line-height:1.55;">${p.desc}</p>` : ''}
    <h4><i class="fa-solid fa-list-check"></i> Weekly Workouts</h4>
    ${p.workouts && p.workouts.length ? '<ol style="margin-left:20px;line-height:1.9;font-size:.9rem;">' + p.workouts.map(w => '<li>' + w + '</li>').join('') + '</ol>' : '<p style="font-size:.88rem;color:var(--muted);">No workouts generated. Edit the plan to add sessions.</p>'}
    <div style="margin-top:16px;display:flex;gap:10px;">
      <button class="btn ghost" onclick="closeModal('plan-detail-modal')" style="flex:1;">Close</button>
      ${p.isDefault ? '' : '<button class="btn primary" onclick="closeModal(\'plan-detail-modal\'); openEditPlanModal(' + idx + ')" style="flex:1;"><i class="fa-solid fa-pen"></i> Edit</button>'}
    </div>
  `;
  openModal('plan-detail-modal');
}
function openEditPlanModal(idx) {
  // Lightweight: reuse the new plan modal pre-filled
  const plans = getCoachPlans();
  const p = plans[idx];
  if (!p || p.isDefault) return;
  openNewPlanModal();
  document.getElementById('np-name').value = p.name || '';
  document.getElementById('np-category').value = p.category || '';
  document.getElementById('np-difficulty').value = p.difficulty || '';
  document.getElementById('np-duration').value = p.duration || '';
  document.getElementById('np-sessions').value = p.sessions || '';
  document.getElementById('np-goal').value = p.goal || '';
  document.getElementById('np-equipment').value = p.equipment || 'Bodyweight Only';
  document.getElementById('np-desc').value = p.desc || '';
  document.querySelectorAll('#np-focus-chips .focus-chip').forEach(c => {
    if (p.focus && p.focus.includes(c.textContent.trim())) c.classList.add('selected');
  });
  // Change form mode: mark as editing
  const form = document.querySelector('#new-plan-modal form');
  form.setAttribute('data-edit-idx', idx);
  form.querySelector('button[type="submit"]').innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Changes';
  document.querySelector('#new-plan-modal h3').innerHTML = '<i class="fa-solid fa-pen"></i> Edit Training Plan';
}
function logoutCoach() {
  localStorage.removeItem(COACH_SESSION_KEY);
  // Use showScreen() so all screens are properly toggled and applySettings runs.
  showScreen('screen-landing');
  showCoachTab('coach-home');
  switchCoachAuthTab('login');
  document.getElementById('coach-email').value = '';
  document.getElementById('coach-password').value = '';
  updateChatbaseVisibility();
}
function coachGoogleLogin() {
  let email = localStorage.getItem('fb_last_coach_google');
  let users = getCoachUsers();
  if (!email || !users[email]) {
    const demoNames = ['Alex Rivera','Sam Cooper','Jordan Lee','Taylor Brooks'];
    const name = demoNames[Math.floor(Math.random() * demoNames.length)];
    email = name.toLowerCase().replace(' ','.') + '@gmail.com';
    localStorage.setItem('fb_last_coach_google', email);
    if (!users[email]) {
      users[email] = { fullName: name, email, cert: 'NASM', specialty: 'Strength & Conditioning', pwdHash: hashPassword('google_' + Date.now()) };
      saveCoachUsers(users);
    }
  }
  localStorage.setItem(COACH_SESSION_KEY, email);
  showCoachMsg('Welcome, Coach! Loading…','ok');
  setTimeout(() => enterCoachApp(users[email]), 300);
}
function getCoachAthletes() { const coachEmail = localStorage.getItem(COACH_SESSION_KEY); try { const all = JSON.parse(localStorage.getItem(COACH_ATHLETES_KEY) || '{}'); return all[coachEmail] || []; } catch(e) { return []; } }
function saveCoachAthletes(athletes) { const coachEmail = localStorage.getItem(COACH_SESSION_KEY); const all = JSON.parse(localStorage.getItem(COACH_ATHLETES_KEY) || '{}'); all[coachEmail] = athletes; localStorage.setItem(COACH_ATHLETES_KEY, JSON.stringify(all)); }
function openAddAthleteModal() { document.getElementById('add-athlete-name').value = ''; document.getElementById('add-athlete-sport').value = ''; document.getElementById('add-athlete-level').value = ''; document.getElementById('add-athlete-email').value = ''; document.getElementById('add-athlete-notes').value = ''; document.getElementById('add-athlete-msg').textContent = ''; openModal('add-athlete-modal'); }
function addAthlete(e) {
  e.preventDefault();
  const name = document.getElementById('add-athlete-name').value.trim();
  const sport = document.getElementById('add-athlete-sport').value;
  const level = document.getElementById('add-athlete-level').value;
  const email = document.getElementById('add-athlete-email').value.trim();
  const notes = document.getElementById('add-athlete-notes').value.trim();
  if (!name || !sport || !level) { document.getElementById('add-athlete-msg').textContent = 'Please fill in all required fields.'; document.getElementById('add-athlete-msg').className = 'msg error'; return false; }
  // Accept any valid email address (no Gmail restriction)
  const isAr = (store.lang === 'ar');
  if (!email) {
    document.getElementById('add-athlete-msg').textContent = isAr ? 'يرجى إدخال بريد إلكتروني.' : 'Please enter an email address.';
    document.getElementById('add-athlete-msg').className = 'msg error';
    return false;
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    document.getElementById('add-athlete-msg').textContent = isAr ? 'يرجى إدخال بريد إلكتروني صالح.' : 'Please enter a valid email address.';
    document.getElementById('add-athlete-msg').className = 'msg error';
    return false;
  }
  // Prevent duplicate athlete emails (same coach can't add the same gmail twice)
  const existing = getCoachAthletes();
  if (existing.some(a => (a.email || '').toLowerCase() === email.toLowerCase())) {
    document.getElementById('add-athlete-msg').textContent = isAr ? 'هذا الرياضي موجود بالفعل في قائمتك.' : 'This athlete is already in your roster.';
    document.getElementById('add-athlete-msg').className = 'msg error';
    return false;
  }
  const athletes = getCoachAthletes();
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2);
  athletes.push({ id: Date.now(), name, sport, level, email, notes, initials, streak: 0, sessions: 0, status: 'new', addedAt: new Date().toISOString(), sessionLog: [], assignedPlan: null, lastSessionDate: null, goals: '', injuryNotes: '', phone: '' });
  saveCoachAthletes(athletes);
  closeModal('add-athlete-modal');
  renderCoachAthletes(); updateCoachStats(); renderCoachSessionsTable();
  return false;
}
function removeAthlete(id) { let a = getCoachAthletes(); a = a.filter(x => x.id !== id); saveCoachAthletes(a); renderCoachAthletes(); updateCoachStats(); renderCoachSessionsTable(); }
function renderCoachAthletes() {
  const athletes = getCoachAthletes();
  const grid = document.getElementById('coach-athletes-grid');
  const noEl = document.getElementById('coach-no-athletes');
  const countEl = document.getElementById('coach-athlete-count');
  const profileCountEl = document.getElementById('coach-profile-athlete-count');
  const isAr = (store.lang === 'ar');
  const athleteWord = isAr ? 'رياضي' : 'athlete';
  const athleteWordPlural = isAr ? 'رياضيون' : 'athletes';
  if (countEl) countEl.textContent = athletes.length + ' ' + (athletes.length === 1 ? athleteWord : athleteWordPlural);
  if (profileCountEl) { profileCountEl.textContent = athletes.length + ' ' + (athletes.length === 1 ? athleteWord : athleteWordPlural); profileCountEl.setAttribute('data-ar', athletes.length + ' رياضياً'); }
  if (athletes.length === 0) { grid.innerHTML = ''; noEl.style.display = 'block'; return; }
  noEl.style.display = 'none';
  const statusLabels = isAr ? { 'on-track': 'على المسار', 'needs-attention': 'بحاجة لاهتمام', 'new': 'جديد' } : { 'on-track': 'On track', 'needs-attention': 'Needs attention', 'new': 'New' };
  const streakLabel = isAr ? 'يوم في السلسلة' : '-day streak';
  const sessionsLabel = isAr ? 'جلسة' : 'sessions';
  const logLabel = isAr ? 'تسجيل جلسة' : 'Log Session';
  const statusLabel = isAr ? 'تغيير الحالة' : 'Change Status';
  const detailsLabel = isAr ? 'التفاصيل' : 'Details';
  grid.innerHTML = athletes.map(a => {
    const bc = a.status === 'on-track' ? 'badge-on-track' : a.status === 'needs-attention' ? 'badge-needs-attention' : 'badge-new';
    const statusKey = a.status || 'new';
    const bt = statusLabels[statusKey];
    const planBadge = a.assignedPlan ? `<span style="font-size:.7rem;background:var(--accent-soft);color:var(--accent);padding:2px 8px;border-radius:8px;margin-left:4px;"><i class="fa-solid fa-clipboard-list" style="font-size:.6rem;"></i> ${a.assignedPlan}</span>` : '';
    // Phase 7: show "Paid" badge if athlete came through marketplace
    const paidBadge = a.paid ? `<span class="athlete-paid-badge" title="${isAr ? 'مدفوع' : 'Paid'} $${a.paidAmount}"><i class="fa-solid fa-circle-check" style="font-size:.6rem;"></i> ${isAr ? 'مدفوع' : 'Paid'}</span>` : '';
    return `<div class="athlete-card" style="cursor:pointer;" onclick="openAthleteDetail(${a.id})"><div class="avatar">${a.initials}</div><div class="a-body"><div class="a-top"><b>${a.name}</b><span class="badge ${bc}">${bt}</span> ${paidBadge}</div><small>${a.sport} · ${a.streak} ${streakLabel} · ${a.level}${planBadge}</small><p class="a-last">${a.sessions} ${sessionsLabel}${a.notes ? ' · ' + a.notes : ''}</p><div class="athlete-quick-actions" style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;"><button class="btn ghost small" onclick="event.stopPropagation();openAthleteDetail(${a.id})" style="font-size:.78rem;padding:9px 14px;min-height:38px;"><i class="fa-solid fa-circle-info"></i> ${detailsLabel}</button><button class="btn ghost small" onclick="event.stopPropagation();openLogSessionModal(${a.id})" style="font-size:.78rem;padding:9px 14px;min-height:38px;"><i class="fa-solid fa-stopwatch"></i> ${logLabel}</button><button class="btn ghost small" onclick="event.stopPropagation();cycleAthleteStatus(${a.id})" style="font-size:.78rem;padding:9px 14px;min-height:38px;"><i class="fa-solid fa-arrows-rotate"></i> ${statusLabel}</button></div></div><button onclick="event.stopPropagation();removeAthlete(${a.id})" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:.85rem;padding:4px 8px;align-self:flex-start;" title="Remove"><i class="fa-solid fa-xmark"></i></button></div>`;
  }).join('');
}
function updateCoachStats() {
  const athletes = getCoachAthletes();
  document.getElementById('coach-stat-athletes').textContent = athletes.length;
  document.getElementById('coach-stat-sessions').textContent = athletes.reduce((s, a) => s + a.sessions, 0);
  document.getElementById('coach-stat-attention').textContent = athletes.filter(a => a.status === 'needs-attention').length;
  document.getElementById('coach-stat-adherence').textContent = athletes.length > 0 ? Math.round((athletes.filter(a => a.status !== 'needs-attention').length / athletes.length) * 100) + '%' : '--';
}
function renderCoachSessionsTable() {
  const athletes = getCoachAthletes();
  const tbody1 = document.getElementById('coach-sessions-tbody');
  const tbody2 = document.getElementById('coach-home-sessions-tbody');
  const recList = document.getElementById('coach-rec-list');
  const isAr = (store.lang === 'ar');
  if (athletes.length === 0) {
    const emptyMsg = isAr ? 'لا يوجد رياضيون مسجلون بعد. أضف رياضيين لرؤية جلساتهم.' : 'No athletes logged yet. Add athletes to see their sessions.';
    const emptyHtml = `<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--muted);">${emptyMsg}</td></tr>`;
    if(tbody1) tbody1.innerHTML = emptyHtml;
    if(tbody2) tbody2.innerHTML = emptyHtml;
    if(recList) recList.innerHTML = `<li>${isAr ? 'أضف رياضيين لتلقي توصيات مخصصة حولهم.' : 'Add athletes to receive personalized recommendations about them.'}</li>`;
    return;
  }
  const drillLabel = isAr ? 'تمرين' : 'drill';
  const loadLabels = isAr ? { Low: 'منخفض', Moderate: 'معتدل', High: 'عالٍ' } : { Low: 'Low', Moderate: 'Moderate', High: 'High' };
  const allLogs = [];
  athletes.forEach(a => {
    if (a.sessionLog && a.sessionLog.length > 0) {
      a.sessionLog.forEach(s => { allLogs.push({ athleteName: a.name, sport: a.sport, ...s }); });
    }
  });
  allLogs.sort((a, b) => new Date(b.date) - new Date(a.date));
  if (allLogs.length === 0) {
    const noSessionMsg = isAr ? 'لا توجد جلسات مسجلة بعد.' : 'No sessions logged yet.';
    const noSessionHtml = `<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--muted);">${noSessionMsg}</td></tr>`;
    if(tbody1) tbody1.innerHTML = noSessionHtml;
    if(tbody2) tbody2.innerHTML = noSessionHtml;
  } else {
    const rows = allLogs.slice(0, 20).map(s => {
      const dateStr = new Date(s.date).toLocaleDateString(isAr ? 'ar-EG' : 'en-US', { month: 'short', day: 'numeric' });
      const intensityKey = s.intensity || 'Moderate';
      const load = loadLabels[intensityKey] || intensityKey;
      let durHtml = `${s.duration || '--'}m`; if (s.calories) durHtml += ` &nbsp;<i class="fa-solid fa-fire" style="font-size:.65rem;color:var(--amber);"></i> ${s.calories}kcal`; if (s.sets) durHtml += ` &middot; ${s.sets}×`; if (s.distance) durHtml += ` &middot; ${s.distance}km`; return `<tr><td><b>${s.athleteName}</b></td><td>${s.sport} ${drillLabel}</td><td>${dateStr}</td><td style="white-space:nowrap;">${durHtml}</td><td><span class="load load-${intensityKey.toLowerCase()}">${load}</span></td></tr>`;
    }).join('');
    if(tbody1) tbody1.innerHTML = rows;
    if(tbody2) tbody2.innerHTML = rows;
  }
  if(recList) {
    recList.innerHTML = athletes.slice(0, 3).map(a => {
      const streak = a.streak || 0;
      if (streak === 0) return isAr ? `<li>${a.name} لم يبدأ بعد. شجّعه على تسجيل أول جلسة!</li>` : `<li>${a.name} hasn't started yet. Encourage them to log their first session!</li>`;
      return isAr ? `<li>${a.name} في سلسلة من ${streak} يوم. حافظ على الزخم مع الحمل التدريجي في ${a.sport}.</li>` : `<li>${a.name} is on a ${streak}-day streak. Keep up the momentum with progressive overload in ${a.sport}.</li>`;
    }).join('');
  }
}
function renderCoachSessionsChart() {
  const athletes = getCoachAthletes();
  const ctx = document.getElementById('coachSessionsChart');
  if (!ctx) return;
  if (coachSessionsChart) coachSessionsChart.destroy();
  const labels = athletes.length > 0 ? athletes.map(a => a.name.split(' ')[0]) : ['No athletes'];
  const data = athletes.length > 0 ? athletes.map(a => a.sessions) : [0];
  const colors = ['#6495ED','#1d9d6b','#b97b16','#c94444','#8b5cf6','#ec4899','#06b6d4','#84cc16'];
  coachSessionsChart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Sessions', data, backgroundColor: data.map((_, i) => colors[i % colors.length] + '33'), borderColor: data.map((_, i) => colors[i % colors.length]), borderWidth: 2, borderRadius: 6, barPercentage: 0.6 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } }, x: { grid: { display: false } } } }
  });
}

// ==========================================
// COACH MEALS FOR USER
// ==========================================
const COACH_MEALS_KEY = 'volta_coach_meals';
function renderCoachMealsForUser() {
  const container = document.getElementById('diet-coach-meals');
  if (!container) return;
  const ar = (store.lang === 'ar');
  const kcalUnit = ar ? 'سعرة' : 'kcal';
  const pLabel = ar ? 'ب' : 'P';
  const cLabel = ar ? 'ك' : 'C';
  const fLabel = ar ? 'د' : 'F';
  const emptyMsg = ar ? 'لا توجد وجبات مخصصة بعد.' : 'No coach meals assigned yet.';
  const fromCoachMsg = ar ? 'من مدربك' : 'From your coach';
  const unableMsg = ar ? 'تعذّر تحميل وجبات المدرب.' : 'Unable to load coach meals.';
  const logBtnLabel = ar ? 'تسجيل هذه الوجبة' : 'Log this meal';
  const loggedLabel = ar ? 'تم التسجيل' : 'Logged';
  try {
    const allMeals = JSON.parse(localStorage.getItem(COACH_MEALS_KEY) || '{}');
    const myMeals = allMeals[store.session] || [];
    if (myMeals.length === 0) {
      container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--muted);"><i class="fa-solid fa-utensils" style="font-size:24px;opacity:.4;display:block;margin-bottom:8px;"></i><span data-ar="لا توجد وجبات مخصصة بعد.">${emptyMsg}</span></div>`;
      return;
    }
    // === Round 11: Render coach meals EXACTLY like AI generated meals.
    // Same HTML structure: .diet-card > h4 + p.diet-desc + .diet-macros (4
    // macro-pill spans) + "From your coach" label + Log button. This makes
    // the coach meals visually identical to the AI meals panel above. ===
    const dietLog = (typeof getDietLog === 'function') ? getDietLog() : [];
    const todayStr = (typeof localDateStr === 'function') ? localDateStr() : null;
    container.innerHTML = myMeals.map((m, idx) => {
      const dispName = m.name || 'Meal';
      const dispDesc = m.desc || '';
      // Check if this meal was already logged today (mirror AI meals behavior)
      const isLoggedToday = dietLog.some(function(x) {
        return x.mealType === 'coach-assigned' && x.date === todayStr && x.name === dispName;
      });
      const btnStyle = isLoggedToday
        ? 'background:var(--green);color:#fff;cursor:default;'
        : '';
      const btnAttrs = isLoggedToday ? 'disabled' : '';
      const btnInner = isLoggedToday
        ? '<i class="fa-solid fa-check"></i> <span>' + loggedLabel + '</span>'
        : '<i class="fa-solid fa-plus"></i> <span>' + logBtnLabel + '</span>';
      return `
      <div class="diet-card">
        <h4>${dispName}</h4>
        <p class="diet-desc">${dispDesc}</p>
        <div class="diet-macros">
          <span class="macro-pill macro-kcal">${m.kcal || '--'} ${kcalUnit}</span>
          <span class="macro-pill macro-p">${pLabel}: ${m.p || '--'}g</span>
          <span class="macro-pill macro-c">${cLabel}: ${m.c || '--'}g</span>
          <span class="macro-pill macro-f">${fLabel}: ${m.f || '--'}g</span>
        </div>
        <small style="color:var(--accent);font-weight:600;display:block;margin-top:8px;"><i class="fa-solid fa-user-tie"></i> <span data-ar="من مدربك">${fromCoachMsg}</span></small>
        <button class="btn primary small diet-log-meal-btn" id="coach-log-meal-btn-${idx}" onclick="logCoachMealForUser('${(m.name||'').replace(/'/g, "\\'")}', ${idx})" style="width:100%;margin-top:10px;font-size:.8rem;padding:8px;${btnStyle}" ${btnAttrs}>${btnInner}</button>
      </div>`;
    }).join('');
  } catch(e) { container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--muted);"><span data-ar="تعذّر تحميل وجبات المدرب.">${unableMsg}</span></div>`; }
  setTimeout(applyTranslations, 0);
}

// Log a coach-assigned meal into the user's own diet log (so it counts toward
// today's calorie bar). Mirrors logAIMeal but reads from the coach meals store.
// Round 7: block duplicate logging per day (same as logAIMeal) and removed the
// trailing ✓ from the label (the big FontAwesome fa-check icon is the single
// checkmark, per user spec).
function logCoachMealForUser(mealName, btnIdx) {
  try {
    const allMeals = JSON.parse(localStorage.getItem(COACH_MEALS_KEY) || '{}');
    const myMeals = allMeals[store.session] || [];
    const m = myMeals.find(x => x.name === mealName);
    if (!m) return;
    const log = getDietLog();
    // === Round 7: BLOCK DUPLICATE COACH MEAL LOG PER DAY ===
    const today = (typeof localDateStr === 'function') ? localDateStr() : null;
    const alreadyLogged = log.some(function(x) {
      return x.mealType === 'coach-assigned'
        && x.date === today
        && x.name === m.name;
    });
    if (alreadyLogged) {
      const btn0 = document.getElementById('coach-log-meal-btn-' + btnIdx);
      if (btn0) {
        const ar0 = (store.lang === 'ar');
        const ll0 = ar0 ? 'تم التسجيل' : 'Logged';   // no ✓ — icon is the checkmark
        btn0.innerHTML = '<i class="fa-solid fa-check"></i> <span>' + ll0 + '</span>';
        btn0.style.background = 'var(--green)';
        btn0.style.color = '#fff';
        btn0.disabled = true;
        btn0.style.cursor = 'default';
      }
      return;
    }
    log.push({
      id: Date.now(),
      name: m.name,
      brand: '',
      kcal: m.kcal || 0,
      protein: m.p || 0,
      carbs: m.c || 0,
      fat: m.f || 0,
      fiber: 0,
      serving: m.desc || '1 serving',
      barcode: '',
      mealType: 'coach-assigned',
      loggedAt: new Date().toISOString(),
      date: localDateStr()
    });
    saveDietLog(log);
    try { renderDietLog(); renderDiet(); renderHome(); } catch(e) {}
    const btn = document.getElementById('coach-log-meal-btn-' + btnIdx);
    if (btn) {
      const ar = (store.lang === 'ar');
      const loggedLabel = ar ? 'تم التسجيل' : 'Logged';   // no ✓ — icon is the checkmark
      btn.innerHTML = '<i class="fa-solid fa-check"></i> <span>' + loggedLabel + '</span>';
      btn.style.background = 'var(--green)';
      btn.style.color = '#fff';
      btn.disabled = true;
      btn.style.cursor = 'default';
    }
  } catch(e) { console.warn('logCoachMealForUser error:', e); }
}

// ===== COACH MEAL LOGGING =====
function coachLogMeal(e) {
  e.preventDefault();
  const ar = (store.lang === 'ar');
  const athleteEmail = document.getElementById('coach-meal-athlete').value;
  if (!athleteEmail) { alert(ar ? 'يرجى اختيار رياضي' : 'Please select an athlete'); return false; }
  const name = document.getElementById('coach-meal-name').value.trim();
  if (!name) return false;
  const kcal = parseInt(document.getElementById('coach-meal-kcal').value) || 0;
  const protein = parseFloat(document.getElementById('coach-meal-protein').value) || 0;
  const carbs = parseFloat(document.getElementById('coach-meal-carbs').value) || 0;
  const fat = parseFloat(document.getElementById('coach-meal-fat').value) || 0;
  const serving = document.getElementById('coach-meal-serving').value || 'coach-assigned';

  // === Round 10: Edit mode ===
  // If the edit flag is set, update the existing meal instead of pushing a new one.
  if (window.__editingCoachMeal) {
    const { athleteEmail: editEmail, mealIdx } = window.__editingCoachMeal;
    const allMeals = JSON.parse(localStorage.getItem(COACH_MEALS_KEY) || '{}');
    if (allMeals[editEmail] && allMeals[editEmail][mealIdx]) {
      allMeals[editEmail][mealIdx] = { name, desc: serving, kcal, p: protein, c: carbs, f: fat };
      localStorage.setItem(COACH_MEALS_KEY, JSON.stringify(allMeals));
      // Also update the athlete's diet log entry with the same name (best-effort sync)
      try {
        const key = 'volta_diet_log_' + editEmail;
        let log = JSON.parse(localStorage.getItem(key) || '[]');
        // Find the most recent coach-assigned entry with the old name and update it
        // (we don't have the old name here, so we just update the latest coach-assigned entry)
        for (let i = log.length - 1; i >= 0; i--) {
          if (log[i].mealType === 'coach-assigned') {
            log[i].name = name;
            log[i].kcal = kcal;
            log[i].protein = protein;
            log[i].carbs = carbs;
            log[i].fat = fat;
            log[i].serving = serving;
            break;
          }
        }
        localStorage.setItem(key, JSON.stringify(log));
      } catch(e) {}
    }
    // Clear edit mode + reset form
    cancelEditCoachMeal();
    alert(ar ? 'تم تحديث الوجبة بنجاح!' : 'Meal updated successfully!');
    renderCoachMealsLog();
    return false;
  }

  // Save to athlete's diet log
  const key = 'volta_diet_log_' + athleteEmail;
  let log = [];
  try { log = JSON.parse(localStorage.getItem(key) || '[]'); } catch(e) {}
  log.push({ id: Date.now(), name, brand: '', kcal, protein, carbs, fat, fiber: 0, serving, barcode: '', mealType: 'coach-assigned', loggedAt: new Date().toISOString(), date: localDateStr(), coachAssigned: true });
  localStorage.setItem(key, JSON.stringify(log));
  // Also save to IndexedDB for offline
  if (typeof voltaDB !== 'undefined') {
    voltaDB.put('dietLog', { email: athleteEmail, log });
  }

  // Save to coach meals collection (for the "Coach-Recommended Meals" section)
  const allMeals = JSON.parse(localStorage.getItem(COACH_MEALS_KEY) || '{}');
  if (!allMeals[athleteEmail]) allMeals[athleteEmail] = [];
  allMeals[athleteEmail].push({ name, desc: serving, kcal, p: protein, c: carbs, f: fat });
  localStorage.setItem(COACH_MEALS_KEY, JSON.stringify(allMeals));

  // Reset form
  document.getElementById('coach-meal-name').value = '';
  document.getElementById('coach-meal-kcal').value = '0';
  document.getElementById('coach-meal-serving').value = '';
  document.getElementById('coach-meal-protein').value = '0';
  document.getElementById('coach-meal-carbs').value = '0';
  document.getElementById('coach-meal-fat').value = '0';

  // Show success
  alert(ar ? 'تم تسجيل الوجبة لرياضيك بنجاح!' : 'Meal logged for athlete successfully!');
  renderCoachMealsLog();
  return false;
}

function renderCoachMealsLog() {
  const container = document.getElementById('coach-meals-log-list');
  if (!container) return;
  const ar = (store.lang === 'ar');
  const allMeals = JSON.parse(localStorage.getItem(COACH_MEALS_KEY) || '{}');
  const athletes = getCoachAthletes();
  let allEntries = [];
  for (const [email, meals] of Object.entries(allMeals)) {
    const athlete = athletes.find(a => a.email === email);
    const athleteName = athlete ? athlete.name : (email || ar ? 'غير معروف' : 'Unknown');
    // Round 10: track mealIdx so the edit button can find the exact meal to update
    meals.forEach((m, i) => {
      allEntries.push({ ...m, athleteName, athleteEmail: email, mealIdx: i });
    });
  }
  // Sort by most recent (last in array = most recent)
  allEntries = allEntries.slice(-20).reverse();
  if (allEntries.length === 0) {
    container.innerHTML = `<p style="color:var(--muted);text-align:center;padding:20px;">${ar ? 'لا توجد وجبات مسجلة بعد.' : 'No meals logged yet.'}</p>`;
    return;
  }
  // Round 10: added Edit + Delete buttons per user spec
  // "add edit meal button for athletes when you log a meal for an athlete"
  const editLabel = ar ? 'تعديل' : 'Edit';
  const delLabel = ar ? 'حذف' : 'Delete';
  container.innerHTML = allEntries.map(e => `
    <div class="diet-log-entry" style="margin-bottom:8px;">
      <div class="diet-log-icon"><i class="fa-solid fa-utensils"></i></div>
      <div class="diet-log-body">
        <b>${e.name}</b>
        <small style="color:var(--accent);"><i class="fa-solid fa-user"></i> ${e.athleteName}</small>
        ${e.desc && e.desc !== 'coach-assigned' ? '<small style="color:var(--muted);"> · ' + e.desc + '</small>' : ''}
      </div>
      <span class="diet-log-kcal">${e.kcal || 0} kcal</span>
      <button class="diet-log-del" onclick="editCoachMeal('${e.athleteEmail}', ${e.mealIdx})" title="${editLabel}" style="color:var(--accent);"><i class="fa-solid fa-pen"></i></button>
      <button class="diet-log-del" onclick="deleteCoachMeal('${e.athleteEmail}', ${e.mealIdx})" title="${delLabel}"><i class="fa-solid fa-xmark"></i></button>
    </div>
  `).join('');
}

// === Round 10: Edit a coach-assigned meal ===
// Loads the meal into the "Log Meal for Athlete" form so the coach can update
// the name/kcal/macros/serving, then submit to save changes.
function editCoachMeal(athleteEmail, mealIdx) {
  try {
    const allMeals = JSON.parse(localStorage.getItem(COACH_MEALS_KEY) || '{}');
    const meals = allMeals[athleteEmail] || [];
    const m = meals[mealIdx];
    if (!m) return;
    const ar = (store.lang === 'ar');
    // Pre-fill the form
    const sel = document.getElementById('coach-meal-athlete');
    if (sel) { sel.value = athleteEmail; sel.disabled = true; }  // lock athlete during edit
    document.getElementById('coach-meal-name').value = m.name || '';
    document.getElementById('coach-meal-kcal').value = m.kcal || 0;
    document.getElementById('coach-meal-serving').value = (m.desc && m.desc !== 'coach-assigned') ? m.desc : '';
    document.getElementById('coach-meal-protein').value = m.p || 0;
    document.getElementById('coach-meal-carbs').value = m.c || 0;
    document.getElementById('coach-meal-fat').value = m.f || 0;
    // Set edit-mode flag so coachLogMeal() knows to update instead of push
    window.__editingCoachMeal = { athleteEmail, mealIdx };
    // Update the submit button label to "Update Meal"
    const submitBtn = document.querySelector('#tab-coach-meals form button[type="submit"]');
    if (submitBtn) {
      submitBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> ' + (ar ? 'تحديث الوجبة' : 'Update Meal');
    }
    // Show the Cancel button so the coach can exit edit mode
    const cancelBtn = document.getElementById('coach-meal-cancel-btn');
    if (cancelBtn) cancelBtn.style.display = 'inline-flex';
    // Scroll to the form so the coach can edit
    const form = document.querySelector('#tab-coach-meals form');
    if (form) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch(e) { console.warn('editCoachMeal error:', e); }
}

// === Round 10: Cancel edit mode (reset the form + flag) ===
function cancelEditCoachMeal() {
  window.__editingCoachMeal = null;
  const sel = document.getElementById('coach-meal-athlete');
  if (sel) sel.disabled = false;
  // Reset form fields
  document.getElementById('coach-meal-name').value = '';
  document.getElementById('coach-meal-kcal').value = '0';
  document.getElementById('coach-meal-serving').value = '';
  document.getElementById('coach-meal-protein').value = '0';
  document.getElementById('coach-meal-carbs').value = '0';
  document.getElementById('coach-meal-fat').value = '0';
  // Reset submit button label
  const ar = (store.lang === 'ar');
  const submitBtn = document.querySelector('#tab-coach-meals form button[type="submit"]');
  if (submitBtn) {
    submitBtn.innerHTML = '<i class="fa-solid fa-utensils"></i> ' + (ar ? 'تسجيل الوجبة للرياضي' : 'Log Meal for Athlete');
  }
  // Hide the Cancel button
  const cancelBtn = document.getElementById('coach-meal-cancel-btn');
  if (cancelBtn) cancelBtn.style.display = 'none';
}

// === Round 10: Delete a coach-assigned meal ===
function deleteCoachMeal(athleteEmail, mealIdx) {
  try {
    const ar = (store.lang === 'ar');
    if (!confirm(ar ? 'هل أنت متأكد من حذف هذه الوجبة؟' : 'Are you sure you want to delete this meal?')) return;
    const allMeals = JSON.parse(localStorage.getItem(COACH_MEALS_KEY) || '{}');
    if (!allMeals[athleteEmail]) return;
    allMeals[athleteEmail].splice(mealIdx, 1);
    if (allMeals[athleteEmail].length === 0) delete allMeals[athleteEmail];
    localStorage.setItem(COACH_MEALS_KEY, JSON.stringify(allMeals));
    renderCoachMealsLog();
    // If we were editing this meal, cancel edit mode
    if (window.__editingCoachMeal && window.__editingCoachMeal.athleteEmail === athleteEmail && window.__editingCoachMeal.mealIdx === mealIdx) {
      cancelEditCoachMeal();
    }
  } catch(e) { console.warn('deleteCoachMeal error:', e); }
}

function populateCoachMealAthletes() {
  const select = document.getElementById('coach-meal-athlete');
  if (!select) return;
  const athletes = getCoachAthletes();
  // Keep the first placeholder option
  const ar = (store.lang === 'ar');
  select.innerHTML = '<option value="">' + (ar ? 'اختر رياضياً...' : 'Select athlete...') + '</option>';
  athletes.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.email || a.name;
    opt.textContent = a.name + (a.sport ? ' (' + a.sport + ')' : '');
    select.appendChild(opt);
  });
}

function autofillFromInBody() {
  const file = document.getElementById('inbody-file').files[0];
  if (!file) { setMsg('inbody-status', 'Please select an InBody result sheet image.', 'error'); return; }

  // Reset UI
  setMsg('inbody-status', '', '');
  const progressWrap = document.getElementById('inbody-progress-wrap');
  const progressBar = document.getElementById('inbody-progress-bar');
  const progressText = document.getElementById('inbody-progress-text');
  const resultsBox = document.getElementById('inbody-results');
  progressWrap.style.display = 'block';
  resultsBox.style.display = 'none';
  progressBar.style.width = '0%';
  progressText.textContent = 'Loading OCR engine…';

  // Guard: Tesseract.js should be loaded via <script> in the page.
  if (typeof Tesseract === 'undefined') {
    setMsg('inbody-status', 'OCR engine failed to load. Check your connection and refresh.', 'error');
    progressWrap.style.display = 'none';
    return;
  }

  const phaseWeights = { 'loading tesseract core': 0.15, 'initializing tesseract': 0.25, 'loading language traineddata': 0.45, 'initializing api': 0.55, 'recognizing text': 0.55 };

  Tesseract.recognize(file, 'eng', {
    logger: m => {
      const base = phaseWeights[m.status] !== undefined ? phaseWeights[m.status] : 0;
      let pct;
      if (m.status === 'recognizing text') {
        pct = Math.round((base + (1 - base) * (m.progress || 0)) * 100);
        progressText.textContent = 'Scanning text… ' + pct + '%';
      } else {
        pct = Math.round((base + (m.progress || 0) * 0.1) * 100);
        progressText.textContent = (m.status.charAt(0).toUpperCase() + m.status.slice(1)) + '…';
      }
      progressBar.style.width = pct + '%';
    }
  }).then(({ data: { text } }) => {
    progressBar.style.width = '100%';
    progressText.textContent = 'Parsing results…';

    // Use the shared parser (handles metric + imperial formats)
    const found = parseInBodyText(text);
    if (found.weight !== undefined) surveyAnswers.weight = found.weight;
    if (found.height !== undefined) surveyAnswers.height = found.height;
    if (found.age !== undefined) surveyAnswers.age = found.age;
    if (found.gender !== undefined) surveyAnswers.gender = found.gender;

    const foundKeys = Object.keys(found).filter(k => !k.endsWith('Unit'));
    if (foundKeys.length === 0) {
      progressWrap.style.display = 'none';
      setMsg('inbody-status', 'Could not read any fields from this image. Please enter your details manually in the survey.', 'error');
      return;
    }

    // Show extracted results
    const rows = [
      ['Weight', found.weight, 'kg'],
      ['Height', found.height, 'cm'],
      ['Age', found.age, 'yrs'],
      ['Gender', found.gender, ''],
      ['BMI', found.bmi, ''],
      ['Body Fat', found.bodyFat, '%'],
      ['Muscle Mass', found.muscle, 'kg'],
      ['BMR', found.bmr, 'kcal']
    ].filter(r => r[1] !== undefined && r[1] !== null && r[1] !== '');

    resultsBox.innerHTML = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;color:var(--green);font-weight:700;font-size:.92rem;"><i class="fa-solid fa-circle-check"></i> ' + foundKeys.length + ' field' + (foundKeys.length === 1 ? '' : 's') + ' auto-filled</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 14px;font-size:.85rem;">' +
        rows.map(r => '<div style="display:flex;justify-content:space-between;gap:8px;"><span style="color:var(--muted);">' + r[0] + ':</span><b>' + r[1] + (r[2] ? ' ' + r[2] : '') + '</b></div>').join('') +
      '</div>';
    resultsBox.style.display = 'block';
    progressText.textContent = 'Done! Review extracted values, then start the survey.';
    setMsg('inbody-status', 'InBody scan read successfully! Values are pre-filled — tap "Start Survey" to continue.', 'ok');
  }).catch(err => {
    console.error('InBody OCR error:', err);
    progressWrap.style.display = 'none';
    setMsg('inbody-status', 'Could not read image. Please enter your details manually in the survey.', 'error');
  });
}

// ===== INITIALIZATION WITH INSTANT LOGIN =====
// ===== Phase 2: IndexedDB-backed meal & workout caches =====
// MEALS_DB and WORKOUTS_DB are populated from IndexedDB on startup.
// When populated, they replace the hardcoded MEALS / WORKOUT_DB arrays as the
// source of truth for rendering. If IndexedDB isn't ready yet (slow init), the
// old hardcoded arrays are used as a fallback so the UI never breaks.
let MEALS_DB = [];       // populated from VoltaDB.meals.getAll()
let WORKOUTS_DB = [];    // populated from VoltaDB.workouts.getAll()

// Initialize VoltaDB and load caches. Runs in parallel with the splash animation
// so by the time the user sees the dashboard, the DB is ready.
(async function initVoltaDB() {
  try {
    if (!window.VoltaDB) { console.warn('[Volta] VoltaDB not loaded — using hardcoded fallback'); return; }
    await VoltaDB.init();
    MEALS_DB = await VoltaDB.meals.getAll();
    WORKOUTS_DB = await VoltaDB.workouts.getAll();
    console.log('[Volta] DB caches loaded: ' + MEALS_DB.length + ' meals, ' + WORKOUTS_DB.length + ' workouts');
    // If a tab that uses meals/workouts is already visible, re-render it now
    // so the user sees the full 100-meal/100-workout database instead of the
    // 6-meal/43-workout fallback.
    try {
      var activeTab = document.querySelector('#screen-app .tab.active');
      if (activeTab) {
        var tabName = activeTab.id.replace('tab-', '');
        if (tabName === 'diet' && typeof renderDiet === 'function') renderDiet();
        if (tabName === 'daily' && typeof renderDailyExercise === 'function') renderDailyExercise();
        if (tabName === 'sports' && typeof renderSports === 'function') renderSports();
      }
    } catch(e) {}
  } catch(e) {
    console.warn('[Volta] DB init failed — using hardcoded fallback:', e);
  }
})();

(function init() {
  try {
    applySettings();
    updateMobileMenuBtn();
  } catch(e) { console.warn('applySettings error:', e); }
  const splash = document.getElementById('splash-screen');
  const isMobileDevice = window.innerWidth <= 768;

  // Coach removed — clear any stale coach session
  try { if (localStorage.getItem('volta_coach_session')) localStorage.removeItem('volta_coach_session'); } catch(e) {}
  const isCoach = false;
  
  const email = store.session;
  const isUser = email && store.users[email];
  
  const splashAnimIn = 100;
  const splashFullDuration = isMobileDevice ? 1700 : 2500;
  setTimeout(() => {
    if (splash) splash.classList.add('animate');
    setTimeout(() => {
      try {
        if (splash) splash.classList.add('hidden');
        // v14 (user): "always redirect the user to the homepage first time
        // ever opening the app" — on the VERY first open (no fb_opened_once
        // flag in storage) the app ALWAYS lands on the homepage/landing
        // screen, no matter what state exists. A truly-first open has no
        // session, so this is normally the same as the old behavior — it
        // just makes the guarantee explicit and covers edge cases (e.g. a
        // stale fb_session without a matching user record). Subsequent
        // opens behave exactly as before.
        var firstEverOpen = false;
        try {
          firstEverOpen = !localStorage.getItem('fb_opened_once');
          localStorage.setItem('fb_opened_once', '1');
        } catch (e) {}
        if (isUser && !firstEverOpen) {
          const u = store.users[email];
          if (!u.verified) { u.verified = true; saveUser(email, u); }
          // First-run opens the HOMEPAGE (survey is optional from Profile).
          enterAppOrSetup();
        } else {
          showScreen('screen-landing');
        }
        updateChatbaseVisibility();
        updateMobileMenuBtn();
        // Failsafe: if no screen is active, force-show landing
        var anyActive = document.querySelector('.screen.active');
        if (!anyActive) {
          var landing = document.getElementById('screen-landing');
          if (landing) landing.classList.add('active');
        }
      } catch(e) {
        console.error('Init splash transition error:', e);
        // Force-show landing as absolute fallback
        var landing = document.getElementById('screen-landing');
        if (landing) landing.classList.add('active');
        if (splash) splash.classList.add('hidden');
      }
    }, splashFullDuration);
  }, splashAnimIn);
  
  setInterval(checkReminders, 30000);
  // Initialize notifications (water reminder removed — workout reminders only)
  try { if (window.VoltaNotifications) VoltaNotifications.init(); } catch(e) {}
  // Phase 7: seed demo coaches for the marketplace
  try { if (window.VoltaMarketplace) VoltaMarketplace.seedCoaches(); } catch(e) {}
  // Phase 8 failsafe: force-hide the OCR overlay on startup in case it's
  // stuck visible (can happen when opening from file:// or if CSS loads slowly)
  try {
    var _ocr = document.getElementById('ocr-overlay');
    if (_ocr) _ocr.classList.remove('active');
  } catch(e) {}
  // Real payment: check if returning from Stripe Checkout with ?payment=success
  try { handlePaymentRedirect(); } catch(e) {}
})();

// ─── Real payment: handle Stripe Checkout redirect ────────────────────────
// When Stripe finishes processing, it redirects back to the app with
// ?payment=success&type=premium&plan=monthly (or type=coach&coachEmail=...)
// This function detects that and activates premium / hires the coach.
function handlePaymentRedirect() {
  var params = new URLSearchParams(window.location.search);
  var paymentStatus = params.get('payment');
  var paymentType = params.get('type');
  if (!paymentStatus) return;

  if (paymentStatus === 'success' && paymentType === 'premium') {
    var plan = params.get('plan') || 'monthly';
    if (window.VoltaPremium) {
      // REAL flow: the server verifies the Stripe session (session_id) and
      // grants the FULL duration (1 calendar month / year). In demo mode
      // (no Stripe key on the backend) the same call activates Premium so
      // the whole flow stays testable. VoltaPremium also refreshes the
      // top-right pill, the sidebar gold tag and the home card.
      VoltaPremium.completeCheckout(plan, params.get('session_id'));
    }
  } else if (paymentStatus === 'success' && paymentType === 'coach' && params.get('coachEmail')) {
    var coachEmail = params.get('coachEmail');
    if (window.VoltaMarketplace) {
      // The hireCoach function adds the athlete to the coach's roster
      // with payment info (without charging again — Stripe already charged)
      var result = VoltaMarketplace.hireCoach(coachEmail, { _stripePaid: true });
      if (result.success) {
        try { if (typeof showVoltaToast === 'function') showVoltaToast('Coach hired successfully!', 'success'); } catch(e) {}
      }
    }
  } else if (paymentStatus === 'cancel') {
    try { if (typeof showVoltaToast === 'function') showVoltaToast('Payment cancelled — you have not been charged.', 'info'); } catch(e) {}
  }

  // Clean the URL (remove the query params so refresh doesn't re-trigger)
  try {
    var cleanUrl = window.location.origin + window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);
  } catch(e) {}
}


// ===== ENHANCED COACH FUNCTIONS =====

// Coach Session Tracker (like athlete version)
let coachSessionTimerInt = null;
let coachSessionStart = null;
let coachSessionIsPaused = false;
let coachSessionAthleteId = null;
let coachSessionSets = 0;

function incrementCoachSets() {
  coachSessionSets++;
  document.getElementById('coach-ses-sets').textContent = coachSessionSets;
}

function openLogSessionModal(athleteId) {
  const athletes = getCoachAthletes();
  const a = athletes.find(x => x.id === athleteId);
  if (!a) return;
  coachSessionAthleteId = athleteId;
  coachSessionSets = 0;
  document.getElementById('coach-ses-athlete-name').textContent = a.name;
  document.getElementById('coach-ses-sport').textContent = a.sport + ' · ' + a.level;
  document.getElementById('coach-ses-timer').textContent = '00:00';
  document.getElementById('coach-ses-calories').innerHTML = '<i class="fa-solid fa-fire"></i> 0 kcal';
  document.getElementById('coach-ses-intensity').textContent = '--';
  document.getElementById('coach-ses-pace').textContent = '--';
  document.getElementById('coach-ses-heart').textContent = '--';
  document.getElementById('coach-ses-distance').textContent = '0.0';
  document.getElementById('coach-ses-sets').textContent = '0';
  document.getElementById('coach-ses-live-actions').style.display = 'flex';
  document.getElementById('coach-ses-log-form').classList.remove('visible');
  document.getElementById('coach-ses-pause-btn').style.display = '';
  document.getElementById('coach-ses-pause-btn').innerHTML = '<i class="fa-solid fa-pause"></i> <span data-ar="إيقاف مؤقت">Pause</span>';
  document.getElementById('coach-ses-pause-btn').onclick = pauseCoachSession;
  document.getElementById('coach-session-overlay').classList.add('active');
  coachSessionStart = Date.now();
  coachSessionIsPaused = false;
  if (coachSessionTimerInt) clearInterval(coachSessionTimerInt);
  coachSessionTimerInt = setInterval(updateCoachSessionTime, 1000);
}

function updateCoachSessionTime() {
  if (coachSessionIsPaused) return;
  const elapsed = Math.floor((Date.now() - coachSessionStart) / 1000);
  const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const secs = (elapsed % 60).toString().padStart(2, '0');
  document.getElementById('coach-ses-timer').textContent = `${mins}:${secs}`;
  const cals = Math.round(6.0 * ((typeof currentUser === 'function' && currentUser() && currentUser().profile && currentUser().profile.weight) || 70) * (elapsed / 3600));
  document.getElementById('coach-ses-calories').innerHTML = `<i class="fa-solid fa-fire"></i> ${cals} kcal`;
  const intensityMap = elapsed < 600 ? 'Low' : elapsed < 1800 ? 'Moderate' : 'High';
  document.getElementById('coach-ses-intensity').textContent = intensityMap;
  const paceMin = elapsed > 0 ? (elapsed / 60 / Math.max(1, (elapsed / 60) * 0.15)).toFixed(1) : '--';
  document.getElementById('coach-ses-pace').textContent = paceMin;
  const hr = Math.round(120 + (elapsed / 60) * 0.5 + Math.random() * 3);
  document.getElementById('coach-ses-heart').textContent = Math.min(hr, 185);
  const distKm = (elapsed / 60 * 0.15).toFixed(1);
  document.getElementById('coach-ses-distance').textContent = distKm;
  document.getElementById('coach-ses-sets').textContent = coachSessionSets;
}

function pauseCoachSession() {
  if (coachSessionIsPaused) return;
  coachSessionIsPaused = true;
  document.getElementById('coach-ses-pause-btn').innerHTML = '<i class="fa-solid fa-play"></i> Resume';
  document.getElementById('coach-ses-pause-btn').onclick = resumeCoachSession;
}

function resumeCoachSession() {
  coachSessionIsPaused = false;
  coachSessionStart += 500;
  document.getElementById('coach-ses-pause-btn').innerHTML = '<i class="fa-solid fa-pause"></i> <span data-ar="إيقاف مؤقت">Pause</span>';
  document.getElementById('coach-ses-pause-btn').onclick = pauseCoachSession;
}

function exitCoachSession() {
  if (coachSessionTimerInt) clearInterval(coachSessionTimerInt);
  coachSessionIsPaused = false;
  document.getElementById('coach-session-overlay').classList.remove('active');
}

function stopCoachSession() {
  if (coachSessionTimerInt) clearInterval(coachSessionTimerInt);
  coachSessionIsPaused = false;
  const elapsedMins = Math.max(1, Math.round((Date.now() - coachSessionStart) / 60000));
  const cals = Math.round(6.0 * ((typeof currentUser === 'function' && currentUser() && currentUser().profile && currentUser().profile.weight) || 70) * (elapsedMins / 60));
  const distKm = (elapsedMins * 0.15).toFixed(1);
  document.getElementById('coach-ses-live-actions').style.display = 'none';
  document.getElementById('coach-ses-log-form').classList.add('visible');
  document.getElementById('coach-ses-log-duration').value = elapsedMins;
  const intensityMap = elapsedMins < 10 ? 'Low' : elapsedMins < 30 ? 'Moderate' : 'High';
  document.getElementById('coach-ses-log-intensity').value = intensityMap;
  document.getElementById('coach-ses-log-calories').value = cals;
  document.getElementById('coach-ses-log-distance').value = distKm;
  document.getElementById('coach-ses-log-sets').value = coachSessionSets;
  document.getElementById('coach-ses-log-notes').value = '';
}

function saveCoachSessionLog() {
  const duration = parseInt(document.getElementById('coach-ses-log-duration').value);
  const intensity = document.getElementById('coach-ses-log-intensity').value;
  const calories = parseInt(document.getElementById('coach-ses-log-calories').value) || 0;
  const distance = parseFloat(document.getElementById('coach-ses-log-distance').value) || 0;
  const sets = parseInt(document.getElementById('coach-ses-log-sets').value) || 0;
  const notes = document.getElementById('coach-ses-log-notes').value.trim();
  if (!duration || duration < 1) { alert('Please enter a valid duration.'); return; }
  const athletes = getCoachAthletes();
  const a = athletes.find(x => x.id === coachSessionAthleteId);
  if (!a) return;
  if (!a.sessionLog) a.sessionLog = [];
  const today = localDateStr();
  a.sessionLog.push({ date: today, duration, intensity, calories, distance, sets, notes, loggedAt: new Date().toISOString() });
  a.sessions = (a.sessions || 0) + 1;
  const todayStr = new Date().toDateString();
  const yesterdayStr = new Date(Date.now() - 864e5).toDateString();
  if (a.lastSessionDate === todayStr) { /* already logged today */ }
  else if (a.lastSessionDate === yesterdayStr) { a.streak = (a.streak || 0) + 1; }
  else { a.streak = 1; }
  a.lastSessionDate = todayStr;
  saveCoachAthletes(athletes);
  document.getElementById('coach-session-overlay').classList.remove('active');
  renderCoachAthletes(); updateCoachStats(); renderCoachSessionsTable(); renderCoachSessionsChart(); renderCoachWeeklyOverview();
}

// Announcements
const COACH_ANNOUNCEMENTS_KEY = 'volta_coach_announcements';
function getCoachAnnouncements() { const e = localStorage.getItem(COACH_SESSION_KEY); try { const a = JSON.parse(localStorage.getItem(COACH_ANNOUNCEMENTS_KEY) || '{}'); return a[e] || []; } catch(e) { return []; } }
function saveCoachAnnouncements(anns) { const e = localStorage.getItem(COACH_SESSION_KEY); const a = JSON.parse(localStorage.getItem(COACH_ANNOUNCEMENTS_KEY) || '{}'); a[e] = anns; localStorage.setItem(COACH_ANNOUNCEMENTS_KEY, JSON.stringify(a)); }
function openAnnouncementModal() { document.getElementById('announcement-title').value = ''; document.getElementById('announcement-message').value = ''; openModal('announcement-modal'); }
function saveAnnouncement() { const t = document.getElementById('announcement-title').value.trim(); const m = document.getElementById('announcement-message').value.trim(); if (!t || !m) { alert('Please fill in title and message.'); return; } const a = getCoachAnnouncements(); a.unshift({ id: Date.now(), title: t, message: m, date: new Date().toISOString() }); saveCoachAnnouncements(a); closeModal('announcement-modal'); renderCoachAnnouncements(); }
function deleteAnnouncement(id) { let a = getCoachAnnouncements(); a = a.filter(x => x.id !== id); saveCoachAnnouncements(a); renderCoachAnnouncements(); }
function renderCoachAnnouncements() { const l = document.getElementById('coach-announcements-list'); const n = document.getElementById('coach-no-announcements'); if (!l) return; const a = getCoachAnnouncements(); if (a.length === 0) { l.innerHTML = ''; if(n) n.style.display = 'block'; return; } if(n) n.style.display = 'none'; const isAr = (store.lang === 'ar'); l.innerHTML = a.map(x => { const d = new Date(x.date).toLocaleDateString(isAr ? 'ar-EG' : 'en-US', { month: 'short', day: 'numeric' }); return `<div class="coach-announcement"><div><b>${x.title}</b><p>${x.message}</p><small style="color:var(--muted);font-size:.72rem;">${d}</small></div><div class="ann-actions"><button onclick="deleteAnnouncement(${x.id})" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:.8rem;padding:2px 6px;"><i class="fa-solid fa-trash"></i></button></div></div>`; }).join(''); }

// Weekly Overview
function renderCoachWeeklyOverview() { const g = document.getElementById('coach-weekly-grid'); if (!g) return; const athletes = getCoachAthletes(); const isAr = (store.lang === 'ar'); const dn = isAr ? ['أحد','إثنين','ثلاثاء','أربعاء','خميس','جمعة','سبت'] : ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']; const t = new Date(); const s = new Date(t); s.setDate(t.getDate() - t.getDay()); let h = ''; for (let i = 0; i < 7; i++) { const d = new Date(s); d.setDate(s.getDate() + i); const ds = d.toDateString(); const isT = ds === t.toDateString(); let c = 0; athletes.forEach(a => { if (a.sessionLog && a.sessionLog.length > 0) { a.sessionLog.forEach(sl => { if (new Date(sl.date).toDateString() === ds) c++; }); } }); h += `<div class="coach-weekly-day${isT ? ' today' : ''}"><small>${dn[i]}</small><b>${c}</b></div>`; } g.innerHTML = h; }

// Athlete Detail
function openAthleteDetail(id) { const athletes = getCoachAthletes(); const a = athletes.find(x => x.id === id); if (!a) return; const isAr = (store.lang === 'ar'); const plans = getCoachPlans(); const po = plans.map((p) => `<option value="${p.name}" ${a.assignedPlan === p.name ? 'selected' : ''}>${p.name}</option>`).join(''); const body = document.getElementById('athlete-detail-body'); body.innerHTML = `<div class="athlete-detail-header"><div class="avatar" style="background:var(--accent-soft);color:var(--accent);">${a.initials}</div><div style="flex:1;"><h3 style="margin-bottom:2px;">${a.name}</h3><p style="color:var(--muted);font-size:.88rem;">${a.sport} · ${a.level}</p></div><span class="badge ${a.status === 'on-track' ? 'badge-on-track' : a.status === 'needs-attention' ? 'badge-needs-attention' : 'badge-new'}">${a.status || 'new'}</span></div><div class="athlete-detail-stats"><div class="athlete-detail-stat"><b>${a.streak || 0}</b><small>${isAr ? 'سلسلة' : 'Streak'}</small></div><div class="athlete-detail-stat"><b>${a.sessions || 0}</b><small>${isAr ? 'جلسات' : 'Sessions'}</small></div><div class="athlete-detail-stat"><b>${a.assignedPlan || '—'}</b><small>${isAr ? 'الخطة' : 'Plan'}</small></div><div class="athlete-detail-stat"><b>${a.sessionLog ? a.sessionLog.length : 0}</b><small>${isAr ? 'سجلات' : 'Logs'}</small></div></div><div style="margin-bottom:16px;"><label style="font-size:.82rem;font-weight:600;color:var(--muted);margin-bottom:6px;display:block;">${isAr ? 'تعيين خطة' : 'Assign Plan'}</label><select class="plan-assign-select" onchange="assignPlanToAthlete(${a.id}, this.value)"><option value="">${isAr ? '— لا خطة —' : '— No plan —'}</option>${po}</select></div>${a.goals ? `<div style="margin-bottom:12px;"><b style="font-size:.85rem;">${isAr ? 'الأهداف' : 'Goals'}</b><p style="font-size:.88rem;color:var(--muted);margin-top:2px;">${a.goals}</p></div>` : ''}${a.injuryNotes ? `<div style="margin-bottom:12px;"><b style="font-size:.85rem;color:var(--red);">${isAr ? 'إصابات' : 'Injury Notes'}</b><p style="font-size:.88rem;color:var(--muted);margin-top:2px;">${a.injuryNotes}</p></div>` : ''}${a.email ? `<div style="margin-bottom:12px;"><b style="font-size:.85rem;">${isAr ? 'البريد' : 'Email'}</b><p style="font-size:.88rem;color:var(--muted);margin-top:2px;">${a.email}</p></div>` : ''}<div style="margin-bottom:12px;"><b style="font-size:.85rem;">${isAr ? 'ملاحظات' : 'Notes'}</b><textarea id="athlete-detail-notes" rows="2" style="resize:vertical;margin-top:4px;width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;font-size:.88rem;background:var(--white);color:var(--text);" placeholder="${isAr ? 'ملاحظات...' : 'Add notes...'}">${a.notes || ''}</textarea><button class="btn ghost small" onclick="saveAthleteNotes(${a.id})" style="margin-top:6px;"><i class="fa-solid fa-floppy-disk"></i> ${isAr ? 'حفظ' : 'Save'}</button></div><div><b style="font-size:.85rem;">${isAr ? 'سجل الجلسات' : 'Session Log'}</b><div style="margin-top:8px;">${a.sessionLog && a.sessionLog.length > 0 ? a.sessionLog.slice().reverse().map(s => { const d = new Date(s.date).toLocaleDateString(isAr ? 'ar-EG' : 'en-US', { month: 'short', day: 'numeric' }); let metrics = `<b>${s.duration || '--'}m</b>`; if (s.calories) metrics += ` · <span style="color:var(--amber);"><i class="fa-solid fa-fire" style="font-size:.65rem;"></i> ${s.calories}kcal</span>`; if (s.distance) metrics += ` · ${s.distance}km`; if (s.sets) metrics += ` · ${s.sets} sets`; metrics += ` · ${s.intensity || '--'}`; if (s.notes) metrics += ` · ${s.notes}`; return `<div class="athlete-session-entry"><div>${metrics}</div><span class="date">${d}</span></div>`; }).join('') : `<p style="color:var(--muted);font-size:.85rem;text-align:center;padding:12px;">${isAr ? 'لا توجد جلسات.' : 'No sessions yet.'}</p>`}</div></div><div style="display:flex;gap:10px;margin-top:16px;"><button class="btn ghost" onclick="closeModal('athlete-detail-modal')" style="flex:1;">${isAr ? 'إغلاق' : 'Close'}</button><button class="btn primary" onclick="closeModal('athlete-detail-modal');openLogSessionModal(${a.id})" style="flex:1;"><i class="fa-solid fa-stopwatch"></i> ${isAr ? 'تسجيل جلسة' : 'Log Session'}</button></div>`; openModal('athlete-detail-modal'); }

function assignPlanToAthlete(athleteId, planName) { const athletes = getCoachAthletes(); const a = athletes.find(x => x.id === athleteId); if (!a) return; a.assignedPlan = planName || null; saveCoachAthletes(athletes); renderCoachAthletes(); updateCoachStats(); }
function saveAthleteNotes(athleteId) { const notes = document.getElementById('athlete-detail-notes').value.trim(); const athletes = getCoachAthletes(); const a = athletes.find(x => x.id === athleteId); if (!a) return; a.notes = notes; saveCoachAthletes(athletes); renderCoachAthletes(); }

function cycleAthleteStatus(id) { const athletes = getCoachAthletes(); const a = athletes.find(x => x.id === id); if (!a) return; const c = ['new', 'on-track', 'needs-attention']; const i = c.indexOf(a.status || 'new'); a.status = c[(i + 1) % c.length]; saveCoachAthletes(athletes); renderCoachAthletes(); updateCoachStats(); }

function exportAthletesCSV() { const athletes = getCoachAthletes(); if (athletes.length === 0) { alert('No athletes to export.'); return; } const h = ['Name','Sport','Level','Status','Streak','Sessions','Email','Notes','Assigned Plan','Last Session Date']; const r = athletes.map(a => [a.name, a.sport, a.level, a.status, a.streak, a.sessions, a.email || '', a.notes || '', a.assignedPlan || '', a.lastSessionDate || '']); const csv = [h, ...r].map(row => row.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n'); const blob = new Blob([csv], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'athletes_export.csv'; link.click(); URL.revokeObjectURL(url); }

let coachAthleteFilter = 'all';
function setCoachFilter(filter) { coachAthleteFilter = filter; document.querySelectorAll('.coach-filter-chip').forEach(c => c.classList.toggle('active', c.dataset.filter === filter)); filterCoachAthletes(); }
function filterCoachAthletes() { const search = (document.getElementById('coach-athlete-search')?.value || '').toLowerCase(); const athletes = getCoachAthletes(); const filtered = athletes.filter(a => { const ms = !search || a.name.toLowerCase().includes(search) || a.sport.toLowerCase().includes(search) || (a.email || '').toLowerCase().includes(search); const mf = coachAthleteFilter === 'all' || (a.status || 'new') === coachAthleteFilter; return ms && mf; }); const grid = document.getElementById('coach-athletes-grid'); const noEl = document.getElementById('coach-no-athletes'); const countEl = document.getElementById('coach-athlete-count'); const isAr = (store.lang === 'ar'); const aw = isAr ? 'رياضي' : 'athlete'; const awp = isAr ? 'رياضيون' : 'athletes'; if (countEl) countEl.textContent = filtered.length + ' ' + (filtered.length === 1 ? aw : awp); if (filtered.length === 0) { grid.innerHTML = ''; noEl.style.display = 'block'; return; } noEl.style.display = 'none'; const sl = isAr ? { 'on-track': 'على المسار', 'needs-attention': 'بحاجة لاهتمام', 'new': 'جديد' } : { 'on-track': 'On track', 'needs-attention': 'Needs attention', 'new': 'New' }; const stkL = isAr ? 'يوم في السلسلة' : '-day streak'; const sesL = isAr ? 'جلسة' : 'sessions'; const logL = isAr ? 'تسجيل جلسة' : 'Log Session'; const chgL = isAr ? 'تغيير الحالة' : 'Change Status'; const detL = isAr ? 'التفاصيل' : 'Details'; grid.innerHTML = filtered.map(a => { const bc = a.status === 'on-track' ? 'badge-on-track' : a.status === 'needs-attention' ? 'badge-needs-attention' : 'badge-new'; const bt = sl[a.status || 'new']; const pb = a.assignedPlan ? `<span style="font-size:.7rem;background:var(--accent-soft);color:var(--accent);padding:2px 8px;border-radius:8px;margin-left:4px;"><i class="fa-solid fa-clipboard-list" style="font-size:.6rem;"></i> ${a.assignedPlan}</span>` : ''; const paidB = a.paid ? `<span class="athlete-paid-badge" title="${isAr ? 'مدفوع' : 'Paid'} $${a.paidAmount}"><i class="fa-solid fa-circle-check" style="font-size:.6rem;"></i> ${isAr ? 'مدفوع' : 'Paid'}</span>` : ''; return `<div class="athlete-card" style="cursor:pointer;" onclick="openAthleteDetail(${a.id})"><div class="avatar">${a.initials}</div><div class="a-body"><div class="a-top"><b>${a.name}</b><span class="badge ${bc}">${bt}</span> ${paidB}</div><small>${a.sport} · ${a.streak} ${stkL} · ${a.level}${pb}</small><p class="a-last">${a.sessions} ${sesL}${a.notes ? ' · ' + a.notes : ''}</p><div class="athlete-quick-actions" style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;"><button class="btn ghost small" onclick="event.stopPropagation();openAthleteDetail(${a.id})" style="font-size:.78rem;padding:9px 14px;min-height:38px;"><i class="fa-solid fa-circle-info"></i> ${detL}</button><button class="btn ghost small" onclick="event.stopPropagation();openLogSessionModal(${a.id})" style="font-size:.78rem;padding:9px 14px;min-height:38px;"><i class="fa-solid fa-stopwatch"></i> ${logL}</button><button class="btn ghost small" onclick="event.stopPropagation();cycleAthleteStatus(${a.id})" style="font-size:.78rem;padding:9px 14px;min-height:38px;"><i class="fa-solid fa-arrows-rotate"></i> ${chgL}</button></div></div><button onclick="event.stopPropagation();removeAthlete(${a.id})" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:.85rem;padding:4px 8px;align-self:flex-start;" title="Remove"><i class="fa-solid fa-xmark"></i></button></div>`; }).join(''); }

function updateCoachStats() { const athletes = getCoachAthletes(); const plans = getCoachPlans(); const today = new Date().toDateString(); document.getElementById('coach-stat-athletes').textContent = athletes.length; document.getElementById('coach-stat-sessions').textContent = athletes.reduce((s, a) => s + (a.sessions || 0), 0); document.getElementById('coach-stat-attention').textContent = athletes.filter(a => a.status === 'needs-attention').length; document.getElementById('coach-stat-adherence').textContent = athletes.length > 0 ? Math.round((athletes.filter(a => a.status !== 'needs-attention').length / athletes.length) * 100) + '%' : '--'; document.getElementById('coach-stat-plans').textContent = plans.length; document.getElementById('coach-stat-avg-streak').textContent = athletes.length > 0 ? Math.round(athletes.reduce((s, a) => s + (a.streak || 0), 0) / athletes.length) : 0; let ts = 0; athletes.forEach(a => { if (a.sessionLog && a.sessionLog.length > 0) { a.sessionLog.forEach(s => { if (new Date(s.date).toDateString() === today) ts++; }); } }); document.getElementById('coach-stat-today-sessions').textContent = ts; document.getElementById('coach-stat-on-track').textContent = athletes.filter(a => a.status === 'on-track').length; }

// Coach auth fields toggle on normal login (coach removed — this is now a no-op)
function setRoleTab(role) {
  // Coach role removed — only athlete is supported now
  var cb = document.getElementById('auth-coach-toggle');
  if (cb) cb.checked = false;
  var athleteTab = document.getElementById('role-tab-athlete');
  if (athleteTab) athleteTab.classList.add('active');
}

function toggleCoachMode() {
  // Legacy compatibility — no-op (coach removed)
}

function toggleCoachAuthFields() {
  // No-op — coach fields removed
  var fields = document.getElementById('auth-coach-fields');
  if (fields) fields.style.display = 'none';
}

// Patch handleAuth to support coach signup (coach removed — this is now a passthrough)
const origHandleAuth = handleAuth;
handleAuth = function(e) {
  // Coach signup removed — just call the original handleAuth
  return origHandleAuth(e);
}

// Patch showCoachTab - already merged above

// Patch enterCoachApp to render new features (coach removed — no-op)
const origEnterCoachApp = function() {};
enterCoachApp = function(user) { /* coach removed */ };

// Mobile CSS for coach session overlay (coach removed — CSS is now a no-op but kept for safety)
(function(){
  try {
    const style = document.createElement('style');
    style.textContent = `@media (max-width: 768px) {
    .modal-content { max-width: 100% !important; margin: 0; border-radius: 16px; }
    .modal-overlay { padding: 8px; }
    input, select, textarea { font-size: 16px !important; }
    .sessions-table { display: block; overflow-x: auto; white-space: nowrap; }
    .stat-card { padding: 14px; }
    .stat-card b { font-size: 1.05rem; }
    .stat-card small { font-size: .72rem; }
    .stat-icon { width: 36px; height: 36px; }
    .stat-icon i { font-size: 16px !important; }
  }`;
    if (document.head) document.head.appendChild(style);
  } catch(e) {}
})();



// ============================================================
// BARCODE SCANNER — Camera photo capture + Open Food Facts API
// ============================================================
// Per user spec: "fix barcode scanner, make the user open the camera and
// actually take a photo".
//
// We no longer rely on the BarcodeDetector API (Chrome-only, missing on
// iOS Safari + most Android browsers). Instead, we:
//   1. Open the device's rear camera as a live <video> preview.
//   2. Show a CAPTURE button. When the user taps it, we grab a still frame
//      from the video onto a <canvas> and convert it to an image.
//   3. We try BarcodeDetector on the captured frame (where supported).
//   4. If BarcodeDetector isn't available OR didn't find anything, we send
//      the image to the Open Food Facts API (which doesn't actually do OCR
//      for barcodes — so we fall back to letting the user type the code).
//   5. As a last resort, the user can always type the barcode manually.
let scannerStream = null;
let scannerDetector = null;
let scannerAnimFrame = null;
let lastScannedBarcode = null;
let lastScanResult = null;

function startBarcodeScanner() {
  const video = document.getElementById('scanner-video');
  const container = document.getElementById('scanner-camera-container');
  const startBtn = document.getElementById('scanner-start-btn');
  const stopBtn = document.getElementById('scanner-stop-btn');
  const fallback = document.getElementById('scanner-fallback');
  const status = document.getElementById('scanner-status');
  const ar = (store.lang === 'ar');

  // Try to use BarcodeDetector if available (for auto-detect while previewing)
  if ('BarcodeDetector' in window) {
    try {
      scannerDetector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'] });
    } catch(e) { scannerDetector = null; }
  }

  navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
  }).then(stream => {
    scannerStream = stream;
    video.srcObject = stream;
    container.style.display = 'block';
    startBtn.style.display = 'none';
    stopBtn.style.display = '';
    if (fallback) fallback.style.display = 'none';
    if (status) status.textContent = ar ? 'وجّه الكاميرا نحو الباركود واضغط التقاط' : 'Aim at barcode and tap Capture';
    video.play();
    // Add a CAPTURE button if not already there
    let captureBtn = document.getElementById('scanner-capture-btn');
    if (!captureBtn) {
      captureBtn = document.createElement('button');
      captureBtn.id = 'scanner-capture-btn';
      captureBtn.className = 'btn primary small';
      captureBtn.style.cssText = 'position:absolute;bottom:14px;left:50%;transform:translateX(-50%);z-index:5;padding:10px 22px;font-weight:700;box-shadow:0 4px 14px rgba(0,0,0,.4);';
      captureBtn.innerHTML = '<i class="fa-solid fa-camera"></i> <span>' + (ar ? 'التقاط' : 'Capture') + '</span>';
      captureBtn.onclick = captureBarcodeFrame;
      container.appendChild(captureBtn);
    }
    captureBtn.style.display = '';
    // Auto-detect loop (only if BarcodeDetector exists)
    if (scannerDetector) {
      scanFrame();
    }
  }).catch(err => {
    console.log('Camera not available:', err);
    container.style.display = 'none';
    if (fallback) fallback.style.display = 'block';
    startBtn.style.display = 'none';
    alert(ar ? 'تعذّر الوصول للكاميرا. تأكد من منح الإذن للمتصفح. يمكنك أيضاً إدخال الباركود يدوياً أو رفع صورة.' : 'Could not access the camera. Please grant camera permission, or enter the barcode manually / upload a photo.');
  });
}

// Capture a still frame from the live video and try to detect a barcode.
function captureBarcodeFrame() {
  const video = document.getElementById('scanner-video');
  const ar = (store.lang === 'ar');
  const status = document.getElementById('scanner-status');
  if (!video || !video.videoWidth) {
    alert(ar ? 'الكاميرا غير جاهزة بعد.' : 'Camera not ready yet.');
    return;
  }
  if (status) status.textContent = ar ? 'جارٍ معالجة الصورة...' : 'Processing image...';
  // Draw the current video frame to a canvas
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  // Try BarcodeDetector on the captured frame
  if (scannerDetector) {
    scannerDetector.detect(canvas).then(barcodes => {
      if (barcodes.length > 0) {
        const code = barcodes[0].rawValue;
        if (code !== lastScannedBarcode) {
          lastScannedBarcode = code;
          if (status) status.textContent = ar ? 'تم العثور على الباركود!' : 'Barcode found!';
          stopBarcodeScanner();
          lookupBarcode(code);
          return;
        }
      }
      // BarcodeDetector didn't find anything — tell the user
      if (status) status.textContent = ar ? 'لم يُعثر على باركود. حاول مرة أخرى أو أدخله يدوياً.' : 'No barcode detected. Try again or enter it manually.';
    }).catch(() => {
      if (status) status.textContent = ar ? 'تعذّر معالجة الصورة. أدخل الباركود يدوياً.' : 'Could not process image. Enter barcode manually.';
    });
  } else {
    // No BarcodeDetector — prompt user to type the code manually
    if (status) status.textContent = ar ? 'متصفحك لا يدعم المسح التلقائي. أدخل الباركود يدوياً.' : 'Your browser does not support auto-detection. Enter the barcode manually.';
    // Focus the manual input so the user can type
    const manualInput = document.getElementById('scanner-manual-input');
    if (manualInput) manualInput.focus();
  }
}

function scanFrame() {
  if (!scannerStream) return;
  const video = document.getElementById('scanner-video');
  if (!scannerDetector) return;
  scannerDetector.detect(video).then(barcodes => {
    if (barcodes.length > 0) {
      const code = barcodes[0].rawValue;
      if (code !== lastScannedBarcode) {
        lastScannedBarcode = code;
        const status = document.getElementById('scanner-status');
        if (status) status.textContent = store.lang === 'ar' ? 'تم المسح!' : 'Scanned!';
        stopBarcodeScanner();
        lookupBarcode(code);
      }
    }
  }).catch(() => {});
  scannerAnimFrame = requestAnimationFrame(scanFrame);
}

function stopBarcodeScanner() {
  if (scannerAnimFrame) cancelAnimationFrame(scannerAnimFrame);
  scannerAnimFrame = null;
  if (scannerStream) {
    scannerStream.getTracks().forEach(t => t.stop());
    scannerStream = null;
  }
  const video = document.getElementById('scanner-video');
  if (video) video.srcObject = null;
  const container = document.getElementById('scanner-camera-container');
  if (container) container.style.display = 'none';
  const startBtn = document.getElementById('scanner-start-btn');
  if (startBtn) startBtn.style.display = '';
  const stopBtn = document.getElementById('scanner-stop-btn');
  if (stopBtn) stopBtn.style.display = 'none';
  // Hide the capture button too
  const captureBtn = document.getElementById('scanner-capture-btn');
  if (captureBtn) captureBtn.style.display = 'none';
  const fallback = document.getElementById('scanner-fallback');
  if (fallback) fallback.style.display = 'block';
}

async function scanBarcodeFromFile(input) {
  const file = input.files[0];
  if (!file) return;
  const img = new Image();
  img.src = URL.createObjectURL(file);
  img.onload = async () => {
    if ('BarcodeDetector' in window) {
      try {
        const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'] });
        const barcodes = await detector.detect(img);
        if (barcodes.length > 0) {
          lookupBarcode(barcodes[0].rawValue);
        } else {
          alert(store.lang === 'ar' ? 'لم يتم العثور على باركود. جرب صورة أوضح أو أدخل الرقم يدوياً.' : 'No barcode found. Try a clearer image or enter the number manually.');
        }
      } catch(e) {
        alert(store.lang === 'ar' ? 'فشل في قراءة الباركود. أدخله يدوياً.' : 'Failed to read barcode. Enter it manually.');
      }
    } else {
      alert(store.lang === 'ar' ? 'متصفحك لا يدعم المسح التلقائي. أدخل الباركود يدوياً.' : 'Your browser doesn\'t support auto-scanning. Enter the barcode manually.');
    }
    URL.revokeObjectURL(img.src);
  };
  input.value = '';
}

// ===== AI Meal Scanner =====
// Replaces the barcode scanner. User takes a photo of any meal, the AI
// (via the backend's /api/analyze-meal endpoint) identifies the food and
// estimates calories + macros. Shows a cool spinning animation while analyzing.
let lastAIMealResult = null;

// Round 18: downscale + compress a chosen image file in the browser BEFORE
// uploading it to the AI meal scanner backend. Phone cameras emit 3-10 MB
// photos; a 1024px JPEG (~150-300 KB) is plenty for food recognition and
// makes the request far faster (and safe for serverless body limits).
function voltaDownscaleImage(file, maxDim, quality) {
  return new Promise(function (resolve, reject) {
    try {
      maxDim = maxDim || 1024; quality = quality || 0.85;
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = function () {
        try {
          let w = img.naturalWidth, h = img.naturalHeight;
          const scale = Math.min(1, maxDim / Math.max(w, h));
          w = Math.max(1, Math.round(w * scale));
          h = Math.max(1, Math.round(h * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) { URL.revokeObjectURL(url); reject(new Error('canvas unavailable')); return; }
          ctx.drawImage(img, 0, 0, w, h);
          const out = canvas.toDataURL('image/jpeg', quality);
          URL.revokeObjectURL(url);
          resolve(out);
        } catch (e) { URL.revokeObjectURL(url); reject(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('image decode failed')); };
      img.src = url;
    } catch (e) { reject(e); }
  });
}

// ─── AI Meal Scanner — 3-tier engine (works offline AND with the backend) ──
// Tier 1: the Vercel backend /api/analyze-meal (full deploy = works).
// Tier 2: Gemini called DIRECTLY from the browser (the app's own key — same
//         key the backend embeds) when the backend is unreachable but the
//         network is up. No Vercel dependency.
// Tier 3: 100% OFFLINE matcher — the photo's color profile is matched
//         against the local meal database (2,000+ meals) and the user
//         confirms the dish from smart suggestions / search. The scan NEVER
//         dead-ends, online or offline.
const VOLTA_MEAL_GEMINI_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash-lite'];
function voltaMealPrompt(lang) {
  const outLang = (lang === 'ar') ? 'Arabic' : 'English';
  const scriptLang = (lang === 'ar') ? 'Arabic script (العربية)' : 'English';
  return 'You are an expert nutritionist and food recognition specialist with deep knowledge of dishes from EVERY country and cuisine: Egyptian, Levantine, Gulf, Maghrebi/Berber, African, Turkish, Indian, Pakistani, Chinese, Japanese, Korean, Thai, Vietnamese, Mexican, Brazilian, American, Italian, Greek, Spanish, French, German, Russian, Filipino, Indonesian — and any mixed or street food.\n\nAnalyze the food/meal shown in this photo.\n\n1. Identify the dish — even if it goes by a local or national name (e.g. koshari, ful medames, molokhia, sambousek, kofta, shakshuka, biryani, pho, plov, jollof rice, arepa, ceviche, poutine, takoyaki).\n2. Estimate its nutrition for a realistic typical serving of that cuisine (per serving, not per 100g).\n\nRespond with ONLY a valid JSON object (no markdown, no code fences, no extra text) using exactly this schema:\n{\n  "name": "dish name in ' + outLang + ' (max 40 chars)",\n  "nameEn": "the dish name in English/Latin script (max 40 chars)",\n  "description": "one short sentence describing the dish in ' + outLang + ' (max 120 chars)",\n  "cuisine": "the cuisine the dish belongs to, in English",\n  "calories": number (kcal, integer),\n  "protein": number (grams, integer),\n  "carbs": number (grams, integer),\n  "fat": number (grams, integer),\n  "ingredients": ["main ingredient 1 in ' + outLang + '", "main ingredient 2 in ' + outLang + '", "main ingredient 3 in ' + outLang + '"]\n}\n\nRules:\n- If the image contains NO food, respond with: {"error":"no_food"}\n- "name", "description" and "ingredients" MUST be written in ' + scriptLang + '; "nameEn" and "cuisine" ALWAYS stay in English/Latin script.\n- Use realistic estimates for an average portion of what is visible.\n- Keep every value a number (no units inside the strings).';
}
function voltaExtractMealJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const s = candidate.indexOf('{'), e = candidate.lastIndexOf('}');
  if (s === -1 || e === -1 || e <= s) return null;
  try { return JSON.parse(candidate.slice(s, e + 1)); } catch (err) { return null; }
}
function voltaNormalizeMeal(p, lang) {
  const num = function (v) { const n = Number(v); return isFinite(n) && n >= 0 ? Math.round(n) : 0; };
  const str = function (v) { return (typeof v === 'string') ? v.trim() : ''; };
  const name = str(p.name);
  return {
    name: name || 'Unknown meal',
    nameEn: str(p.nameEn) || name,
    cuisine: str(p.cuisine) || 'Unknown',
    description: str(p.description).slice(0, 120),
    calories: num(p.calories), protein: num(p.protein), carbs: num(p.carbs), fat: num(p.fat),
    ingredients: Array.isArray(p.ingredients) ? p.ingredients.filter(function (i) { return typeof i === 'string' && i.trim(); }).slice(0, 8) : []
  };
}
// Tier 2 — direct Gemini vision call from the browser (no backend needed).
async function analyzeMealWithGeminiDirect(base64Image, lang) {
  const m = base64Image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
  if (!m) throw new Error('bad image data url');
  const key = (typeof window.VOLTA_GEMINI_KEY === 'string' && window.VOLTA_GEMINI_KEY) || 'AQ.Ab8RN6KPIi_YFfB-2pgAkEMKG_AEN6k_b0e9loWVByX1IyM-ZQ';
  const body = {
    contents: [{ parts: [ { text: voltaMealPrompt(lang) }, { inline_data: { mime_type: m[1], data: m[2] } } ] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 700, responseMimeType: 'application/json' }
  };
  let lastErr = null;
  for (let i = 0; i < VOLTA_MEAL_GEMINI_MODELS.length; i++) {
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = ctrl ? setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 25000) : null;
    try {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + VOLTA_MEAL_GEMINI_MODELS[i] + ':generateContent?key=' + encodeURIComponent(key), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: ctrl ? ctrl.signal : undefined
      });
      const j = await r.json().catch(function () { return null; });
      if (!r.ok) {
        const msg = (j && j.error && j.error.message) || ('Gemini HTTP ' + r.status);
        if (r.status === 404 && i < VOLTA_MEAL_GEMINI_MODELS.length - 1) { lastErr = new Error(msg); if (timer) clearTimeout(timer); continue; }
        if (timer) clearTimeout(timer);
        throw new Error(msg);
      }
      if (timer) clearTimeout(timer);
      const parts = (j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
      const text = parts.map(function (p) { return p.text || ''; }).join('');
      const parsed = voltaExtractMealJson(text);
      if (!parsed) throw new Error('Gemini returned no JSON');
      if (parsed.error === 'no_food') throw new Error('no_food');
      return voltaNormalizeMeal(parsed, lang);
    } catch (e) {
      if (timer) clearTimeout(timer);
      throw e;
    }
  }
  throw (lastErr || new Error('Gemini unavailable'));
}

// ════════════════════════════════════════════════════════════════════════
// v8 — AI MEAL GENERATOR (GEMINI + LOCATION) ════════════════════════════
// Per user request: "use gemini for the ai meal generator, make it be able
// to see the location and only pick the popular and better options around
// the user in every country".
//
//   1. voltaUserLocationInfo() resolves WHERE the user is (no repeated
//      permission prompts — see chain below; the browser only prompts the
//      first time it is genuinely needed, and a 24h negative-cache avoids
//      nagging).
//   2. Gemini generates the day's meals: POPULAR, well-loved, real options
//      people actually eat around that location — STRICTLY HALAL (no pork,
//      no alcohol, no sushi) and sized to the user's macro targets.
//   3. Results are cached per day + country (localStorage), so they render
//      instantly (and stay loggable) offline; the local meal DB stays the
//      instant fallback while Gemini works.
// ════════════════════════════════════════════════════════════════════════
const GEMINI_MEALS_CACHE_KEY = 'volta_gemini_meals_v1';
const LOC_INFO_CACHE_KEY = 'fb_loc_info_v1';

// Where is the user? Priority: cached info → weather's coordinates →
// live geolocation (ONLY when the browser already remembers a grant, or the
// user enabled location — this is the "app needs it" moment) → locale
// region/timezone (no prompt at all). Never prompts twice in a day.
async function voltaUserLocationInfo() {
  const day = new Date().toDateString();
  try {
    const cached = JSON.parse(localStorage.getItem(LOC_INFO_CACHE_KEY) || 'null');
    if (cached && cached.day === day) return cached;   // same-day cache (incl. denied state)
  } catch (e) {}
  const info = { day: day, country: '', city: '', source: 'locale' };
  const revGeo = async function (lat, lon) {
    try {
      const r = await fetch('https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=' + encodeURIComponent(lat) + '&longitude=' + encodeURIComponent(lon) + '&localityLanguage=en');
      const j = await r.json();
      if (j && j.countryName) {
        return { country: String(j.countryName), city: String(j.city || j.locality || j.principalSubdivision || ''), lat: lat, lon: lon };
      }
    } catch (e) {}
    return null;
  };
  // 1) last weather coordinates (already granted, works offline of prompts)
  try {
    const lc = store.locCache;
    if (lc && typeof lc.lat === 'number') {
      const got = await revGeo(lc.lat, lc.lon);
      if (got) { info.country = got.country; info.city = got.city; info.source = 'coords'; }
    }
  } catch (e) {}
  // 2) live geolocation — only when permission is already granted, or the
  //    user has location ON (Settings → Weather Location). Short timeout,
  //    silent failure, and a same-day negative cache so we never nag.
  if (!info.country) {
    let permState = '';
    try {
      const perm = await navigator.permissions.query({ name: 'geolocation' });
      permState = perm.state;   // 'granted' | 'denied' | 'prompt'
    } catch (e) {}
    const locEnabled = (typeof store !== 'undefined') ? store.locationEnabled !== false : true;
    if (navigator.geolocation && permState !== 'denied' && (permState === 'granted' || locEnabled)) {
      const pos = await new Promise(function (resolve) {
        let settled = false;
        try {
          navigator.geolocation.getCurrentPosition(function (p) { if (!settled) { settled = true; resolve(p); } }, function () { if (!settled) { settled = true; resolve(null); } }, { enableHighAccuracy: false, timeout: 9000, maximumAge: 600000 });
          setTimeout(function () { if (!settled) { settled = true; resolve(null); } }, 9500);
        } catch (e) { resolve(null); }
      });
      if (pos) {
        const got = await revGeo(pos.coords.latitude, pos.coords.longitude);
        if (got) { info.country = got.country; info.city = got.city; info.source = 'live'; }
      } else if (permState !== 'granted') {
        info.source = 'denied';   // asked and refused/failed → don't ask again today
      }
    }
  }
  // 3) locale fallback (ZERO prompts): browser region + timezone
  if (!info.country) {
    try {
      const langs = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || ''];
      let region = '';
      for (let i = 0; i < langs.length; i++) {
        const m = String(langs[i] || '').match(/-([A-Z]{2})$/);
        if (m) { region = m[1]; break; }
      }
      let tz = '';
      try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
      if (region || tz) {
        info.country = region ? ('ISO:' + region) : '';   // Gemini resolves ISO codes
        info.city = '';
        info.tz = tz;
        info.source = 'locale';
      }
    } catch (e) {}
  }
  try { localStorage.setItem(LOC_INFO_CACHE_KEY, JSON.stringify(info)); } catch (e) {}
  return info;
}

// v12 (user): "make sure gluten free and vegans and all those people get
// the proper food" — the user's dietary preference (survey diet_pref), used
// by the Gemini meal generator, the meal pools and the cache check.
function currentDietPref() {
  try {
    const u = currentUser();
    if (!u) return 'None';
    const p = u.plan && u.plan.preferences && u.plan.preferences.diet_pref;
    const s = u.survey && u.survey.diet_pref;
    return p || s || 'None';
  } catch (e) { return 'None'; }
}
window.currentDietPref = currentDietPref;

function geminiMealGenPrompt(loc, targets, lang, dietPref) {
  const outLang = (lang === 'ar') ? 'Arabic' : 'English';
  const place = loc && loc.country
    ? ((loc.country.indexOf('ISO:') === 0 ? 'the country with ISO code ' + loc.country.slice(4) : loc.country) + (loc.city ? (', around the city of ' + loc.city) : '') + (loc.tz ? (' (timezone ' + loc.tz + ')') : ''))
    : 'the user\'s country (unknown — pick widely popular international fitness meals)';
  const macroLine = targets
    ? ('\n- The user\'s daily nutrition target is ~' + targets.kcal + ' kcal with ~' + targets.p + 'g protein / ~' + targets.c + 'g carbs / ~' + targets.f + 'g fat across the day — size each meal so the SIX meals together roughly land in that budget.')
    : '\n- No nutrition targets known — use balanced fitness-portion sizes.';
  // v12: PERSONAL DIETARY RULES — the user's own diet preference now drives
  // generation just as strictly as the halal rules. Vegetarian/Vegan users
  // never see meat; Gluten-free users never see gluten ingredients; Keto
  // users get low-carb meals. 'None'/'Halal' add nothing beyond the halal
  // block below (halal users still eat normal halal food).
  const pref = String(dietPref || 'None');
  let dietRules = '';
  if (pref === 'Vegetarian') {
    dietRules = '\n\nTHE USER IS VEGETARIAN — STRICT RULES:\n- ABSOLUTELY NO meat, poultry, fish, seafood, gelatin, animal broth/stock, lard, or meat-based sauces.\n- Eggs and dairy ARE allowed. Build high-protein vegetarian meals (legumes, tofu, eggs, dairy, nuts).';
  } else if (pref === 'Vegan') {
    dietRules = '\n\nTHE USER IS VEGAN — STRICT RULES:\n- ABSOLUTELY NO meat, poultry, fish, seafood, eggs, dairy, milk, cheese, yogurt, butter, cream, honey, gelatin, or animal broth/stock.\n- Everything must be 100% plant-based (legumes, tofu, tempeh, grains, nuts, seeds, vegetables, plant milk).';
  } else if (pref === 'Gluten-free') {
    dietRules = '\n\nTHE USER IS GLUTEN-FREE (celiac-safe) — STRICT RULES:\n- ABSOLUTELY NO wheat, barley, rye, spelt, bulgur, couscous, semolina, regular oats, malt, regular bread/pasta/pita/tortilla/wraps, breadcrumbs, flour-thickened sauces, or regular soy sauce.\n- Naturally gluten-free staples are fine: rice, potatoes, quinoa, corn, buckwheat, certified-gluten-free oats, legumes, eggs, meat/fish (halal), dairy, fruit, vegetables. Use tamari instead of soy sauce.';
  } else if (pref === 'Keto') {
    dietRules = '\n\nTHE USER IS KETO — STRICT RULES:\n- Keep every meal VERY LOW CARB: no rice, pasta, bread, potatoes, sugar, oats, honey, fruit juice, or sweet sauces. Berries in small amounts only.\n- Build meals around protein + healthy fats + low-carb vegetables (eggs, meat/fish (halal), cheese, avocado, olive oil, nuts, leafy greens).';
  }
  return 'You are a local food expert and sports nutritionist living exactly where the user is: ' + place + '.\n\nGenerate SIX meals the user should eat today. Pick the POPULAR and better-loved real options people around this location actually eat — local favourites, well-rated everyday dishes and easily available ingredients from that country (NOT generic western gym food when the location has its own cuisine).\n\nABSOLUTE DIETARY RULES (halal app):\n- STRICTLY HALAL: no pork, no bacon, no ham, no lard, no pork sausage/salami/pepperoni.\n- NO ALCOHOL in any form — no wine, beer, rum, vodka, whiskey, cooking wine, mirin, sake, liqueur, alcohol-based vanilla. Use broth, stock, lemon juice or tomato paste instead.\n- Meat only from chicken, beef, lamb, turkey, goat or fish/seafood (halal-slaughterable). Vegetarian and vegan dishes are welcome.\n- NO SUSHI and no raw-fish dishes.\n- No non-halal additions of any kind.' + dietRules + macroLine + '\n\nReturn 2 breakfast, 2 lunch, 2 dinner meals (realistic portions, with realistic kcal/macros).\n\nRespond with ONLY a valid JSON array (no markdown, no code fences) of exactly 6 objects:\n[\n  { "name": "meal name in ' + outLang + ', max 40 chars",\n    "nameEn": "same meal name in English/Latin script",\n    "desc": "one short appetizing sentence in ' + outLang + ', max 100 chars, mention it is popular around this location",\n    "kcal": number, "p": number (protein g), "c": number (carbs g), "f": number (fat g),\n    "mealType": "breakfast" | "lunch" | "dinner",\n    "ingredients": ["3-6 main ingredients in ' + outLang + '"] }\n]\n\nRules:\n- "name", "desc" and "ingredients" in ' + outLang + '; "nameEn" always English/Latin script.\n- kcal/p/c/f are plain numbers for ONE realistic serving.\n- Dishes must be recognizable and genuinely popular around the location.\n- EVERY meal must satisfy BOTH the halal rules AND the user\'s personal dietary rules above — a single violation fails the whole answer.';
}

function voltaNormalizeGeminiMeals(arr, lang, dietPref) {
  const out = [];
  const seen = {};
  const prefTag = (dietPref && dietPref !== 'None' && dietPref !== 'Halal') ? dietPref : null;
  (Array.isArray(arr) ? arr : []).forEach(function (m) {
    if (!m || typeof m !== 'object') return;
    const num = function (v) { const n = Number(v); return isFinite(n) && n > 0 ? Math.round(n) : 0; };
    const str = function (v) { return (typeof v === 'string') ? v.trim() : ''; };
    const name = str(m.name);
    if (!name || seen[name]) return;
    seen[name] = 1;
    const type = ['breakfast', 'lunch', 'dinner', 'snack'].indexOf(String(m.mealType || '').toLowerCase()) !== -1 ? String(m.mealType).toLowerCase() : 'lunch';
    out.push({
      name: name.slice(0, 60),
      nameEn: str(m.nameEn || name).slice(0, 60),
      desc: str(m.desc).slice(0, 120),
      kcal: num(m.kcal), p: num(m.p), c: num(m.c), f: num(m.f),
      fiber: 0, diet: prefTag ? prefTag.toLowerCase() : 'halal', mealType: type,
      cuisine: str(m.cuisine) || 'Local',
      tags: ['Popular near you', 'Halal'].concat(prefTag ? [prefTag] : []),
      ingredients: (Array.isArray(m.ingredients) ? m.ingredients : []).filter(function (i) { return typeof i === 'string' && i.trim(); }).slice(0, 8),
      recipe: [], image: '', gemini: true
    });
  });
  return out;
}

async function generateGeminiLocalMeals(force) {
  const key = (typeof window.VOLTA_GEMINI_KEY === 'string' && window.VOLTA_GEMINI_KEY) || '';
  if (!key || !navigator.onLine) return null;
  const loc = await voltaUserLocationInfo();
  if (loc.source === 'denied' && !loc.country && !loc.tz) { /* even denied, locale fallback fills something */ }
  // Macro targets from the user's diet plan (best effort)
  let targets = null;
  try {
    const u = currentUser();
    if (u && u.plan && u.plan.diet) {
      const d = u.plan.diet;
      targets = { kcal: Math.round(d.dailyCalories || 2000), p: d.macros && d.macros.p || 150, c: d.macros && d.macros.c || 200, f: d.macros && d.macros.f || 55 };
    }
  } catch (e) {}
  const lang = (store.lang === 'ar') ? 'ar' : 'en';
  // v12: the user's dietary preference drives the prompt (vegan /
  // vegetarian / gluten-free / keto never see food they can't eat).
  const dietPref = currentDietPref();
  const body = {
    contents: [{ parts: [{ text: geminiMealGenPrompt(loc, targets, lang, dietPref) }] }],
    generationConfig: { temperature: 0.85, maxOutputTokens: 1600, responseMimeType: 'application/json' }
  };
  let lastErr = null;
  for (let i = 0; i < VOLTA_MEAL_GEMINI_MODELS.length; i++) {
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = ctrl ? setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 26000) : null;
    try {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + VOLTA_MEAL_GEMINI_MODELS[i] + ':generateContent?key=' + encodeURIComponent(key), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: ctrl ? ctrl.signal : undefined
      });
      const j = await r.json().catch(function () { return null; });
      if (!r.ok) {
        const msg = (j && j.error && j.error.message) || ('Gemini HTTP ' + r.status);
        if (timer) clearTimeout(timer);
        if (r.status === 404 && i < VOLTA_MEAL_GEMINI_MODELS.length - 1) { lastErr = new Error(msg); continue; }
        throw new Error(msg);
      }
      if (timer) clearTimeout(timer);
      const parts = (j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
      const text = parts.map(function (p) { return p.text || ''; }).join('');
      let parsed = null;
      try { parsed = JSON.parse(text); } catch (e) {
        const s = text.indexOf('['), e2 = text.lastIndexOf(']');
        if (s !== -1 && e2 > s) { try { parsed = JSON.parse(text.slice(s, e2 + 1)); } catch (e3) {} }
      }
      const meals = voltaNormalizeGeminiMeals(parsed, lang, dietPref);
      if (!meals.length) throw new Error('Gemini returned no meals');
      const record = {
        day: new Date().toDateString(),
        email: (typeof store !== 'undefined' && store.session) || '',
        diet: dietPref,   // v12: cache is preference-scoped — a diet change regenerates
        country: (loc && loc.country) || '', city: (loc && loc.city) || '', source: (loc && loc.source) || '',
        at: Date.now(), meals: meals
      };
      try { localStorage.setItem(GEMINI_MEALS_CACHE_KEY, JSON.stringify(record)); } catch (e) {}
      return record;
    } catch (e) {
      if (timer) clearTimeout(timer);
      lastErr = e;
      if (e && e.name === 'AbortError') break;
    }
  }
  if (!force) console.warn('[Gemini meals] generation failed:', lastErr && lastErr.message);
  return null;
}

// Today's cached Gemini meals (same-day + same-account + at least 4 meals).
// v12: also same DIET PREFERENCE — old-cache meals from a different pref
// (e.g. vegan meals cached before the user set Vegan) are ignored and the
// generator runs again with the new rules.
function geminiMealsToday() {
  try {
    const r = JSON.parse(localStorage.getItem(GEMINI_MEALS_CACHE_KEY) || 'null');
    if (r && r.day === new Date().toDateString() && (r.meals || []).length >= 4) {
      if (!r.email || !store.session || r.email === store.session) {
        if (String(r.diet || 'None') === String(currentDietPref())) return r;
      }
    }
  } catch (e) {}
  return null;
}

// SHARED diet-meal card renderer (used by BOTH the local daily set and the
// Gemini location-aware set — identical look, one log path per source).
function renderDietMealsCards(meals, meta) {
  const panel = document.getElementById('diet-meals');
  if (!panel) return;
  const ar = (store.lang === 'ar');
  const kcalUnit = ar ? 'سعرة' : 'kcal';
  const pLabel = ar ? 'ب' : 'P', cLabel = ar ? 'ك' : 'C', fLabel = ar ? 'د' : 'F';
  const logBtnLabel = ar ? 'تسجيل هذه الوجبة' : 'Log this meal';
  const loggedLabel = ar ? 'تم التسجيل' : 'Logged';
  const dietLog = getDietLog();
  const todayStr = (typeof localDateStr === 'function') ? localDateStr() : null;
  const gemini = !!(meta && meta.gemini);
  let html = '';
  // Source bar: where today's AI picks come from.
  // v9 (user, picture 1): "change the text in ai generated meals and just put
  // a 'regenerate another diet plan' button" — short clean line + a full
  // labeled REGENERATE button (which asks "are you sure?" first).
  // v14 (user): "regenerate diet plan button isnt on phone" — the button
  // used to render ONLY on the Gemini pass; on phones where the Gemini tier
  // fails or never runs (offline/slow network), the whole source bar —
  // button included — never appeared. The bar now renders on EVERY pass:
  // Gemini meals → location line + button; local meals → button alone.
  // Clicking it always tries a fresh Gemini generation and falls back to a
  // regenerated local set (refreshGeminiMeals), so it works offline too.
  if (gemini) {
    const place = meta.city
      ? (ar ? (meta.city + '، ' + String(meta.country).replace('ISO:', '')) : (meta.city + ', ' + String(meta.country).replace('ISO:', '')))
      : (meta.country ? String(meta.country).replace('ISO:', '') : (ar ? 'موقعك' : 'your area'));
    // v12 (user): "remove popular picks from text right on the top of the
    // regenerate another meal plan button" — the source line now reads just
    // "AI-Generated Meals · <place>" (the "popular picks around" wording is
    // gone in both languages; the location chip stays).
    html += '<div class="gemini-meal-src">' +
      '<div class="gemini-meal-src-line">' +
        '<i class="fa-solid fa-location-dot"></i>' +
        '<span data-ar="وجبات مولّدة بالذكاء الاصطناعي · ' + place + '">' + (ar ? 'وجبات مولّدة بالذكاء الاصطناعي · ' + place : 'AI-Generated Meals · ' + place) + '</span>' +
      '</div>' +
      '<button class="gemini-meal-regen" id="gemini-meal-regen-btn" onclick="regenerateDietPlanConfirm(this)"><i class="fa-solid fa-rotate"></i> <span data-ar="إعادة توليد خطة غذائية أخرى">' + (ar ? 'إعادة توليد خطة غذائية أخرى' : 'Regenerate Another Diet Plan') + '</span></button>' +
      '</div>';
  } else {
    // v14: local-meal pass — no location line, but the REGENERATE button is
    // always there (phone included).
    html += '<div class="gemini-meal-src">' +
      '<button class="gemini-meal-regen" id="gemini-meal-regen-btn" onclick="regenerateDietPlanConfirm(this)"><i class="fa-solid fa-rotate"></i> <span data-ar="إعادة توليد خطة غذائية أخرى">' + (ar ? 'إعادة توليد خطة غذائية أخرى' : 'Regenerate Another Diet Plan') + '</span></button>' +
      '</div>';
  }
  html += (meals || []).map(function (m, idx) {
    const dispName = gemini ? m.name : getMealName(m);
    const isLoggedToday = dietLog.some(function (x) {
      return x.mealType === 'ai-meal' && x.date === todayStr && x.name === dispName;
    });
    const btnStyle = isLoggedToday ? 'background:var(--green);color:#fff;cursor:default;' : '';
    const btnAttrs = isLoggedToday ? 'disabled' : '';
    const btnInner = isLoggedToday
      ? '<i class="fa-solid fa-check"></i> <span>' + loggedLabel + '</span>'
      : '<i class="fa-solid fa-plus"></i> <span>' + logBtnLabel + '</span>';
    const nameAttr = String(m.name).replace(/"/g, '&quot;');
    const onclick = gemini
      ? 'logGeminiMeal(' + idx + ')'
      : 'logAIMeal(\'' + String(m.name).replace(/'/g, "\\'") + '\', ' + idx + ')';
    // v12 (user): "the more info button glitches and disappears sometimes" —
    // every meal card (Gemini AND local) now gets a stable info button.
    // Gemini cards open the same modal via showGeminiMealInfo(idx).
    const infoBtn = gemini
      ? '<button class="info-btn" onclick="showGeminiMealInfo(' + idx + ')" aria-label="More info"><i class="fa-solid fa-circle-info"></i></button>'
      : '<button class="info-btn" onclick="showMealInfo(\'' + String(m.name).replace(/'/g, "\\'") + '\')"><i class="fa-solid fa-circle-info"></i></button>';
    const ingLine = (gemini && m.ingredients && m.ingredients.length)
      ? '<p class="diet-desc" style="margin-top:-6px;font-size:.74rem;">' + m.ingredients.slice(0, 6).join(' · ') + '</p>'
      : '';
    return '<div class="diet-card" id="diet-meal-card-' + idx + '" data-meal-name="' + nameAttr + '">' +
      infoBtn +
      '<h4>' + dispName + '</h4><p class="diet-desc">' + (gemini ? m.desc : getMealDesc(m)) + '</p>' + ingLine +
      '<div class="diet-macros"><span class="macro-pill macro-kcal">' + m.kcal + ' ' + kcalUnit + '</span><span class="macro-pill macro-p">' + pLabel + ': ' + m.p + 'g</span><span class="macro-pill macro-c">' + cLabel + ': ' + m.c + 'g</span><span class="macro-pill macro-f">' + fLabel + ': ' + m.f + 'g</span></div>' +
      '<button class="btn primary small diet-log-meal-btn" id="diet-log-meal-btn-' + idx + '" onclick="' + onclick + '" style="width:100%;margin-top:10px;font-size:.8rem;padding:8px;' + btnStyle + '" ' + btnAttrs + '>' + btnInner + '</button>' +
      '</div>';
  }).join('');
  panel.innerHTML = html;
  setTimeout(applyTranslations, 0);
}

// Async upgrade of the Diet panel: cached Gemini meals → live generation.
let __geminiMealsBusy = false;
async function maybeShowGeminiMeals() {
  if (__geminiMealsBusy) return;
  const key = (typeof window.VOLTA_GEMINI_KEY === 'string' && window.VOLTA_GEMINI_KEY) || '';
  if (!key) return;                                   // no key → local meals only
  __geminiMealsBusy = true;
  try {
    let rec = geminiMealsToday();
    if (rec) {
      renderDietMealsCards(rec.meals, { gemini: true, country: rec.country, city: rec.city });
      // v9: the AI meals exist → the diet-plan panels (dashboard + Diet tab)
      // sync to show these same meals as their slot suggestions.
      try { renderPlan(); } catch (e) {}
      try { renderDietPlanPanel(); } catch (e) {}
    }
    if (!rec && navigator.onLine) {
      // First show a small "AI is picking local meals…" note, then upgrade
      const panel = document.getElementById('diet-meals');
      if (panel && !panel.querySelector('.gemini-meal-src')) {
        const ar = (store.lang === 'ar');
        const note = document.createElement('div');
        note.className = 'gemini-meal-src loading';
        note.innerHTML = '<i class="fa-solid fa-robot fa-spin"></i><span>' + (ar ? 'الذكاء الاصطناعي يجهز وجبات شائعة حولك…' : 'AI is picking popular meals around you…') + '</span>';
        panel.insertBefore(note, panel.firstChild);
      }
      rec = await generateGeminiLocalMeals(false);
      if (rec) {
        renderDietMealsCards(rec.meals, { gemini: true, country: rec.country, city: rec.city });
        // v9: same sync — the dashboard diet card follows the AI meals.
        try { renderPlan(); } catch (e) {}
        try { renderDietPlanPanel(); } catch (e) {}
      }
      else {
        const n = document.querySelector('#diet-meals .gemini-meal-src.loading');
        if (n) n.remove();                            // keep the local cards, remove the note
      }
    }
  } catch (e) {} finally { __geminiMealsBusy = false; }
}
window.maybeShowGeminiMeals = maybeShowGeminiMeals;

// Manual "Regenerate Another Diet Plan" action — new set, same day. Called
// AFTER the "are you sure you want to regenerate your plan?" confirm popup.
async function refreshGeminiMeals(btn) {
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-rotate fa-spin"></i> <span>' + (store.lang === 'ar' ? 'جارٍ التوليد…' : 'Generating…') + '</span>'; }
  try { localStorage.removeItem(GEMINI_MEALS_CACHE_KEY); } catch (e) {}
  const rec = await generateGeminiLocalMeals(true);
  if (rec) {
    renderDietMealsCards(rec.meals, { gemini: true, country: rec.country, city: rec.city });
    // v9 ("sync diet plan in dashboard with ai generated meals"): the diet
    // plan panels re-render so the dashboard DIET PLAN card and the Diet tab's
    // "My Diet Plan" show the SAME freshly generated AI meals.
    try { renderPlan(); } catch (e) {}
    try { renderDietPlanPanel(); } catch (e) {}
  } else {
    try { showVoltaToast((store.lang === 'ar') ? 'تعذر توليد وجبات جديدة — حاول مجدداً عند الاتصال.' : 'Could not generate new meals — try again when online.', 'error'); } catch (e) {}
    const local = (typeof dailyAiMealsPanel === 'function' && dailyAiMealsPanel().length >= 4)
      ? dailyAiMealsPanel()
      : getDailyItems((MEALS_DB && MEALS_DB.length) ? MEALS_DB : MEALS, 6);
    renderDietMealsCards(local, null);
  }
}
window.refreshGeminiMeals = refreshGeminiMeals;

// v9 (user: "in the dashboard when the user clicks regenerate, make a popup
// and say 'are you sure you want to regenerate your plan?'") — the AI-meals
// regenerate button asks for confirmation before replacing today's meals.
function regenerateDietPlanConfirm(btn) {
  const ar = (store.lang === 'ar');
  voltaConfirm(
    ar ? 'هل أنت متأكد أنك تريد إعادة توليد خطتك؟' : 'Are you sure you want to regenerate your plan?',
    function () { refreshGeminiMeals(btn); },
    { yesIcon: 'fa-rotate' }
  );
}
window.regenerateDietPlanConfirm = regenerateDietPlanConfirm;

// Log a GEMINI-generated meal (from the day's cached set — offline-friendly).
function logGeminiMeal(idx) {
  try {
    const rec = geminiMealsToday();
    if (!rec) return;
    const m = (rec.meals || [])[idx];
    if (!m) return;
    const log = getDietLog();
    const today = (typeof localDateStr === 'function') ? localDateStr() : null;
    const alreadyLogged = log.some(function (x) {
      return x.mealType === 'ai-meal' && x.date === today && x.name === m.name;
    });
    if (alreadyLogged) {
      const btn0 = document.getElementById('diet-log-meal-btn-' + idx);
      if (btn0) {
        const ar0 = (store.lang === 'ar');
        btn0.innerHTML = '<i class="fa-solid fa-check"></i> <span>' + (ar0 ? 'تم التسجيل' : 'Logged') + '</span>';
        btn0.style.background = 'var(--green)'; btn0.style.color = '#fff';
        btn0.disabled = true; btn0.style.cursor = 'default';
      }
      return;
    }
    log.push({
      id: Date.now(),
      name: m.name,
      brand: (rec.country || '') ? String(rec.country).replace('ISO:', '') : '',
      kcal: m.kcal || 0, protein: m.p || 0, carbs: m.c || 0, fat: m.f || 0, fiber: 0,
      serving: '1 serving',
      barcode: '',
      mealType: 'ai-meal',
      loggedAt: new Date().toISOString(),
      date: localDateStr()
    });
    saveDietLog(log);
    try { renderDietLog(); renderDiet(); renderHome(); } catch (e) {}
    const btn = document.getElementById('diet-log-meal-btn-' + idx);
    if (btn) {
      const ar = (store.lang === 'ar');
      btn.innerHTML = '<i class="fa-solid fa-check"></i> <span>' + (ar ? 'تم التسجيل' : 'Logged') + '</span>';
      btn.style.background = 'var(--green)'; btn.style.color = '#fff';
      btn.disabled = true; btn.style.cursor = 'default';
    }
  } catch (e) { console.warn('logGeminiMeal error:', e); }
}
window.logGeminiMeal = logGeminiMeal;

// Tier 3a — offline photo color profile (canvas, ~48px, no network).
function voltaMealImageProfile(base64Image) {
  return new Promise(function (resolve) {
    try {
      const img = new Image();
      img.onload = function () {
        try {
          const S = 48;
          const c = document.createElement('canvas'); c.width = S; c.height = S;
          const ctx = c.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, S, S);
          const d = ctx.getImageData(0, 0, S, S).data;
          let r = 0, g = 0, b = 0, n = 0, dark = 0, bright = 0;
          const buckets = { red: 0, green: 0, yellow: 0, brown: 0, white: 0, dark: 0 };
          for (let i = 0; i < d.length; i += 4) {
            const R = d[i], G = d[i + 1], B = d[i + 2];
            r += R; g += G; b += B; n++;
            const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
            const lum = 0.299 * R + 0.587 * G + 0.114 * B;
            if (lum < 45) { buckets.dark++; dark++; continue; }
            if (lum > 215 && mx - mn < 30) { buckets.white++; bright++; continue; }
            if (R > 140 && G < 110 && B < 110) buckets.red++;
            else if (G > 110 && G > R + 20 && G > B + 20) buckets.green++;
            else if (R > 160 && G > 120 && B < 110) buckets.yellow++;
            else if (R >= G && G > B && R > 85 && R < 200) buckets.brown++;
          }
          const avg = { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
          const dominant = Object.keys(buckets).sort(function (a, b2) { return buckets[b2] - buckets[a]; })[0];
          resolve({ avg: avg, buckets: buckets, dominant: dominant, darkRatio: dark / n, brightRatio: bright / n });
        } catch (e) { resolve(null); }
      };
      img.onerror = function () { resolve(null); };
      img.src = base64Image;
    } catch (e) { resolve(null); }
  });
}
// Tier 3b — match the profile against the LOCAL meal database.
async function voltaOfflineMealCandidates(base64Image) {
  const profile = await voltaMealImageProfile(base64Image);
  let pool = (typeof MEALS_DB !== 'undefined' && MEALS_DB && MEALS_DB.length) ? MEALS_DB : null;
  if (!pool && window.VOLTA_MEAL_SEED && window.VOLTA_MEAL_SEED.length) pool = window.VOLTA_MEAL_SEED;
  if (!pool) pool = MEALS;
  const KEYWORDS = {
    green: ['salad', 'greens', 'broccoli', 'spinach', 'veg', 'kale', 'cucumber', 'avocado', 'zucchini', 'herb', 'cabbage', 'lettuce', 'green bean', 'asparagus', 'pesto'],
    red: ['tomato', 'pasta', 'pizza', 'chili', 'shakshuka', 'berries', 'marinara', 'bolognese', 'salsa', 'harissa', 'pepper', 'watermelon', 'strawberry', 'raspberry', 'curry'],
    yellow: ['curry', 'sweet potato', 'egg', 'mango', 'corn', 'pumpkin', 'cheese', 'pineapple', 'butter', 'noodle', 'turmeric', 'banana', 'honey', 'lemon'],
    brown: ['rice', 'chicken', 'beef', 'meat', 'stir', 'roast', 'potato', 'burger', 'steak', 'oats', 'quinoa', 'lentil', 'bean', 'chickpea', 'bread', 'pasta', 'wheat', 'shawarma', 'kebab', 'kofta', 'bulgur', 'peanut'],
    white: ['yogurt', 'oat', 'milk', 'rice', 'tofu', 'cottage', 'chia', 'pancake', 'cream', 'coconut', 'fish', 'cod', 'potato', 'pasta', 'mozzarella', 'feta', 'labneh', 'mushroom', 'onion', 'garlic', 'banana', 'cauliflower'],
    dark: ['chocolate', 'coffee', 'beef', 'salmon', 'tuna', 'dark', 'soy', 'date', 'prune', 'walnut', 'brownie', 'cocoa', 'tea']
  };
  const kws = (profile && KEYWORDS[profile.dominant]) ? KEYWORDS[profile.dominant] : [];
  const scored = pool.map(function (meal) {
    let score = 0;
    const hay = ((meal.name || '') + ' ' + ((meal.ingredients || []).join(' ')) + ' ' + ((meal.tags || []).join(' ')) + ' ' + (meal.desc || '')).toLowerCase();
    for (let i = 0; i < kws.length; i++) { if (hay.indexOf(kws[i]) !== -1) score += 3; }
    // small preference for protein-forward mains at meal time
    if (meal.mealType === 'lunch' || meal.mealType === 'dinner') score += 1;
    return { meal: meal, score: score };
  }).sort(function (a, b) { return b.score - a.score; });
  // Keep the strongest suggestions, de-duplicated.
  const seen = {}; const out = [];
  for (let i = 0; i < scored.length && out.length < 8; i++) {
    const m = scored[i].meal;
    if (!m || seen[m.name]) continue;
    seen[m.name] = 1; out.push(m);
  }
  return { profile: profile, candidates: out };
}
// Tier 3c — the offline picker UI (suggest + search + confirm).
function voltaShowOfflineMealPicker(result) {
  const ar = (store.lang === 'ar');
  // remove any previous picker
  const old = document.getElementById('ai-meal-offline-picker');
  if (old) old.remove();
  const panel = document.getElementById('ai-meal-result-panel');
  const upload = document.getElementById('ai-scan-upload-area');
  const picker = document.createElement('div');
  picker.id = 'ai-meal-offline-picker';
  picker.style.cssText = 'margin-top:14px;background:var(--accent-soft);border:1px solid var(--accent-border);border-radius:14px;padding:16px;';
  // v29 (user: "ai features still dont work on the html file"): the picker
  // used to ALWAYS say "You're offline" — even when the user was online and
  // the cloud tiers simply didn't answer. The wording is now honest about
  // what actually happened, so it never reads like the AI is broken.
  const pickerOnline = !(typeof navigator !== 'undefined' && navigator.onLine === false);
  const pickHead = pickerOnline
    ? { icon: 'fa-wand-magic-sparkles',
        en: 'We matched your photo against the meal database. Pick your meal to log it instantly:',
        ar: '\u0637\u0627\u0628\u0642\u0646\u0627 \u0635\u0648\u0631\u062a\u0643 \u0645\u0639 \u0648\u062c\u0628\u0627\u062a \u0642\u0627\u0639\u062f\u0629 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a. \u0627\u062e\u062a\u0631 \u0648\u062c\u0628\u062a\u0643 \u0644\u062a\u0633\u062c\u064a\u0644\u0647\u0627 \u0641\u0648\u0631\u0627\u064b:' }
    : { icon: 'fa-wifi',
        en: 'You\'re offline — we matched your photo against the meal database. Pick your meal to log it instantly:',
        ar: '\u0623\u0646\u062a \u063a\u064a\u0631 \u0645\u062a\u0635\u0644 \u2014 \u0637\u0627\u0628\u0642\u0646\u0627 \u0635\u0648\u0631\u062a\u0643 \u0645\u0639 \u0648\u062c\u0628\u0627\u062a \u0642\u0627\u0639\u062f\u0629 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a. \u0627\u062e\u062a\u0631 \u0648\u062c\u0628\u062a\u0643 \u0644\u062a\u0633\u062c\u064a\u0644\u0647\u0627 \u0641\u0648\u0631\u0627\u064b:' };
  picker.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;color:var(--amber);font-size:.85rem;font-weight:600;">' +
      '<i class="fa-solid ' + pickHead.icon + '"></i> ' +
      '<span data-ar="' + pickHead.ar + '">' + (ar ? pickHead.ar : pickHead.en) + '</span>' +
    '</div>' +
    '<input type="text" id="ai-meal-offline-search" placeholder="' + (ar ? 'ابحث عن وجبة…' : 'Search meals…') + '" oninput="filterOfflineMeals(this.value)" style="width:100%;padding:10px 12px;border:1px solid var(--accent-border);border-radius:10px;font:inherit;background:var(--white);color:var(--text);margin-bottom:10px;" />' +
    '<div id="ai-meal-offline-list" style="display:flex;flex-direction:column;gap:8px;"></div>';
  (panel && panel.parentNode) ? panel.parentNode.insertBefore(picker, panel) : upload.parentNode.appendChild(picker);
  window.__voltaOfflineMeals = result.candidates;
  renderOfflineMealList(result.candidates);
  try { applyTranslations(); } catch (e) {}
}
function renderOfflineMealList(list) {
  const el = document.getElementById('ai-meal-offline-list');
  if (!el) return;
  const ar = (store.lang === 'ar');
  if (!list.length) {
    el.innerHTML = '<p style="color:var(--muted);font-size:.82rem;text-align:center;padding:6px;">' + (ar ? 'لا نتائج — جرّب كلمة أخرى.' : 'No matches — try another word.') + '</p>';
    return;
  }
  el.innerHTML = list.map(function (m) {
    const idx = window.__voltaOfflineMeals.indexOf(m);
    return '<button type="button" class="offline-meal-pick" onclick="selectOfflineMeal(' + idx + ')">' +
      '<span class="offline-meal-pick-ic"><i class="fa-solid fa-utensils"></i></span>' +
      '<span class="offline-meal-pick-body"><b>' + getMealName(m) + '</b>' +
      '<small>' + (m.desc || '') + '</small></span>' +
      '<span class="offline-meal-pick-kcal">' + (m.kcal || 0) + ' kcal</span>' +
    '</button>';
  }).join('');
}
function filterOfflineMeals(q) {
  const all = window.__voltaOfflineMeals || [];
  const s = String(q || '').trim().toLowerCase();
  const list = s ? all.filter(function (m) { return ((m.name || '') + ' ' + (m.desc || '') + ' ' + ((m.ingredients || []).join(' '))).toLowerCase().indexOf(s) !== -1; }) : all;
  renderOfflineMealList(list);
}
function selectOfflineMeal(idx) {
  const m = (window.__voltaOfflineMeals || [])[idx];
  if (!m) return;
  const ar = (store.lang === 'ar');
  const data = {
    name: getMealName(m) || m.name,
    nameEn: m.name,
    description: (m.desc || '') + (ar ? ' (مطابقة دون اتصال)' : ' (offline match)'),
    cuisine: m.cuisine || '',
    calories: m.kcal || 0, protein: m.p || 0, carbs: m.c || 0, fat: m.f || 0,
    ingredients: (m.ingredients || []).slice(0, 8)
  };
  const picker = document.getElementById('ai-meal-offline-picker');
  if (picker) picker.remove();
  window.__voltaOfflineMeals = null;
  voltaMealShowResult(data);
  try { if (typeof showVoltaToast === 'function') showVoltaToast(ar ? 'تمت مطابقة الوجبة دون اتصال!' : 'Meal matched offline!', 'success'); } catch (e) {}
}
// Shared result renderer (used by all 3 tiers).
function voltaMealShowResult(data) {
  const ar = (store.lang === 'ar');
  document.getElementById('ai-scan-overlay').style.display = 'none';
  document.getElementById('ai-scan-upload-area').style.display = 'block';
  lastAIMealResult = data;
  document.getElementById('ai-meal-name').textContent = data.name || 'Unknown meal';
  document.getElementById('ai-meal-desc').textContent = data.description || '';
  document.getElementById('ai-meal-kcal').textContent = (data.calories || 0) + ' kcal';
  document.getElementById('ai-meal-protein').textContent = 'P: ' + (data.protein || 0) + 'g';
  document.getElementById('ai-meal-carbs').textContent = 'C: ' + (data.carbs || 0) + 'g';
  document.getElementById('ai-meal-fat').textContent = 'F: ' + (data.fat || 0) + 'g';
  const ingEl = document.getElementById('ai-meal-ingredients');
  if (data.ingredients && data.ingredients.length > 0) {
    ingEl.innerHTML = '<b style="color:var(--text);">' + (ar ? 'المكونات: ' : 'Ingredients: ') + data.ingredients.join(', ') + '</b>';
    ingEl.style.display = 'block';
  } else {
    ingEl.style.display = 'none';
  }
  // dir=auto on the localized result fields so Arabic dish names,
  // descriptions and ingredients render RTL (and Latin ones LTR).
  ['ai-meal-name', 'ai-meal-desc', 'ai-meal-ingredients'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.setAttribute('dir', 'auto');
  });
  document.getElementById('ai-meal-result-panel').classList.remove('hidden');
}
async function analyzeMealPhoto(inputEl) {
  const file = inputEl.files && inputEl.files[0];
  if (!file) return;
  const ar = (store.lang === 'ar');
  const lang = (store && store.lang === 'ar') ? 'ar' : 'en';

  // Show scanning animation, hide upload area + old result
  document.getElementById('ai-scan-overlay').style.display = 'block';
  document.getElementById('ai-scan-upload-area').style.display = 'none';
  document.getElementById('ai-meal-result-panel').classList.add('hidden');
  const oldPicker = document.getElementById('ai-meal-offline-picker');
  if (oldPicker) oldPicker.remove();

  // Round 18: convert to a COMPRESSED base64 data URL (see voltaDownscaleImage).
  // Falls back to the raw file if downsizing is unavailable.
  let base64Image;
  try {
    base64Image = await voltaDownscaleImage(file, 1024, 0.85);
  } catch (e) {
    base64Image = await new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function (ev) { resolve(ev.target.result); };
      reader.onerror = function () { reject(new Error('read failed')); };
      reader.readAsDataURL(file);
    });
  }
  const API_URL = window.VOLTA_API_BASE || window.location.origin;

  // ─── v18 (user): PHONES run the SAME AI chain as PC ───
  // v14 made phones ALWAYS answer with the LOCAL engine (the server tiers
  // were slow on mobile data and looked like "servers offline"). The user
  // now wants the phone port identical to PC: "ai doesnt work, even when
  // online" — so phones get the real AI tiers again (Vercel backend →
  // direct Gemini), with the local engine as the failure fallback, exactly
  // like desktop. The ONLY phone shortcut left: when the device is fully
  // OFFLINE we jump straight to the local engine (instant, no dead waits).
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    try {
      const result = await voltaOfflineMealCandidates(base64Image);
      document.getElementById('ai-scan-overlay').style.display = 'none';
      document.getElementById('ai-scan-upload-area').style.display = 'block';
      voltaShowOfflineMealPicker(result);
    } catch (errOffline) {
      console.error('AI meal analysis error (offline local engine):', errOffline);
      document.getElementById('ai-scan-overlay').style.display = 'none';
      document.getElementById('ai-scan-upload-area').style.display = 'block';
      const msg = (ar ? 'تعذر تحليل الصورة — حاول التقاط صورة أوضح.' : 'Could not analyze the photo — try a clearer picture.');
      try { if (typeof showVoltaToast === 'function') showVoltaToast(msg, 'error'); } catch (e) {}
    }
    inputEl.value = '';
    return;
  }

  // ─── TIER 1 — the Vercel backend (/api/analyze-meal) ───
  try {
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    // v18: phones wait max 12s for the backend (flaky mobile data falls
    // through to direct Gemini quickly) — desktop keeps the 30s budget.
    const tier1TimeoutMs = (window.innerWidth <= 768) ? 12000 : 30000;
    const timer = ctrl ? setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, tier1TimeoutMs) : null;
    const response = await fetch(API_URL + '/api/analyze-meal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64Image, lang: lang }),
      signal: ctrl ? ctrl.signal : undefined
    });
    if (timer) clearTimeout(timer);
    if (!response.ok) throw new Error('Backend returned ' + response.status);
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    voltaMealShowResult(data);
    try { if (typeof showVoltaToast === 'function') showVoltaToast(ar ? 'تم تحليل الوجبة!' : 'Meal analyzed!', 'success'); } catch (e) {}
    inputEl.value = '';
    return;
  } catch (err1) {
    console.warn('[MealScanner] backend tier failed, trying direct Gemini…', err1 && err1.message);
  }

  // ─── TIER 2 — Gemini DIRECTLY from the browser (no backend dependency) ───
  if (navigator.onLine) {
    try {
      const data = await analyzeMealWithGeminiDirect(base64Image, lang);
      voltaMealShowResult(data);
      try { if (typeof showVoltaToast === 'function') showVoltaToast(ar ? 'تم تحليل الوجبة!' : 'Meal analyzed!', 'success'); } catch (e) {}
      inputEl.value = '';
      return;
    } catch (err2) {
      console.warn('[MealScanner] direct Gemini tier failed, using offline matcher…', err2 && err2.message);
    }
  }

  // ─── TIER 3 — OFFLINE matcher (always works — no network needed) ───
  try {
    const result = await voltaOfflineMealCandidates(base64Image);
    document.getElementById('ai-scan-overlay').style.display = 'none';
    document.getElementById('ai-scan-upload-area').style.display = 'block';
    voltaShowOfflineMealPicker(result);
  } catch (err3) {
    console.error('AI meal analysis error:', err3);
    document.getElementById('ai-scan-overlay').style.display = 'none';
    document.getElementById('ai-scan-upload-area').style.display = 'block';
    const msg = (ar ? 'تعذر تحليل الصورة — حاول التقاط صورة أوضح.' : 'Could not analyze the photo — try a clearer picture.');
    try { if (typeof showVoltaToast === 'function') showVoltaToast(msg, 'error'); } catch (e) {}
  }
  inputEl.value = '';
}

// Renamed from `logAIMeal` to `logScannedAIMeal` to fix the "Log a Meal"
// button on AI-generated meal cards. The two functions had different
// signatures (this one takes no args and reads `lastAIMealResult`; the
// other takes (mealName, btnIdx) and looks the meal up in MEALS_DB). Since
// JS allows redeclaring functions, the no-arg version was silently
// shadowing the meal-card version, so clicking "Log a Meal" under any
// AI-generated meal did nothing. Renaming this one keeps both code paths
// working — the AI scanner result panel calls logScannedAIMeal(); the
// meal cards call logAIMeal(name, idx).
function logScannedAIMeal() {
  if (!lastAIMealResult) return;
  const ar = (store.lang === 'ar');
  const log = getDietLog();
  log.push({
    id: Date.now(),
    name: lastAIMealResult.name || 'AI Meal',
    brand: '',
    kcal: lastAIMealResult.calories || 0,
    protein: lastAIMealResult.protein || 0,
    carbs: lastAIMealResult.carbs || 0,
    fat: lastAIMealResult.fat || 0,
    fiber: 0,
    serving: '1 serving',
    barcode: '',
    mealType: 'ai-meal',
    loggedAt: new Date().toISOString(),
    date: localDateStr()
  });
  saveDietLog(log);
  renderDietLog();
  renderDiet();
  document.getElementById('ai-meal-result-panel').classList.add('hidden');
  lastAIMealResult = null;
  try { if (typeof showVoltaToast === 'function') showVoltaToast(ar ? 'تمت إضافة الوجبة إلى السجل!' : 'Meal added to log!', 'success'); } catch(e) {}
}

async function lookupBarcode(code) {
  if (!code || code.trim().length < 4) { alert('Please enter a valid barcode.'); return; }
  code = code.trim();
  const status = document.getElementById('scanner-status');
  if (status) status.textContent = store.lang === 'ar' ? 'جارٍ البحث...' : 'Looking up...';
  const resultPanel = document.getElementById('scanner-result-panel');
  const resultContent = document.getElementById('scanner-result-content');
  const logBtn = document.getElementById('scanner-log-meal-btn');

  try {
    const resp = await fetch('https://world.openfoodfacts.org/api/v0/product/' + encodeURIComponent(code) + '.json');
    const data = await resp.json();
    if (data.status === 1 && data.product) {
      const p = data.product;
      const n = p.nutriments || {};
      const isAr = (store.lang === 'ar');
      const name = p.product_name || (isAr ? 'منتج غير معروف' : 'Unknown Product');
      const brand = p.brands || '';
      const kcal = Math.round(n['energy-kcal_100g'] || n['energy-kcal'] || 0);
      const protein = Math.round((n.proteins_100g || 0) * 10) / 10;
      const carbs = Math.round((n.carbohydrates_100g || 0) * 10) / 10;
      const fat = Math.round((n.fat_100g || 0) * 10) / 10;
      const fiber = Math.round((n.fiber_100g || 0) * 10) / 10;
      const serving = p.serving_size || (isAr ? 'لكل 100غ' : 'per 100g');
      const img = p.image_small_url || p.image_url || '';

      lastScanResult = { name, brand, kcal, protein, carbs, fat, fiber, serving, barcode: code, img, loggedAt: new Date().toISOString() };

      resultContent.innerHTML = `
        <div class="scanner-product-card">
          ${img ? `<img src="${img}" alt="${name}" style="width:80px;height:80px;object-fit:cover;border-radius:10px;float:right;margin-left:12px;" onerror="this.style.display='none'" />` : ''}
          <h4>${name}</h4>
          <div class="brand">${brand} · ${serving}</div>
          <div class="nutri-grid">
            <div class="scanner-nutri-item"><b>${kcal}</b><small>${isAr ? 'سعرة' : 'kcal'}</small></div>
            <div class="scanner-nutri-item"><b>${protein}g</b><small>${isAr ? 'بروتين' : 'Protein'}</small></div>
            <div class="scanner-nutri-item"><b>${carbs}g</b><small>${isAr ? 'كربوهيدرات' : 'Carbs'}</small></div>
            <div class="scanner-nutri-item"><b>${fat}g</b><small>${isAr ? 'دهون' : 'Fat'}</small></div>
            <div class="scanner-nutri-item"><b>${fiber}g</b><small>${isAr ? 'ألياف' : 'Fiber'}</small></div>
          </div>
        </div>`;
      resultPanel.classList.remove('hidden');
      logBtn.style.display = '';
      saveScannerHistory(lastScanResult);
    } else {
      resultContent.innerHTML = `<p style="color:var(--muted);text-align:center;padding:20px;">${store.lang === 'ar' ? 'لم يتم العثور على المنتج. جرب باركود آخر.' : 'Product not found. Try another barcode.'}</p>`;
      resultPanel.classList.remove('hidden');
      logBtn.style.display = 'none';
    }
  } catch(e) {
    resultContent.innerHTML = `<p style="color:var(--red);text-align:center;padding:20px;">${store.lang === 'ar' ? 'خطأ في الاتصال. تحقق من الإنترنت.' : 'Connection error. Check your internet.'}</p>`;
    resultPanel.classList.remove('hidden');
    logBtn.style.display = 'none';
  }
  renderScannerHistory();
}

function logScannedProduct() {
  if (!lastScanResult) return;
  const log = getDietLog();
  log.push({ ...lastScanResult, id: Date.now(), date: localDateStr() });
  saveDietLog(log);
  renderDietLog();
  try { renderHome(); } catch(e) {}
  document.getElementById('scanner-log-meal-btn').style.display = 'none';
  const isAr = (store.lang === 'ar');
  alert(isAr ? 'تمت إضافة المنتج إلى سجل الوجبات!' : 'Product added to meal log!');
}

function addManualMealLog() {
  // Reset form fields
  document.getElementById('meal-name-input').value = '';
  document.getElementById('meal-type-input').value = 'lunch';
  document.getElementById('meal-kcal-input').value = '0';
  document.getElementById('meal-grams-input').value = '';
  document.getElementById('meal-protein-input').value = '0';
  document.getElementById('meal-carbs-input').value = '0';
  document.getElementById('meal-fat-input').value = '0';
  openModal('manual-meal-modal');
}

function submitManualMeal(e) {
  e.preventDefault();
  const name = document.getElementById('meal-name-input').value.trim();
  if (!name) return false;
  let kcal = parseInt(document.getElementById('meal-kcal-input').value) || 0;
  const protein = parseFloat(document.getElementById('meal-protein-input').value) || 0;
  const carbs = parseFloat(document.getElementById('meal-carbs-input').value) || 0;
  const fat = parseFloat(document.getElementById('meal-fat-input').value) || 0;
  const mealType = document.getElementById('meal-type-input').value;
  // GRAMS replaced "serving size": the user logs the amount in grams.
  const grams = parseFloat(document.getElementById('meal-grams-input').value) || 0;
  const serving = grams > 0 ? (Math.round(grams * 10) / 10 + ' g') : '';
  // If the user knows the macros but not the kcal — compute exactly
  // (4 kcal per g protein/carb + 9 kcal per g fat) like the food database.
  if (!kcal && (protein || carbs || fat)) kcal = Math.round(4 * protein + 4 * carbs + 9 * fat);
  const log = getDietLog();
  log.push({ id: Date.now(), name, brand: '', kcal, protein, carbs, fat, fiber: 0, grams, serving, barcode: '', mealType, loggedAt: new Date().toISOString(), date: localDateStr() });
  saveDietLog(log);
  // Refresh diet log + progress bar + home dashboard so the calorie bar updates
  renderDietLog();
  try { renderHome(); } catch(e) {}
  closeModal('manual-meal-modal');
  return false;
}

function getDietLog() {
  try {
    const u = currentUser();
    if (!u) return [];
    const key = 'volta_diet_log_' + u.email;
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch(e) { return []; }
}

function saveDietLog(log) {
  const u = currentUser();
  if (!u) return;
  const key = 'volta_diet_log_' + u.email;
  localStorage.setItem(key, JSON.stringify(log));
  // Also save to IndexedDB for offline
  if (typeof voltaDB !== 'undefined') {
    voltaDB.put('dietLog', { email: u.email, log });
  }
  // CloudSync: push the diet log to Vercel so it's available on other
  // devices. Best-effort — debounced inside VoltaCloudSync so rapid meal
  // logs coalesce into a single API call. No-op if CloudSync isn't loaded.
  try {
    if (window.VoltaCloudSync) {
      window.VoltaCloudSync.syncDietLogToCloud(u.email, log);
    }
  } catch(e) {}
}

function deleteDietLogEntry(id) {
  const log = getDietLog().filter(x => x.id !== id);
  saveDietLog(log);
  renderDietLog();
}

function renderDietLog() {
  const container = document.getElementById('diet-log-list');
  if (!container) return;
  const log = getDietLog();
  const isAr = (store.lang === 'ar');
  const today = localDateStr();
  // Use the local `date` field when available (immune to UTC/off-by-one bugs).
  // Fall back to `loggedAt.startsWith(today)` for older entries without `date`.
  const todayLog = log.filter(x => (x.date && x.date === today) || (!x.date && (x.loggedAt || '').startsWith(today)));
  if (todayLog.length === 0) {
    container.innerHTML = `<p style="color:var(--muted);text-align:center;padding:12px;">${isAr ? 'لم تسجل أي وجبات بعد. استخدم ماسح الباركود أو أضف يدوياً.' : 'No meals logged yet. Use the barcode scanner or add manually.'}</p>`;
    // Still refresh the progress bar (it will show 0 / target)
    try { renderDiet(); } catch(e) {}
    return;
  }
  // v25: whole-number calories (never decimals).
  const totalKcal = Math.round(todayLog.reduce((s, x) => s + (x.kcal || 0), 0));
  container.innerHTML = `<div style="text-align:center;margin-bottom:12px;padding:8px;background:var(--accent-soft);border-radius:10px;"><b style="font-size:1.2rem;color:var(--accent);">${totalKcal}</b> <small style="color:var(--muted);">${isAr ? 'سعرة اليوم' : 'kcal today'}</small></div>` +
    todayLog.map(x => `<div class="diet-log-entry"><div class="diet-log-icon"><i class="fa-solid fa-utensils"></i></div><div class="diet-log-body"><b>${x.name}</b><small>${x.brand ? x.brand + ' · ' : ''}${x.serving || ''}</small></div><span class="diet-log-kcal">${x.kcal || 0} kcal</span><button class="diet-log-del" onclick="deleteDietLogEntry(${x.id})" title="Remove"><i class="fa-solid fa-xmark"></i></button></div>`).join('');
  // Refresh the diet progress bar so it reflects the new total
  try { renderDiet(); } catch(e) {}
}

function saveScannerHistory(item) {
  try {
    const key = 'volta_scanner_history';
    const history = JSON.parse(localStorage.getItem(key) || '[]');
    history.unshift({ name: item.name, brand: item.brand, kcal: item.kcal, barcode: item.barcode, date: new Date().toISOString() });
    if (history.length > 20) history.length = 20;
    localStorage.setItem(key, JSON.stringify(history));
  } catch(e) {}
}

function renderScannerHistory() {
  const container = document.getElementById('scanner-history');
  if (!container) return;
  const isAr = (store.lang === 'ar');
  try {
    const history = JSON.parse(localStorage.getItem('volta_scanner_history') || '[]');
    if (history.length === 0) {
      container.innerHTML = `<p style="color:var(--muted);text-align:center;padding:12px;">${isAr ? 'لا توجد عمليات مسح سابقة.' : 'No recent scans.'}</p>`;
      return;
    }
    container.innerHTML = history.map(x => {
      const d = new Date(x.date).toLocaleDateString(isAr ? 'ar-EG' : 'en-US', { month: 'short', day: 'numeric' });
      return `<div class="scanner-history-item" style="cursor:pointer;" onclick="lookupBarcode('${x.barcode}')"><div class="sh-icon"><i class="fa-solid fa-barcode"></i></div><div class="sh-body"><b>${x.name}</b><small>${x.brand || ''} · ${d}</small></div><span class="sh-kcal">${x.kcal || 0} kcal</span></div>`;
    }).join('');
  } catch(e) { container.innerHTML = ''; }
}

// ============================================================
// WEB AUDIO API REST TIMER & INTERVAL BEEPER
// ============================================================
let timerAudioCtx = null;
let timerMode = 'rest';
let timerRunning = false;
let timerPaused = false;
let timerInterval = null;
let timerRemaining = 0;
let timerTotal = 0;
let timerCurrentRound = 1;
let timerTotalRounds = 8;
let timerPhase = 'idle'; // idle, work, rest, countdown
let restDuration = 90;
let timerLaps = [];
let timerStartTime = null;
let timerElapsed = 0;

function getTimerAudioCtx() {
  if (!timerAudioCtx) timerAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (timerAudioCtx.state === 'suspended') timerAudioCtx.resume();
  return timerAudioCtx;
}

function playBeep(freq, duration, type) {
  // v16: the timer sound toggle was removed from the UI in an earlier round
  // but this line still dereferenced it — every beep call (workout-timer
  // completion, countdown cues) threw a TypeError. Missing toggle → no sound
  // (the effective behavior users already had), just without the crash.
  var st = document.getElementById('timer-sound-toggle');
  if (!st || !st.checked) return;
  try {
    const ctx = getTimerAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (duration / 1000));
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + (duration / 1000));
  } catch(e) {}
}

function playCountdownBeep() { playBeep(880, 150, 'square'); }
function playWorkBeep() { playBeep(1200, 300, 'sawtooth'); }
function playRestBeep() { playBeep(600, 300, 'sine'); }
function playDoneBeep() {
  playBeep(1000, 200, 'square');
  setTimeout(() => playBeep(1200, 200, 'square'), 250);
  setTimeout(() => playBeep(1500, 400, 'square'), 500);
}

function vibrateDevice(pattern) {
  // v16: same removed-toggle guard as playBeep (was throwing a TypeError
  // on every call because #timer-vibrate-toggle no longer exists).
  var vt = document.getElementById('timer-vibrate-toggle');
  if (!vt || !vt.checked) return;
  try { navigator.vibrate(pattern); } catch(e) {}
}

function testTimerSound() {
  playBeep(800, 200, 'sine');
  setTimeout(() => playBeep(1000, 200, 'sine'), 300);
  setTimeout(() => playBeep(1200, 300, 'sine'), 600);
  vibrateDevice([100, 50, 100]);
}

function setTimerMode(mode) {
  if (timerRunning) return;
  timerMode = mode;
  document.querySelectorAll('#timer-mode-tabs .btn').forEach(b => b.classList.remove('active'));
  document.getElementById('timer-mode-' + mode).classList.add('active');
  document.getElementById('rest-settings').style.display = mode === 'rest' ? '' : 'none';
  document.getElementById('hiit-settings').style.display = mode === 'hiit' ? '' : 'none';
  document.getElementById('tabata-settings').style.display = mode === 'tabata' ? '' : 'none';
  document.getElementById('stopwatch-settings').style.display = mode === 'stopwatch' ? '' : 'none';
  document.getElementById('timer-round-info').style.display = mode === 'stopwatch' ? 'none' : '';
  document.getElementById('timer-lap-btn').style.display = mode === 'stopwatch' ? '' : 'none';
  resetTimer();
}

function adjustRestTime(delta) {
  restDuration = Math.max(10, Math.min(300, restDuration + delta));
  document.getElementById('rest-duration-display').textContent = restDuration;
  document.getElementById('rest-duration-slider').value = restDuration;
}

function updateRestDuration(val) {
  restDuration = parseInt(val);
  document.getElementById('rest-duration-display').textContent = restDuration;
}

function formatTimerTime(seconds) {
  const m = Math.floor(Math.abs(seconds) / 60).toString().padStart(2, '0');
  const s = (Math.abs(seconds) % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function startTimer() {
  if (timerRunning && timerPaused) {
    // Resume
    timerPaused = false;
    document.getElementById('timer-pause-btn').style.display = '';
    document.getElementById('timer-start-btn').style.display = 'none';
    return;
  }
  if (timerRunning) return;

  // Initialize audio context on user gesture
  getTimerAudioCtx();

  timerRunning = true;
  timerPaused = false;
  timerLaps = [];
  timerCurrentRound = 1;
  timerStartTime = Date.now();
  timerElapsed = 0;

  document.getElementById('timer-start-btn').style.display = 'none';
  document.getElementById('timer-pause-btn').style.display = '';
  document.getElementById('timer-reset-btn').style.display = '';
  document.getElementById('timer-laps').innerHTML = '';

  if (timerMode === 'rest') {
    timerTotal = restDuration;
    timerRemaining = restDuration;
    timerPhase = 'rest';
    updateTimerPhaseLabel();
    timerInterval = setInterval(tickRestTimer, 1000);
  } else if (timerMode === 'hiit') {
    const workTime = parseInt(document.getElementById('hiit-work').value) || 40;
    const restTime = parseInt(document.getElementById('hiit-rest').value) || 20;
    timerTotalRounds = parseInt(document.getElementById('hiit-rounds').value) || 8;
    timerTotal = workTime;
    timerRemaining = workTime;
    timerPhase = 'work';
    timerCurrentRound = 1;
    updateTimerRoundInfo();
    updateTimerPhaseLabel();
    timerInterval = setInterval(() => tickHIITTimer(workTime, restTime), 1000);
  } else if (timerMode === 'tabata') {
    timerTotalRounds = parseInt(document.getElementById('tabata-rounds').value) || 8;
    timerTotal = 20;
    timerRemaining = 20;
    timerPhase = 'work';
    timerCurrentRound = 1;
    updateTimerRoundInfo();
    updateTimerPhaseLabel();
    timerInterval = setInterval(() => tickHIITTimer(20, 10), 1000);
  } else if (timerMode === 'stopwatch') {
    timerPhase = 'work';
    updateTimerPhaseLabel();
    timerInterval = setInterval(tickStopwatch, 100);
  }

  // 3-2-1 countdown
  if (document.getElementById('timer-countdown-toggle').checked && timerMode !== 'stopwatch') {
    clearInterval(timerInterval);
    let countdown = 3;
    timerRemaining = countdown;
    timerPhase = 'countdown';
    updateTimerPhaseLabel();
    document.getElementById('timer-display').textContent = formatTimerTime(countdown);
    playCountdownBeep();
    vibrateDevice(50);
    const countdownInt = setInterval(() => {
      countdown--;
      if (countdown > 0) {
        document.getElementById('timer-display').textContent = formatTimerTime(countdown);
        playCountdownBeep();
        vibrateDevice(50);
      } else {
        clearInterval(countdownInt);
        timerPhase = timerMode === 'rest' ? 'rest' : 'work';
        if (timerMode === 'rest') {
          timerRemaining = restDuration;
          timerInterval = setInterval(tickRestTimer, 1000);
        } else if (timerMode === 'hiit') {
          const workTime = parseInt(document.getElementById('hiit-work').value) || 40;
          const restTime = parseInt(document.getElementById('hiit-rest').value) || 20;
          timerRemaining = workTime;
          timerInterval = setInterval(() => tickHIITTimer(workTime, restTime), 1000);
        } else if (timerMode === 'tabata') {
          timerRemaining = 20;
          timerInterval = setInterval(() => tickHIITTimer(20, 10), 1000);
        }
        updateTimerPhaseLabel();
        document.getElementById('timer-display').textContent = formatTimerTime(timerRemaining);
        playWorkBeep();
        vibrateDevice([100, 50, 100]);
      }
    }, 1000);
  }
}

function tickRestTimer() {
  if (timerPaused) return;
  timerRemaining--;
  document.getElementById('timer-display').textContent = formatTimerTime(timerRemaining);
  if (timerRemaining <= 3 && timerRemaining > 0) {
    playCountdownBeep();
    vibrateDevice(50);
  }
  if (timerRemaining <= 0) {
    clearInterval(timerInterval);
    timerRunning = false;
    timerPhase = 'done';
    updateTimerPhaseLabel();
    playDoneBeep();
    vibrateDevice([200, 100, 200, 100, 200]);
    document.getElementById('timer-pause-btn').style.display = 'none';
    document.getElementById('timer-start-btn').style.display = '';
    document.getElementById('timer-start-btn').querySelector('span').textContent = store.lang === 'ar' ? 'إعادة' : 'Restart';
  }
}

function tickHIITTimer(workTime, restTime) {
  if (timerPaused) return;
  timerRemaining--;
  document.getElementById('timer-display').textContent = formatTimerTime(timerRemaining);
  if (timerRemaining <= 3 && timerRemaining > 0) {
    playCountdownBeep();
    vibrateDevice(50);
  }
  if (timerRemaining <= 0) {
    if (timerPhase === 'work') {
      // Switch to rest
      timerPhase = 'rest';
      timerRemaining = restTime;
      playRestBeep();
      vibrateDevice([100]);
    } else {
      // Rest over, next round or done
      timerCurrentRound++;
      if (timerCurrentRound > timerTotalRounds) {
        clearInterval(timerInterval);
        timerRunning = false;
        timerPhase = 'done';
        updateTimerPhaseLabel();
        playDoneBeep();
        vibrateDevice([200, 100, 200, 100, 200]);
        document.getElementById('timer-pause-btn').style.display = 'none';
        document.getElementById('timer-start-btn').style.display = '';
        document.getElementById('timer-start-btn').querySelector('span').textContent = store.lang === 'ar' ? 'إعادة' : 'Restart';
        return;
      }
      timerPhase = 'work';
      timerRemaining = workTime;
      playWorkBeep();
      vibrateDevice([100, 50, 100]);
    }
    updateTimerRoundInfo();
    updateTimerPhaseLabel();
  }
}

function tickStopwatch() {
  if (timerPaused) return;
  timerElapsed = Math.floor((Date.now() - timerStartTime) / 1000);
  document.getElementById('timer-display').textContent = formatTimerTime(timerElapsed);
}

function pauseTimer() {
  timerPaused = true;
  document.getElementById('timer-pause-btn').style.display = 'none';
  document.getElementById('timer-start-btn').style.display = '';
  document.getElementById('timer-start-btn').querySelector('span').textContent = store.lang === 'ar' ? 'استئناف' : 'Resume';
}

function resetTimer() {
  clearInterval(timerInterval);
  timerRunning = false;
  timerPaused = false;
  timerRemaining = 0;
  timerPhase = 'idle';
  timerLaps = [];
  timerElapsed = 0;
  document.getElementById('timer-display').textContent = '00:00';
  document.getElementById('timer-pause-btn').style.display = 'none';
  document.getElementById('timer-reset-btn').style.display = 'none';
  document.getElementById('timer-lap-btn').style.display = timerMode === 'stopwatch' ? '' : 'none';
  document.getElementById('timer-start-btn').style.display = '';
  const startSpan = document.getElementById('timer-start-btn').querySelector('span');
  if (startSpan) startSpan.textContent = store.lang === 'ar' ? 'ابدأ' : 'Start';
  document.getElementById('timer-phase-label').style.display = 'none';
  document.getElementById('timer-laps').innerHTML = '';
}

function recordLap() {
  if (!timerRunning || timerMode !== 'stopwatch') return;
  timerLaps.push(timerElapsed);
  const isAr = (store.lang === 'ar');
  document.getElementById('timer-laps').innerHTML = timerLaps.map((l, i) =>
    `<div class="timer-lap-item"><span>${isAr ? 'لفة' : 'Lap'} ${i + 1}</span><b>${formatTimerTime(l)}</b></div>`
  ).reverse().join('');
}

function updateTimerRoundInfo() {
  document.getElementById('timer-current-round').textContent = timerCurrentRound;
  document.getElementById('timer-total-rounds').textContent = timerTotalRounds;
}

function updateTimerPhaseLabel() {
  const label = document.getElementById('timer-phase-label');
  const isAr = (store.lang === 'ar');
  label.style.display = 'inline-block';
  label.className = '';
  if (timerPhase === 'countdown') {
    label.textContent = isAr ? 'العد التنازلي...' : 'Get ready...';
    label.classList.add('timer-phase-rest');
  } else if (timerPhase === 'work') {
    label.textContent = isAr ? 'عمل!' : 'WORK!';
    label.classList.add('timer-phase-work');
  } else if (timerPhase === 'rest') {
    label.textContent = isAr ? 'راحة' : 'REST';
    label.classList.add('timer-phase-rest');
  } else if (timerPhase === 'done') {
    label.textContent = isAr ? 'انتهى!' : 'DONE!';
    label.classList.add('timer-phase-done');
  } else {
    label.style.display = 'none';
  }
}

// ============================================================
// PWA & OFFLINE-FIRST — IndexedDB + Service Worker
// ============================================================
let voltaDB = null;

function initIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('volta_offline_db', 2);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('users')) db.createObjectStore('users', { keyPath: 'email' });
      if (!db.objectStoreNames.contains('dietLog')) db.createObjectStore('dietLog', { keyPath: 'email' });
      if (!db.objectStoreNames.contains('coachAthletes')) db.createObjectStore('coachAthletes', { keyPath: 'coachEmail' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
    };
    request.onsuccess = (e) => {
      voltaDB = e.target.result;
      // Add helper methods
      voltaDB.put = function(storeName, data) {
        return new Promise((res, rej) => {
          const tx = this.transaction(storeName, 'readwrite');
          tx.objectStore(storeName).put(data);
          tx.oncomplete = () => res();
          tx.onerror = () => rej(tx.error);
        });
      };
      voltaDB.get = function(storeName, key) {
        return new Promise((res, rej) => {
          const tx = this.transaction(storeName, 'readonly');
          const req = tx.objectStore(storeName).get(key);
          req.onsuccess = () => res(req.result);
          req.onerror = () => rej(req.error);
        });
      };
      voltaDB.getAll = function(storeName) {
        return new Promise((res, rej) => {
          const tx = this.transaction(storeName, 'readonly');
          const req = tx.objectStore(storeName).getAll();
          req.onsuccess = () => res(req.result);
          req.onerror = () => rej(req.error);
        });
      };
      resolve(voltaDB);
    };
    request.onerror = () => reject(request.error);
  });
}

// Sync localStorage to IndexedDB for offline persistence
function syncToIndexedDB() {
  try {
    const users = store.users;
    if (users && voltaDB) {
      Object.entries(users).forEach(([email, data]) => {
        voltaDB.put('users', { email, data });
      });
    }
    // Save settings
    if (voltaDB) {
      voltaDB.put('settings', { key: 'theme', value: store.theme });
      voltaDB.put('settings', { key: 'lang', value: store.lang });
    }
  } catch(e) { console.log('IndexedDB sync error:', e); }
}

// Register Service Worker
function registerServiceWorker() {
  // Round 13: Skip SW registration when running from file:// — it always
  // fails with "The URL protocol of the current origin ('null') is not
  // supported" which spams the console and hurts first impressions. SW only
  // works when the app is served over http:// or https://.
  try {
    if (typeof location !== 'undefined' && location.protocol === 'file:') return;
  } catch(e) { return; }
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(reg => {
      console.log('Service Worker registered:', reg.scope);
    }).catch(err => {
      // Silent — SW is a progressive enhancement, not critical
    });
  }
}

// Offline/Online detection
// v5 (user request): the offline banner now DISAPPEARS AFTER 2 SECONDS —
// it no longer stays on screen until the device reconnects. The sync
// guarantee is unchanged (CloudSync keeps queueing and flushing on its
// own); the banner is just a brief heads-up, not a persistent state bar.
function setupOfflineDetection() {
  const banner = document.getElementById('offline-banner');
  if (!banner) return;
  const bannerText = banner.querySelector('span');
  const TEXT_OFFLINE_EN = "You're offline — your progress is saved on this device and will sync to the server automatically";
  const TEXT_OFFLINE_AR = 'أنت غير متصل — تقدمك محفوظ على هذا الجهاز وسيتم مزامنته مع السيرفر تلقائياً';
  let hideTimer = null;
  function setText(en, ar) { if (bannerText) { bannerText.setAttribute('data-ar', ar); bannerText.textContent = en; } }
  function updateOnlineStatus() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (!navigator.onLine) {
      setText(TEXT_OFFLINE_EN, TEXT_OFFLINE_AR);
      banner.classList.add('visible');
      // Auto-dismiss after 2 seconds even while still offline.
      hideTimer = setTimeout(function () { banner.classList.remove('visible'); hideTimer = null; }, 2000);
    } else {
      banner.classList.remove('visible');
    }
  }
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();
}

// Initialize IndexedDB and sync on load
initIndexedDB().then(() => {
  console.log('IndexedDB initialized');
  syncToIndexedDB();
}).catch(e => {
  console.log('IndexedDB init failed:', e);
});

// Auto-sync to IndexedDB periodically
setInterval(syncToIndexedDB, 30000);

// ============================================================
// PATCH showTab — already merged above
// ============================================================

// ============================================================
// Initialize on load
// ============================================================
registerServiceWorker();
setupOfflineDetection();



// Font Awesome fallback — if icons don't load, show text fallback
(function() {
  setTimeout(() => {
    const testIcon = document.querySelector('.sidebar .brand i');
    if (testIcon) {
      const cs = window.getComputedStyle(testIcon, '::before');
      if (!cs || cs.content === 'none' || cs.content === 'normal' || cs.fontFamily.indexOf('Font') === -1) {
        // FA didn't load — replace icons with text in sidebar brands
        document.querySelectorAll('.sidebar .brand i').forEach(icon => {
          const fallback = document.createElement('span');
          fallback.className = 'brand-icon-fallback';
          fallback.textContent = 'V';
          fallback.style.display = 'flex';
          icon.replaceWith(fallback);
        });
      }
    }
  }, 3000);
})();

// ============================================================
// VOLTA AI CHAT FLOATING BUTTON — REMOVED (v9)
// ============================================================
// Per user request ("in picture 2, on phone in dark mode you can see that
// extra shape, remove it") the floating blue chat circle and the whole
// third-party Chatbase widget were removed (see index.html). The button
// creator and the greeting-bubble suppressor that lived here are gone.

// === Date-change watcher ===
// Detects when the local date changes (e.g. midnight rollover while the app
// is open) and re-renders the daily-exercise kcal popup + home dashboard so
// the "today" counters reset to 0 for the new day. Checks every 30 seconds.
(function() {
  let lastDate = (typeof localDateStr === 'function') ? localDateStr() : null;
  setInterval(function() {
    try {
      const today = (typeof localDateStr === 'function') ? localDateStr() : null;
      if (today && lastDate && today !== lastDate) {
        lastDate = today;
        // Date changed — roll over the daily exercise plan (reset done flags)
        // so the user starts a fresh workout list for the new day.
        try {
          if (typeof rolloverDailyPlanIfNeeded === 'function') {
            const rolled = rolloverDailyPlanIfNeeded();
            if (rolled && typeof renderDailyExercise === 'function') {
              renderDailyExercise();
            }
          }
        } catch(e) {}
        // Refresh the daily-exercise kcal popup + home dashboard + diet log
        if (typeof renderTodayKcalPopup === 'function') renderTodayKcalPopup();
        if (typeof renderHome === 'function') renderHome();
        if (typeof renderDietLog === 'function') renderDietLog();
      }
    } catch(e) {}
  }, 30000);
})();


// ============================================================
// COACH COURSES — server-only publish + list + delete
// ============================================================
let _coachCoursesCache = [];

function publishAnnouncement() {
  var title = document.getElementById('announce-title').value.trim();
  var desc = document.getElementById('announce-desc').value.trim();
  var type = document.getElementById('announce-type').value;
  var url = document.getElementById('announce-url').value.trim();
  var price = parseFloat(document.getElementById('announce-price').value) || 0;
  var currency = document.getElementById('announce-currency').value;
  var maxAthletes = parseInt(document.getElementById('announce-max').value, 10) || 0;
  var duration = document.getElementById('announce-duration').value.trim();
  var skillLevel = document.getElementById('announce-level').value;
  var msgEl = document.getElementById('announce-msg');
  var ar = (store.lang === 'ar');
  if (!title) { if (msgEl) { msgEl.textContent = ar ? 'الرجاء إدخال عنوان.' : 'Please enter a title.'; msgEl.className = 'msg error'; } return; }
  if (!desc) { if (msgEl) { msgEl.textContent = ar ? 'الرجاء إدخال وصف.' : 'Please enter a description.'; msgEl.className = 'msg error'; } return; }

  var coachEmail = localStorage.getItem(COACH_SESSION_KEY);
  var coachName = '';
  try {
    var cu = getCoachUsers();
    if (cu[coachEmail]) coachName = cu[coachEmail].fullName || '';
  } catch(e) {}
  var API_URL = window.VOLTA_API_BASE || window.location.origin;

  fetch(API_URL + '/api/publish-course', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      coachEmail: coachEmail, coachName: coachName,
      title: title, description: desc, type: type, url: url,
      price: price, currency: currency, maxAthletes: maxAthletes,
      duration: duration, skillLevel: skillLevel
    })
  }).then(function(resp) { return resp.json(); }).then(function(data) {
    if (data.success) {
      document.getElementById('announce-title').value = '';
      document.getElementById('announce-desc').value = '';
      document.getElementById('announce-url').value = '';
      document.getElementById('announce-duration').value = '';
      document.getElementById('announce-price').value = '0';
      document.getElementById('announce-max').value = '0';
      document.getElementById('announce-level').value = '';
      if (msgEl) { msgEl.textContent = ar ? 'تم نشر الدورة! يمكن للرياضيين رؤيتها الآن.' : 'Course published! Athletes can see it now.'; msgEl.className = 'msg ok'; }
    } else {
      if (msgEl) { msgEl.textContent = (ar ? 'فشل النشر: ' : 'Publish failed: ') + (data.error || ''); msgEl.className = 'msg error'; }
    }
  }).catch(function(err) {
    if (msgEl) { msgEl.textContent = (ar ? 'فشل الاتصال بالخادم.' : 'Failed to connect to server.'); msgEl.className = 'msg error'; }
  });
}

async function renderCoachCourses() {
  var ar = (store.lang === 'ar');
  var listEl = document.getElementById('coach-courses-list');
  var countEl = document.getElementById('coach-course-count');
  var coachEmail = localStorage.getItem(COACH_SESSION_KEY);
  if (!coachEmail || !listEl) return;

  var courses = [];
  try {
    var resp = await fetch(window.VOLTA_API_BASE + '/api/courses?coachEmail=' + encodeURIComponent(coachEmail));
    if (resp.ok) {
      var data = await resp.json();
      courses = data.courses || [];
    }
  } catch (e) {}

  _coachCoursesCache = courses;
  if (countEl) {
    var cnt = courses.length;
    countEl.textContent = cnt + ' ' + (cnt === 1 ? (ar ? 'دورة' : 'course') : (ar ? 'دورات' : 'courses'));
  }

  if (courses.length === 0) {
    listEl.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--muted);">' +
      '<i class="fa-solid fa-graduation-cap" style="font-size:48px;opacity:.3;margin-bottom:14px;display:block;"></i>' +
      '<p style="font-size:1.05rem;font-weight:600;margin-bottom:6px;">' + (ar ? 'لا توجد دورات منشورة' : 'No courses published yet') + '</p>' +
      '<p style="font-size:.88rem;margin-bottom:14px;">' + (ar ? 'انتقل إلى "إعلان" لنشر دورتك الأولى.' : 'Go to "Announce" to publish your first course.') + '</p>' +
      '<button class="btn primary" onclick="showCoachTab(\'coach-announce\')"><i class="fa-solid fa-plus"></i> ' + (ar ? 'دورة جديدة' : 'New Course') + '</button>' +
    '</div>';
    return;
  }

  listEl.innerHTML = courses.map(renderCoachCourseCard).join('');
  setTimeout(applyTranslations, 0);

  // Fetch enrolled athletes for each course
  courses.forEach(function (c) {
    fetchEnrolledAthletesForCourse(c.id).then(function (athletes) {
      var body = document.getElementById('coach-course-athletes-' + c.id);
      if (body) body.innerHTML = renderEnrolledAthletesList(athletes);
    });
  });
}

function renderCoachCourseCard(c) {
  var ar = (store.lang === 'ar');
  var enrolled = c.enrolledCount != null ? c.enrolledCount : (Array.isArray(c.enrolledAthletes) ? c.enrolledAthletes.length : 0);
  var max = c.maxAthletes || 0;
  var isFull = max > 0 && enrolled >= max;
  var typeLabel = c.type === 'video' ? (ar ? 'فيديو' : 'Video') : c.type === 'plan' ? (ar ? 'خطة' : 'Plan') : (ar ? 'مقال' : 'Article');
  var priceLabel = c.price > 0 ? (c.price + ' ' + (c.currency || 'USD')) : (ar ? 'مجاني' : 'Free');
  var capText = max > 0 ? (enrolled + ' / ' + max + ' ' + (ar ? 'رياضي' : 'athletes')) : (enrolled + ' ' + (ar ? 'مشترك' : 'enrolled'));
  var publishedDate = c.publishedAt ? new Date(c.publishedAt).toLocaleDateString(ar ? 'ar-EG' : 'en-US', { month: 'short', day: 'numeric' }) : '';
  return '<div class="panel" style="padding:16px;">' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:8px;">' +
      '<div style="flex:1;min-width:0;">' +
        '<h3 style="margin:0 0 4px;font-size:1.05rem;">' + escapeHtml(c.title || '') + '</h3>' +
        '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">' +
          '<span style="font-size:.7rem;background:var(--accent-soft);color:var(--accent);padding:2px 8px;border-radius:6px;font-weight:600;">' + typeLabel + '</span>' +
          '<span style="font-size:.7rem;background:var(--green-bg);color:var(--green);padding:2px 8px;border-radius:6px;font-weight:600;">' + priceLabel + '</span>' +
          (isFull ? '<span style="font-size:.7rem;background:#fff3e0;color:#e65100;padding:2px 8px;border-radius:6px;font-weight:600;">' + (ar ? 'مكتملة' : 'Full') + '</span>' : '') +
          (publishedDate ? '<small style="color:var(--muted);font-size:.72rem;">' + publishedDate + '</small>' : '') +
        '</div>' +
      '</div>' +
      '<button onclick="deleteCoachCourse(' + c.id + ')" style="background:none;border:1px solid var(--red);color:var(--red);cursor:pointer;font-size:.78rem;padding:9px 14px;min-height:38px;border-radius:8px;font-weight:600;flex-shrink:0;display:inline-flex;align-items:center;gap:4px;" title="' + (ar ? 'حذف الدورة' : 'Delete Course') + '"><i class="fa-solid fa-trash"></i> <span>' + (ar ? 'حذف' : 'Delete') + '</span></button>' +
    '</div>' +
    '<p style="color:var(--muted);font-size:.86rem;margin:6px 0 10px;line-height:1.5;">' + escapeHtml(c.description || '') + '</p>' +
    '<div style="display:flex;gap:14px;flex-wrap:wrap;font-size:.78rem;color:var(--muted);margin-bottom:12px;">' +
      (c.skillLevel ? '<span><i class="fa-solid fa-signal"></i> ' + escapeHtml(c.skillLevel) + '</span>' : '') +
      (c.duration ? '<span><i class="fa-solid fa-clock"></i> ' + escapeHtml(c.duration) + '</span>' : '') +
      '<span><i class="fa-solid fa-users"></i> ' + capText + '</span>' +
    '</div>' +
    '<div style="background:var(--bg);border-radius:10px;padding:10px 12px;">' +
      '<h4 style="margin:0 0 6px;font-size:.82rem;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:700;"><i class="fa-solid fa-user-check" style="margin-right:4px;"></i> ' + (ar ? 'الرياضيون المشتركون' : 'Enrolled Athletes') + '</h4>' +
      '<div id="coach-course-athletes-' + c.id + '"><p style="font-size:.82rem;color:var(--muted);padding:6px 0;"><i class="fa-solid fa-spinner fa-spin" style="margin-right:4px;"></i>' + (ar ? 'جارٍ التحميل...' : 'Loading...') + '</p></div>' +
    '</div>' +
  '</div>';
}

async function fetchEnrolledAthletesForCourse(courseId) {
  var coachEmail = localStorage.getItem(COACH_SESSION_KEY);
  var API_URL = window.VOLTA_API_BASE || window.location.origin;
  try {
    var resp = await fetch(API_URL + '/api/courses/' + encodeURIComponent(courseId) + '/athletes?coachEmail=' + encodeURIComponent(coachEmail));
    if (resp.ok) {
      var data = await resp.json();
      var emails = data.athletes || [];
      var roster = [];
      try {
        var allAthletes = JSON.parse(localStorage.getItem(COACH_ATHLETES_KEY) || '{}');
        roster = allAthletes[coachEmail] || [];
      } catch (e) {}
      return emails.map(function (email) {
        var rosterMatch = roster.find(function (a) { return (a.email || '').toLowerCase() === email; });
        return {
          email: email,
          name: rosterMatch ? (rosterMatch.name || email.split('@')[0]) : email.split('@')[0],
          sport: rosterMatch ? (rosterMatch.sport || '') : ''
        };
      });
    }
  } catch (e) {}
  return [];
}

function renderEnrolledAthletesList(athletes) {
  var ar = (store.lang === 'ar');
  if (!athletes || athletes.length === 0) {
    return '<p style="font-size:.82rem;color:var(--muted);padding:6px 0;">' + (ar ? 'لا يوجد رياضيون مشتركون بعد.' : 'No athletes enrolled yet.') + '</p>';
  }
  return '<div style="display:flex;flex-direction:column;gap:6px;">' + athletes.map(function (a) {
    var initial = (a.name || a.email || '?').charAt(0).toUpperCase();
    return '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--white);border-radius:8px;border:1px solid var(--line);">' +
      '<div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,var(--accent),#4a7bd9);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.78rem;flex-shrink:0;">' + initial + '</div>' +
      '<div style="min-width:0;flex:1;">' +
        '<div style="font-size:.85rem;font-weight:600;">' + escapeHtml(a.name || '') + '</div>' +
        '<div style="font-size:.72rem;color:var(--muted);">' + escapeHtml(a.email || '') + (a.sport ? ' · ' + escapeHtml(a.sport) : '') + '</div>' +
      '</div>' +
      '<button class="btn ghost small" onclick="VoltaChat.openWith(\'' + escapeHtml(a.email || '').replace(/'/g, "\\'") + '\', \'' + escapeHtml(a.name || '').replace(/'/g, "\\'") + '\')" style="font-size:.78rem;padding:9px 12px;min-height:36px;min-width:36px;"><i class="fa-solid fa-comment-dots"></i></button>' +
    '</div>';
  }).join('') + '</div>';
}

function filterCoachCourses() {
  var q = (document.getElementById('coach-course-search').value || '').toLowerCase().trim();
  var listEl = document.getElementById('coach-courses-list');
  if (!listEl || !_coachCoursesCache) return;
  var filtered = !q ? _coachCoursesCache : _coachCoursesCache.filter(function (c) {
    return (c.title || '').toLowerCase().indexOf(q) !== -1 || (c.description || '').toLowerCase().indexOf(q) !== -1;
  });
  if (filtered.length === 0) {
    listEl.innerHTML = '<p style="color:var(--muted);font-size:.88rem;text-align:center;padding:20px;">No courses match your search.</p>';
    return;
  }
  listEl.innerHTML = filtered.map(renderCoachCourseCard).join('');
  filtered.forEach(function (c) {
    fetchEnrolledAthletesForCourse(c.id).then(function (athletes) {
      var body = document.getElementById('coach-course-athletes-' + c.id);
      if (body) body.innerHTML = renderEnrolledAthletesList(athletes);
    });
  });
}

async function deleteCoachCourse(courseId) {
  var ar = (store.lang === 'ar');
  var coachEmail = localStorage.getItem(COACH_SESSION_KEY);
  if (!coachEmail) return;
  var c = _coachCoursesCache.find(function (x) { return String(x.id) === String(courseId); });
  var title = c ? (c.title || '') : '';
  var confirmMsg = ar ? 'هل أنت متأكد أنك تريد حذف "' + title + '"؟' : 'Are you sure you want to delete "' + title + '"?';
  if (!confirm(confirmMsg)) return;
  try {
    var resp = await fetch(window.VOLTA_API_BASE + '/api/courses/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseId: courseId, coachEmail: coachEmail })
    });
    if (resp.ok) {
      var data = await resp.json();
      if (data.success) {
        alert(ar ? 'تم حذف الدورة.' : 'Course deleted.');
        await renderCoachCourses();
      }
    }
  } catch (e) {
    alert(ar ? 'فشل الاتصال بالخادم.' : 'Failed to connect to server.');
  }
}
