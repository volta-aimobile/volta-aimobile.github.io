 































window.VoltaPremium = (function () {

   
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
    { key: 'recovery',   icon: 'fa-battery-three-quarters', title: 'RecoveryIQ — Muscle Recovery Guide', titleAr: 'Recovery IQ — دليل استشفاء العضلات',
      desc: 'See which muscles have recovered and which need rest — AI tells you exactly what to train today.',
      descAr: 'اعرف أي العضلات استُشفت وأيها يحتاج راحة — الذكاء الاصطناعي يخبرك بما يجب تدريبه اليوم.', launch: 'openRecoveryIQ' }
  ];

   
  let selectedPlan = 'yearly';
  let priceData = null;           
  let pricePromise = null;
  let featureKey = null;          

   
  function user() {
    try {
      if (typeof currentUser === 'function') return currentUser();
      if (typeof store !== 'undefined' && store.session) return store.users[store.session];
      return null;
    } catch (e) { return null; }
  }
  function ar() { return typeof store !== 'undefined' && store.lang === 'ar'; }
   
   
   
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

   
   
   
  function isPremium() {
    const u = user();
    if (!u || u.isPremium !== true) return false;
    if (u.premiumExpiry) {
      if (Date.now() >= u.premiumExpiry) return false;  
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
    save(u);  
    updateButton();
    return true;
  }

   
   
   
   
   
   
   
   
   
   
  function gate(key) {
    if (isPremium()) return true;
    openHub(key);
    return false;
  }

   
  function loadPrices(force) {
    if (priceData && !force) return Promise.resolve(priceData);
    if (pricePromise && !force) return pricePromise;
     
     
     
     
     
     
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

   
   
   
   
   
   
   
   
  var ETISALAT_WALLET = '01115502733';

  function etisalatPriceLabel() {
     
     
    try {
      if (priceData && priceData.currency) {
        return selectedPlan === 'yearly' ? priceData.yearly : priceData.monthly;
      }
    } catch (e) {}
    return selectedPlan === 'yearly' ? '249 EGP' : '29 EGP';
  }

  function subscribe() {
    if (typeof store === 'undefined' || !store.session) {
      toast(ar() ? 'سجّل الدخول أو أنشئ حساباً للاشتراك.' : 'Log in or create an account to subscribe.', 'info');
      try { if (typeof showScreen === 'function') showScreen('screen-auth'); } catch (e) {}
      return;
    }
    openEtisalatPay();
  }

   
  function closeEtisalatPay() {
    var m = document.getElementById('etisalat-pay-modal');
    if (m) m.remove();
    document.body.style.overflow = '';
  }

  function copyWallet() {
    try {
      var done = function () { toast(ar() ? 'تم نسخ الرقم' : 'Number copied', 'success'); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(ETISALAT_WALLET).then(done, done);
      } else {
        var t = document.createElement('textarea');
        t.value = ETISALAT_WALLET; document.body.appendChild(t); t.select();
        try { document.execCommand('copy'); } catch (e) {}
        t.remove(); done();
      }
    } catch (e) {}
  }
  window.__voltaCopyWallet = function () { copyWallet(); };

  function etisalatStatus(msg, type) {
    var el = document.getElementById('etisalat-status');
    if (!el) return;
    if (!msg) { el.style.display = 'none'; el.textContent = ''; return; }
    el.style.display = 'block';
    el.className = 'etisalat-status ' + (type || 'info');
    el.innerHTML = msg;
  }

  function openEtisalatPay() {
    closeEtisalatPay();
    var AR = ar();
    var planName = selectedPlan === 'yearly' ? (AR ? 'سنوي' : 'Yearly') : (AR ? 'شهري' : 'Monthly');
    var price = etisalatPriceLabel();
    var m = document.createElement('div');
    m.id = 'etisalat-pay-modal';
    m.className = 'modal-overlay';
    m.style.zIndex = '10030';
    m.innerHTML =
      '<div class="modal-content etisalat-pay">' +
        '<button class="modal-close etisalat-x" type="button" id="etisalat-x" aria-label="' + (AR ? 'إغلاق' : 'Close') + '"></button>' +
        '<div class="etisalat-head">' +
          '<span class="etisalat-ic"><i class="fa-solid fa-mobile-screen-button"></i></span>' +
          '<div><h3 data-ar="الدفع بمحفظة هاتفك">Pay with your mobile wallet</h3>' +
          '<small data-ar="طريقة الدفع الحالية">The current payment method</small></div>' +
        '</div>' +
        '<div class="etisalat-order">' +
          '<span>' + (AR ? 'الخطة' : 'Plan') + '</span><b>' + planName + '</b>' +
          '<span>' + (AR ? 'المبلغ' : 'Amount') + '</span><b class="etisalat-amount">' + price + '</b>' +
        '</div>' +
        '<div class="etisalat-step">' +
          '<b><i class="fa-solid fa-1"></i> ' + (AR ? 'حوّل المبلغ بالضبط إلى هذه المحفظة' : 'Send the EXACT amount to this wallet') + '</b>' +
          '<div class="etisalat-wallet-row">' +
            '<code dir="ltr">' + ETISALAT_WALLET + '</code>' +
            '<button type="button" class="etisalat-copy" onclick="__voltaCopyWallet()"><i class="fa-solid fa-copy"></i> ' + (AR ? 'نسخ' : 'Copy') + '</button>' +
          '</div>' +
          '<small>' + (AR ? 'افتح تطبيق محفظة هاتفك أو اذهب لأقرب منفذ، وحوّل ' + price + ' إلى الرقم أعلاه.' : 'Open your mobile wallet app or visit any agent and send ' + price + ' to the number above.') + '</small>' +
        '</div>' +
        '<div class="etisalat-step">' +
          '<b><i class="fa-solid fa-2"></i> ' + (AR ? 'أدخل رقم عملية التحويل' : 'Enter the transaction reference') + '</b>' +
          '<input type="text" id="etisalat-txid" inputmode="numeric" maxlength="14" dir="ltr" placeholder="' + (AR ? '8-14 رقماً من رسالة التأكيد' : '8-14 digits from the confirmation SMS') + '" />' +
        '</div>' +
        '<div class="etisalat-step">' +
          '<b><i class="fa-solid fa-3"></i> ' + (AR ? 'أرفق صورة الإيصال (اختياري — يسرّع التحقق)' : 'Attach the receipt screenshot (optional — speeds up verification)') + '</b>' +
          '<input type="file" id="etisalat-shot" accept="image/*" style="display:none;" />' +
          '<button type="button" class="etisalat-attach" id="etisalat-attach-btn"><i class="fa-solid fa-paperclip"></i> ' + (AR ? 'إرفاق صورة' : 'Attach screenshot') + '</button>' +
          '<small id="etisalat-shot-name"></small>' +
        '</div>' +
        '<div class="etisalat-status" id="etisalat-status" style="display:none;"></div>' +
        '<button type="button" class="vp-cta etisalat-cta" id="etisalat-verify"><i class="fa-solid fa-shield-halved"></i> ' + (AR ? 'تحقق وتفعيل Premium' : 'Verify & Activate Premium') + '</button>' +
        '<p class="etisalat-note">' + (AR ? 'سيتم تفعيل Premium فور نجاح التحقق من العملية.' : 'Premium activates the moment your transaction is verified.') + '</p>' +
      '</div>';
    document.body.appendChild(m);
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(function () { m.classList.add('active'); });
    m.addEventListener('click', function (e) { if (e.target === m) closeEtisalatPay(); });
    document.getElementById('etisalat-x').addEventListener('click', closeEtisalatPay);
    var txInput = document.getElementById('etisalat-txid');
    txInput.addEventListener('input', function () {
      this.value = this.value.replace(/[^0-9]/g, '').slice(0, 14);
    });
    var attachBtn = document.getElementById('etisalat-attach-btn');
    var shotInput = document.getElementById('etisalat-shot');
    attachBtn.addEventListener('click', function () { shotInput.click(); });
    shotInput.addEventListener('change', function () {
      var nameEl = document.getElementById('etisalat-shot-name');
      if (shotInput.files && shotInput.files[0]) {
        nameEl.textContent = '✓ ' + shotInput.files[0].name;
      } else { nameEl.textContent = ''; }
    });
    document.getElementById('etisalat-verify').addEventListener('click', function () { verifyEtisalat(); });
    try {
      if (typeof applyTranslations === 'function' && AR) applyTranslations();
    } catch (e) {}
    setTimeout(function () { try { txInput.focus(); } catch (e) {} }, 80);
  }

  async function verifyEtisalat() {
    var AR = ar();
    var txid = (document.getElementById('etisalat-txid').value || '').trim();
    if (!/^\d{8,14}$/.test(txid)) {
      etisalatStatus(AR ? 'رقم العملية يجب أن يكون من 8 إلى 14 رقماً.' : 'The transaction reference must be 8-14 digits.', 'error');
      return;
    }
    var btn = document.getElementById('etisalat-verify');
    var idleLabel = '<i class="fa-solid fa-shield-halved"></i> ' + (AR ? 'تحقق وتفعيل Premium' : 'Verify & Activate Premium');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ' + (AR ? 'جارٍ التحقق…' : 'Verifying…');
    etisalatStatus(AR ? 'جارٍ التحقق من عملية الدفع…' : 'Verifying your payment…', 'info');
    try {
       
       
      var shot = null;
      var shotInput = document.getElementById('etisalat-shot');
      if (shotInput.files && shotInput.files[0]) {
        try {
          shot = await new Promise(function (resolve, reject) {
            var img = new Image();
            var url = URL.createObjectURL(shotInput.files[0]);
            img.onload = function () {
              try {
                var maxDim = 1280;
                var scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
                var c = document.createElement('canvas');
                c.width = Math.max(1, Math.round(img.naturalWidth * scale));
                c.height = Math.max(1, Math.round(img.naturalHeight * scale));
                c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                URL.revokeObjectURL(url);
                resolve(c.toDataURL('image/jpeg', 0.82));
              } catch (e) { URL.revokeObjectURL(url); reject(e); }
            };
            img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
            img.src = url;
          });
        } catch (e) { shot = null; }
      }
      var res = await fetch(API_URL + '/api/premium/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: store.session,
          plan: selectedPlan,
          provider: 'etisalat',
          transactionId: txid,
          screenshot: shot || undefined,
          timezone: timezone()
        })
      });
      var data = await res.json();
      if (data && data.ok && data.premium) {
        applyServerState(data);
        etisalatStatus((AR ? 'تم تفعيل Premium! شكراً لاشتراكك.' : 'Premium activated! Thank you for subscribing.'), 'ok');
        toast(AR ? 'تم تفعيل Premium! شكراً لاشتراكك.' : 'Premium activated! Thank you for subscribing.', 'success');
        setTimeout(function () {
          closeEtisalatPay();
          closeModalSafe();
          renderModal();
        }, 900);
      } else {
        etisalatStatus(data && data.error ? String(data.error) : (AR ? 'تعذر تأكيد الدفع — تأكد من رقم العملية وحاول مجدداً.' : 'Could not confirm the payment — check the transaction reference and try again.'), 'error');
        btn.disabled = false;
        btn.innerHTML = idleLabel;
      }
    } catch (e) {
      console.error('[VoltaPremium] etisalat verify error:', e && e.message);
      etisalatStatus(AR ? 'خطأ في الاتصال — تحقق من الإنترنت وحاول مجدداً.' : 'Connection error — check your internet and try again.', 'error');
      btn.disabled = false;
      btn.innerHTML = idleLabel;
    }
  }

   
   
   
   
   
   
   
   
   
   
   
   
  async function subscribePlay(svc) {
    try {
      const itemId = selectedPlan === 'yearly' ? 'volta_premium_yearly' : 'volta_premium_monthly';
      let item = null;
      try {
        const details = await svc.getDetails([itemId]);
        item = (details || []).find(function (d) { return d && (d.itemId === itemId || d.id === itemId); }) || null;
      } catch (e) { console.warn('[VoltaPremium] getDetails failed:', e); }
      if (!item) { toast(ar() ? 'الخطة غير متوفرة في متجر Play.' : 'Plan not available in Play Store.', 'error'); return; }

       
      let token = null, restored = false;
      try {
        const hist = await svc.listPurchaseHistory();
        const prior = (hist || []).find(function (p) { return p && p.itemId === itemId; });
        if (prior && prior.purchaseToken) { token = prior.purchaseToken; restored = true; }
      } catch (e) {   }

      if (!restored) {
        const purchase = await svc.purchase(itemId);
        token = purchase && (purchase.purchaseToken || purchase.token) || null;
      }
      if (!token) throw new Error('missing purchase token');

      const res = await fetch(API_URL + '/api/premium/google-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: store.session, purchaseToken: token, productId: itemId, restored: restored })
      });
      const data = await res.json();
      if (data && data.ok) {
        applyServerState(data);
        toast(restored
          ? (ar() ? 'تم استعادة شرائك من Play — Premium مُفعّل!' : 'Play purchase restored — Premium activated!')
          : (ar() ? 'تم تفعيل Premium!' : 'Premium activated!'), 'success');
        closeModalSafe();
      } else toast(data && data.error ? data.error : (ar() ? 'تعذر التحقق من الشراء.' : 'Purchase verification failed.'), 'error');
    } catch (e) {
      console.error('[VoltaPremium] play billing error:', e);
      toast(ar() ? 'خطأ في الشراء من متجر Play.' : 'Play Billing purchase error.', 'error');
    }
  }

   
   
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
        toast(ar() ? 'تم تفعيل Premium! شكراً لاشتراكك.' : 'Premium activated! Thank you for subscribing.', 'success');
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
         
        if (data.premium || isPremium() === false) applyServerState(data);
      }
    } catch (e) {   }
  }

   
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
        toast(ar() ? 'تم إلغاء التجديد — Premium يستمر حتى نهاية مدتك.' : 'Auto-renew cancelled — Premium stays until your period ends.', 'info');
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

   
   
   
   
   
   
   
  function askCancelRefund() {
    if (!user() || !isPremium()) return;
    try {
      if (typeof voltaConfirm === 'function') {
        voltaConfirm(
          ar()
            ? 'إلغاء الاشتراك واسترداد المبلغ؟<br><small style="color:var(--muted);font-weight:600;">سينتهي Premium فوراً وسيُعاد المبلغ المدفوع إلى بطاقتك الأصلية خلال 5–10 أيام عمل.</small>'
            : 'Cancel subscription & get refunded?<br><small style="color:var(--muted);font-weight:600;">Premium ends immediately and the amount you paid is refunded to your original payment card within 5–10 business days.</small>',
          function () { cancelWithRefund(); },
          { danger: true, yesLabel: ar() ? 'إلغاء واسترداد' : 'Cancel & refund', icon: 'fa-circle-exclamation' }
        );
        return;
      }
    } catch (e) {}
    cancelWithRefund();  
  }
  async function cancelWithRefund() {
    if (!user()) return;
    const u = user();
    const plan = u.premiumPlan || 'monthly';
    const provider = u.premiumProvider || 'stripe';
    const amount = u.premiumAmount || 0;
    const currency = u.premiumCurrency || 'USD';
    const remaining = u.premiumExpiry ? Math.max(0, Math.ceil((u.premiumExpiry - Date.now()) / 864e5)) : 0;
     
     
    let serverOk = false;
    try {
      const res = await fetch(API_URL + '/api/premium/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: store.session, refund: true, immediate: true })
      });
      const data = await res.json();
      serverOk = !!(data && data.ok);
    } catch (e) { serverOk = false; }
     
    try {
      u.premiumRefund = {
        at: Date.now(),
        plan: plan,
        provider: provider,
        amount: amount,
        currency: currency,
        daysLeft: remaining,
        method: 'original payment card',
        serverConfirmed: serverOk
      };
      save(u);
    } catch (e) {}
    deactivate();
    showRefundPopup(plan, provider, amount, currency, serverOk);
    renderHomeCard();
    try { if (typeof renderProfile === 'function') renderProfile(); } catch (e) {}
  }
  function showRefundPopup(plan, provider, amount, currency, serverOk) {
    const amountLine = (amount > 0)
      ? ((currency === 'USD' || currency === 'EGP' || currency === 'EUR' ? '' : '') + amount.toFixed(2) + ' ' + currency)
      : (plan === 'yearly' ? (ar() ? 'المبلغ السنوي' : 'the yearly amount') : (ar() ? 'المبلغ الشهري' : 'the monthly amount'));
    const methodLine = provider === 'google'
      ? (ar() ? 'حساب Google Play الدفع' : 'your original Google Play payment method')
      : (ar() ? 'بطاقتك الأصلية (نفس وسيلة الدفع عند الاشتراك)' : 'your original payment card (the one used at checkout)');
    let m = document.getElementById('vp-refund-modal');
    if (m) m.remove();
    m = document.createElement('div');
    m.id = 'vp-refund-modal';
    m.className = 'modal-overlay active';
    m.style.zIndex = '10070';
    m.innerHTML =
      '<div class="modal-content" style="max-width:400px;text-align:center;padding:28px 22px;">' +
        '<div style="width:64px;height:64px;border-radius:50%;background:var(--green-bg,#dcfce7);color:var(--green,#1d9d6b);display:flex;align-items:center;justify-content:center;margin:0 auto 14px;font-size:1.7rem;"><i class="fa-solid fa-circle-check"></i></div>' +
        '<h3 style="margin:0 0 8px;">' + (ar() ? 'تم إلغاء الاشتراك واسترداد المبلغ' : 'Subscription cancelled & refunded') + '</h3>' +
        '<p style="color:var(--muted);font-size:.92rem;line-height:1.7;margin:0 0 6px;">' +
          (ar()
            ? 'انتهى Premium فوراً. سيُعاد <b>' + amountLine + '</b> إلى ' + methodLine + ' — قد تستغرق 5–10 أيام عمل لتظهر في كشف حسابك.'
            : 'Premium has ended. <b>' + amountLine + '</b> was refunded to ' + methodLine + ' — it can take 5–10 business days to appear on your statement.') +
        '</p>' +
        '<button type="button" class="btn primary" style="min-width:140px;margin-top:16px;" onclick="document.getElementById(\'vp-refund-modal\').remove();">' + (ar() ? 'حسناً' : 'Got it') + '</button>' +
      '</div>';
    m.addEventListener('click', function (e) { if (e.target === m) m.remove(); });
    document.body.appendChild(m);
  }

   
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
    if (isPremium()) { toast(ar() ? 'Premium مُفعّل بالفعل.' : 'Premium is already active.', 'success'); return true; }
    refreshFromServer().then(function () {
      if (isPremium()) toast(ar() ? 'تم استعادة اشتراكك!' : 'Subscription restored!', 'success');
      else toast(ar() ? 'لا يوجد اشتراك نشط.' : 'No active subscription found.', 'info');
    });
    return true;
  }

   

  function ctaLabel() {
    return '<i class="fa-solid fa-bolt"></i> ' + (ar() ? 'اشترك الآن' : 'Subscribe Now');
  }

   
   
   
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
      return f ? '<p class="vp-sub" style="color:var(--accent);font-weight:700;">' + (ar() ? f.titleAr : f.title) + ' ' + (ar() ? 'خاصية Premium' : 'is a Premium feature') + '</p>' : '';
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
        '<h3 class="vp-title" data-ar="Premium مُفعّل">Premium Active</h3>' +
      '</div>' +
      '<div class="vp-status-card">' +
        '<div class="vp-days">' + (days != null ? days : '∞') + ' <small>' + daysLabel + '</small></div>' +
        '<div class="vp-plan-line">' + planName + ' · ' + renewsOrEnds + ' <b>' + (info.expiry ? fmtDate(info.expiry) : '—') + '</b></div>' +
        '<div class="vp-period-bar"><div class="vp-period-fill" style="width:' + pct + '%"></div></div>' +
        (info.cancelAtPeriodEnd
          ? '<div class="vp-status-note"><i class="fa-solid fa-triangle-exclamation"></i> ' + (ar() ? 'تم إلغاء التجديد التلقائي — ستفقد Premium في ' : 'Auto-renew is off — you lose Premium on ') + (info.expiry ? fmtDate(info.expiry) : '') + '</div>'
          : '') +
      '</div>' +
      '<div class="vp-btn-row">' +
        '<button class="btn primary" onclick="VoltaPremium.openHub(\'__paywall__\')" style="min-width:130px;"><i class="fa-solid fa-rotate-right"></i> <span data-ar="تجديد">' + (ar() ? 'تجديد' : 'Renew') + '</span></button>' +
        (info.cancelAtPeriodEnd
          ? '<button class="btn ghost" onclick="VoltaPremium.resume()" style="min-width:130px;"><i class="fa-solid fa-undo"></i> <span data-ar="استئناف">' + (ar() ? 'استئناف' : 'Resume') + '</span></button>'
          : '<button class="btn ghost" onclick="VoltaPremium.cancel()" style="min-width:130px;"><i class="fa-solid fa-xmark"></i> <span data-ar="إلغاء الاشتراك">' + (ar() ? 'إلغاء الاشتراك' : 'Cancel') + '</span></button>') +
      '</div>' +
      '<div style="height:16px;"></div>' +
       
       
       
      '<div class="vp-features">' + featureRows() + '</div>'
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
     
     
     
     
     
    const wasFallback = !!(priceData && priceData.fallback);
    loadPrices(wasFallback).then(function () {
       
      const body = document.getElementById('premium-modal-body');
      if (body && document.getElementById('premium-modal').classList.contains('active')) {
        renderModal();
      }
    }).catch(function () {});
  }

  function showPaywall(key) { openHub(key); }
  function showPremiumScreen() { openHub(); }  

   
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
          '<div><h3 data-ar="VOLTA PREMIUM">VOLTA PREMIUM</h3>' +
          '<p data-ar="مدرب بالذكاء الاصطناعي يصحح أداءك ويعّد تكراراتك.">An AI coach that checks your form and counts your reps.</p></div>' +
          '<button class="vp-home-cta" onclick="VoltaPremium.openHub()">' + (ar() ? 'اشترك' : 'Go Premium') + '</button>' +
        '</div>' +
        '<div class="vp-fx-grid">' + featureChips() + '</div>';
    } else {
      const days = info.daysLeft;
      const status = ar()
        ? ('Premium ' + (info.plan === 'yearly' ? 'السنوي' : 'الشهري') + ' · ' + (days != null ? days + ' يوم متبقي' : 'نشط'))
        : ((info.plan === 'yearly' ? 'Yearly' : 'Monthly') + ' Premium · ' + (days != null ? days + ' days left' : 'active')) +
          (info.cancelAtPeriodEnd ? (ar() ? ' · التجديد ملغي' : ' · renewal off') : '');
      card.innerHTML =
        '<div class="vp-home-head">' +
          '<span class="vp-home-ic"><i class="fa-solid fa-bolt"></i></span>' +
          '<div><h3 data-ar="VOLTA PREMIUM">VOLTA PREMIUM</h3>' +
          '<p class="vp-status-inline"><b>' + status + '</b></p></div>' +
          '<button class="vp-home-cta" onclick="VoltaPremium.openHub()">' + (ar() ? 'إدارة' : 'Manage') + '</button>' +
        '</div>' +
        '<div class="vp-fx-grid">' + featureChips() + '</div>' +
         
         
         
        '<button type="button" class="vp-cancel-sub-btn" onclick="VoltaPremium.askCancelRefund()">' +
          '<i class="fa-solid fa-circle-xmark"></i> ' +
          '<span data-ar="إلغاء الاشتراك (مع استرداد المبلغ)">' + (ar() ? 'إلغاء الاشتراك (مع استرداد المبلغ)' : 'Cancel Subscription') + '</span>' +
        '</button>';
    }
    if (typeof store !== 'undefined' && store.lang === 'ar' && typeof applyTranslations === 'function') {
      try { applyTranslations(); } catch (e) {}
    }
  }

  function updateButton() {
     
     
     
     
     
    const btn = document.getElementById('app-premium-btn');
    if (btn) {
      const prem = !!(typeof store !== 'undefined' && store.session && isPremium());
      btn.style.display = prem ? 'inline-flex' : 'none';
      btn.classList.toggle('is-premium', prem);
       
       
      const txt = btn.querySelector('.vp-pill-txt');
      if (txt) {
        txt.textContent = 'Premium';
        txt.setAttribute('data-ar', 'Premium');
      }
    }
     
    const tag = document.getElementById('volta-premium-tag');
    if (tag) tag.style.display = (store && store.session && isPremium()) ? 'inline-block' : 'none';
     
     
     
     
     
    try {
      const premNow = (typeof store !== 'undefined' && store.session && isPremium());
      document.querySelectorAll('.side-btn-recovery, .bottom-nav-item[data-btab="recovery"]').forEach(function (b) {
        b.style.display = premNow ? '' : 'none';
      });
      document.querySelectorAll('.bottom-nav-item[data-btab="mood"]').forEach(function (b) {
        b.style.display = premNow ? 'none' : '';
      });
      document.querySelectorAll('.bottom-nav-more-item[data-more="mood"]').forEach(function (b) {
        b.style.display = premNow ? '' : 'none';
      });
    } catch (e) {}
     
    renderHomeCard();
  }

  function closeModalSafe() {
    try { if (typeof closeModal === 'function') closeModal('premium-modal'); } catch (e) {}
  }

   
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

   
  try {
    updateButton();
    loadPrices();
    if (typeof store !== 'undefined' && store.session) refreshFromServer();
  } catch (e) {}
   
   
   
   
  [0, 250, 800, 1600].forEach(function (d) {
    setTimeout(function () { try { updateButton(); } catch (e) {} }, d);
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { try { updateButton(); } catch (e) {} });
  }
  window.addEventListener('load', function () { try { updateButton(); } catch (e) {} });

  return {
    isPremium: isPremium,
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
    askCancelRefund: askCancelRefund,
    cancelWithRefund: cancelWithRefund,
    restore: restore,
    activate: activateLocal,
    deactivate: deactivate,
    selectPlan: selectPlan,
    updateButton: updateButton,
    renderHomeCard: renderHomeCard,
    updateScreenNotice: updateScreenNotice,
    openPayment: openPayment,
    processPayment: processPayment,
    openEtisalatPay: openEtisalatPay,
    verifyEtisalat: verifyEtisalat,
    formatCardNumber: formatCardNumber,
    formatCardExpiry: formatCardExpiry,
    back: back,
    getPlans: getPlans,
    getFeatures: getFeatures
  };
})();
