/**
 * Volta Premium — Subscription management module (v2)
 * ══════════════════════════════════════════════════════════════════════
 * Premium is NOT a screen anymore — it lives in:
 *   1. A small gold button at the top-right of the dashboard hero
 *      (#app-premium-btn)
 *   2. A "VOLTA PREMIUM" card on the homescreen (#premium-home-card)
 *   3. A gradient-gold tag next to the Volta logo in the sidebar
 *      (#volta-premium-tag) when the user is subscribed
 *   4. One modal (#premium-modal) that morphs between paywall ⇄ management
 *
 * PRODUCT RULES (hard requirements):
 *   • Regional pricing — currency CODES only (29 EGP, 4.99 USD…),
 *     resolved server-side per country; every price ends in 9.
 *   • Subscribers ALWAYS get the full duration (1 calendar month / year).
 *   • They can see time remaining, renew, or cancel (cancel keeps access
 *     until the end of the paid period).
 *   • NO crown icon · NO "prices in your country currency" line ·
 *     NO "secure payment" line — a single centered "Subscribe Now" CTA.
 *   • Gold = multi-stop gradient, never one flat gold color.
 *
 * BACKEND (server is the source of truth):
 *   POST /api/premium/price     → regional price for the user
 *   POST /api/premium/checkout  → Stripe Checkout URL (or demo redirect)
 *   POST /api/premium/verify    → activates after payment (session_id)
 *   POST /api/premium/status    → current subscription state
 *   POST /api/premium/cancel    → cancel at period end / resume
 *   POST /api/premium/google-verify → Play Billing purchase validation
 * On Vercel the same paths exist as serverless functions (api/premium/*).
 * ══════════════════════════════════════════════════════════════════════
 */

