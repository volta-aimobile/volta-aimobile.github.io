/**
 * Volta CloudSync — cross-device account sync (v4, Vercel + Firebase + textdb)
 * ====================================================================
 * TRANSPORTS (all-write, read in priority order):
 *   1. VERCEL VAULT — the user's own backend (the repo's api/ folder,
 *      deployed on Vercel at window.VOLTA_API_BASE). Stores the FULL
 *      account record — login details included — under the same one-way
 *      hashed keys. Auto-probed via /api/health; if the api/ functions
 *      are not deployed yet the transport 404s fast, backs off and is
 *      skipped silently — the moment the user pushes the repo, it
 *      activates itself with zero configuration.
 *   2. FIRESTORE (the user's own Firebase project, window.VOLTA_FIREBASE_CONFIG):
 *        • Google accounts  → users/<uid>            (owner-bound by rules)
 *        • ALL accounts     → volta_users/<emailKey> (deterministic email key,
 *                             same hash as the textdb keys)
 *   3. textdb.dev (free, keyless, CORS-open, deterministic keys):
 *        • User record : https://textdb.dev/api/data/volta-u-v1-<emailHash>
 *        • Diet log    : https://textdb.dev/api/data/volta-d-v1-<emailHash>
 *        • <emailHash> = SHA-256("volta_user:" + email)[0..40] (cloudKeyForEmail)
 *
 * Writes go to BOTH transports (best-effort — one failing never blocks the
 * other). Reads prefer Firestore, fall back to textdb. Failures are queued
 * and retried when connectivity returns. The Settings tab shows a live
 * Cloud Backup card (per-transport status + last sync time).
 */
