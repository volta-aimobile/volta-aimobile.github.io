 























(function () {
  'use strict';

   
   
   
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

   
  function ensureSdk() {
    if (_sdkPromise) return _sdkPromise;
    _sdkPromise = (async function () {
      if (typeof firebase === 'undefined') {
        await _loadSdk('firebase-app-compat.js');
        await _loadSdk('firebase-auth-compat.js');
        try {
          await _loadSdk('firebase-firestore-compat.js');
        } catch (e) {   }
      }
      if (!firebase.apps.length) firebase.initializeApp(window.VOLTA_FIREBASE_CONFIG);
      try { if (firebase.firestore) _db = firebase.firestore(); } catch (e) {}
      return firebase.auth();
    })();
    return _sdkPromise;
  }

   
   
   
  function warmIfReturningUser() {
    try {
      if (!isConfigured()) return;
      if (localStorage.getItem('volta_fb_on') !== '1') return;
      ensureSdk().then(function (auth) {
         
        try {
          auth.getRedirectResult().then(function (res) {
            if (res && res.user && res.user.email && window.VoltaGoogle) {
              _finishPipeline(res.user);
            }
          }).catch(function () {});
        } catch (e) {}
         
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
        _msg('', true);  
        return;
      }
      if (code === 'auth/popup-blocked') {
         
         
         
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

   
   
   
   
  function fsUid() {
    try {
      if (!isConfigured()) return null;
      if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) return null;
      if (localStorage.getItem('volta_fb_on') !== '1') return null;
      var cu = firebase.auth().currentUser;
      return (cu && cu.uid) ? cu.uid : null;
    } catch (e) { return null; }
  }

   
  function fs() { return _db; }

   
   
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

   
  if (typeof window !== 'undefined') {
    if (document.readyState === 'complete') setTimeout(warmIfReturningUser, 1200);
    else window.addEventListener('load', function () { setTimeout(warmIfReturningUser, 1200); });
  }
})();
