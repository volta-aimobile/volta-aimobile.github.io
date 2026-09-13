/**
 * Volta — REAL Google Sign-In (Firebase Auth) + Firestore account sync
 * ====================================================================
 * The "Continue with Google" button calls openGooglePicker() in volta.js.
 * window.VOLTA_FIREBASE_CONFIG (index.html) is LIVE (project volta-692ae),
 * so this module performs a REAL Google sign-in:
 *
 *   1. Lazy-loads the Firebase compat SDK from the official CDN
 *      (app + auth + firestore — cached after first click).
 *   2. Opens the Google account picker (signInWithPopup). If the browser
 *      blocks popups (common on mobile in-app browsers), automatically
 *      falls back to signInWithRedirect; the result is picked up on the
 *      next page load via getRedirectResult().
 *   3. Reuses the app's existing account pipeline:
 *        cloud lookup (VoltaCloudSync) → ensureUserRecord → loginSuccess
 *      so Google users get the same cross-device sync as everyone else.
 *   4. Marks localStorage 'volta_fb_on' so every future page load warms
 *      the SDK in the background — letting cloudsync.js mirror account
 *      data into Firestore (users/<uid>) automatically, with textdb.dev
 *      as fallback.
 *
 * NOTE: Google blocks popups on file:// pages. Test with a local server
 * (python -m http.server) or on GitHub Pages.
 */
