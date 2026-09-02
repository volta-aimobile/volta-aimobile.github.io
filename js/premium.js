/**
 * Volta Premium — Subscription management module
 * ===============================================
 *
 * This module handles all premium-related logic:
 *   - Checking premium status
 *   - Showing the paywall modal
 *   - Processing REAL payments via Stripe Checkout (if backend is running)
 *   - Fallback to demo payment (if backend is not available)
 *   - Persisting premium status on the user object
 *   - Restoring purchases
 *
 * PAYMENT FLOW (real Stripe):
 *   1. User clicks "Subscribe Now"
 *   2. App calls POST /api/create-premium-checkout on the backend
 *   3. Backend creates a Stripe Checkout Session and returns a URL
 *   4. Frontend redirects to Stripe's hosted checkout page
 *   5. User enters real credit card details on Stripe's secure page
 *   6. Stripe processes the payment and redirects back to the app
 *   7. App detects ?payment=success in URL → activates premium
 *
 * FALLBACK (no backend):
 *   If the backend server is not running, the app falls back to the
 *   demo payment modal (fake card form with Luhn validation).
 *   This allows testing without setting up the backend.
 */

window.VoltaPremium = (function () {

  // Backend API URL — change this if your backend runs on a different port/domain
  const API_URL = window.location.origin.replace(/:\d+$/, ':3001') || 'http://localhost:3001';

  const PLANS = {
    monthly: { id: 'monthly', name: 'Monthly', price: 4.99, billing: 'Billed monthly' },
    yearly:  { id: 'yearly',  name: 'Yearly',  price: 39.99, billing: 'Billed yearly — Save 33%' }
  };

  const PREMIUM_FEATURES = [
    { icon: 'fa-robot',         title: 'AI Coach',           desc: 'Personalized AI-powered training advice and form analysis' },
    { icon: 'fa-chart-line',    title: 'Advanced Analytics',  desc: 'Deep insights into your progress, trends, and predictions' },
    { icon: 'fa-utensils',      title: 'Unlimited Meal Logging', desc: 'Log unlimited meals daily (free users: 5/day)' },
    { icon: 'fa-pen-to-square', title: 'Custom Workout Plans', desc: 'Edit and customize your auto-generated workout plan' },
    { icon: 'fa-file-export',   title: 'Export Data',         desc: 'Download your sessions, diet log, and progress data' },
    { icon: 'fa-bolt',          title: 'Priority Support',    desc: 'Get faster responses from our team' }
  ];

  // ─── Internal: get current user ──────────────────────────────────────────
  function user() {
    try {
      if (typeof currentUser === 'function') return currentUser();
      if (typeof store !== 'undefined' && store.session) return store.users[store.session];
      return null;
    } catch (e) { return null; }
  }

  // ─── Public: check if current user is premium ────────────────────────────
  // Premium has been removed from the app — all features are now free.
  // This always returns true so nothing is locked behind a paywall.
  function isPremium() {
    return true;
  }

  // ─── Public: get plan list ───────────────────────────────────────────────
  function getPlans() { return PLANS; }

  // ─── Public: get features list ───────────────────────────────────────────
  function getFeatures() { return PREMIUM_FEATURES; }

  // ─── Public: activate premium on current user ────────────────────────────
  function activate(planId) {
    var u = user();
    if (!u) { console.warn('[VoltaPremium] No user logged in — cannot activate'); return false; }
    u.isPremium = true;
    u.premiumPlan = planId || 'monthly';
    u.premiumActivatedAt = Date.now();
    try {
      if (typeof saveUser === 'function') saveUser(store.session, u);
      else if (store.session) {
        var users = store.users;
        users[store.session] = u;
        store.users = users;
      }
    } catch (e) { console.warn('[VoltaPremium] Save error:', e); }
    // Update UI
    try { if (typeof updatePremiumButton === 'function') updatePremiumButton(); } catch (e) {}
    return true;
  }

  // ─── Public: deactivate premium (for testing or refund) ──────────────────
  function deactivate() {
    var u = user();
    if (!u) return false;
    u.isPremium = false;
    delete u.premiumPlan;
    delete u.premiumActivatedAt;
    try {
      if (typeof saveUser === 'function') saveUser(store.session, u);
    } catch (e) {}
    try { if (typeof updatePremiumButton === 'function') updatePremiumButton(); } catch (e) {}
    return true;
  }

  // ─── Public: restore purchases (check if user already has premium) ───────
  function restore() {
    if (isPremium()) {
      try { if (typeof showVoltaToast === 'function') showVoltaToast('Premium already active', 'success'); } catch (e) {}
      return true;
    }
    // In a real app, this would check with the app store / backend.
    // Here, we just check the current user object (which is already done above).
    try { if (typeof showVoltaToast === 'function') showVoltaToast('No active subscription found', 'info'); } catch (e) {}
    return false;
  }

  // ─── Public: gate a feature — show paywall if not premium ────────────────
  /**
   * @param {string} featureKey — key for analytics/messaging (e.g. 'ai_coach')
   * @returns {boolean} — true if access granted (user is premium), false if blocked
   */
  function gate(featureKey) {
    if (isPremium()) return true;
    showPaywall(featureKey);
    return false;
  }

  // ─── Public: show the paywall modal ──────────────────────────────────────
  // Premium removed — this is now a no-op. All features are free.
  function showPaywall(featureKey) {
    // Do nothing — premium is removed, all features are unlocked.
    return;
  }

  // ─── Public: show the premium screen (plan selection) ────────────────────
  // Premium removed — this is now a no-op.
  function showPremiumScreen() {
    // Do nothing — premium screen no longer exists.
    return;
  }

  // ─── Public: open the payment modal ──────────────────────────────────────
  let selectedPlan = 'monthly';

  function openPayment(planId) {
    selectedPlan = planId || 'monthly';
    var plan = PLANS[selectedPlan];
    if (!plan) return;
    var ar = (typeof store !== 'undefined' && store.lang === 'ar');

    // Update plan summary in the modal
    var nameEl = document.getElementById('payment-plan-name');
    var billEl = document.getElementById('payment-plan-billing');
    var priceEl = document.getElementById('payment-plan-price');
    if (nameEl) nameEl.textContent = ar ? ('فولتا بريميوم — ' + (planId === 'yearly' ? 'سنوي' : 'شهري')) : ('Volta Premium — ' + plan.name);
    if (billEl) billEl.textContent = ar ? (planId === 'yearly' ? 'يُحاسب سنوياً' : 'يُحاسب شهرياً') : plan.billing;
    if (priceEl) priceEl.textContent = '$' + plan.price.toFixed(2);

    // Reset form
    ['pay-card-name', 'pay-card-number', 'pay-card-expiry', 'pay-card-cvc', 'pay-card-zip'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) { el.value = ''; el.style.borderColor = 'var(--line)'; }
    });
    var errEl = document.getElementById('payment-error');
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
    var btn = document.getElementById('payment-submit-btn');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = ar ? 'ادفع وفعّل بريميوم' : 'Pay &amp; Activate Premium';
      btn.style.background = '';
    }
    if (typeof openModal === 'function') openModal('premium-payment-modal');
  }

  // ─── Card formatting helpers ─────────────────────────────────────────────
  function formatCardNumber(input) {
    var v = input.value.replace(/\D/g, '').slice(0, 16);
    input.value = v.replace(/(.{4})/g, '$1 ').trim();
  }

  function formatCardExpiry(input) {
    var v = input.value.replace(/\D/g, '').slice(0, 4);
    if (v.length >= 3) v = v.slice(0, 2) + '/' + v.slice(2);
    input.value = v;
  }

  // ─── Card validation with Luhn check ─────────────────────────────────────
  function validateCardForm() {
    var name = (document.getElementById('pay-card-name').value || '').trim();
    var num = (document.getElementById('pay-card-number').value || '').replace(/\s/g, '');
    var exp = (document.getElementById('pay-card-expiry').value || '').trim();
    var cvc = (document.getElementById('pay-card-cvc').value || '').trim();
    var zip = (document.getElementById('pay-card-zip').value || '').trim();
    var ar = (typeof store !== 'undefined' && store.lang === 'ar');

    function showErr(msg, fieldId) {
      var errEl = document.getElementById('payment-error');
      if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
      if (fieldId) { var f = document.getElementById(fieldId); if (f) f.style.borderColor = 'var(--red)'; }
    }

    if (name.length < 2) { showErr(ar ? 'الرجاء إدخال اسم حامل البطاقة.' : 'Please enter the cardholder name.', 'pay-card-name'); return false; }
    if (num.length < 13 || num.length > 16) { showErr(ar ? 'رقم البطاقة غير صالح.' : 'Invalid card number.', 'pay-card-number'); return false; }

    // Luhn check
    var luhn = 0, dbl = false;
    for (var i = num.length - 1; i >= 0; i--) {
      var d = parseInt(num.charAt(i), 10);
      if (dbl) { d *= 2; if (d > 9) d -= 9; }
      luhn += d; dbl = !dbl;
    }
    if (luhn % 10 !== 0) { showErr(ar ? 'رقم البطاقة غير صالح.' : 'Invalid card number.', 'pay-card-number'); return false; }

    var m = exp.match(/^(\d{2})\/(\d{2})$/);
    if (!m || +m[1] < 1 || +m[1] > 12) { showErr(ar ? 'تاريخ الانتهاء غير صالح.' : 'Invalid expiry date.', 'pay-card-expiry'); return false; }
    if (!/^\d{3,4}$/.test(cvc)) { showErr(ar ? 'رمز الأمان غير صالح.' : 'Invalid CVC.', 'pay-card-cvc'); return false; }
    if (zip.length < 4) { showErr(ar ? 'الرجاء إدخال الرمز البريدي.' : 'Please enter your ZIP / postal code.', 'pay-card-zip'); return false; }

    var errEl = document.getElementById('payment-error');
    if (errEl) errEl.style.display = 'none';
    return true;
  }

  // ─── Public: process payment ─────────────────────────────────────────────
  function processPayment() {
    if (!validateCardForm()) return;
    var ar = (typeof store !== 'undefined' && store.lang === 'ar');
    var btn = document.getElementById('payment-submit-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ' + (ar ? 'جارٍ المعالجة...' : 'Processing...');
    }
    // Fake processing delay
    setTimeout(function () {
      // Activate premium
      var success = activate(selectedPlan);
      if (success) {
        if (btn) {
          btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> ' + (ar ? 'تم تفعيل بريميوم!' : 'Premium Activated!');
          btn.style.background = 'var(--green)';
        }
        setTimeout(function () {
          if (typeof closeModal === 'function') closeModal('premium-payment-modal');
          if (btn) {
            btn.disabled = false;
            btn.innerHTML = ar ? 'ادفع وفعّل بريميوم' : 'Pay &amp; Activate Premium';
            btn.style.background = '';
          }
          // Return to app
          setTimeout(function () {
            try {
              if (typeof store !== 'undefined' && store.session) {
                if (typeof enterApp === 'function') enterApp();
              } else {
                if (typeof showScreen === 'function') showScreen('screen-landing');
              }
            } catch (e) {}
          }, 600);
        }, 1500);
      } else {
        // Activation failed (no user logged in)
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = ar ? 'ادفع وفعّل بريميوم' : 'Pay &amp; Activate Premium';
        }
        var errEl = document.getElementById('payment-error');
        if (errEl) {
          errEl.textContent = ar ? 'الرجاء تسجيل الدخول أولاً.' : 'Please log in first.';
          errEl.style.display = 'block';
        }
      }
    }, 2200);
  }

  // ─── Public: update the top-right premium button ─────────────────────────
  function updateButton() {
    var btn = document.getElementById('app-premium-btn');
    if (!btn) return;
    if (typeof store === 'undefined' || !store.session) { btn.style.display = 'none'; return; }
    btn.style.display = 'flex';
    var ar = (typeof store !== 'undefined' && store.lang === 'ar');
    if (isPremium()) {
      // Use direct text content based on current language — no data-ar reliance
      btn.textContent = ar ? 'بريميوم' : 'Premium';
      btn.style.background = 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)';
      btn.style.color = '#1a1a2e';
      btn.style.borderColor = 'transparent';
      btn.onclick = function () { showPremiumScreen(); };
    } else {
      btn.textContent = ar ? 'بريميوم' : 'Go Premium';
      btn.style.background = '';
      btn.style.color = 'var(--accent)';
      btn.style.borderColor = 'var(--accent)';
      btn.onclick = function () { showPremiumScreen(); };
    }
  }

  // ─── Public: update the premium screen's subscribe button ────────────────
  function updateScreenNotice() {
    var btn = document.getElementById('premium-subscribe-btn');
    var notice = document.getElementById('premium-login-notice');
    var ar = (typeof store !== 'undefined' && store.lang === 'ar');
    if (!btn) return;
    if (typeof store === 'undefined' || !store.session) {
      btn.textContent = ar ? 'سجّل الدخول للاشتراك' : 'Log in to Subscribe';
      if (notice) notice.style.display = 'block';
    } else if (isPremium()) {
      btn.textContent = ar ? 'بريميوم نشط ✓' : 'Premium Active ✓';
      btn.style.background = 'var(--green)';
      btn.disabled = true;
      if (notice) notice.style.display = 'none';
    } else {
      btn.textContent = ar ? 'اشترك الآن' : 'Subscribe Now';
      btn.disabled = false;
      btn.style.background = '';
      if (notice) notice.style.display = 'none';
    }
  }

  // ─── Public: handle "Subscribe Now" click ────────────────────────────────
  function handleSubscribe() {
    if (typeof store === 'undefined' || !store.session) {
      try { if (typeof showVoltaToast === 'function') showVoltaToast('Please log in or sign up to subscribe to Premium.', 'info'); } catch (e) {}
      if (typeof showScreen === 'function') showScreen('screen-auth');
      if (typeof switchAuthTab === 'function') switchAuthTab('signup');
      return;
    }
    if (isPremium()) {
      try { if (typeof showVoltaToast === 'function') showVoltaToast('You already have Premium!', 'success'); } catch (e) {}
      return;
    }
    // Try real Stripe Checkout first, fall back to demo payment
    tryStripeCheckout(selectedPlan);
  }

  // ─── Internal: try real Stripe Checkout ─────────────────────────────────
  async function tryStripeCheckout(planId) {
    var ar = (typeof store !== 'undefined' && store.lang === 'ar');
    // Show loading state on the subscribe button
    var btn = document.getElementById('premium-subscribe-btn');
    var origText = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ' + (ar ? 'جارٍ التحميل...' : 'Loading...');
    }

    try {
      var userEmail = (typeof store !== 'undefined' && store.session) ? store.session : '';
      var response = await fetch(API_URL + '/api/create-premium-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId, userEmail: userEmail })
      });

      if (!response.ok) throw new Error('Backend returned ' + response.status);
      var data = await response.json();

      if (data.url) {
        // Redirect to Stripe Checkout
        window.location.href = data.url;
        return;
      }
      throw new Error('No checkout URL returned');
    } catch (err) {
      // Backend not available — show error (no demo fallback)
      console.error('[VoltaPremium] Payment error:', err.message);
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = origText;
      }
      try { if (typeof showVoltaToast === 'function') showVoltaToast(ar ? 'خطأ في الخادم — تأكد من تشغيل الخادم الخلفي.' : 'Server error — make sure the backend server is running.', 'error'); } catch (e) {}
    }
  }

  // ─── Public: premiumBack — return from premium screen ────────────────────
  function back() {
    try {
      if (typeof store !== 'undefined' && store.session) {
        if (typeof enterApp === 'function') enterApp();
      } else {
        if (typeof showScreen === 'function') showScreen('screen-landing');
      }
    } catch (e) {}
  }

  // ─── Public: select a plan (highlights it in the UI) ─────────────────────
  function selectPlan(planId) {
    selectedPlan = planId;
    document.querySelectorAll('.premium-plan').forEach(function (el) { el.style.borderColor = 'var(--line)'; });
    var idx = planId === 'yearly' ? 1 : 0;
    var el = document.querySelectorAll('.premium-plan')[idx];
    if (el) el.style.borderColor = 'var(--accent)';
  }

  return {
    isPremium: isPremium,
    gate: gate,
    activate: activate,
    deactivate: deactivate,
    restore: restore,
    showPaywall: showPaywall,
    showPremiumScreen: showPremiumScreen,
    openPayment: openPayment,
    processPayment: processPayment,
    formatCardNumber: formatCardNumber,
    formatCardExpiry: formatCardExpiry,
    updateButton: updateButton,
    updateScreenNotice: updateScreenNotice,
    handleSubscribe: handleSubscribe,
    back: back,
    selectPlan: selectPlan,
    getPlans: getPlans,
    getFeatures: getFeatures
  };
})();