window.VoltaPremium = (function () {

  // ─── Backend base (same-origin, mirrors index.html logic) ──────────────
  const API_URL = (function () {
    try {
      var host = window.location.hostname || '';
      var isStatic = window.location.protocol === 'file:'
        || host === 'volta-aimobile.github.io'
        || host.indexOf('vercel.app') !== -1
        || host.indexOf('web.app') !== -1
        || host.indexOf('firebaseapp.com') !== -1;
      if (isStatic) return window.VOLTA_VERCEL_VAULT || 'https://volta-aimobile-github-io.vercel.app';
      return window.location.origin;
    } catch (e) { return window.location.origin; }
  })();

  // ─── The 4 premium features (replaces ALL previous premium features) ───
  // Coach AI / AI Weekly Report / AI Diet Plan were free features; Coach AI
  // and AI Diet Plan are now REMOVED entirely (user decision). All 4 premium
  // features run 100% locally on the device (offline-first) — no backend
  // routes needed anymore.
  const FEATURES = [
    { key: 'form-check', icon: 'fa-video',      title: 'FormSense — AI Form Check', titleAr: 'فورم سينس — تدقيق الأداء بالذكاء الاصطناعي',
      desc: 'Open your camera while training — AI checks your form in real time and fixes your technique before it can hurt you.',
      descAr: 'افتح الكاميرا أثناء التمرين — الذكاء الاصطناعي يراقب أداءك ويصحح تقنيتك قبل أن تسبب إصابة.', launch: 'openFormSense' },
    { key: 'rep-count',  icon: 'fa-stopwatch-20', title: 'RepSense — AI Rep Counter', titleAr: 'ريب سينس — عدّاد التكرارات الذكي',
      desc: 'The AI counts every rep automatically while you focus on your set — hands-free.',
      descAr: 'الذكاء الاصطناعي يعدّ كل تكرار تلقائياً بينما تركّز في تمرينك — بدون أي لمس.', launch: 'openRepSense' },
    { key: 'progression', icon: 'fa-dumbbell',  title: 'ProgressIQ — Smart Weight Coach', titleAr: 'بروغريس آيكيو — مدرب الأوزان الذكي',
      desc: 'AI studies your last sets and tells you the exact weight, reps and rest for your next session.',
      descAr: 'الذكاء الاصطناعي يدرس مجموعاتك السابقة ويحدد لك الوزن والتكرارات والراحة المناسبة لجلستك القادمة.', launch: 'openProgressIQ' },
    { key: 'recovery',   icon: 'fa-battery-three-quarters', title: 'RecoveryIQ — Muscle Recovery Guide', titleAr: 'ريكفري آيكيو — دليل استشفاء العضلات',
      desc: 'See which muscles have recovered and which need rest — AI tells you exactly what to train today.',
      descAr: 'اعرف أي العضلات استُشفت وأيها يحتاج راحة — الذكاء الاصطناعي يخبرك بما يجب تدريبه اليوم.', launch: 'openRecoveryIQ' }
  ];

  // ─── State ──────────────────────────────────────────────────────────────
  let selectedPlan = 'yearly';
  let priceData = null;          // { currency, monthly, yearly, monthlyMinor, yearlyMinor, country }
  let pricePromise = null;
  let featureKey = null;         // feature that triggered the paywall

  // ─── Small helpers ──────────────────────────────────────────────────────
  function user() {
    try {
      if (typeof currentUser === 'function') return currentUser();
      if (typeof store !== 'undefined' && store.session) return store.users[store.session];
      return null;
    } catch (e) { return null; }
  }
  function ar() { return typeof store !== 'undefined' && store.lang === 'ar'; }
  // IMPORTANT: store.users is a GETTER that re-parses localStorage on every
  // access — each user() call returns a FRESH COPY. Mutate the copy you hold
  // and pass THAT SAME object to save(); never re-fetch inside save.
  function save(u) {
    try {
      const target = u || user();
      if (target && typeof saveUser === 'function' && store.session) saveUser(store.session, target);
    } catch (e) {}
  }
  function toast(msg, type) {
    try { if (typeof showVoltaToast === 'function') showVoltaToast(msg, type || 'info'); } catch (e) {}
  }
  function timezone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; }
  }

  // ─── Premium check (local cache of the server state) ────────────────────
  // Real check: user.isPremium === true AND not expired. Full duration is
  // guaranteed by the server; expiry is the truth, the flag is the cache.
  function isPremium() {
    const u = user();
    if (!u || u.isPremium !== true) return false;
    if (u.premiumExpiry) {
      if (Date.now() >= u.premiumExpiry) return false; // expired → free again
    }
    return true;
  }

  function premiumInfo() {
    const u = user();
    if (!u || !isPremium()) return null;
    const expiry = u.premiumExpiry || 0;
    const start = u.premiumStartedAt || (expiry - 30 * 864e5);
    const msLeft = expiry ? Math.max(0, expiry - Date.now()) : Infinity;
    const periodMs = Math.max(1, expiry - start);
    return {
      plan: u.premiumPlan || 'monthly',
      expiry: expiry,
      startedAt: start,
      daysLeft: isFinite(msLeft) ? Math.ceil(msLeft / 864e5) : null,
      pctLeft: expiry ? Math.max(0, Math.min(100, (msLeft / periodMs) * 100)) : 100,
      cancelAtPeriodEnd: !!u.premiumCancelAtPeriodEnd,
      status: u.premiumStatus || 'active',
      currency: u.premiumCurrency || 'USD',
      amount: u.premiumAmount || 0,
      provider: u.premiumProvider || 'stripe'
    };
  }

  // Apply a server subscription response onto the local user record.
  function applyServerState(s) {
    const u = user();
    if (!u || !s) return false;
    u.isPremium = !!s.premium;
    u.premiumPlan = s.plan || u.premiumPlan;
    u.premiumStatus = s.status || 'active';
    u.premiumExpiry = s.periodEnd ? new Date(s.periodEnd).getTime() : u.premiumExpiry;
    u.premiumStartedAt = s.periodStart ? new Date(s.periodStart).getTime() : u.premiumStartedAt;
    u.premiumCancelAtPeriodEnd = !!s.cancelAtPeriodEnd;
    u.premiumCurrency = s.currency || u.premiumCurrency;
    u.premiumAmount = typeof s.amount === 'number' ? s.amount : u.premiumAmount;
    u.premiumCountry = s.country || u.premiumCountry;
    u.premiumProvider = s.provider || u.premiumProvider;
    save(u); // save the SAME mutated object (store.users re-parses!)
    updateButton();
    return true;
  }

  // ─── v29 (user): the 4 AI features are FREE for everyone ───────────────
  // "ai features still dont work on the html file" — FormSense, RepSense,
  // ProgressIQ and RecoveryIQ run 100% on-device (v25 engines, offline
  // first), so gating them behind the paywall only made them look broken.
  // They are unlocked for every account now; the premium hub stays for the
  // subscription itself (supporter perks, future cloud extras).
  var AI_FREE_KEYS = ['form-check', 'rep-count', 'progression', 'recovery'];
  function aiFree(key) {
    return AI_FREE_KEYS.indexOf(String(key || '')) !== -1;
  }

  // ─── Public: gate a feature — show paywall if not premium ───────────────
  function gate(key) {
    if (aiFree(key)) return true;   // v29: on-device AI features are never gated
    if (isPremium()) return true;
    openHub(key);
    return false;
  }

  // ─── Pricing (server-resolved, regional) ────────────────────────────────
  function loadPrices(force) {
    if (priceData && !force) return Promise.resolve(priceData);
    if (pricePromise && !force) return pricePromise;
    // IMPORTANT: do NOT send the user's cached premiumCountry here. If a
    // previous request ever resolved to a fallback country (e.g. US) and got
    // cached on the user record, every later call would pin that country and
    // the user would keep seeing USD instead of their real local price
    // (reported: Egypt user stuck on USD). The server resolves the country
    // from the Vercel geo header → IANA timezone every time.
    pricePromise = fetch(API_URL + '/api/premium/price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timezone: timezone() })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok) { priceData = d; return priceData; }
        throw new Error('price failed');
      })
      .catch(function () {
        // Server unreachable (404 on an older Vercel deployment, offline PWA,
        // first-load race) → resolve the regional price LOCALLY from the
        // embedded pricing table (js/pricing-fallback.js, same numbers as the
        // server). This is what fixes "Egypt user keeps seeing USD": the old
        // code fell back to a hardcoded USD row whenever the API 404'd.
        // IMPORTANT: we DO store the row in priceData — the paywall renders
        // from priceData, so returning a row without caching it would leave
        // the old/USD value on screen. The next openHub(force) still retries
        // the server to recover geo-header-accurate pricing.
        pricePromise = null;
        try {
          const F = window.VoltaPricingFallback;
          if (F) {
            const p = F.resolvePrice({ timezone: timezone() });
            priceData = {
              ok: true,
              country: p.country,
              currency: p.currency,
              monthlyMinor: p.monthly,
              yearlyMinor: p.yearly,
              monthly: F.formatPrice(p.monthly, p.currency),
              yearly: F.formatPrice(p.yearly, p.currency),
              stripe: F.stripeSupportsCurrency(p.currency),
              fallback: true
            };
            return priceData;
          }
        } catch (e) {}
        priceData = { ok: true, country: '', currency: 'USD', monthly: '4.99 USD', yearly: '39.99 USD', monthlyMinor: 499, yearlyMinor: 3999, fallback: true };
        return priceData;
      })
      .finally(function () { pricePromise = null; });
    return pricePromise;
  }

  function savePercent() {
    if (!priceData) return 30;
    const m = priceData.monthlyMinor || 0, y = priceData.yearlyMinor || 0;
    if (!m || !y) return 30;
    return Math.max(1, Math.round((1 - y / (m * 12)) * 100));
  }

  // ─── Subscribe flow ─────────────────────────────────────────────────────
  async function subscribe() {
    if (typeof store === 'undefined' || !store.session) {
      toast(ar() ? 'سجّل الدخول أو أنشئ حساباً للاشتراك.' : 'Log in or create an account to subscribe.', 'info');
      try { if (typeof showScreen === 'function') showScreen('screen-auth'); } catch (e) {}
      return;
    }
    const u = user();
    if (!u) return;

    // Google Play Billing path (packaged PWA on the Play Store)
    try {
      if (window.getDigitalGoodsService) {
        const svc = await window.getDigitalGoodsService('play');
        if (svc) return subscribePlay(svc);
      }
    } catch (e) { /* not in the Play environment → web flow */ }

    const btn = document.getElementById('vp-subscribe-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ' + (ar() ? 'جارٍ التحميل...' : 'Loading...'); }
    try {
      const res = await fetch(API_URL + '/api/premium/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: selectedPlan, email: store.session, timezone: timezone() })
      });
      const data = await res.json();
      if (data && data.ok && data.url) {
        window.location.href = data.url; // Stripe hosted checkout (or demo redirect)
        return;
      }
      throw new Error((data && data.error) || 'checkout failed');
    } catch (err) {
      console.error('[VoltaPremium] checkout error:', err.message);
      toast(ar() ? 'تعذر بدء الدفع — حاول مرة أخرى.' : 'Could not start checkout — please try again.', 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = ctaLabel(); }
    }
  }

  // Google Play Billing (Digital Goods API) — used when packaged for Play
  async function subscribePlay(svc) {
    try {
      const itemId = selectedPlan === 'yearly' ? 'volta_premium_yearly' : 'volta_premium_monthly';
      const items = await svc.list();
      const item = (items || []).find(function (i) { return i.id === itemId; });
      if (!item) { toast(ar() ? 'الخطة غير متوفرة في متجر Play.' : 'Plan not available in Play Store.', 'error'); return; }
      const purchase = await svc.purchase(itemId);
      const token = purchase && (purchase.purchaseToken || (purchase.token));
      const res = await fetch(API_URL + '/api/premium/google-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: store.session, purchaseToken: token, productId: itemId })
      });
      const data = await res.json();
      if (data && data.ok) { applyServerState(data); toast(ar() ? 'تم تفعيل بريميوم!' : 'Premium activated!', 'success'); closeModalSafe(); }
      else toast(data && data.error ? data.error : (ar() ? 'تعذر التحقق من الشراء.' : 'Purchase verification failed.'), 'error');
    } catch (e) {
      console.error('[VoltaPremium] play billing error:', e);
      toast(ar() ? 'خطأ في الشراء من متجر Play.' : 'Play Billing purchase error.', 'error');
    }
  }

  // Called from volta.js → handlePaymentRedirect when we land back from
  // Stripe (or the demo redirect). sessionId validates REAL payments.
  async function completeCheckout(plan, sessionId) {
    const u = user();
    if (!u) return false;
    try {
      const res = await fetch(API_URL + '/api/premium/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: store.session, plan: plan || 'monthly', sessionId: sessionId || undefined, timezone: timezone() })
      });
      const data = await res.json();
      if (data && data.ok && data.premium) {
        applyServerState(data);
        toast(ar() ? 'تم تفعيل بريميوم! شكراً لاشتراكك.' : 'Premium activated! Thank you for subscribing.', 'success');
        return true;
      }
      toast(data && data.error ? data.error : (ar() ? 'تعذر تأكيد الدفع.' : 'Could not confirm the payment.'), 'error');
      return false;
    } catch (e) {
      console.error('[VoltaPremium] verify error:', e);
      toast(ar() ? 'تعذر تأكيد الدفع — تحقق من الاتصال.' : 'Could not confirm payment — check your connection.', 'error');
      return false;
    }
  }

  // ─── Server sync (status is the source of truth) ────────────────────────
  async function refreshFromServer() {
    if (typeof store === 'undefined' || !store.session) return;
    try {
      const res = await fetch(API_URL + '/api/premium/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: store.session })
      });
      const data = await res.json();
      if (data && data.ok && data.found) {
        // If local says expired but server says active → trust the server.
        if (data.premium || isPremium() === false) applyServerState(data);
      }
    } catch (e) { /* offline — keep the local cache */ }
  }

  // ─── Cancel / resume (keeps FULL paid duration either way) ──────────────
  async function cancel() {
    if (!user()) return;
    try {
      const res = await fetch(API_URL + '/api/premium/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: store.session })
      });
      const data = await res.json();
      if (data && data.ok) {
        applyServerState(data);
        toast(ar() ? 'تم إلغاء التجديد — بريميوم يستمر حتى نهاية مدتك.' : 'Auto-renew cancelled — Premium stays until your period ends.', 'info');
        renderModal();
        renderHomeCard();
      } else toast(ar() ? 'تعذر الإلغاء — حاول مرة أخرى.' : 'Could not cancel — try again.', 'error');
    } catch (e) { toast(ar() ? 'خطأ في الاتصال.' : 'Connection error.', 'error'); }
  }
  async function resume() {
    if (!user()) return;
    try {
      const res = await fetch(API_URL + '/api/premium/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: store.session, resume: true })
      });
      const data = await res.json();
      if (data && data.ok) {
        applyServerState(data);
        toast(ar() ? 'تم استئناف التجديد التلقائي.' : 'Auto-renew resumed.', 'success');
        renderModal();
        renderHomeCard();
      } else toast(ar() ? 'تعذر الاستئناف — حاول مرة أخرى.' : 'Could not resume — try again.', 'error');
    } catch (e) { toast(ar() ? 'خطأ في الاتصال.' : 'Connection error.', 'error'); }
  }

  // ─── Local activate/deactivate (kept for tests/support) ─────────────────
  function activateLocal(planId) {
    const u = user();
    if (!u) return false;
    u.isPremium = true;
    u.premiumPlan = planId || 'monthly';
    u.premiumStatus = 'active';
    u.premiumStartedAt = Date.now();
    u.premiumExpiry = Date.now() + (planId === 'yearly' ? 365 : 30) * 864e5;
    save(u); updateButton();
    return true;
  }
  function deactivate() {
    const u = user();
    if (!u) return false;
    u.isPremium = false;
    ['premiumPlan', 'premiumExpiry', 'premiumStartedAt', 'premiumStatus', 'premiumCancelAtPeriodEnd'].forEach(function (k) { delete u[k]; });
    save(u); updateButton();
    return true;
  }
  function restore() {
    if (isPremium()) { toast(ar() ? 'بريميوم مُفعّل بالفعل.' : 'Premium is already active.', 'success'); return true; }
    refreshFromServer().then(function () {
      if (isPremium()) toast(ar() ? 'تم استعادة اشتراكك!' : 'Subscription restored!', 'success');
      else toast(ar() ? 'لا يوجد اشتراك نشط.' : 'No active subscription found.', 'info');
    });
    return true;
  }

  // ═════════════════════════════ UI ═══════════════════════════════════════

  function ctaLabel() {
    return '<i class="fa-solid fa-bolt"></i> ' + (ar() ? 'اشترك الآن' : 'Subscribe Now');
  }

  // Renders the 5 feature rows (paywall) or launcher chips (management)
  // NOTE: the paywall lists ONLY premium features. Free AI features (Coach
  // AI, Weekly Report, Diet Plan) live in their own panels — never here.
  function featureRows() {
    return FEATURES.map(function (f) {
      return '<div class="vp-feature"><i class="fa-solid ' + f.icon + '"></i><div>' +
        '<b data-ar="' + f.titleAr + '">' + f.title + '</b>' +
        '<small data-ar="' + f.descAr + '">' + f.desc + '</small></div></div>';
    }).join('');
  }
  function featureChips() {
    return FEATURES.map(function (f) {
      return '<button class="vp-fx" onclick="VoltaAI.' + f.launch + '()">' +
        '<i class="fa-solid ' + f.icon + '"></i><span data-ar="' + f.titleAr + '">' + f.title.split(' — ')[0] + '</span></button>';
    }).join('');
  }

  function planCardsHtml() {
    const p = priceData || { monthly: '4.99 USD', yearly: '39.99 USD' };
    const save = savePercent();
    return (
      '<div class="vp-plan ' + (selectedPlan === 'monthly' ? 'selected' : '') + '" data-plan="monthly" onclick="VoltaPremium.selectPlan(\'monthly\')">' +
        '<div class="vp-plan-name" data-ar="شهري">Monthly</div>' +
        '<div class="vp-plan-price">' + p.monthly + '</div>' +
        '<div class="vp-plan-per" data-ar="كل شهر">per month</div>' +
        '<div class="vp-plan-underline"></div>' +
      '</div>' +
      '<div class="vp-plan ' + (selectedPlan === 'yearly' ? 'selected' : '') + '" data-plan="yearly" onclick="VoltaPremium.selectPlan(\'yearly\')">' +
        '<span class="vp-save" data-ar="وفّر ' + save + '%">' + (ar() ? 'وفّر ' + save + '%' : 'SAVE ' + save + '%') + '</span>' +
        '<div class="vp-plan-name" data-ar="سنوي">Yearly</div>' +
        '<div class="vp-plan-price">' + p.yearly + '</div>' +
        '<div class="vp-plan-per" data-ar="كل سنة">per year</div>' +
        '<div class="vp-plan-underline"></div>' +
      '</div>'
    );
  }

  function paywallHtml() {
    const featureLine = featureKey ? (function () {
      const f = FEATURES.find(function (x) { return x.key === featureKey; });
      return f ? '<p class="vp-sub" style="color:var(--accent);font-weight:700;">' + (ar() ? f.titleAr : f.title) + ' ' + (ar() ? 'خاصية بريميوم' : 'is a Premium feature') + '</p>' : '';
    })() : '';
    return (
      '<div style="text-align:center;">' +
        '<span class="vp-eyebrow"><i class="fa-solid fa-bolt"></i> VOLTA PREMIUM</span>' +
        '<h3 class="vp-title" data-ar="افتح قوة فولتا الكاملة">Unlock the full Volta</h3>' +
        (featureLine || '<p class="vp-sub" data-ar="ميزات ذكاء اصطناعي تتدرّب معك.">Premium AI features that train with you.</p>') +
      '</div>' +
      '<div class="vp-features">' + featureRows() + '</div>' +
      '<div class="vp-plans" id="vp-plans">' + planCardsHtml() + '</div>' +
      '<button class="vp-cta" id="vp-subscribe-btn" onclick="VoltaPremium.subscribe()">' + ctaLabel() + '</button>'
    );
  }

  function fmtDate(ms) {
    try {
      return new Date(ms).toLocaleDateString(ar() ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) { return new Date(ms).toDateString(); }
  }

  function manageHtml() {
    const info = premiumInfo();
    if (!info) return paywallHtml();
    const days = info.daysLeft;
    const daysLabel = ar()
      ? (days === 1 ? 'يوم متبقي' : (days === 0 ? 'ينتهي اليوم' : 'أيام متبقية'))
      : (days === 1 ? 'day left' : (days === 0 ? 'ends today' : 'days left'));
    const planName = info.plan === 'yearly' ? (ar() ? 'سنوي' : 'Yearly') : (ar() ? 'شهري' : 'Monthly');
    const renewsOrEnds = info.cancelAtPeriodEnd
      ? (ar() ? 'ينتهي الاشتراك في' : 'Subscription ends on')
      : (ar() ? 'يتجدد في' : 'Renews on');
    const pct = info.pctLeft != null ? info.pctLeft.toFixed(1) : '100';
    return (
      '<div style="text-align:center;">' +
        '<span class="vp-eyebrow"><i class="fa-solid fa-bolt"></i> VOLTA PREMIUM</span>' +
        '<h3 class="vp-title" data-ar="بريميوم مُفعّل">Premium Active</h3>' +
      '</div>' +
      '<div class="vp-status-card">' +
        '<div class="vp-days">' + (days != null ? days : '∞') + ' <small>' + daysLabel + '</small></div>' +
        '<div class="vp-plan-line">' + planName + ' · ' + renewsOrEnds + ' <b>' + (info.expiry ? fmtDate(info.expiry) : '—') + '</b></div>' +
        '<div class="vp-period-bar"><div class="vp-period-fill" style="width:' + pct + '%"></div></div>' +
        (info.cancelAtPeriodEnd
          ? '<div class="vp-status-note"><i class="fa-solid fa-triangle-exclamation"></i> ' + (ar() ? 'تم إلغاء التجديد التلقائي — ستفقد بريميوم في ' : 'Auto-renew is off — you lose Premium on ') + (info.expiry ? fmtDate(info.expiry) : '') + '</div>'
          : '') +
      '</div>' +
      '<div class="vp-btn-row">' +
        '<button class="btn primary" onclick="VoltaPremium.openHub(\'__paywall__\')" style="min-width:130px;"><i class="fa-solid fa-rotate-right"></i> <span data-ar="تجديد">' + (ar() ? 'تجديد' : 'Renew') + '</span></button>' +
        (info.cancelAtPeriodEnd
          ? '<button class="btn ghost" onclick="VoltaPremium.resume()" style="min-width:130px;"><i class="fa-solid fa-undo"></i> <span data-ar="استئناف">' + (ar() ? 'استئناف' : 'Resume') + '</span></button>'
          : '<button class="btn ghost" onclick="VoltaPremium.cancel()" style="min-width:130px;"><i class="fa-solid fa-xmark"></i> <span data-ar="إلغاء الاشتراك">' + (ar() ? 'إلغاء الاشتراك' : 'Cancel') + '</span></button>') +
      '</div>' +
      '<div style="height:16px;"></div>' +
      '<div class="vp-fx-grid">' + featureChips() + '</div>'
    );
  }

  function renderModal() {
    const body = document.getElementById('premium-modal-body');
    if (!body) return;
    const paywall = featureKey === '__paywall__' || !isPremium();
    body.innerHTML = paywall ? paywallHtml() : manageHtml();
    if (typeof store !== 'undefined' && store.lang === 'ar' && typeof applyTranslations === 'function') {
      try { applyTranslations(); } catch (e) {}
    }
  }

  function openHub(key) {
    featureKey = key || null;
    renderModal();
    if (typeof openModal === 'function') openModal('premium-modal');
    // If the current row came from the LOCAL fallback table (server was down
    // or 404 at some point), retry the server once per hub-open so the price
    // recovers to geo-header accuracy as soon as the deployment is fixed —
    // without ever blocking or blanking the paywall (it renders instantly
    // from priceData, then re-renders if fresher data arrives).
    const wasFallback = !!(priceData && priceData.fallback);
    loadPrices(wasFallback).then(function () {
      // Re-render once prices arrive so the CTA/plans show local currency.
      const body = document.getElementById('premium-modal-body');
      if (body && document.getElementById('premium-modal').classList.contains('active')) {
        renderModal();
      }
    }).catch(function () {});
  }

  function showPaywall(key) { openHub(key); }
  function showPremiumScreen() { openHub(); } // legacy alias

  // ─── Dashboard home card + top-right pill + sidebar tag ─────────────────
  function renderHomeCard() {
    const card = document.getElementById('premium-home-card');
    if (!card) return;
    if (typeof store === 'undefined' || !store.session) { card.style.display = 'none'; return; }
    card.style.display = 'block';
    const info = premiumInfo();
    if (!info) {
      card.innerHTML =
        '<div class="vp-home-head">' +
          '<span class="vp-home-ic"><i class="fa-solid fa-bolt"></i></span>' +
          '<div><h3 data-ar="فولتا بريميوم">VOLTA PREMIUM</h3>' +
          '<p data-ar="مدرب بالذكاء الاصطناعي يصحح أداءك ويعّد تكراراتك.">An AI coach that checks your form and counts your reps.</p></div>' +
          '<button class="vp-home-cta" onclick="VoltaPremium.openHub()">' + (ar() ? 'اشترك' : 'Go Premium') + '</button>' +
        '</div>' +
        '<div class="vp-fx-grid">' + featureChips() + '</div>';
    } else {
      const days = info.daysLeft;
      const status = ar()
        ? ('بريميوم ' + (info.plan === 'yearly' ? 'السنوي' : 'الشهري') + ' · ' + (days != null ? days + ' يوم متبقي' : 'نشط'))
        : ((info.plan === 'yearly' ? 'Yearly' : 'Monthly') + ' Premium · ' + (days != null ? days + ' days left' : 'active')) +
          (info.cancelAtPeriodEnd ? (ar() ? ' · التجديد ملغي' : ' · renewal off') : '');
      card.innerHTML =
        '<div class="vp-home-head">' +
          '<span class="vp-home-ic"><i class="fa-solid fa-bolt"></i></span>' +
          '<div><h3 data-ar="فولتا بريميوم">VOLTA PREMIUM</h3>' +
          '<p class="vp-status-inline"><b>' + status + '</b></p></div>' +
          '<button class="vp-home-cta" onclick="VoltaPremium.openHub()">' + (ar() ? 'إدارة' : 'Manage') + '</button>' +
        '</div>' +
        '<div class="vp-fx-grid">' + featureChips() + '</div>';
    }
    if (typeof store !== 'undefined' && store.lang === 'ar' && typeof applyTranslations === 'function') {
      try { applyTranslations(); } catch (e) {}
    }
  }

  function updateButton() {
    // 1) top-right pill
    // v17 (user): "for a premium user on phone, add the premium tag at the
    // top right of the screen if they are premium only" — the pill is now a
    // PREMIUM-ONLY status tag. Free users (and logged-out) never see it; the
    // CSS keeps it phone-only (hidden ≥769px) and popup-safe (modal-open).
    const btn = document.getElementById('app-premium-btn');
    if (btn) {
      const prem = !!(typeof store !== 'undefined' && store.session && isPremium());
      btn.style.display = prem ? 'inline-flex' : 'none';
      btn.classList.toggle('is-premium', prem);
      const txt = btn.querySelector('.vp-pill-txt');
      if (txt) {
        txt.textContent = ar() ? 'بريميوم' : 'Premium';
        txt.setAttribute('data-ar', 'بريميوم');
      }
    }
    // 2) sidebar gold tag
    const tag = document.getElementById('volta-premium-tag');
    if (tag) tag.style.display = (store && store.session && isPremium()) ? 'inline-block' : 'none';
    // 3) Recovery IQ — PREMIUM-ONLY VISIBILITY (user request, v6).
    //    Free users never see the Recovery IQ entries at all (sidebar +
    //    mobile bottom nav). Subscribers see them instantly. The launcher
    //    (deRecoveryLaunch) and the screen render keep their own premium
    //    gates as defense in depth.
    try {
      const premNow = (typeof store !== 'undefined' && store.session && isPremium());
      document.querySelectorAll('.side-btn-recovery, .bottom-nav-item[data-btab="recovery"]').forEach(function (b) {
        b.style.display = premNow ? '' : 'none';
      });
    } catch (e) {}
    // 4) home card
    renderHomeCard();
  }

  function closeModalSafe() {
    try { if (typeof closeModal === 'function') closeModal('premium-modal'); } catch (e) {}
  }

  // Compatibility no-ops (old entry points that may still be referenced)
  function updateScreenNotice() {}
  function back() {}
  function openPayment() { openHub(); }
  function processPayment() { subscribe(); }
  function formatCardNumber() {}
  function formatCardExpiry() {}
  function selectPlan(planId) {
    selectedPlan = planId;
    document.querySelectorAll('#vp-plans .vp-plan').forEach(function (el) {
      el.classList.toggle('selected', el.getAttribute('data-plan') === planId);
    });
  }
  function getPlans() {
    const p = priceData || { monthly: '4.99 USD', yearly: '39.99 USD' };
    return { monthly: { id: 'monthly', price: p.monthly }, yearly: { id: 'yearly', price: p.yearly } };
  }
  function getFeatures() { return FEATURES; }

  // ─── Init ───────────────────────────────────────────────────────────────
  try {
    updateButton();
    loadPrices();
    if (typeof store !== 'undefined' && store.session) refreshFromServer();
  } catch (e) {}
  // premium.js loads BEFORE volta.js (which defines `store` and restores the
  // session), so the init call above can't see the logged-in user yet.
  // Re-sync the entry buttons after boot — otherwise an auto-logged-in user
  // lands with the top-right pill hidden until some later repaint calls it.
  [0, 250, 800, 1600].forEach(function (d) {
    setTimeout(function () { try { updateButton(); } catch (e) {} }, d);
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { try { updateButton(); } catch (e) {} });
  }
  window.addEventListener('load', function () { try { updateButton(); } catch (e) {} });

  return {
    isPremium: isPremium,
    aiFree: aiFree,          // v29: the 4 on-device AI features — always unlocked
    gate: gate,
    openHub: openHub,
    loadPrices: loadPrices,
    showPaywall: showPaywall,
    showPremiumScreen: showPremiumScreen,
    subscribe: subscribe,
    completeCheckout: completeCheckout,
    refreshFromServer: refreshFromServer,
    cancel: cancel,
    resume: resume,
    restore: restore,
    activate: activateLocal,
    deactivate: deactivate,
    selectPlan: selectPlan,
    updateButton: updateButton,
    renderHomeCard: renderHomeCard,
    updateScreenNotice: updateScreenNotice,
    openPayment: openPayment,
    processPayment: processPayment,
    formatCardNumber: formatCardNumber,
    formatCardExpiry: formatCardExpiry,
    back: back,
    getPlans: getPlans,
    getFeatures: getFeatures
  };
})();