(function () {
  'use strict';

  // Vendored SDKs (js/vendor/firebasejs/) load first — offline-friendly and
  // file://-safe. If the local copy is missing (partial deploy), fall back
  // to the gstatic CDN.
  var SDK_LOCAL = 'js/vendor/firebasejs/10.12.2';
  var SDK_CDN = 'https://www.gstatic.com/firebasejs/10.12.2';
  function _loadSdk(name) {
    return _loadScript(SDK_LOCAL + '/' + name).catch(function () {
      return _loadScript(SDK_CDN + '/' + name);
    });
  }
  var _sdkPromise = null;
  var _db = null;

  function isConfigured() {
    var c = (typeof window !== 'undefined') ? window.VOLTA_FIREBASE_CONFIG : null;
    return !!(c && c.apiKey && c.authDomain && c.projectId && c.appId);
  }

  function _loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }

  // Load app+auth+firestore compat SDKs and initialise (once).
  function ensureSdk() {
    if (_sdkPromise) return _sdkPromise;
    _sdkPromise = (async function () {
      if (typeof firebase === 'undefined') {
        await _loadSdk('firebase-app-compat.js');
        await _loadSdk('firebase-auth-compat.js');
        try {
          await _loadSdk('firebase-firestore-compat.js');
        } catch (e) { /* Firestore optional — auth still works */ }
      }
      if (!firebase.apps.length) firebase.initializeApp(window.VOLTA_FIREBASE_CONFIG);
      try { if (firebase.firestore) _db = firebase.firestore(); } catch (e) {}
      return firebase.auth();
    })();
    return _sdkPromise;
  }

  // Warm the SDK in the background (no UI): used on page load when the
  // user previously signed in with Google, so cloudsync.js can reach
  // Firestore for automatic sync without any click.
  function warmIfReturningUser() {
    try {
      if (!isConfigured()) return;
      if (localStorage.getItem('volta_fb_on') !== '1') return;
      ensureSdk().then(function (auth) {
        // Restore redirect results (mobile popup-blocked fallback) first.
        try {
          auth.getRedirectResult().then(function (res) {
            if (res && res.user && res.user.email && window.VoltaGoogle) {
              _finishPipeline(res.user);
            }
          }).catch(function () {});
        } catch (e) {}
        // Keep the Firebase session mirrored onto the app account record.
        try {
          auth.onAuthStateChanged(function (fu) {
            if (!fu) return;
            try { localStorage.setItem('volta_fb_on', '1'); } catch (e) {}
          });
        } catch (e) {}
      }).catch(function () {});
    } catch (e) {}
  }

  function _msg(text, ok) {
    try {
      var el = document.getElementById('auth-msg');
      if (el) {
        el.textContent = text;
        el.style.color = ok ? 'var(--green)' : 'var(--red)';
      }
    } catch (e) {}
  }

  // Enter the app through the normal pipeline (cloud-first, like the demo
  // picker does): if the account exists in the cloud (created on another
  // device) pull it, otherwise create a fresh verified Google record.
  async function _finishPipeline(user) {
    var email = user.email.toLowerCase().trim();
    try {
      if (!store.users[email]) {
        var cloudUser = await loadUserFromCloud(email);
        if (cloudUser) saveUser(email, cloudUser);
      }
    } catch (e) {}
    ensureUserRecord(email, {
      password: null,
      verified: true,
      google: true,
      displayName: user.displayName || null
    });
    // Stash the Google display name WITHOUT creating u.profile — seeding a
    // profile object here made loginSuccess()/enterApp() think onboarding was
    // already finished, so Google users NEVER got the signup survey (user
    // report: "the user doesnt get the survey when they use their google
    // accounts"). The name is pre-filled into the survey's first question
    // instead (volta.js renderSurveyQuestion), and saveSurvey() folds it into
    // the real profile when onboarding completes.
    try {
      var u = store.users[email];
      if (user.displayName && !u.pendingName) {
        u.pendingName = user.displayName;
        saveUser(email, u);
      }
    } catch (e) {}
    try { localStorage.setItem('volta_fb_on', '1'); } catch (e) {}

    _msg(((store.lang === 'ar') ? 'مرحباً، ' : 'Welcome, ') + (user.displayName || email), true);
    store.session = email;
    setTimeout(function () { loginSuccess(email); }, 350);
  }

  // Sign in with Google, then enter the app through the normal pipeline.
  async function signInAndEnter() {
    if (!isConfigured()) throw new Error('not-configured');
    _msg((store.lang === 'ar') ? 'جارٍ فتح نافذة Google...' : 'Opening Google...', true);
    var auth = await ensureSdk();
    var provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    var result;
    try {
      result = await auth.signInWithPopup(provider);
    } catch (err) {
      var code = (err && err.code) || '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        _msg('', true); // user closed the picker — stay quiet
        return;
      }
      if (code === 'auth/popup-blocked') {
        // Mobile in-app browsers often block popups: fall back to the
        // full-page redirect flow. The pipeline resumes automatically
        // on return via getRedirectResult().
        _msg((store.lang === 'ar') ? 'جارٍ إعادة التوجيه إلى Google...' : 'Redirecting to Google...', true);
        try { await auth.signInWithRedirect(provider); } catch (e2) {
          _msg((store.lang === 'ar') ? 'تعذّر تسجيل الدخول عبر Google.' : 'Google sign-in failed. Please try again.', false);
        }
        return;
      }
      if (code === 'auth/unauthorized-domain') {
        _msg((store.lang === 'ar') ? 'أضف هذا النطاق إلى Authorized domains في إعدادات Firebase.' : 'Add this domain to Firebase → Authentication → Settings → Authorized domains.', false);
        return;
      }
      if (code === 'auth/operation-not-allowed') {
        _msg((store.lang === 'ar') ? 'فعّل مزوّد Google في Firebase → Authentication.' : 'Enable the Google provider in Firebase → Authentication.', false);
        return;
      }
      _msg((store.lang === 'ar') ? 'تعذّر تسجيل الدخول عبر Google.' : 'Google sign-in failed. Please try again.', false);
      return;
    }

    var user = result.user;
    if (!user || !user.email) {
      _msg((store.lang === 'ar') ? 'لم يتم العثور على بريد في حساب Google.' : 'No email found on that Google account.', false);
      return;
    }
    await _finishPipeline(user);
  }

  // ─── Firestore context for cloudsync.js ────────────────────────────────
  // Returns { uid } when the SDK is loaded AND a Google user is signed in
  // (the flag guards against restoring an auth session for a non-Google
  // account on a shared device).
  function fsUid() {
    try {
      if (!isConfigured()) return null;
      if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) return null;
      if (localStorage.getItem('volta_fb_on') !== '1') return null;
      var cu = firebase.auth().currentUser;
      return (cu && cu.uid) ? cu.uid : null;
    } catch (e) { return null; }
  }

  // Firestore instance (or null). cloudsync.js calls this after fsUid().
  function fs() { return _db; }

  // Sign out of Firebase when the app logs out (keeps sessions tidy on
  // shared devices). Safe to call anytime.
  function signOutIfAny() {
    try {
      if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
        firebase.auth().signOut().catch(function () {});
      }
      localStorage.removeItem('volta_fb_on');
    } catch (e) {}
  }

  window.VoltaGoogle = {
    isConfigured: isConfigured,
    signInAndEnter: signInAndEnter,
    ensureSdk: ensureSdk,
    fsUid: fsUid,
    fs: fs,
    signOutIfAny: signOutIfAny
  };

  // Warm up after load (harmless no-op when flag is absent).
  if (typeof window !== 'undefined') {
    if (document.readyState === 'complete') setTimeout(warmIfReturningUser, 1200);
    else window.addEventListener('load', function () { setTimeout(warmIfReturningUser, 1200); });
  }
})();