(function () {
  'use strict';

  // ─── Config ────────────────────────────────────────────────────────────
  var TEXTDB_BASE = 'https://textdb.dev/api/data/';
  var USER_SYNC_DEBOUNCE_MS = 1200;
  var DIET_LOG_SYNC_DEBOUNCE_MS = 800;
  var DIET_LOG_MAX_ENTRIES = 250;

  var _userSyncTimer = null;
  var _dietSyncTimer = null;
  var _retryQueue = [];          // [{kind:'user'|'diet', email}]
  var _draining = false;
  var _flushing = false;

  var _lastSyncStatus = {
    lastSyncedAt: 0,
    hasUserData: false,
    hasExtraData: false,
    kv: 'unknown',
    online: (typeof navigator !== 'undefined') ? navigator.onLine : true,
    // Per-transport health for the Settings → Cloud Backup card:
    //   'ok' | 'fail' | 'skipped'
    transports: { textdb: 'skipped', firebase: 'skipped', vercel: 'skipped' },
    fsHint: '',           // human-readable Firebase fix-it hint when it fails
    vcHint: ''            // human-readable Vercel fix-it hint when it fails
  };

  // ─── Helpers ───────────────────────────────────────────────────────────
  function _isOnline() {
    return (typeof navigator !== 'undefined') ? navigator.onLine : true;
  }

  // Same hash the app has always used for cloud keys (volta.js
  // cloudKeyForEmail). Deterministic across http/https/file contexts.
  function _fnvFallback(email) {
    var s = 'volta_user:' + String(email || '').trim().toLowerCase();
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return 'fnv' + h.toString(16);
  }
  async function _emailKey(email) {
    try {
      if (typeof cloudKeyForEmail === 'function') {
        return await cloudKeyForEmail(email);
      }
    } catch (e) {}
    return _fnvFallback(email);
  }

  function _userDocId(hash) { return 'volta-u-v1-' + hash; }
  function _dietDocId(hash) { return 'volta-d-v1-' + hash; }

  // Firestore vault — the user's own Firebase project.
  //  • Google accounts mirror into users/<uid> (rules bind doc to owner).
  //  • ALL accounts (incl. email) mirror into volta_users/<emailKey> —
  //    deterministic, so any device finds the record without signing in.
  //  • textdb.dev stays as the universal fallback transport.
  function _fsCtx() {
    try {
      if (typeof window === 'undefined') return null;
      if (!window.VoltaGoogle || !window.VoltaGoogle.isConfigured()) return null;
      var uid = window.VoltaGoogle.fsUid();
      if (!uid) return null;
      var db = window.VoltaGoogle.fs();
      if (!db) return null;
      return { uid: uid, db: db };
    } catch (e) { return null; }
  }

  // Firestore instance — loads the SDK on demand (email accounts don't sign
  // in, so the SDK may never have warmed). Cached by volta-google.js.
  async function _fsDb() {
    try {
      if (typeof window === 'undefined') return null;
      if (!window.VoltaGoogle || !window.VoltaGoogle.isConfigured()) return null;
      if (window.VoltaGoogle.fs()) return window.VoltaGoogle.fs();
      await _fsRace(window.VoltaGoogle.ensureSdk(), FS_SDK_MS, 'Firestore SDK load');
      return window.VoltaGoogle.fs();
    } catch (e) { return null; }
  }

  // Record per-transport health for the Cloud Backup card.
  function _fsTrack(kind, ok, err) {
    try {
      if (!_lastSyncStatus.transports) _lastSyncStatus.transports = { textdb: 'skipped', firebase: 'skipped', vercel: 'skipped' };
      if (kind) _lastSyncStatus.transports[kind] = ok ? 'ok' : 'fail';
      if (!ok && err) {
        var msg = String((err && err.message) || err || '');
        if (kind === 'vercel') {
          _lastSyncStatus.vcHint = /deploy|404/i.test(msg)
            ? 'Vercel vault waiting — push the repo (api/ folder is inside) and it activates automatically. See VERCEL-SETUP.txt.'
            : 'Vercel vault unreachable — will retry automatically.';
        } else if (/timed out/i.test(msg)) {
          // Firestore SDK writes hang when the database does not exist yet.
          _lastSyncStatus.fsHint = 'Firebase vault inactive — create the Firestore database in your Firebase console (see UPGRADE-NOTES.txt step 1).';
        } else if (/has not been used|not been enabled|not found/i.test(msg)) {
          _lastSyncStatus.fsHint = 'Firebase vault inactive — create the Firestore database in your Firebase console (see UPGRADE-NOTES.txt step 1).';
        } else if (/permission/i.test(msg)) {
          _lastSyncStatus.fsHint = 'Firestore rules deny access — paste the rules from UPGRADE-NOTES.txt step 2.';
        } else if (/offline|network/i.test(msg)) {
          _lastSyncStatus.fsHint = 'Firebase unreachable — will retry automatically.';
        } else {
          _lastSyncStatus.fsHint = 'Firebase: ' + msg.slice(0, 110);
        }
      }
      if (ok) {
        if (kind === 'vercel') _lastSyncStatus.vcHint = '';
        else _lastSyncStatus.fsHint = '';
      }
    } catch (e) {}
  }

  // Firestore rejects `undefined` values — JSON round-trip strips them.
  function _fsSanitize(obj) {
    try { return JSON.parse(JSON.stringify(obj)); } catch (e) { return null; }
  }

  // Fail-fast wrapper: a Firestore op against a missing/locked database can
  // HANG for a long time (the SDK retries internally). Every Firestore call
  // is raced against a timeout so the sync pipeline NEVER stalls — on
  // timeout we record the failure, show the fix-it hint, and textdb.dev
  // (which always runs anyway) remains the guaranteed transport.
  function _withTimeout(p, ms) {
    return new Promise(function (resolve) {
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; resolve(undefined); } }, ms);
      Promise.resolve(p).then(
        function (v) { if (!done) { done = true; clearTimeout(t); resolve(v); } },
        function (e) { if (!done) { done = true; clearTimeout(t); resolve(e); } }
      );
    });
  }
  // Resolves with the op's value, throws on error/timeout (so try/catch works).
  async function _fsRace(p, ms, tag) {
    var r = await _withTimeout(p, ms);
    if (r === undefined) throw new Error(tag + ' timed out after ' + ms + 'ms');
    if (r instanceof Error) throw r;
    return r;
  }

  var FS_WRITE_MS = 6000;   // max wait per .set()
  var FS_READ_MS  = 3500;   // max wait per .get() — keeps login restore snappy
  var FS_SDK_MS   = 8000;   // max wait for the CDN SDK to load

  // Write the user record to Firestore (uid doc for Google + email doc for
  // everyone). Returns true when at least one document landed.
  async function _fsPutUser(data, emailKey) {
    var db = await _fsDb();
    if (!db) { _fsTrack('firebase', false, 'SDK unavailable'); return false; }
    var clean = _fsSanitize(data); if (!clean) return false;
    var anyOk = false, lastErr = null;
    try {
      var ctx = _fsCtx();
      if (ctx) { await _fsRace(ctx.db.collection('users').doc(ctx.uid).set(clean, { merge: true }), FS_WRITE_MS, 'uid write'); anyOk = true; }
    } catch (e) { lastErr = e; }
    try {
      if (emailKey) {
        await _fsRace(db.collection('volta_users').doc('volta-u-v1-' + emailKey).set(clean, { merge: true }), FS_WRITE_MS, 'email write');
        anyOk = true;
      }
    } catch (e) { lastErr = e; }
    _fsTrack('firebase', anyOk, lastErr || (anyOk ? null : 'no document written'));
    return anyOk;
  }

  async function _fsPutDiet(entries, emailKey) {
    var db = await _fsDb();
    if (!db) { _fsTrack('firebase', false, 'SDK unavailable'); return false; }
    var clean = _fsSanitize(entries); if (!clean) return false;
    var anyOk = false, lastErr = null;
    try {
      var ctx = _fsCtx();
      if (ctx) { await _fsRace(ctx.db.collection('users').doc(ctx.uid).set({ dietLog: clean, dietUpdatedAt: Date.now() }, { merge: true }), FS_WRITE_MS, 'uid diet write'); anyOk = true; }
    } catch (e) { lastErr = e; }
    try {
      if (emailKey) {
        await _fsRace(db.collection('volta_users').doc('volta-d-v1-' + emailKey).set({ log: clean, updatedAt: Date.now() }, { merge: true }), FS_WRITE_MS, 'email diet write');
        anyOk = true;
      }
    } catch (e) { lastErr = e; }
    _fsTrack('firebase', anyOk, lastErr || (anyOk ? null : 'no document written'));
    return anyOk;
  }

  // Returns { data, extra } — or null (= "no Firestore copy, try textdb").
  async function _fsGetUser(emailKey) {
    var db = await _fsDb();
    if (!db) return null;
    // 1) Owner-bound uid document (Google accounts).
    try {
      var ctx = _fsCtx();
      if (ctx) {
        var snap = await _fsRace(ctx.db.collection('users').doc(ctx.uid).get(), FS_READ_MS, 'uid read');
        if (snap && snap.exists) {
          var d = snap.data();
          if (d && typeof d === 'object') {
            var extra = (Array.isArray(d.dietLog) && d.dietLog.length) ? { dietLog: d.dietLog } : null;
            return { data: d, extra: extra };
          }
        }
      }
    } catch (e) {}
    // 2) Deterministic email document (all accounts).
    try {
      if (!emailKey) return null;
      var snap2 = await _fsRace(db.collection('volta_users').doc('volta-u-v1-' + emailKey).get(), FS_READ_MS, 'email read');
      if (snap2 && snap2.exists) {
        var d2 = snap2.data();
        if (d2 && typeof d2 === 'object') {
          var extra2 = (Array.isArray(d2.dietLog) && d2.dietLog.length) ? { dietLog: d2.dietLog } : null;
          return { data: d2, extra: extra2 };
        }
      }
    } catch (e) {}
    return null;
  }

  async function _fsGetDiet(emailKey) {
    var db = await _fsDb();
    if (!db) return null;
    try {
      var ctx = _fsCtx();
      if (ctx) {
        var snap = await _fsRace(ctx.db.collection('users').doc(ctx.uid).get(), FS_READ_MS, 'uid diet read');
        if (snap && snap.exists) {
          var d = snap.data();
          if (d && Array.isArray(d.dietLog) && d.dietLog.length) return d.dietLog;
        }
      }
    } catch (e) {}
    try {
      if (!emailKey) return null;
      var snap2 = await _fsRace(db.collection('volta_users').doc('volta-d-v1-' + emailKey).get(), FS_READ_MS, 'email diet read');
      if (snap2 && snap2.exists) {
        var d2 = snap2.data();
        if (d2 && Array.isArray(d2.log) && d2.log.length) return d2.log;
      }
    } catch (e) {}
    return null;
  }

  // ─── Vercel vault — the user's own backend (repo api/ folder) ──────────
  // Activates AUTOMATICALLY the moment the api/ functions are deployed at
  // window.VOLTA_API_BASE (default: volta-aimobile-github-io.vercel.app).
  // Until then every call 404s fast → short backoff → the other transports
  // carry the sync. No console noise, no user action, no config.
  function _vcBase() {
    try {
      if (typeof window === 'undefined') return '';
      var b = (window.VOLTA_SYNC_API || window.VOLTA_API_BASE || '') + '';
      return b.replace(/\/+$/, '');
    } catch (e) { return ''; }
  }
  var _vc = { ok: null, failUntil: 0, probing: null };
  var VC_CALL_MS = 4500;  // max wait per GET (keeps login restore snappy)
  var VC_PUT_MS  = 6000;  // max wait per POST

  function _vcEnabled() {
    if (!_vcBase()) return false;
    return Date.now() >= _vc.failUntil;
  }

  // Generic fetch-with-timeout — fail-fast, the sync pipeline never stalls.
  async function _fetchT(url, opts, ms) {
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var o = opts || {}; var timer = null;
    if (ctrl) { o.signal = ctrl.signal; timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, ms); }
    try { return await fetch(url, o); }
    finally { if (timer) clearTimeout(timer); }
  }

  // Health probe (deduped, cached). 404/DNS-fail → 5-minute backoff so the
  // not-deployed-yet state costs nothing; success → transport goes live.
  // force=true re-probes even when a healthy result is cached.
  async function _vcProbe(force) {
    var b = _vcBase();
    if (!b) return false;
    if (force) { _vc.ok = null; _vc.failUntil = 0; }
    if (_vc.ok === true) return true;
    if (_vc.probing) return _vc.probing;
    _vc.probing = (async function () {
      try {
        var r = await _fetchT(b + '/api/health', { cache: 'no-store' }, VC_CALL_MS);
        var j = null;
        try { j = await r.json(); } catch (e) {}
        _vc.ok = !!(r.ok && j && j.ok === true);
        if (!_vc.ok) _vc.failUntil = Date.now() + 5 * 60 * 1000;
        else _vc.failUntil = 0;
      } catch (e) {
        _vc.ok = false;
        _vc.failUntil = Date.now() + 5 * 60 * 1000;
      }
      _vc.probing = null;
      _fsTrack('vercel', _vc.ok, _vc.ok ? null : 'API not deployed yet (404) — see VERCEL-SETUP.txt');
      _notifySyncStatusListeners();
      return _vc.ok;
    })();
    return _vc.probing;
  }

  // PUT one document (user or diet) to the vault. 404 → 60s backoff.
  // Offline-guarded — pushing while offline only arms pointless backoffs.
  async function _vcPut(key, obj) {
    if (!_isOnline()) return false;
    if (!_vcEnabled()) return false;
    try {
      var r = await _fetchT(_vcBase() + '/api/sync-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key, data: obj })
      }, VC_PUT_MS);
      var j = null;
      try { j = await r.json(); } catch (e) {}
      var ok = !!(r.ok && j && j.ok === true);
      if (ok) { _vc.ok = true; _vc.failUntil = 0; _fsTrack('vercel', true, null); }
      else {
        _vc.failUntil = Date.now() + 60 * 1000;
        _fsTrack('vercel', false, 'HTTP ' + r.status + (r.status === 404 ? ' — api/ not deployed yet (VERCEL-SETUP.txt)' : ''));
      }
      return ok;
    } catch (e) {
      _vc.failUntil = Date.now() + 60 * 1000;
      _fsTrack('vercel', false, e);
      return false;
    }
  }

  async function _vcGet(key) {
    if (!_vcEnabled()) return null;
    try {
      var r = await _fetchT(_vcBase() + '/api/sync-user?key=' + encodeURIComponent(key), { cache: 'no-store' }, VC_CALL_MS);
      if (!r.ok) return null;
      var j = null;
      try { j = await r.json(); } catch (e) { return null; }
      if (j && j.ok === true && j.found === true && j.data && typeof j.data === 'object') return j.data;
      return null;
    } catch (e) { return null; }
  }

  async function _vcPutUser(data, emailKey) {
    if (!emailKey) return false;
    return _vcPut(_userDocId(emailKey), data);
  }

  async function _vcPutDiet(entries, emailKey) {
    if (!emailKey) return false;
    return _vcPut(_dietDocId(emailKey), { log: entries, updatedAt: Date.now() });
  }

  async function _vcGetDiet(emailKey) {
    if (!_vcEnabled() || !emailKey) return null;
    try {
      var r = await _fetchT(_vcBase() + '/api/sync-diet?key=' + encodeURIComponent(_dietDocId(emailKey)), { cache: 'no-store' }, VC_CALL_MS);
      if (!r.ok) return null;
      var j = null;
      try { j = await r.json(); } catch (e) { return null; }
      if (j && j.ok === true && Array.isArray(j.log) && j.log.length) return j.log;
      return null;
    } catch (e) { return null; }
  }

  // GET one document. Returns parsed object, or null when missing/error.
  // Round 7: timeout-guarded — a hanging textdb response used to stall the
  // whole sync pipeline (flushPending latched). Fail fast instead.
  async function _getDoc(id) {
    try {
      var resp = await _fetchT(TEXTDB_BASE + id, { cache: 'no-store' }, 5000);
      if (!resp || !resp.ok) return null;
      var text = await resp.text();
      if (!text || !text.trim()) return null;
      return JSON.parse(text);
    } catch (e) { return null; }
  }

  // GET with one delayed retry — textdb.dev occasionally serves an empty
  // body for a document written seconds earlier (write-propagation lag).
  // A single 1.6s retry masks that window without slowing real misses much.
  async function _getDocRetry(id) {
    var first = await _getDoc(id);
    if (first) return first;
    await new Promise(function (r) { setTimeout(r, 1600); });
    return _getDoc(id);
  }

  // POST (replace) one document. Returns true on success.
  // Also records textdb transport health for the Cloud Backup card.
  // Offline-guarded: never even attempt a write while navigator says we are
  // offline — the dirty marker / retry queue owns that case.
  async function _putDoc(id, obj) {
    if (!_isOnline()) return false;
    try {
      var resp = await _fetchT(TEXTDB_BASE + id, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(obj)
      }, 6000);
      _fsTrack('textdb', !!resp && resp.ok, (!resp || resp.ok) ? null : ('HTTP ' + resp.status));
      return !!resp && resp.ok;
    } catch (e) {
      _fsTrack('textdb', false, e);
      return false;
    }
  }

  // VERIFIED write — textdb.dev sometimes answers 200 yet silently drops the
  // write (observed in QA: POST 200 → GET empty even minutes later). Save
  // durability matters here, so every write is read back; if the document
  // didn't land, it is re-posted once and verified again. Still-missing →
  // returns false so the retry queue keeps working on it (45s drain loop).
  async function _putDocVerified(id, obj) {
    var ok = await _putDoc(id, obj);
    if (!ok) {
      await new Promise(function (r) { setTimeout(r, 1200); });
      ok = await _putDoc(id, obj);
      if (!ok) return false;
    }
    var back = await _getDoc(id);
    if (back) return true;                       // landed + readable ✓
    await new Promise(function (r) { setTimeout(r, 1600); });
    back = await _getDoc(id);
    if (back) return true;                       // late propagation ✓
    ok = await _putDoc(id, obj);                 // one re-post
    if (!ok) return false;
    back = await _getDoc(id);
    return !!back;
  }

  function _stamp(status) {
    try { _lastSyncStatus.lastSyncedAt = Date.now(); } catch (e) {}
    if (status === 'user') _lastSyncStatus.hasUserData = true;
    if (status === 'diet') _lastSyncStatus.hasExtraData = true;
    _lastSyncStatus.kv = 'connected';
    _lastSyncStatus.online = true;
    // The dirty marker for this kind is now clean on the server side.
    try {
      var email = (typeof store !== 'undefined' && store.session) ? store.session : null;
      if (email) _clearDirty(email, status);
    } catch (e) {}
    _notifySyncStatusListeners();
  }

  // ─── Retry queue (drained on `online` / focus) ─────────────────────────
  // Offline enqueues ALSO stamp the persistent dirty marker, so the pending
  // change survives even a full app restart (see flushPending below).
  function _enqueue(kind, email) {
    try { _markDirty(email, kind); } catch (e) {}
    for (var i = 0; i < _retryQueue.length; i++) {
      if (_retryQueue[i].kind === kind && _retryQueue[i].email === email) {
        _retryQueue[i].at = Date.now();
        return;
      }
    }
    _retryQueue.push({ kind: kind, email: email, at: Date.now() });
  }

  async function _drainQueue() {
    if (_draining || !_retryQueue.length || !_isOnline()) return;
    _draining = true;
    var items = _retryQueue.splice(0, _retryQueue.length);
    try {
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        try {
          if (it.kind === 'user') {
            var u = _localUser(it.email);
            if (u) await forceSyncUserToCloud(it.email, u);
          } else if (it.kind === 'diet') {
            var log = _localDiet(it.email);
            if (log) await syncDietLogToCloud(it.email, log);
          }
        } catch (e) {}
      }
    } finally {
      _draining = false;
    }
  }

  function _localUser(email) {
    try { return store.users[email] || null; } catch (e) { return null; }
  }
  function _localDiet(email) {
    try {
      var raw = localStorage.getItem('volta_diet_log_' + email);
      var arr = JSON.parse(raw || '[]');
      return Array.isArray(arr) ? arr : null;
    } catch (e) { return null; }
  }

  // ─── Persistent dirty marker (survives reload / app close) ─────────────
  // The in-memory retry queue dies with the tab. If the user makes changes
  // offline and closes the app BEFORE connectivity returns, the marker below
  // guarantees the next app open (or the next `online` event) force-pushes
  // the full local state to the server. Stored per-account in localStorage:
  //   volta_dirty_<email> = { user: 0|1, diet: 0|1, at: <timestamp> }
  function _dirtyKey(email) { return 'volta_dirty_' + String(email || '').toLowerCase(); }
  function _readDirty(email) {
    try {
      var raw = localStorage.getItem(_dirtyKey(email));
      var o = raw ? JSON.parse(raw) : null;
      return (o && typeof o === 'object') ? { user: !!o.user, diet: !!o.diet, at: o.at || 0 } : { user: false, diet: false, at: 0 };
    } catch (e) { return { user: false, diet: false, at: 0 }; }
  }
  function _writeDirty(email, st) {
    try {
      if (!st.user && !st.diet) localStorage.removeItem(_dirtyKey(email));
      else localStorage.setItem(_dirtyKey(email), JSON.stringify(st));
    } catch (e) {}
  }
  function _markDirty(email, kind) {
    try {
      var st = _readDirty(email);
      if (kind === 'user') st.user = true; else if (kind === 'diet') st.diet = true;
      st.at = Date.now();
      _writeDirty(email, st);
    } catch (e) {}
  }
  function _clearDirty(email, kind) {
    try {
      var st = _readDirty(email);
      if (kind === 'user') st.user = false; else if (kind === 'diet') st.diet = false;
      _writeDirty(email, st);
    } catch (e) {}
  }
  // True when ANY account has pending unsynced work (heartbeat / boot check).
  function _hasDirty() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('volta_dirty_') === 0) {
          var o = null;
          try { o = JSON.parse(localStorage.getItem(k)); } catch (e) {}
          if (o && (o.user || o.diet)) return true;
        }
      }
    } catch (e) {}
    return false;
  }

  // ─── Public: force-push every dirty piece of the account ───────────────
  // Called on app entry (volta.js enterApp), on the `online` event and by a
  // periodic heartbeat. Guarantees the server catches up with everything the
  // user did while offline — even if the app was fully closed in between
  // (which the in-memory retry queue alone cannot cover).
  // Hard 30s watchdog: whatever happens inside (a hung fetch, a stalled
  // transport), _flushing is ALWAYS released so future flushes can run.
  async function flushPending(email) {
    if (!email) email = (typeof store !== 'undefined' && store.session) ? store.session : null;
    if (!email) return { userSynced: false, dietSynced: false, pending: 0 };
    var st = _readDirty(email);
    // Also honour in-memory queue membership (offline enqueues).
    for (var q = 0; q < _retryQueue.length; q++) {
      if (_retryQueue[q].email === email) {
        if (_retryQueue[q].kind === 'user') st.user = true;
        if (_retryQueue[q].kind === 'diet') st.diet = true;
      }
    }
    var pending = (st.user ? 1 : 0) + (st.diet ? 1 : 0);
    if (!pending) return { userSynced: false, dietSynced: false, pending: 0 };
    if (!_isOnline()) return { userSynced: false, dietSynced: false, pending: pending };
    if (_flushing) return { userSynced: false, dietSynced: false, pending: pending };
    _flushing = true;
    try {
      return await Promise.race([
        _flushBody(email),
        new Promise(function (resolve) { setTimeout(function () { resolve({ userSynced: false, dietSynced: false, pending: -1, watchdog: true }); }, 30000); })
      ]);
    } finally {
      _flushing = false;
      _notifySyncStatusListeners();
    }
  }

  async function _flushBody(email) {
    var out = { userSynced: false, dietSynced: false, pending: 0 };
    var st = _readDirty(email);
    for (var q = 0; q < _retryQueue.length; q++) {
      if (_retryQueue[q].email === email) {
        if (_retryQueue[q].kind === 'user') st.user = true;
        if (_retryQueue[q].kind === 'diet') st.diet = true;
      }
    }
    if (st.user) {
      var u = _localUser(email);
      if (u) out.userSynced = await forceSyncUserToCloud(email, u);
      if (out.userSynced) _clearDirty(email, 'user');
    }
    if (st.diet) {
      var log = _localDiet(email);
      if (log) out.dietSynced = await syncDietLogToCloud(email, log);
      if (out.dietSynced) _clearDirty(email, 'diet');
    }
    var left = _readDirty(email);
    out.pending = (left.user ? 1 : 0) + (left.diet ? 1 : 0);
    return out;
  }

  function _pendingCount(email) {
    var st = _readDirty(email);
    var n = (st.user ? 1 : 0) + (st.diet ? 1 : 0);
    for (var q = 0; q < _retryQueue.length; q++) {
      if (_retryQueue[q].email === email) n = Math.max(n, 1);
    }
    return n;
  }

  // ─── Public: sync the user record (debounced, automatic) ───────────────
  // Supersede-safety: when a second call re-arms the shared debounce timer,
  // the first caller's promise would otherwise NEVER resolve (its timer was
  // cleared) — hanging flushPending and permanently latching _flushing.
  // Superseded waiters now resolve immediately (false) — the newer call owns
  // the actual push and stamps success on its own.
  var _userWaiters = [];
  function syncUserToCloud(email, userData) {
    if (!email || !userData) return Promise.resolve(false);
    if (!_isOnline()) { _enqueue('user', email); return Promise.resolve(false); }
    if (_userSyncTimer) clearTimeout(_userSyncTimer);
    var superseded = _userWaiters; _userWaiters = [];
    superseded.forEach(function (res) { try { res(false); } catch (e) {} });
    return new Promise(function (resolve) {
      _userWaiters.push(resolve);
      _userSyncTimer = setTimeout(async function () {
        _userSyncTimer = null; _userWaiters = [];
        // Same pipeline as the force path (Vercel vault first, textdb
        // verified fallback, Firestore mirror, dirty-marker stamping).
        resolve(await _doPushUser(email, userData));
      }, USER_SYNC_DEBOUNCE_MS);
    });
  }

  // ─── Public: force-sync (no debounce) — used on login / tab-hide ───────
  // Round 7: all concurrent callers for the SAME account collapse into ONE
  // in-flight push (flush + retry-drain + hide-flush used to fire multiple
  // simultaneous verified writes at the same textdb doc — self-inflicted
  // rate-limit stalls). Firestore mirror no longer delays the dirty-marker
  // clear either: the stamp lands as soon as textdb/Vercel confirm.
  var _inflightUser = null;
  async function forceSyncUserToCloud(email, userData) {
    if (!email || !userData) return false;
    if (!_isOnline()) { _enqueue('user', email); return false; }
    if (_inflightUser && _inflightUser.email === email) {
      try { return await _inflightUser.promise; } catch (e) { return false; }
    }
    var p = _doPushUser(email, userData);
    _inflightUser = { email: email, promise: p };
    try { return await p; }
    finally { if (_inflightUser && _inflightUser.promise === p) _inflightUser = null; }
  }

  async function _doPushUser(email, userData) {
    if (_userSyncTimer) { clearTimeout(_userSyncTimer); _userSyncTimer = null; }
    try {
      var data = JSON.parse(JSON.stringify(userData));
      data.lastSyncedAt = Date.now();
      data.email = email;
      var hash = await _emailKey(email);
      // PRIMARY: the user's own Vercel vault. One fast POST; when it lands,
      // the server has ALSO mirrored the doc into the fallback store, so the
      // slow client-side textdb verified write (POST + read-back + retries,
      // up to ~30s under rate limiting) is only needed when the vault is
      // unreachable / not deployed yet.
      var vcOk = await _vcPutUser(data, hash);
      var any = vcOk;
      if (!any) any = await _putDocVerified(_userDocId(hash), data);
      if (any) _stamp('user');             // clear the pending marker NOW —
                                           // the Firestore mirror (best-effort,
                                           // up to ~14s when inactive) must not
                                           // delay it.
      var fsOk = await _fsPutUser(data, hash); // Firestore mirror — best-effort
      if (!any && fsOk) _stamp('user');
      if (any || fsOk) return true;
      _enqueue('user', email);
      return false;
    } catch (e) {
      _enqueue('user', email);
      return false;
    }
  }

  // ─── Public: sync just the diet log (debounced, automatic) ─────────────
  // Same supersede-safety as syncUserToCloud + one shared in-flight push
  // per account (see forceSyncUserToCloud).
  var _dietWaiters = [];
  var _inflightDiet = null;
  function syncDietLogToCloud(email, log) {
    if (!email || !log) return Promise.resolve(false);
    if (!_isOnline()) { _enqueue('diet', email); return Promise.resolve(false); }
    if (_dietSyncTimer) clearTimeout(_dietSyncTimer);
    var superseded = _dietWaiters; _dietWaiters = [];
    superseded.forEach(function (res) { try { res(false); } catch (e) {} });
    return new Promise(function (resolve) {
      _dietWaiters.push(resolve);
      _dietSyncTimer = setTimeout(async function () {
        _dietSyncTimer = null; _dietWaiters = [];
        var entries = Array.isArray(log) ? log : [];
        if (entries.length > DIET_LOG_MAX_ENTRIES) {
          entries = entries.slice(entries.length - DIET_LOG_MAX_ENTRIES);
        }
        resolve(await _doPushDiet(email, entries));
      }, DIET_LOG_SYNC_DEBOUNCE_MS);
    });
  }

  async function _doPushDiet(email, entries) {
    if (_inflightDiet && _inflightDiet.email === email) {
      try { return await _inflightDiet.promise; } catch (e) { return false; }
    }
    var p = _doPushDietBody(email, entries);
    _inflightDiet = { email: email, promise: p };
    try { return await p; }
    finally { if (_inflightDiet && _inflightDiet.promise === p) _inflightDiet = null; }
  }

  async function _doPushDietBody(email, entries) {
    try {
      var hash = await _emailKey(email);
      // PRIMARY: the user's own Vercel vault (see _doPushUser).
      var vcOk = await _vcPutDiet(entries, hash);
      var any = vcOk;
      if (!any) any = await _putDocVerified(_dietDocId(hash), { log: entries, updatedAt: Date.now() });
      if (any) _stamp('diet');             // clear the pending marker now;
                                           // Firestore mirror must not delay it.
      var fsOk = await _fsPutDiet(entries, hash); // Firestore mirror — best-effort
      if (!any && fsOk) _stamp('diet');
      if (any || fsOk) return true;
      _enqueue('diet', email);
      return false;
    } catch (e) {
      _enqueue('diet', email);
      return false;
    }
  }

  // ─── Public: load user record (+ diet log) from the cloud ──────────────
  // Returns { data, extra:{ dietLog } } or null — same shape as before.
  // Round 7 order: VERCEL VAULT FIRST (the user's own server — authoritative
  // AND the fastest transport), then Firestore (Google mirrors), then
  // textdb.dev as the universal fallback. The old Firestore-first order made
  // every login on a new device wait for SDK load + 2×3.5s read timeouts
  // when the Firestore database was not active — users stared at
  // "Checking cloud..." for up to ~12s before the app opened.
  async function loadUserFromCloud(email) {
    if (!email || !_isOnline()) return null;
    try {
      var hash = await _emailKey(email);
      // 1) The Vercel vault (user's own backend — login details live here).
      if (_vcEnabled()) {
        var vcData = await _vcGet(_userDocId(hash));
        if (vcData && typeof vcData === 'object') {
          var vcExtra = null;
          try {
            var vcDiet = await _vcGetDiet(hash);
            if (vcDiet && vcDiet.length) vcExtra = { dietLog: vcDiet };
          } catch (e) {}
          return { data: vcData, extra: vcExtra };
        }
      }
      // 2) Firestore (uid doc for Google accounts + email doc for all).
      var fsRes = await _fsGetUser(hash);
      if (fsRes) return fsRes;
      // 3) textdb.dev as the universal fallback (with propagation-lag retry).
      var data = await _getDocRetry(_userDocId(hash));
      if (!data || typeof data !== 'object') return null;
      var extra = null;
      try {
        var diet = await _getDocRetry(_dietDocId(hash));
        if (diet && Array.isArray(diet.log)) extra = { dietLog: diet.log };
      } catch (e) {}
      return { data: data, extra: extra };
    } catch (e) {
      return null;
    }
  }

  // ─── Public: load just the diet log ────────────────────────────────────
  async function loadDietLogFromCloud(email) {
    if (!email || !_isOnline()) return [];
    try {
      var hash = await _emailKey(email);
      var vcLog = await _vcGetDiet(hash); // Vercel vault first — fastest
      if (vcLog && vcLog.length) return vcLog;
      var fsLog = await _fsGetDiet(hash);
      if (fsLog && fsLog.length) return fsLog;
      var diet = await _getDocRetry(_dietDocId(hash));
      return (diet && Array.isArray(diet.log)) ? diet.log : [];
    } catch (e) {
      return [];
    }
  }

  // ─── Public: check sync status (panel is gone; kept for compatibility) ─
  async function checkSyncStatus(email) {
    if (!email || !_isOnline()) {
      _lastSyncStatus.online = _isOnline();
      _notifySyncStatusListeners();
      return _lastSyncStatus;
    }
    try {
      _vcProbe(); // refresh Vercel vault health for the Cloud Backup card
      var hash = await _emailKey(email);
      var data = await _getDoc(_userDocId(hash));
      if (data && typeof data === 'object') {
        _lastSyncStatus.lastSyncedAt = data.lastSyncedAt || 0;
        _lastSyncStatus.hasUserData = true;
        _lastSyncStatus.hasExtraData = false;
        _lastSyncStatus.kv = 'connected';
        _lastSyncStatus.online = true;
      } else {
        _lastSyncStatus.kv = 'empty';
      }
    } catch (e) {
      _lastSyncStatus.online = false;
    }
    _notifySyncStatusListeners();
    return _lastSyncStatus;
  }

  // ─── Public: force-sync everything now ─────────────────────────────────
  async function forceSyncNow(email, userData, dietLog) {
    if (!email) return { success: false, error: 'No email' };
    if (!_isOnline()) return { success: false, error: 'Offline' };
    var userOk = false, dietOk = false;
    if (userData) userOk = await forceSyncUserToCloud(email, userData);
    if (dietLog) dietOk = await syncDietLogToCloud(email, dietLog);
    await checkSyncStatus(email);
    return {
      success: userOk || dietOk,
      userSynced: userOk,
      dietSynced: dietOk,
      syncedAt: _lastSyncStatus.lastSyncedAt
    };
  }

  // ─── Public: format "X minutes ago" ────────────────────────────────────
  function formatLastSynced(ts) {
    if (!ts) return 'Never';
    var diff = Date.now() - ts;
    if (diff < 60 * 1000) return 'Just now';
    if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + ' min ago';
    if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + 'h ago';
    return Math.floor(diff / 86400000) + 'd ago';
  }

  // ─── Settings panel listeners (panel removed; kept for compatibility) ──
  var _listeners = [];
  function onSyncStatusChange(fn) { _listeners.push(fn); }
  function _notifySyncStatusListeners() {
    for (var i = 0; i < _listeners.length; i++) {
      try { _listeners[i](_lastSyncStatus); } catch (e) {}
    }
    try { _updateSettingsPanel(); } catch (e) {}
  }

  function _updateSettingsPanel() {
    var statusEl = document.getElementById('cloudsync-status');
    if (statusEl) {
      var online = _isOnline();
      var synced = _lastSyncStatus.lastSyncedAt > 0;
      statusEl.textContent = online
        ? (synced ? ('Last synced: ' + formatLastSynced(_lastSyncStatus.lastSyncedAt)) : 'Automatic — syncs after every change')
        : 'Offline — data saved locally, will sync when back online';
      statusEl.style.color = online ? 'var(--green)' : 'var(--red)';
    }
    var lastEl = document.getElementById('cloudsync-last');
    if (lastEl) lastEl.textContent = 'Last synced: ' + formatLastSynced(_lastSyncStatus.lastSyncedAt);
    var dotEl = document.getElementById('cloudsync-dot');
    if (dotEl) dotEl.style.background = _isOnline() ? 'var(--green)' : 'var(--red)';
    // Pending line — "N changes waiting" keeps the user confident that
    // nothing made offline is lost (it syncs automatically on reconnect).
    var pendEl = document.getElementById('cloudsync-pending');
    if (pendEl) {
      try {
        var email = (typeof store !== 'undefined' && store.session) ? store.session : null;
        var n = email ? _pendingCount(email) : 0;
        var isAr = (typeof store !== 'undefined' && store.lang === 'ar');
        if (n > 0) {
          pendEl.textContent = isAr ? ('⏳ ' + n + ' من التغييرات في انتظار المزامنة') : ('⏳ ' + n + ' change' + (n > 1 ? 's' : '') + ' waiting to sync');
          pendEl.style.display = 'block';
        } else {
          pendEl.textContent = isAr ? ('✓ كل شيء محفوظ على السيرفر') : ('✓ Everything is saved on the server');
          pendEl.style.display = 'block';
        }
      } catch (e) {}
    }
    // Cloud Backup card: per-transport line + Firebase fix-it hint.
    var trEl = document.getElementById('cloudsync-transport');
    if (trEl) {
      var t = _lastSyncStatus.transports || {};
      var fs = t.firebase === 'ok' ? 'Firebase vault: synced'
        : t.firebase === 'fail' ? 'Firebase vault: not active'
        : 'Firebase vault: standby';
      var vc = t.vercel === 'ok' ? 'Vercel vault: synced'
        : t.vercel === 'fail' ? 'Vercel vault: waiting for deploy'
        : 'Vercel vault: standby';
      var td = t.textdb === 'ok' ? 'Backup cloud: synced'
        : t.textdb === 'fail' ? 'Backup cloud: retrying'
        : 'Backup cloud: standby';
      trEl.textContent = fs + ' · ' + vc + ' · ' + td;
    }
    var hintEl = document.getElementById('cloudsync-fshint');
    if (hintEl) {
      var allHints = [_lastSyncStatus.fsHint || '', _lastSyncStatus.vcHint || ''].filter(Boolean).join(' ');
      hintEl.textContent = allHints;
      hintEl.style.display = allHints ? 'block' : 'none';
    }
  }

  // ─── Wire up connectivity events ───────────────────────────────────────
  if (typeof window !== 'undefined') {
    // Periodic retry: drains the queue every 45s while it has pending items
    // (covers long-lived tabs where no visibility/online event fires).
    setInterval(function () { if (_retryQueue.length) _drainQueue(); }, 45000);
    // Safety heartbeat (3 min): pushes anything still marked dirty — e.g. a
    // debounced write whose network blipped mid-flight. Cheap no-op when clean.
    setInterval(function () {
      try {
        if (!_isOnline() || !_hasDirty()) return;
        var email = (typeof store !== 'undefined' && store.session) ? store.session : null;
        if (email) flushPending(email);
      } catch (e) {}
    }, 3 * 60 * 1000);
    window.addEventListener('online', function () {
      _lastSyncStatus.online = true;
      _notifySyncStatusListeners();
      // Re-activate the Vercel vault IMMEDIATELY: a failed probe arms a
      // 5-minute backoff, and without the forced re-probe the first pushes
      // after reconnect would skip the user's own server.
      try { _vcProbe(true); } catch (e) {}
      setTimeout(function () {
        _drainQueue();
        try {
          var email = (typeof store !== 'undefined' && store.session) ? store.session : null;
          if (email) {
            flushPending(email);
            checkSyncStatus(email);
          }
        } catch (e) {}
      }, 800);
    });
    window.addEventListener('offline', function () {
      _lastSyncStatus.online = false;
      _notifySyncStatusListeners();
    });
    window.addEventListener('visibilitychange', function () {
      // Flush pending saves the moment the user leaves the app.
      if (document.hidden) {
        try {
          var email = (typeof store !== 'undefined' && store.session) ? store.session : null;
          if (email) {
            var u = _localUser(email);
            if (u && _isOnline()) forceSyncUserToCloud(email, u);
            else if (u && !_isOnline()) _markDirty(email, 'user');
          }
        } catch (e) {}
      } else {
        setTimeout(_drainQueue, 600);
      }
    });
    // pagehide — last-chance push when the app/tab is closed outright (some
    // mobile flows skip visibilitychange). Best-effort fire-and-forget.
    window.addEventListener('pagehide', function () {
      try {
        var email = (typeof store !== 'undefined' && store.session) ? store.session : null;
        if (!email) return;
        var u = _localUser(email);
        if (u && _isOnline()) forceSyncUserToCloud(email, u);
        else if (u) _markDirty(email, 'user');
        if (_readDirty(email).diet && _isOnline()) {
          var log = _localDiet(email);
          if (log) syncDietLogToCloud(email, log);
        }
      } catch (e) {}
    });
    // Boot catch-up: if a previous session ended with unsynced changes
    // (app closed while offline), push them once this open has settled.
    setTimeout(function () {
      try {
        if (!_isOnline() || !_hasDirty()) return;
        var email = (typeof store !== 'undefined' && store.session) ? store.session : null;
        if (email) flushPending(email);
      } catch (e) {}
    }, 6000);
  }

  // ─── Expose globally (same API surface) ────────────────────────────────
  window.VoltaCloudSync = {
    syncUserToCloud: syncUserToCloud,
    forceSyncUserToCloud: forceSyncUserToCloud,
    syncDietLogToCloud: syncDietLogToCloud,
    loadUserFromCloud: loadUserFromCloud,
    loadDietLogFromCloud: loadDietLogFromCloud,
    checkSyncStatus: checkSyncStatus,
    forceSyncNow: forceSyncNow,
    // Push every locally-dirty piece (user record + diet log) to the server
    // right now — used on app entry, on reconnect and by the Settings card.
    flushPending: flushPending,
    pendingCount: function (email) {
      try {
        return _pendingCount(email || ((typeof store !== 'undefined' && store.session) ? store.session : null));
      } catch (e) { return 0; }
    },
    formatLastSynced: formatLastSynced,
    onSyncStatusChange: onSyncStatusChange,
    getStatus: function () { return _lastSyncStatus; },
    // Per-transport health for the Settings → Cloud Backup card:
    // { textdb, firebase, vercel: 'ok'|'fail'|'skipped', fsHint, vcHint }
    getTransportStatus: function () {
      return {
        transports: Object.assign({}, _lastSyncStatus.transports || {}),
        fsHint: _lastSyncStatus.fsHint || '',
        vcHint: _lastSyncStatus.vcHint || '',
        lastSyncedAt: _lastSyncStatus.lastSyncedAt || 0
      };
    },
    // Force a Vercel vault health probe (Settings card / QA).
    probeVercel: function () { return _vcProbe(true); }
  };
})();
