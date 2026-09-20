/**
 * Volta AI — premium feature module (frontend)
 * ══════════════════════════════════════════════════════════════════════
 * ALL 4 premium features now run 100% ON THE APP (offline-first):
 *
 *   1. FormSense   — camera + on-device form engine (js/volta-local-ai.js)
 *                    PLUS a real GEMINI vision check: snapshots captured
 *                    at your rep bottoms are sent to Gemini together with
 *                    the live measured stats, and the AI critiques YOUR
 *                    form for THAT exercise (online only; offline it
 *                    falls back to the on-device multi-result analysis).
 *   2. RepSense    — camera AUTO-COUNTS reps (block-matching motion
 *                    engine, no tapping). Every counted rep beeps +
 *                    vibrates + pops the counter, and feeds per-rep
 *                    analytics (tempo / ROM / symmetry) to the form check.
 *   3. ProgressIQ  — local safe-progression engine (≤10% rule)
 *   4. RecoveryIQ  — local recovery model, MULTI-ANSWER + condition-aware
 *                    (reads soreness, sleep, energy, sore area, the user's
 *                    injury and the last 7 days of sessions)
 *
 * They need NO internet and NO backend — they work offline, every time.
 * The old dual "AI Cloud / On-device mode" engines were removed per user
 * request ("remove on-device because it doesn't work"): the features simply
 * run locally, with no mode badges and no dead-end errors.
 *
 * FREE feature kept here: AI Weekly Report (cloud-backed, /api/ai/weekly-report).
 * Coach AI and AI Diet Plan were REMOVED per user request.
 *
 * CAMERA (v9): ONE shared stream per app session — getUserMedia (and the
 * browser permission prompt) happens at most ONCE. FormSense + RepSense are
 * now SEPARATE features (tapping one does NOT auto-start the other) and both
 * attach to the same camera session, so switching features or exercises
 * never re-prompts. When the last camera surface closes, the stream lingers
 * briefly (covering the 60s rest timer) and then fully stops. They run from
 * the workout-detail popup, or standalone from the Premium hub while the
 * user is IN a workout (otherwise the modal points to today's workout).
 * getUserMedia works from file:// pages in Chrome / Edge / Firefox / Android
 * Chrome (file:// is a secure context — the browser just asks for
 * permission); in the Play-Store wrapper the app needs the camera
 * permission granted.
 *
 * All modals are injected here (index.html stays lean), always carry a
 * working × close button (overlay click + Esc also close), and respect
 * the app's EN/AR engine.
 * ══════════════════════════════════════════════════════════════════════ */

window.VoltaAI = (function () {

  // ─── tiny helpers ───────────────────────────────────────────────────────
  function ar() { return typeof store !== 'undefined' && store.lang === 'ar'; }
  function T(en, arTxt) { return ar() ? arTxt : en; }
  function TA(en, arTxt) { return ' data-ar="' + arTxt + '"'; } // attr builder
  function toast(msg, type) {
    try { if (typeof showVoltaToast === 'function') showVoltaToast(msg, type || 'info'); } catch (e) { alert(msg); }
  }
  function email() { return (typeof store !== 'undefined' && store.session) || ''; }
  function u() { try { return typeof currentUser === 'function' ? currentUser() : null; } catch (e) { return null; } }
  function applyAr(scope) {
    if (ar() && typeof applyTranslations === 'function') {
      try { applyTranslations(); } catch (e) {}
    }
  }
  const NETWORK_MSG = function () {
    return T('You are offline — the AI Weekly Report needs internet. Try again when you reconnect.',
             'أنت غير متصل — يحتاج التقرير الأسبوعي الذكي إلى الإنترنت. حاول مجدداً عند عودة الاتصال.');
  };

  // v25 (user): "make ai features work offline even on the html file" — the
  // Weekly Report was the last cloud-only feature. When the API can't be
  // reached (offline / file:// / dead network), the report is generated
  // ON-DEVICE from the exact same collectWeekStats() data the cloud would
  // receive, with the same structure (headline / summary / wins /
  // improvements / focus / note) so the renderer is untouched.
  function localWeeklyReport() {
    const s = collectWeekStats();
    const A = ar();
    const mins = Math.round(s.minutes || 0);
    const days = s.daysActive || 0;
    const sess = s.sessionsLogged || 0;
    const burned = Math.round(s.kcalBurned || 0);
    const streak = s.streakDays || 0;
    const top = (s.topExercises || [])[0] || '';
    const wins = [], imps = [], focus = [];
    if (sess > 0) {
      wins.push(A ? ('سجّلت ' + sess + ' جلسة تمرين هذا الأسبوع — الاستمرارية هي أهم من الكمال.')
                  : ('You logged ' + sess + ' training session' + (sess === 1 ? '' : 's') + ' this week — consistency beats perfection.'));
      if (mins > 0) wins.push(A ? ('حركتك: ' + mins + ' دقيقة — كل دقيقة تُحسب في تقدمك.')
                                : ('Movement: ' + mins + ' minutes — every minute counts toward your progress.'));
      if (burned > 0) wins.push(A ? ('حرقت حوالي ' + burned + ' سعرة عبر جلساتك المسجلة.')
                                  : ('You burned roughly ' + burned + ' kcal across your logged sessions.'));
      if (top) wins.push(A ? ('تمرينك الأكثر تكراراً: ' + top + ' — التكرار يبني الإتقان.')
                            : ('Most frequent exercise: ' + top + ' — repetition builds mastery.'));
    } else {
      wins.push(A ? 'أسبوع جديد — أفضل وقت لتبدأ من جديد.'
                  : 'A fresh week — the best time to restart is now.');
    }
    if (streak >= 2) wins.push(A ? ('سلسلة نشاطك وصلت ' + streak + ' يوم — حافظ عليها!')
                                 : ('Your streak is at ' + streak + ' days — protect it!'));
    if (mins < 150) { imps.push(A ? 'التوصية الصحية 150 دقيقة أسبوعياً — أنت عند ' + mins + ' دقيقة حالياً.'
                                  : 'The health guideline is 150 active minutes a week — you are at ' + mins + '.');
                      focus.push(A ? 'استهدف 5 جلسات × 30 دقيقة الأسبوع القادم.'
                                   : 'Target five 30-minute sessions next week.'); }
    if (days < 4) { imps.push(A ? ('كنت نشطاً في ' + days + ' من 7 أيام — توزيع التمرين على أيام أكثر يرفع النتائج.')
                                : ('You were active on ' + days + ' of 7 days — spreading training over more days lifts results.'));
                    focus.push(A ? 'أضف يوماً أو يومين نشطين قصيرين (حتى مشي 20 دقيقة).'
                                 : 'Add one or two short active days (even a 20-minute walk).'); }
    if ((s.kcalEaten || 0) === 0) { imps.push(A ? 'لا يوجد تسجيل وجبات هذا الأسبوع — التسجيل يضبط الطاقة الحقيقية.'
                                                : 'No meals logged this week — logging keeps your energy budget honest.');
                                    focus.push(A ? 'سجّل وجباتك الرئيسية يومياً في تبويب التغذية.'
                                                 : 'Log your main meals daily in the Diet tab.'); }
    if (!imps.length) { imps.push(A ? 'أسبوع متوازن — حافظ على هذا الإيقاع.'
                                    : 'A well-balanced week — keep this rhythm.');
                        focus.push(A ? 'ارفع الحمل 5-10% فقط للحفاظ على السلامة.'
                                     : 'Increase load by only 5-10% to stay safe.'); }
    const headline = A ? ('تقرير أسبوعك: ' + days + ' أيام نشطة · ' + mins + ' دقيقة')
                       : ('Your week: ' + days + ' active day' + (days === 1 ? '' : 's') + ' · ' + mins + ' minutes');
    const summary = A ? ('حلّل الذكاء الاصطناعي المحلي جلساتك ووجباتك المسجلة: ' + sess + ' جلسة، ' + mins + ' دقيقة حركة، وحوالي ' + burned + ' سعرة محروقة.')
                      : ('The on-device AI analyzed your logged sessions and meals: ' + sess + ' session' + (sess === 1 ? '' : 's') + ', ' + mins + ' active minutes, and about ' + burned + ' kcal burned.');
    const note = A ? 'هذا التحليل يعمل بالكامل على جهازك — بلا إنترنت. عند الاتصال يحلله الذكاء السحابي بتفاصيل أعمق.'
                   : 'This analysis runs fully on your device — no internet needed. When you are back online, the cloud AI re-analyzes with deeper detail.';
    return { headline: headline, summary: summary, wins: wins, improvements: imps, focus: focus, note: note };
  }

  const API = (function () {
    try {
      const host = window.location.hostname || '';
      const isStatic = window.location.protocol === 'file:'
        || host === 'volta-aimobile.github.io'
        || host.indexOf('vercel.app') !== -1
        || host.indexOf('web.app') !== -1
        || host.indexOf('firebaseapp.com') !== -1;
      if (isStatic) return window.VOLTA_VERCEL_VAULT || 'https://volta-aimobile-github-io.vercel.app';
      return window.location.origin;
    } catch (e) { return window.location.origin; }
  })();

  // ═══════════════════════ modal plumbing ════════════════════════════════
  // The × button renders OUTSIDE the node that features overwrite with
  // innerHTML — it can never be destroyed (the "I have to refresh every
  // time" bug). Content renders into a dedicated .vai-inner container.
  function ensureModal(id) {
    let m = document.getElementById(id);
    if (m) return m;
    m = document.createElement('div');
    m.id = id;
    m.className = 'modal-overlay';
    m.style.zIndex = '10011';
    m.innerHTML =
      '<div class="modal-content vai-modal">' +
        // routes through closeIt so camera/loops are ALWAYS cleaned up
        '<button class="modal-close" onclick="VoltaAI.closeAiModal(\'' + id + '\')">&times;</button>' +
        '<div class="vai-inner" id="' + id + '-body"></div>' +
      '</div>';
    document.body.appendChild(m);
    // click on the dark overlay (not the card) closes the popup
    m.addEventListener('click', function (e) { if (e.target === m) closeIt(id); });
    return m;
  }
  function openIt(id) {
    ensureModal(id);
    if (typeof openModal === 'function') openModal(id);
  }
  function closeIt(id) {
    try { if (typeof closeModal === 'function') closeModal(id); } catch (e) {}
    const m = document.getElementById(id);
    if (m) m.classList.remove('active');
    onModalClosed(id);
  }
  // Esc closes the top-most Volta AI popup (never interferes with other UI).
  // NOTE: vai-coach-modal / vai-diet-modal removed (features removed).
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    const ids = ['vai-form-modal', 'vai-rep-modal', 'vai-report-modal', 'vai-prog-modal', 'premium-modal'];
    for (let i = 0; i < ids.length; i++) {
      const m = document.getElementById(ids[i]);
      if (m && m.classList.contains('active')) { closeIt(ids[i]); e.preventDefault(); return; }
    }
  });
  // What happens when a camera modal goes away
  function onModalClosed(id) {
    if (id === 'vai-form-modal' || id === 'vai-rep-modal') {
      if (ActiveEngine) {
        // v13: the "Finish set" button was removed from the rep counter —
        // the counted set now saves AUTOMATICALLY when the modal closes.
        if (id === 'vai-rep-modal') { try { autoSaveRepModalSet(ActiveEngine); } catch (e) {} }
        try { ActiveEngine.stop(); } catch (e) {} ActiveEngine = null;
      }
      // v9: release the shared camera (lingering shutdown — reopening the
      // feature within the linger window reattaches with NO permission ask).
      closeCamera();
    }
  }
  // v13: silent auto-save of a counted set (fires when the RepSense modal
  // closes or the engine is replaced — no button needed).
  async function autoSaveRepModalSet(eng) {
    try {
      if (!eng || !eng.counter || !(eng.counter.reps > 0)) return;
      const r = eng.finishSet();
      if (!(r.reps > 0)) return;
      await saveRepSession({ type: 'rep', exercise: eng.exercise, reps: r.reps, durationSec: r.durationSec, tempoSec: r.tempoSec || 0 });
      eng.counter.reps = 0; eng.counter.repIntervals = [];
      try { toast(T('Set saved: ' + r.reps + ' reps · ' + r.durationSec + 's', 'تم حفظ المجموعة: ' + r.reps + ' تكرار · ' + r.durationSec + ' ث'), 'success'); } catch (e) {}
    } catch (e) { /* never block the close path */ }
  }

  function head(icon, titleEn, titleAr, subEn, subAr) {
    return '<div class="vai-head">' +
      '<span class="vp-home-ic"><i class="fa-solid ' + icon + '"></i></span>' +
      '<div><h3' + TA(titleEn, titleAr) + '>' + T(titleEn, titleAr) + '</h3>' +
      '<small' + TA(subEn, subAr) + '>' + T(subEn, subAr) + '</small></div></div>';
  }

  // ═══════════════════════ network layer ═════════════════════════════════
  // Only used by the FREE AI Weekly Report (cloud feature). The 4 premium
  // features run fully locally and never touch this.
  async function callApi(path, body, timeoutMs) {
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = ctrl ? setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, timeoutMs || 20000) : null;
    let res;
    try {
      res = await fetch(API + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl ? ctrl.signal : undefined
      });
    } catch (e) {
      if (timer) clearTimeout(timer);
      const err = new Error(NETWORK_MSG());
      err.code = 'network';
      throw err;
    }
    if (timer) clearTimeout(timer);
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok || !data || data.ok === false) {
      const msg = data && data.error ? data.error : ('Server error ' + res.status);
      const err = new Error(msg);
      err.code = (res.status === 402 || /premium/i.test(msg)) ? 'premium' : (res.status >= 500 || res.status === 501 ? 'server' : 'http');
      throw err;
    }
    return data;
  }
  function premiumRequiredMsg(err) {
    return err && (err.code === 'premium' || /premium/i.test(err.message || ''));
  }

  // ═══════ CAMERA PERMISSION (ask once · toggle in Settings) ═══════════
  // v8: the camera is asked for ONLY the first time a feature needs it.
  // After that the setting lives in Settings → “AI Camera” (exactly like
  // Weather Location). When OFF, features never touch getUserMedia again.
  function cameraEnabledInSettings() {
    try { return localStorage.getItem('fb_cam') !== 'false'; } catch (e) { return true; }
  }
  function markCameraAsked() {
    try { localStorage.setItem('fb_cam_asked', 'true'); } catch (e) {}
  }

  // ═════ v9: CAMERA SESSION — ONE stream per page session ═════════════
  // Per user request ("it asks for permission for my camera every time, fix
  // that"): getUserMedia is called AT MOST ONCE per app session.
  //   • All engines (FormSense modal, RepSense modal, workout-detail chips)
  //     ATTACH to the same shared stream — switching features or exercises
  //     never triggers a second permission prompt.
  //   • When the last camera surface closes, closeCamera() doesn't kill the
  //     stream instantly: it lingers CAM_LINGER_MS (the app's own rest timer
  //     between exercises is 60s — the linger covers exercise-to-exercise
  //     switches) and then fully stops the tracks (camera light off). Any
  //     new feature within the window reuses the stream with ZERO prompt.
  //   • shutdownCamera() stops everything immediately (Settings toggle OFF,
  //     page hide).
  const CAM_LINGER_MS = 90000;
  let CamStream = null;        // the ONE shared MediaStream
  let CamAcquiring = null;     // in-flight getUserMedia promise (deduped)
  let CamLingerTimer = null;   // delayed physical shutdown
  let CamHeld = 0;             // surfaces currently USING the camera

  function camStreamLive() {
    return !!(CamStream && CamStream.active && CamStream.getTracks().some(function (t) { return t.readyState === 'live'; }));
  }
  async function acquireCamera() {
    // 1) a live stream already exists → reuse (NO new prompt)
    if (camStreamLive()) { if (CamLingerTimer) { clearTimeout(CamLingerTimer); CamLingerTimer = null; } return CamStream; }
    // 2) an acquire is already in flight → ride the same promise (the browser
    //    shows ONE prompt no matter how many features start at once)
    if (CamAcquiring) return CamAcquiring;
    CamAcquiring = navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 960 } },
      audio: false
    }).then(function (s) {
      CamStream = s;
      CamAcquiring = null;
      markCameraAsked();       // granted at least once → remember
      return s;
    }).catch(function (err) {
      CamAcquiring = null;
      throw err;
    });
    return CamAcquiring;
  }
  function camHold() { CamHeld++; if (CamLingerTimer) { clearTimeout(CamLingerTimer); CamLingerTimer = null; } }
  function camDrop() { CamHeld = Math.max(0, CamHeld - 1); }
  // "Close the camera": the visible panel is gone; the stream lingers a
  // short while so the next exercise/feature reattaches with no prompt, then
  // the tracks really stop (light off). Safe to call repeatedly.
  function closeCamera() {
    if (!camStreamLive()) return;
    if (CamLingerTimer) clearTimeout(CamLingerTimer);
    CamLingerTimer = setTimeout(function () {
      CamLingerTimer = null;
      if (CamHeld > 0) return;                 // something re-attached meanwhile
      shutdownCamera();
    }, CAM_LINGER_MS);
  }
  // Immediate, unconditional stop (Settings OFF / page hidden / error).
  function shutdownCamera() {
    if (CamLingerTimer) { clearTimeout(CamLingerTimer); CamLingerTimer = null; }
    CamHeld = 0;
    if (CamStream) {
      try { CamStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      CamStream = null;
    }
  }
  // Page hidden/closed → never keep the camera running behind the app.
  window.addEventListener('pagehide', shutdownCamera);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') shutdownCamera();
  });

  // ═══════════════════════ AssistEngine (shared camera) ══════════════════
  // ONE getUserMedia stream powers BOTH FormSense and RepSense at the same
  // time. Rep counting runs on the local motion engine (instant, works
  // offline); form checks run the on-device multi-result analyzer, and —
  // when online — can additionally send captured rep-bottom snapshots to
  // Gemini for a real vision critique of THIS exercise (deep check).
  // Exactly one engine exists at a time.
  let ActiveEngine = null;

  function AssistEngine(opts) {
    this.exercise = opts.exercise || 'exercise';
    this.videoEl = opts.videoEl || null;
    this.onStatus = opts.onStatus || function () {};   // ('starting'|'live'|'denied'|'stopped')
    this.onReps = opts.onReps || function () {};       // ({reps, phase, tempoSec, counted})
    this.onForm = opts.onForm || function () {};       // (result | {premiumWall:true})
    this.formOn = false;
    this.repsOn = false;
    this.stream = null;
    this.loop = null;
    this.autoFormTimer = null;
    this.formBusy = false;
    this.counter = null;
    this.startedAt = 0;
    this.lang = opts.lang || (ar() ? 'ar' : 'en');
    this.beepOn = opts.beep !== false;                 // v7: per-rep auto-count feedback
    this.frames = [];                                  // v7: rep-bottom snapshots for the Gemini deep check
    this._snapCv = null; this._snapCtx = null;
  }
  AssistEngine.prototype.start = async function () {
    if (!this.videoEl) return false;
    // v8: respect the Settings → AI Camera switch (like Weather Location).
    // OFF → we never even ask for the camera; the feature surfaces a clear
    // “camera is off — enable it in Settings” state instead.
    if (!cameraEnabledInSettings()) { this.onStatus('off'); return false; }
    this.onStatus('starting');
    // v9: the stream comes from the CAMERA SESSION — acquired ONCE per app
    // session and shared by every feature. Switching between FormSense /
    // RepSense / the workout popup reattaches the SAME stream, so the
    // browser permission prompt appears only the very first time.
    try {
      this.stream = await acquireCamera();
      camHold();
    } catch (err) {
      const name = (err && err.name) || '';
      this.onStatus(name === 'NotAllowedError' ? 'denied' : (name === 'NotFoundError' || name === 'OverconstrainedError') ? 'nocam' : 'error');
      return false;
    }
    // srcObject can throw on exotic browsers — treat it like a camera
    // failure instead of dying silently (chips would stay "on" forever).
    // NOTE: the stream is SHARED, so a failure here only detaches — the
    // session itself is left for closeCamera()/shutdownCamera() to manage.
    try {
      this.videoEl.srcObject = this.stream;
    } catch (err) {
      camDrop();
      this.stream = null;
      this.onStatus('error');
      return false;
    }
    try { await this.videoEl.play(); } catch (e) {}
    this.counter = (window.VoltaLocalAI) ? new VoltaLocalAI.MotionRepCounter() : null;
    this.startedAt = Date.now();
    const self = this;
    this.loop = setInterval(function () {
      if (!self.counter || !self.videoEl || !self.videoEl.videoWidth) return;
      const r = self.counter.process(self.videoEl, Date.now());
      if (r.counted) self._onRepCounted();             // v7: beep + vibrate + snapshot
      if (self.repsOn) self.onReps(r);
    }, 120);
    // Automatic form checking: the first analysis fires the moment the
    // camera is live (then every 20s via the autoFormTimer).
    if (this.formOn) this.checkFormNow();
    this.onStatus('live');
    return true;
  };
  // v7 — every AUTO-COUNTED rep: audible + tactile confirmation that the AI
  // counted it by itself, and a snapshot at the rep's deepest point for the
  // Gemini deep form check.
  AssistEngine.prototype._onRepCounted = function () {
    if (this.beepOn) { try { if (typeof playDoneBeep === 'function') playDoneBeep(); } catch (e) {} }
    try { if (typeof vibrateDevice === 'function') vibrateDevice([70]); } catch (e) {}
    this._captureFrame(false);
  };
  // v7 — grab a 384×512 JPEG snapshot of the live frame (rep-bottom moments
  // preferred — that is where form errors live). Max 3 kept per set.
  AssistEngine.prototype._captureFrame = function (force) {
    try {
      if (!this.videoEl || !this.videoEl.videoWidth) return;
      if (!this._snapCv) {
        this._snapCv = document.createElement('canvas');
        this._snapCv.width = 384; this._snapCv.height = 512;
        this._snapCtx = this._snapCv.getContext('2d');
      }
      const v = this.videoEl;
      const s = Math.min(384 / v.videoWidth, 512 / v.videoHeight);
      const w = Math.max(1, Math.round(v.videoWidth * s));
      const h = Math.max(1, Math.round(v.videoHeight * s));
      this._snapCtx.drawImage(v, Math.round((384 - w) / 2), Math.round((512 - h) / 2), w, h);
      const url = this._snapCv.toDataURL('image/jpeg', 0.72);
      if (force) { this.frames.push(url); if (this.frames.length > 3) this.frames.shift(); }
      else if (this.frames.length < 3) this.frames.push(url);
    } catch (e) {}
  };
  AssistEngine.prototype.setReps = function (on) {
    this.repsOn = !!on;
    if (this.counter) this.counter.reset();
    if (this.repsOn) this.startedAt = this.startedAt || Date.now();
  };
  AssistEngine.prototype.setForm = function (on) {
    this.formOn = !!on;
    const self = this;
    if (this.formOn) {
      // Only fire the instant check when the camera is already streaming —
      // when the camera is still starting, start() runs the FIRST check the
      // moment it goes live (prevents a bogus verdict from an empty frame).
      if (this.stream) this.checkFormNow();
      if (!this.autoFormTimer) this.autoFormTimer = setInterval(function () { self.checkFormNow(); }, 20000);
    } else if (this.autoFormTimer) {
      clearInterval(this.autoFormTimer); this.autoFormTimer = null;
    }
  };
  AssistEngine.prototype.repAdjust = function (delta) {
    if (!this.counter) return;
    // adjust by re-basing the raw counter (±)
    this.counter.reps = Math.max(0, this.counter.reps + delta);
    this.onReps({ reps: this.counter.reps, phase: this.counter.phase, tempoSec: this.counter.avgTempoSec(), counted: false });
  };
  AssistEngine.prototype.checkFormNow = async function (deep) {
    if (!this.formOn || this.formBusy) return;
    this.formBusy = true;
    const self = this;
    const finish = function (r) { self.formBusy = false; self.onForm(r); };
    const m = this.counter ? this.counter.metrics() : {};
    m.durationSec = this.startedAt ? Math.round((Date.now() - this.startedAt) / 1000) : 0;
    // LOCAL analysis (always works, offline): motion-quality metrics from
    // the live counter + the exercise-specific profile library.
    const local = VoltaLocalAI.formCheckLocal(this.exercise, m, { lang: this.lang, durationSec: m.durationSec });
    // v7 GEMINI deep check — only when asked, online, with a key, with frames:
    // a real vision critique of the captured rep snapshots for THIS exercise.
    if (deep) {
      if (!this.frames.length) this._captureFrame(true);   // live snapshot right now
      const key = (typeof window.VOLTA_GEMINI_KEY === 'string' && window.VOLTA_GEMINI_KEY) || '';
      if (navigator.onLine && key && this.frames.length) {
        try {
          const ai = await geminiFormCheckDirect(this.exercise, local, this.frames, this.lang);
          if (ai) {
            local.ai = ai;
            if (typeof ai.score === 'number' && ai.score > 0) {
              local.score = Math.round(local.score * 0.5 + ai.score * 0.5);
              local.verdict = local.score >= 80 ? 'good' : local.score >= 62 ? 'okay' : 'bad';
            }
          }
        } catch (e) { /* silent — the on-device analysis stands on its own */ }
      }
    }
    finish(local);
  };
  AssistEngine.prototype.finishSet = function () {
    const reps = this.counter ? this.counter.reps : 0;
    const secs = this.startedAt ? Math.round((Date.now() - this.startedAt) / 1000) : 0;
    return { reps: reps, durationSec: secs, tempoSec: this.counter ? this.counter.avgTempoSec() : 0 };
  };
  AssistEngine.prototype.stop = function () {
    if (this.loop) { clearInterval(this.loop); this.loop = null; }
    if (this.autoFormTimer) { clearInterval(this.autoFormTimer); this.autoFormTimer = null; }
    // v9: the stream belongs to the shared CAMERA SESSION — stopping an
    // engine only DETACHES it (video goes black, tracking stops). The
    // physical camera is closed by closeCamera()/shutdownCamera() so the
    // next feature can reattach without a new permission prompt.
    if (this.stream) { camDrop(); this.stream = null; }
    try { if (this.videoEl) this.videoEl.srcObject = null; } catch (e) {}
    this.formOn = false; this.repsOn = false;
    this.frames = [];
    if (ActiveEngine === this) ActiveEngine = null;
    this.onStatus('stopped');
  };
  /** Stop the previous engine and register this one as active.
   *  v9: the camera session SURVIVES engine switches (the new engine
   *  reattaches the same stream instantly — no permission prompt). */
  function claimEngine(engine) {
    if (ActiveEngine && ActiveEngine !== engine) { try { ActiveEngine.stop(); } catch (e) {} }
    ActiveEngine = engine;
  }

  // ═══════════════ GEMINI VISION DEEP CHECK (FormSense) ═════════════════
  // When online, the "Check My Form" action sends the rep-bottom snapshots
  // captured during the user's set TOGETHER with the live measured stats to
  // Gemini, which critiques the user's ACTUAL form for THAT exercise. The
  // on-device analysis always runs first (offline-safe); this layer only
  // enriches it. Model chain mirrors the meal scanner (volta.js).
  const VOLTA_AI_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash-lite'];
  function voltaFormPrompt(exercise, stats, lang) {
    const outLang = (lang === 'ar') ? 'Arabic' : 'English';
    const mv = (stats && stats.measured) || {};
    const lines = [
      'reps auto-counted by the motion engine: ' + (mv.reps || 0),
      'average tempo: ' + (mv.tempoSec || 0) + 's per rep',
      'tempo consistency: ' + (mv.tempoConsistencyPct != null ? mv.tempoConsistencyPct : 'n/a') + '%',
      'range-of-motion consistency: ' + (mv.romConsistencyPct != null ? mv.romConsistencyPct : 'n/a') + '%',
      'left/right motion split: ' + (mv.leftPct != null ? (mv.leftPct + '% / ' + mv.rightPct + '%') : 'n/a'),
      'stability between reps: ' + (mv.stabilityPct != null ? mv.stabilityPct : 'n/a') + '%',
      'set duration: ' + (mv.durationSec || 0) + 's'
    ].join('\n');
    return 'You are an expert strength & conditioning coach. Analyze the person performing the exercise "' + exercise + '" from the attached image frame(s) (captured live during their set, around the bottom of their reps).' +
      '\n\nThe app measured these live motion metrics from the camera during the set:\n' + lines +
      '\n\nJudge the person\'s FORM for THIS specific exercise only — quote what the metrics and the frames actually show. Be direct and specific (e.g. squat depth/knee tracking, push-up elbow angle/hip line, deadlift back flatness, press lockout/rib flare, curl elbow drift/swing).' +
      '\n\nRespond with ONLY a valid JSON object (no markdown, no code fences) in ' + outLang + ':\n' +
      '{\n' +
      '  "verdict": "good" or "okay" or "bad",\n' +
      '  "score": number (0-100),\n' +
      '  "observations": ["3-5 specific observations about what you actually see in the frame(s) + the measured numbers, each max 90 chars"],\n' +
      '  "fixes": ["2-4 concrete technique fixes for ' + exercise + ', each max 90 chars"],\n' +
      '  "bodyCue": "one short overall body cue, max 60 chars"\n' +
      '}\n\nRules:\n- If no person is clearly visible in the frame(s), respond {"verdict":"okay","score":50,"observations":["No person clearly visible in the captured frames"],"fixes":["Prop the phone up so your full body is in frame"],"bodyCue":"Full body in frame"}.\n- Use the measured metrics as facts; do not contradict them.\n- Never give medical advice; technique coaching only.';
  }
  function voltaExtractFormJson(text) {
    if (!text) return null;
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced ? fenced[1] : text;
    const s = candidate.indexOf('{'), e = candidate.lastIndexOf('}');
    if (s === -1 || e === -1 || e <= s) return null;
    try { return JSON.parse(candidate.slice(s, e + 1)); } catch (err) { return null; }
  }
  async function geminiFormCheckDirect(exercise, localResult, frames, lang) {
    const key = (typeof window.VOLTA_GEMINI_KEY === 'string' && window.VOLTA_GEMINI_KEY) || '';
    if (!key) return null;
    const parts = [{ text: voltaFormPrompt(exercise, localResult, lang) }];
    for (let i = 0; i < Math.min(3, frames.length); i++) {
      const m = String(frames[i]).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
      if (m && m[2]) parts.push({ inline_data: { mime_type: m[1], data: m[2] } });
    }
    if (parts.length < 2) return null;   // no usable frames → local-only
    const body = {
      contents: [{ parts: parts }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 700, responseMimeType: 'application/json' }
    };
    let lastErr = null;
    for (let i = 0; i < VOLTA_AI_MODELS.length; i++) {
      const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const timer = ctrl ? setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 28000) : null;
      try {
        const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + VOLTA_AI_MODELS[i] + ':generateContent?key=' + encodeURIComponent(key), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body), signal: ctrl ? ctrl.signal : undefined
        });
        const j = await r.json().catch(function () { return null; });
        if (!r.ok) {
          const msg = (j && j.error && j.error.message) || ('Gemini HTTP ' + r.status);
          if (timer) clearTimeout(timer);
          if (r.status === 404 && i < VOLTA_AI_MODELS.length - 1) { lastErr = new Error(msg); continue; }
          throw new Error(msg);
        }
        if (timer) clearTimeout(timer);
        const cparts = (j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
        const text = cparts.map(function (p) { return p.text || ''; }).join('');
        const parsed = voltaExtractFormJson(text);
        if (!parsed) throw new Error('Gemini returned no JSON');
        const verdict = (['good', 'okay', 'bad'].indexOf(parsed.verdict) !== -1) ? parsed.verdict : 'okay';
        const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0)));
        const strArr = function (v, n) {
          return (Array.isArray(v) ? v : []).filter(function (x) { return typeof x === 'string' && x.trim(); }).slice(0, n);
        };
        return {
          checked: true, model: VOLTA_AI_MODELS[i], verdict: verdict, score: score,
          observations: strArr(parsed.observations, 5), fixes: strArr(parsed.fixes, 4),
          bodyCue: (typeof parsed.bodyCue === 'string' ? parsed.bodyCue : '').slice(0, 90)
        };
      } catch (e) {
        if (timer) clearTimeout(timer);
        lastErr = e;
        if (e && e.name === 'AbortError') break;
      }
    }
    throw (lastErr || new Error('Gemini unavailable'));
  }

  // Persist AI sessions locally — history exists offline, forever.
  function localSessions() {
    try { return JSON.parse(localStorage.getItem('volta_ai_sessions') || '[]'); } catch (e) { return []; }
  }
  function pushLocalSession(s) {
    try {
      const all = localSessions();
      all.unshift(Object.assign({ at: Date.now(), email: email() }, s));
      localStorage.setItem('volta_ai_sessions', JSON.stringify(all.slice(0, 40)));
    } catch (e) {}
  }

  // ═══════════════ PROGRESSIQ DATABASE (persistent history) ═══════════
  // v8: every set the AI counts for the user — RepSense (premium hub),
  // the workout-detail popup, and the typed “last session” numbers — is
  // appended here per exercise. ProgressIQ READS this database, so it works
  // with the user's actual counted reps instead of asking from scratch.
  const PROGRESS_DB_KEY = 'volta_progress_db';
  function progressDbRead() {
    try { return JSON.parse(localStorage.getItem(PROGRESS_DB_KEY) || '{}'); } catch (e) { return {}; }
  }
  function progressDbWrite(db) {
    try { localStorage.setItem(PROGRESS_DB_KEY, JSON.stringify(db)); } catch (e) {}
  }
  /** Append one finished set to the exercise's history (per account). */
  function progressDbAdd(exercise, entry) {
    try {
      exercise = String(exercise || '').trim();
      if (!exercise) return;
      const db = progressDbRead();
      if (!db[exercise]) db[exercise] = [];
      db[exercise].unshift(Object.assign({
        at: Date.now(), email: email(),
        reps: 0, sets: 1, weight: 0, tempoSec: 0, durationSec: 0,
        source: 'ai-rep-counter'
      }, entry, { exercise: exercise }));
      // keep the last 60 sets per exercise
      db[exercise] = db[exercise].slice(0, 60);
      progressDbWrite(db);
    } catch (e) {}
  }
  /** The user's sets for one exercise (newest first, this account). */
  function progressDbFor(exercise) {
    try {
      exercise = String(exercise || '').trim();
      if (!exercise) return [];
      const db = progressDbRead();
      const rows = (db[exercise] || []).filter(function (r) {
        return !email() || !r.email || r.email === email();
      });
      // same-day consolidation → one {date, sets, reps, weight} log per day
      const byDay = {};
      rows.forEach(function (r) {
        const d = new Date(r.at || Date.now());
        const key = (typeof localDateStr === 'function' ? localDateStr(d) : d.toISOString().slice(0, 10));
        if (!byDay[key]) byDay[key] = { date: key, sets: 0, reps: 0, weight: 0, tempoSec: 0, at: 0, repsBySet: [] };
        byDay[key].sets += (r.sets || 1);
        byDay[key].reps += (r.reps || 0);
        byDay[key].repsBySet.push(r.reps || 0);
        if ((r.weight || 0) > byDay[key].weight) byDay[key].weight = r.weight || 0;
        if ((r.tempoSec || 0) > byDay[key].tempoSec) byDay[key].tempoSec = r.tempoSec || 0;
        if ((r.at || 0) > byDay[key].at) byDay[key].at = r.at;
      });
      return Object.keys(byDay).map(function (k) { return byDay[k]; })
        .sort(function (a, b) { return b.at - a.at; })
        .map(function (d) { d.bestSet = Math.max.apply(null, d.repsBySet.concat([0])); return d; });
    } catch (e) { return []; }
  }
  window.VoltaProgressDb = { add: progressDbAdd, forExercise: progressDbFor };

  // Save a finished set / form check locally (offline-first).
  async function saveRepSession(payload) {
    // v8: every AI-counted set also feeds the ProgressIQ database, so the
    // weight coach works with what the user actually counted.
    if (payload && payload.type !== 'form' && payload.exercise) {
      progressDbAdd(payload.exercise, {
        reps: payload.reps || 0, sets: 1,
        weight: payload.weight || 0,
        tempoSec: payload.tempoSec || 0, durationSec: payload.durationSec || 0,
        source: payload.source || 'ai-rep-counter'
      });
    }
    pushLocalSession(Object.assign({ type: payload.type || 'rep' }, payload));
  }

  // ═══════════════ v9: IN-WORKOUT GATE ═════════════════════════════════
  // Per user request ("make form check and rep check only work when the user
  // is in a workout"): the standalone FormSense / RepSense modals (opened
  // from the Premium hub) only run their camera while the user is actually
  // in a workout — the workout-detail popup open, the Daily tracker showing
  // today's list, or a live sports session running. Outside a workout the
  // modal explains where to use the feature and offers a jump button.
  function inWorkout() {
    try {
      const wd = document.getElementById('workout-detail-modal');
      if (wd && wd.classList.contains('active')) return true;
      const so = document.getElementById('session-overlay');
      if (so && so.classList.contains('active')) return true;
      if (typeof deState !== 'undefined' && deState && deState.step === 4 && deState.workouts && deState.workouts.length) return true;
    } catch (e) {}
    return false;
  }
  function inWorkoutNoticeHtml(kind) {
    const icon = (kind === 'form') ? 'fa-video' : 'fa-stopwatch-20';
    const title = (kind === 'form')
      ? T('FormSense works inside your workout', 'فورم سينس يعمل داخل تمرينك')
      : T('RepSense works inside your workout', 'ريب سينس يعمل داخل تمرينك');
    return '<div class="vai-inworkout">' +
      '<div class="vai-inworkout-ic"><i class="fa-solid ' + icon + '"></i></div>' +
      '<b>' + title + '</b>' +
      '<span>' + T('The AI camera features only run while you are IN a workout. Open today\'s workout, then tap Form Check or Rep Counter on the exercise you are doing.',
                   'ميزات كاميرا الذكاء الاصطناعي تعمل فقط أثناء التمرين. افتح تمرين اليوم ثم اضغط فحص الأداء أو عدّاد التكرارات في التمرين الذي تؤديه.') + '</span>' +
      '<button class="vp-cta" onclick="VoltaAI.goToTodaysWorkout()"><i class="fa-solid fa-play"></i> ' + T('Open Today\'s Workout', 'افتح تمرين اليوم') + '</button>' +
      '</div>';
  }
  function goToTodaysWorkout() {
    closeIt('vai-form-modal');
    closeIt('vai-rep-modal');
    try { if (typeof showTab === 'function') showTab('daily'); } catch (e) {}
  }

  // ═══════════════ 1) FormSense — standalone modal (Premium hub) ═════════
  function openFormSense(exercise) {
    if (typeof VoltaPremium === 'undefined' || !VoltaPremium.gate('form-check')) return;
    // v9: only inside a workout (the premium hub can be opened anywhere).
    if (!inWorkout()) {
      const inner0 = ensureModal('vai-form-modal').querySelector('.vai-inner');
      inner0.innerHTML =
        head('fa-video', 'FormSense — AI Form Check', 'فورم سينس — تدقيق الأداء',
          T('AI checks YOUR form for the exercise below — live, from your camera.', 'الذكاء الاصطناعي يدقق أدائك في التمرين أدناه — مباشرة من الكاميرا.'),
          'تدقيق لحظي مخصص لكل تمرين') +
        inWorkoutNoticeHtml('form');
      openIt('vai-form-modal');
      applyAr();
      return;
    }
    const inner = ensureModal('vai-form-modal').querySelector('.vai-inner');
    inner.innerHTML =
      head('fa-video', 'FormSense — AI Form Check', 'فورم سينس — تدقيق الأداء',
        T('AI checks YOUR form for the exercise below — live, from your camera.', 'الذكاء الاصطناعي يدقق أدائك في التمرين أدناه — مباشرة من الكاميرا.'),
        'تدقيق لحظي مخصص لكل تمرين') +
      '<div class="vai-cam-wrap">' +
        '<video id="vai-form-video" playsinline muted></video>' +
        '<div class="vai-cam-msg" id="vai-form-cammsg"><i class="fa-solid fa-video"></i><div>' + T('Starting camera…', 'جارٍ تشغيل الكاميرا…') + '</div></div>' +
        '<span class="vai-cam-badge" id="vai-form-badge"><span class="dot"></span> <span>' + T('camera off', 'الكاميرا متوقفة') + '</span></span>' +
      '</div>' +
      '<label style="font-size:.78rem;color:var(--muted);">' + T('Exercise to check', 'التمرين المراد تدقيقه') + '</label>' +
      '<input type="text" id="vai-form-exercise" value="' + String(exercise || '').replace(/"/g, '&quot;') + '" placeholder="' + T('e.g. Squat', 'مثال: سكوات') + '" style="margin:6px 0 6px;" />' +
      '<small style="display:block;color:var(--muted);font-size:.72rem;margin-bottom:10px;">' +
        T('Perform a few slow reps in frame — the AI reads your actual movement (tempo, range, balance, stability)' + (navigator.onLine ? ' and adds a Gemini vision check of your captured frames.' : ' — fully on-device, works offline.'),
           'أدِّ بعض التكرارات البطيئة داخل الإطار — الذكاء الاصطناعي يقرأ حركتك الفعلية (الإيقاع والمدى والتوازن والثبات)' + (navigator.onLine ? ' ويضيف فحص رؤية بجيميني للصور الملتقطة.' : ' — بالكامل على الجهاز ويعمل دون اتصال.')) +
      '</small>' +
      '<button class="vp-cta" id="vai-form-check-btn" onclick="VoltaAI.checkMyForm()"><i class="fa-solid fa-wand-magic-sparkles"></i> ' + T('Check My Form', 'دقّق أدائي') + '</button>' +
      '<div id="vai-form-result" style="margin-top:12px;"></div>';
    openIt('vai-form-modal');
    const video = document.getElementById('vai-form-video');
    const badge = document.getElementById('vai-form-badge');
    const eng = new AssistEngine({
      videoEl: video, exercise: exercise || 'exercise',
      onStatus: function (st) {
        const msgs = {
          starting: ['Starting camera…', 'جارٍ تشغيل الكاميرا…'],
          denied: ['Camera permission denied — allow camera in your browser (or check Settings → AI Camera).', 'تم رفض إذن الكاميرا — اسمح بها من المتصفح (أو راجع الإعدادات ← كاميرا الذكاء).'],
          off: ['AI camera is OFF — enable it in Settings → AI Camera to use the live form check.', 'كاميرا الذكاء الاصطناعي متوقفة — فعّلها من الإعدادات ← كاميرا الذكاء لاستخدام فحص الأداء المباشر.'],
          nocam: ['No camera found on this device.', 'لا توجد كاميرا على هذا الجهاز.'],
          error: ['Could not start the camera.', 'تعذر تشغيل الكاميرا.'],
          live: ['', ''],
          stopped: ['camera off', 'الكاميرا متوقفة']
        }[st] || ['', ''];
        const msgEl = document.getElementById('vai-form-cammsg');
        if (msgEl && msgs[0]) { msgEl.innerHTML = '<i class="fa-solid fa-video-slash"></i><div>' + T(msgs[0], msgs[1]) + '</div>'; msgEl.style.display = 'flex'; }
        if (msgEl && st === 'live') msgEl.style.display = 'none';
        // v7: no camera → show WHY + the correct-technique reference for the
        // exercise (from the workout library) so the modal still teaches.
        if (st === 'denied' || st === 'nocam' || st === 'error' || st === 'off') {
          const resEl = document.getElementById('vai-form-result');
          if (resEl && !resEl.innerHTML) { resEl.innerHTML = cameraHelpHtml(exercise); applyAr(); }
        }
        if (badge) {
          const live = st === 'live';
          badge.classList.toggle('live', live);
          badge.querySelector('span:last-child').textContent = live ? T('live', 'مباشر') : T('camera off', 'الكاميرا متوقفة');
        }
      },
      onForm: function (r) {
        if (r && r.premiumWall) { closeIt('vai-form-modal'); VoltaPremium.openHub('form-check'); return; }
        const resEl = document.getElementById('vai-form-result');
        if (resEl) { resEl.innerHTML = verdictHtml(r); applyAr(); }
      }
    });
    claimEngine(eng);
    eng.setForm(true);
    eng.start();
  }

  // v7 — the "Check My Form" action runs the DEEP check: on-device
  // multi-result analysis + (online) a real Gemini vision critique of the
  // frames captured at the user's rep bottoms.
  async function checkMyForm() {
    if (!ActiveEngine) return;
    const btn = document.getElementById('vai-form-check-btn');
    const deep = !!(navigator.onLine && (typeof window.VOLTA_GEMINI_KEY === 'string' && window.VOLTA_GEMINI_KEY));
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ' + T(deep ? 'AI is analyzing your movement…' : 'AI is reading your movement…', 'الذكاء الاصطناعي يحلل حركتك…'); }
    try {
      const exEl = document.getElementById('vai-form-exercise');
      if (exEl && exEl.value) ActiveEngine.exercise = exEl.value;
      await ActiveEngine.checkFormNow(deep);
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> ' + T('Check My Form', 'دقّق أدائي'); }
    }
  }

  // v7 — camera unavailable: explain (and answer the "does it work from a
  // local html file?" question inline) + show the exercise's technique
  // reference from the workout library, so the check is never a dead end.
  function cameraHelpHtml(exercise) {
    let info = null;
    try { if (typeof getWorkoutInfo === 'function') info = getWorkoutInfo(exercise || '', ''); } catch (e) {}
    // Fuzzy fallback: an exact-name match can miss ("Push-ups" vs "Decline
    // Push-Ups") — find a closely related workout in the DB so the user
    // still gets real technique steps for their exercise.
    if (info && !(info.steps && info.steps.length) && typeof WORKOUTS_DB !== 'undefined' && Array.isArray(WORKOUTS_DB)) {
      try {
        const norm = (typeof normalizeExerciseName === 'function')
          ? normalizeExerciseName(exercise)
          : String(exercise || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
        if (norm) {
          const tokens = norm.split(' ').filter(function (t) { return t.length > 2; });
          let best = null, bestScore = 0;
          WORKOUTS_DB.forEach(function (w) {
            if (!w || !w.name) return;
            const wn = (typeof normalizeExerciseName === 'function') ? normalizeExerciseName(w.name) : String(w.name).toLowerCase();
            if (wn === norm) { if (w.steps || w.tips) { best = w; bestScore = 99; } return; }
            let score = 0;
            tokens.forEach(function (t) { if (wn.indexOf(t) !== -1) score++; });
            if (wn.indexOf(norm) !== -1) score += 2;
            if (score > bestScore && (w.steps || w.tips)) { bestScore = score; best = w; }
          });
          if (best && bestScore >= Math.max(1, Math.ceil(tokens.length / 2))) {
            info = { muscle: best.muscleGroup || (info.muscle || ''), desc: best.description || info.desc, img: info.img,
                     steps: Array.isArray(best.steps) ? best.steps : [], tips: Array.isArray(best.tips) ? best.tips : [] };
          }
        }
      } catch (e) {}
    }
    let html =
      '<div class="vai-verdict">' +
        '<div class="vai-safety medium" style="margin-top:0;"><i class="fa-solid fa-video-slash"></i><span>' +
          T('The live AI form check needs your camera. It DOES work from a local HTML file in Chrome, Edge and Firefox — click "Allow" when the camera permission appears (file:// pages are secure). In the Play-Store app, grant the app camera permission.',
             'فحص الأداء الذكي يحتاج الكاميرا. وهو يعمل من ملف HTML محلي في كروم وإيدج وفايرفوكس — اضغط «سماح» عند ظهور إذن الكاميرا (صفحات file:// آمنة). وفي تطبيق المتجر، اسمح للتطبيق باستخدام الكاميرا.') +
        '</span></div>';
    if (info && ((info.steps && info.steps.length) || (info.tips && info.tips.length))) {
      html += '<div class="vai-ai-sec" style="margin-top:10px;">' +
        '<h6><i class="fa-solid fa-book-open"></i> ' + T('Correct technique — ' + (exercise || 'exercise'), 'الأداء الصحيح — ' + (exercise || 'التمرين')) + '</h6>';
      if (info.steps && info.steps.length) html += '<ol style="margin:0;padding-inline-start:20px;">' + info.steps.map(function (s) { return '<li style="font-size:.8rem;color:var(--text);line-height:1.45;">' + s + '</li>'; }).join('') + '</ol>';
      if (info.tips && info.tips.length) html += '<ul style="margin:8px 0 0;padding-inline-start:20px;">' + info.tips.map(function (s) { return '<li style="font-size:.8rem;color:var(--muted);line-height:1.45;">' + s + '</li>'; }).join('') + '</ul>';
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  // v7 — MULTI-RESULT verdict renderer: score ring + (AI-checked tag) +
  // measured-stats grid + SEVERAL finding cards + Gemini vision section.
  // Falls back to the legacy issues/cues lists when a result carries no
  // results[] array.
  function verdictHtml(d) {
    const color = d.verdict === 'good' ? 'var(--green)' : d.verdict === 'okay' ? 'var(--amber)' : 'var(--red)';
    const vLabel = d.verdict === 'good' ? T('Great form', 'أداء ممتاز') : d.verdict === 'okay' ? T('Good — fixable details', 'جيد — تفاصيل قابلة للتحسين') : T('Needs fixing', 'يحتاج تصحيحاً');
    const circ = 2 * Math.PI * 26;
    const dash = circ * (Math.max(0, Math.min(100, d.score || 0)) / 100);
    let html =
      '<div class="vai-verdict">' +
        '<div class="vai-verdict-head">' +
          '<div class="vai-score-ring">' +
            '<svg width="64" height="64"><circle cx="32" cy="32" r="26" fill="none" stroke="var(--accent-soft)" stroke-width="6"/>' +
            '<circle cx="32" cy="32" r="26" fill="none" stroke="' + color + '" stroke-width="6" stroke-linecap="round" stroke-dasharray="' + dash + ' ' + circ + '"/></svg>' +
            '<b>' + (d.score != null ? d.score : '—') + '</b>' +
          '</div>' +
          '<div class="vt" style="color:' + color + ';">' + vLabel +
            (d.ai && d.ai.checked ? '<span class="vai-ai-tag"><i class="fa-solid fa-wand-magic-sparkles"></i> ' + T('GEMINI VISION CHECK', 'فحص رؤية جيميني') + '</span>' : '') +
            '<small>' + (d.exercise || '') + (d.exerciseType ? ' · ' + d.exerciseType : '') + '</small></div>' +
        '</div>';
    // ── what the AI measured in this set ──
    if (d.measured && (d.measured.reps > 0 || d.measured.durationSec > 0)) {
      const mv = d.measured;
      const cell = function (val, label) { return (val != null) ? '<div class="vm"><b>' + val + '</b><small>' + label + '</small></div>' : ''; };
      html += '<div class="vai-measured">' +
        cell(mv.reps, T('REPS', 'تكرار')) +
        cell((mv.tempoSec ? mv.tempoSec + 's' : null), T('TEMPO', 'الإيقاع')) +
        cell((mv.tempoConsistencyPct != null ? mv.tempoConsistencyPct + '%' : null), T('TIMING', 'التوقيت')) +
        cell((mv.romConsistencyPct != null ? mv.romConsistencyPct + '%' : null), T('RANGE', 'المدى')) +
        cell((mv.symmetryPct != null ? mv.symmetryPct + '%' : null), T('L/R BALANCE', 'التوازن')) +
        cell((mv.stabilityPct != null ? mv.stabilityPct + '%' : null), T('STABILITY', 'الثبات')) +
      '</div>';
    }
    // ── several finding cards (the multi-answer part) ──
    if (d.results && d.results.length) {
      const rIcon = { good: 'fa-circle-check', warn: 'fa-triangle-exclamation', bad: 'fa-circle-xmark' };
      const rCol = { good: 'var(--green)', warn: 'var(--amber)', bad: 'var(--red)' };
      html += '<div class="vai-answers-head" style="margin-top:4px;"><i class="fa-solid fa-magnifying-glass-chart"></i> ' + T('WHAT THE AI FOUND', 'ما وجده الذكاء الاصطناعي') + '</div>' +
        d.results.map(function (r) {
          const v = r.verdict || 'warn';
          return '<div class="vai-result ' + v + '">' +
            '<i class="fa-solid ' + (r.icon || rIcon[v] || 'fa-circle-info') + ' ric" style="color:' + rCol[v] + ';"></i>' +
            '<div class="vr-body"><b>' + (r.title || '') + '</b><span>' + (r.text || '') + '</span></div></div>';
        }).join('');
    }
    // ── Gemini vision critique (deep check) ──
    if (d.ai && d.ai.checked) {
      html += '<div class="vai-ai-sec">' +
        '<h6><i class="fa-solid fa-wand-magic-sparkles"></i> ' + T('GEMINI AI — YOUR ACTUAL FORM', 'جيميني — أداؤك الفعلي') + '</h6>';
      if (d.ai.observations && d.ai.observations.length) {
        html += '<ul>' + d.ai.observations.map(function (x) { return '<li><i class="fa-solid fa-eye" style="color:var(--accent);"></i><span>' + x + '</span></li>'; }).join('') + '</ul>';
      }
      if (d.ai.fixes && d.ai.fixes.length) {
        html += '<ul style="margin-top:6px;">' + d.ai.fixes.map(function (x) { return '<li><i class="fa-solid fa-screwdriver-wrench" style="color:var(--green);"></i><span>' + x + '</span></li>'; }).join('') + '</ul>';
      }
      if (d.ai.bodyCue) html += '<div class="vai-note" style="margin:8px 0 0;"><i class="fa-solid fa-person"></i> ' + d.ai.bodyCue + '</div>';
      html += '</div>';
    }
    // ── legacy lists (only when no results[] cards were rendered) ──
    if (!(d.results && d.results.length)) {
      if (d.issues && d.issues.length) {
        html += '<b style="font-size:.76rem;color:var(--muted);">' + T('ISSUES', 'المشاكل') + '</b>' +
          '<ul class="vai-list">' + d.issues.map(function (x) { return '<li><i class="fa-solid fa-circle-exclamation" style="color:var(--amber)"></i><span>' + x + '</span></li>'; }).join('') + '</ul>';
      }
      if (d.cues && d.cues.length) {
        html += '<b style="font-size:.76rem;color:var(--muted);display:block;margin-top:8px;">' + T('FIXES', 'التصحيحات') + '</b>' +
          '<ul class="vai-list">' + d.cues.map(function (x) { return '<li><i class="fa-solid fa-circle-check" style="color:var(--green)"></i><span>' + x + '</span></li>'; }).join('') + '</ul>';
      }
    } else if (d.cues && d.cues.length) {
      // keep the top fixes visible under the cards too
      html += '<b style="font-size:.76rem;color:var(--muted);display:block;margin-top:8px;">' + T('TOP FIXES', 'أهم التصحيحات') + '</b>' +
        '<ul class="vai-list">' + d.cues.map(function (x) { return '<li><i class="fa-solid fa-circle-check" style="color:var(--green)"></i><span>' + x + '</span></li>'; }).join('') + '</ul>';
    }
    if (d.safety) {
      const lvl = d.safetyLevel === 'high' ? 'high' : d.safetyLevel === 'medium' ? 'medium' : 'low';
      html += '<div class="vai-safety ' + lvl + '"><i class="fa-solid fa-shield-halved"></i><span>' + d.safety + '</span></div>';
    }
    html += '</div>';
    return html;
  }

  // ═══════════════ 2) RepSense — standalone modal (Premium hub) ══════════
  function openRepSense(exercise) {
    if (typeof VoltaPremium === 'undefined' || !VoltaPremium.gate('rep-count')) return;
    // v9: only inside a workout (the premium hub can be opened anywhere).
    if (!inWorkout()) {
      const inner0 = ensureModal('vai-rep-modal').querySelector('.vai-inner');
      inner0.innerHTML =
        head('fa-stopwatch-20', 'RepSense — AI Rep Counter', 'ريب سينس — عدّاد التكرارات',
          T('Stand back so your full body is in frame — AI counts your reps.', 'قف بعيداً ليظهر جسمك كاملاً — الذكاء الاصطناعي يعدّ تكراراتك.'),
          'عدّ تلقائي وتلميحات أداء لحظية') +
        inWorkoutNoticeHtml('reps');
      openIt('vai-rep-modal');
      applyAr();
      return;
    }
    const inner = ensureModal('vai-rep-modal').querySelector('.vai-inner');
    inner.innerHTML =
      head('fa-stopwatch-20', 'RepSense — AI Rep Counter', 'ريب سينس — عدّاد التكرارات',
        T('Stand back so your full body is in frame — AI counts your reps.', 'قف بعيداً ليظهر جسمك كاملاً — الذكاء الاصطناعي يعدّ تكراراتك.'),
        'عدّ تلقائي وتلميحات أداء لحظية') +
      '<div class="vai-cam-wrap">' +
        '<video id="vai-rep-video" playsinline muted></video>' +
        '<div class="vai-cam-msg" id="vai-rep-cammsg"><i class="fa-solid fa-video"></i><div>' + T('Starting camera…', 'جارٍ تشغيل الكاميرا…') + '</div></div>' +
        '<span class="vai-cam-badge" id="vai-rep-badge"><span class="dot"></span> <span>' + T('camera off', 'الكاميرا متوقفة') + '</span></span>' +
        '<span class="vai-autocount" id="vai-rep-autocount"><i class="fa-solid fa-robot"></i> ' + T('AI AUTO-COUNT', 'عدّ تلقائي بالذكاء') + '</span>' +
      '</div>' +
      '<label style="font-size:.78rem;color:var(--muted);">' + T('Exercise', 'التمرين') + '</label>' +
      '<input type="text" id="vai-rep-exercise" value="' + String(exercise || '').replace(/"/g, '&quot;') + '" placeholder="' + T('e.g. Push-ups', 'مثال: تمارين ضغط') + '" style="margin:6px 0 12px;" />' +
      '<div class="vai-rep-hud">' +
        // v13 (user): "only display rep count and align it to the center" —
        // the REPS label + UP/DOWN phase pill are gone; the number stands
        // alone, centered. Set auto-saves when the modal closes.
        '<div class="vai-rep-num"><b id="vai-rep-count">0</b></div>' +
      '</div>' +
      '<div class="vai-feedback" id="vai-rep-feedback"></div>' +
      '<div class="vp-btn-row">' +
        '<button class="btn ghost" id="vai-rep-toggle" onclick="VoltaAI.repToggle()"><i class="fa-solid fa-pause"></i> <span>' + T('Pause', 'إيقاف مؤقت') + '</span></button>' +
      '</div>' +
      '<div class="vai-sessions" id="vai-rep-history"></div>';
    openIt('vai-rep-modal');
    const video = document.getElementById('vai-rep-video');
    const badge = document.getElementById('vai-rep-badge');
    const eng = new AssistEngine({
      videoEl: video, exercise: exercise || 'exercise', beep: true,
      onStatus: function (st) {
        const msgs = {
          starting: ['Starting camera…', 'جارٍ تشغيل الكاميرا…'],
          denied: ['Camera permission denied — allow camera in your browser (or check Settings → AI Camera).', 'تم رفض إذن الكاميرا — اسمح بها من المتصفح (أو راجع الإعدادات ← كاميرا الذكاء).'],
          off: ['AI camera is OFF — enable it in Settings → AI Camera to count reps.', 'كاميرا الذكاء الاصطناعي متوقفة — فعّلها من الإعدادات ← كاميرا الذكاء لعدّ التكرارات.'],
          nocam: ['No camera found on this device.', 'لا توجد كاميرا على هذا الجهاز.'],
          error: ['Could not start the camera.', 'تعذر تشغيل الكاميرا.'],
          live: ['', ''],
          stopped: ['camera off', 'الكاميرا متوقفة']
        }[st] || ['', ''];
        const msgEl = document.getElementById('vai-rep-cammsg');
        if (msgEl && msgs[0]) { msgEl.innerHTML = '<i class="fa-solid fa-video-slash"></i><div>' + T(msgs[0], msgs[1]) + '</div>'; msgEl.style.display = 'flex'; }
        if (msgEl && st === 'live') msgEl.style.display = 'none';
        if (badge) {
          const live = st === 'live';
          badge.classList.toggle('live', live);
          badge.querySelector('span:last-child').textContent = live ? T('live', 'مباشر') : T('camera off', 'الكاميرا متوقفة');
        }
      },
      onReps: function (r) {
        const el = document.getElementById('vai-rep-count');
        if (el) {
          el.textContent = r.reps;
          // v7: every auto-counted rep pops the counter — you SEE and HEAR
          // the AI counting by itself (beep + vibrate fire in the engine).
          if (r.counted) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
        }
        const ph = document.getElementById('vai-rep-phase');
        if (ph) ph.textContent = ''; // v13: phase pill removed from the HUD
        if (r.feedback === 'no_movement') {
          const fb = document.getElementById('vai-rep-feedback');
          if (fb) fb.innerHTML = '<b><i class="fa-solid fa-robot"></i></b> ' + T('No movement detected — step back so your full body is in frame.', 'لا يوجد حركة — ابتعد قليلاً ليظهر جسمك كاملاً.');
        } else if (r.counted && r.tempoSec) {
          const fb = document.getElementById('vai-rep-feedback');
          if (fb) fb.innerHTML = '<b><i class="fa-solid fa-robot"></i></b> ' + T('Auto-counted — steady rhythm, ' + r.tempoSec + 's per rep. Keep going!', 'عدّ تلقائي — إيقاع ثابت، ' + r.tempoSec + ' ث لكل تكرار. استمر!');
        }
      }
    });
    claimEngine(eng);
    eng.setReps(true);
    eng.start();
    loadRepHistory();
  }

  function repToggle() {
    // pause/resume the counting loop of the active engine
    if (!ActiveEngine) return;
    const btn = document.getElementById('vai-rep-toggle');
    if (ActiveEngine.loop) {
      clearInterval(ActiveEngine.loop); ActiveEngine._paused = true;
      if (btn) btn.innerHTML = '<i class="fa-solid fa-play"></i> <span>' + T('Start counting', 'ابدأ العد') + '</span>';
      return;
    }
    ActiveEngine._paused = false;
    if (btn) btn.innerHTML = '<i class="fa-solid fa-pause"></i> <span>' + T('Pause', 'إيقاف مؤقت') + '</span>';
    const eng = ActiveEngine;
    eng.loop = setInterval(function () {
      if (!eng.counter || !eng.videoEl || !eng.videoEl.videoWidth) return;
      const r = eng.counter.process(eng.videoEl, Date.now());
      if (r.counted) eng._onRepCounted();   // v7: keep the beep + vibrate + snapshot on resume
      if (eng.repsOn && eng.onReps) eng.onReps(r);
    }, 120);
  }

  function repAdjust(delta) {
    if (ActiveEngine) ActiveEngine.repAdjust(delta);
  }

  async function repFinish() {
    if (!ActiveEngine) return;
    const exEl = document.getElementById('vai-rep-exercise');
    if (exEl && exEl.value) ActiveEngine.exercise = exEl.value;
    const r = ActiveEngine.finishSet();
    if (r.reps <= 0) { toast(T('No reps counted yet — step into frame and start moving, the AI counts for you.', 'لا يوجد عد بعد — ادخل في الإطار وابدأ الحركة، الذكاء الاصطناعي يعدّ تلقائياً.'), 'info'); return; }
    await saveRepSession({ type: 'rep', exercise: ActiveEngine.exercise, reps: r.reps, durationSec: r.durationSec, tempoSec: r.tempoSec || 0 });
    toast(T('Set saved: ' + r.reps + ' reps · ' + r.durationSec + 's' + (r.tempoSec ? ' · ~' + r.tempoSec + 's/rep' : ''),
            'تم حفظ المجموعة: ' + r.reps + ' تكرار · ' + r.durationSec + ' ث' + (r.tempoSec ? ' · ~' + r.tempoSec + ' ث/تكرار' : '')), 'success');
    if (ActiveEngine && ActiveEngine.counter) { ActiveEngine.counter.reps = 0; ActiveEngine.counter.repIntervals = []; }
    const el = document.getElementById('vai-rep-count');
    if (el) el.textContent = '0';
    loadRepHistory();
  }

  async function loadRepHistory() {
    const el = document.getElementById('vai-rep-history');
    if (!el) return;
    const rows = localSessions().filter(function (s) { return !email() || s.email === email(); }).slice(0, 12);
    if (!rows.length) { el.innerHTML = ''; return; }
    el.innerHTML = rows.slice(0, 12).map(function (s) {
      const d = new Date(s.at || Date.now()).toLocaleDateString(ar() ? 'ar-EG' : 'en-GB', { month: 'short', day: 'numeric' });
      const icon = s.type === 'form' ? 'fa-video' : 'fa-stopwatch-20';
      const right = s.type === 'form'
        ? (s.formScore != null ? (T('Form', 'أداء') + ' ' + s.formScore + '/100') : '')
        : (s.reps + ' ' + T('reps', 'تكرار') + ' · ' + (s.durationSec || 0) + 's');
      return '<div class="vai-session"><i class="fa-solid ' + icon + '"></i><b>' + (s.exercise || '—') + '</b><small>' + right + ' · ' + d + '</small></div>';
    }).join('');
  }

  // ═══════════════ 3) AI Weekly Report (FREE, cloud-backed) ══════════════
  function openWeeklyReport() {
    const inner = ensureModal('vai-report-modal').querySelector('.vai-inner');
    inner.innerHTML =
      head('fa-chart-line', 'AI Weekly Report', 'التقرير الأسبوعي الذكي',
        T('AI analyzes your last 7 days and tells you what to improve.', 'الذكاء الاصطناعي يحلل آخر 7 أيام ويقول لك ماذا تتحسن.'),
        'تحليل صادق ومباشر لكل أسبوع') +
      '<div id="vai-report-body" style="text-align:center;padding:26px 0;">' +
        '<button class="vp-cta" onclick="VoltaAI.generateReport()"><i class="fa-solid fa-wand-magic-sparkles"></i> ' + T('Generate my report', 'أنشئ تقريري') + '</button>' +
      '</div>';
    openIt('vai-report-modal');
  }

  function collectWeekStats() {
    const stats = { minutes: 0, workouts: 0, kcalBurned: 0, kcalEaten: 0, streakDays: 0, topExercises: [], sessionsLogged: 0, daysActive: 0 };
    const user = u();
    if (!user) return stats;
    stats.streakDays = user.streak || 0;
    try {
      if (typeof getSessionStats === 'function') {
        const s = getSessionStats();
        stats.minutes = s.weekMin || 0;
      }
    } catch (e) {}
    const since = Date.now() - 7 * 864e5;
    const days = {}, exCount = {};
    (user.sessions || []).forEach(function (s) {
      const t = new Date(s.completedAt || s.date || s.at || 0).getTime();
      if (!t || t < since) return;
      stats.sessionsLogged++;
      stats.workouts += (s.workouts != null ? s.workouts : 1) || 1;
      stats.kcalBurned += s.calories || s.kcal || 0;
      const d = new Date(t).toDateString();
      days[d] = 1;
      if (s.name) exCount[s.name] = (exCount[s.name] || 0) + 1;
      if (s.exercises) s.exercises.forEach(function (x) { if (x && x.name) exCount[x.name] = (exCount[x.name] || 0) + 1; });
    });
    stats.daysActive = Object.keys(days).length;
    stats.topExercises = Object.keys(exCount).sort(function (a, b) { return exCount[b] - exCount[a]; }).slice(0, 5);
    try {
      if (typeof getDietLog === 'function') {
        const week = getDietLog().filter(function (x) {
          const t = new Date(x.loggedAt || x.date || 0).getTime();
          return t >= since;
        });
        stats.kcalEaten = week.reduce(function (a, x) { return a + (x.kcal || 0); }, 0);
      }
    } catch (e) {}
    return stats;
  }

  async function generateReport() {
    const body = document.getElementById('vai-report-body');
    if (!body) return;
    body.innerHTML = '<div style="padding:20px;color:var(--muted);"><i class="fa-solid fa-spinner fa-spin"></i> ' + T('AI is analyzing your week…', 'الذكاء الاصطناعي يحلل أسبوعك…') + '</div>';
    let data;
    try {
      data = await callApi('/api/ai/weekly-report', { email: email(), lang: ar() ? 'ar' : 'en', stats: collectWeekStats() });
    } catch (err) {
      if (premiumRequiredMsg(err)) { closeIt('vai-report-modal'); VoltaPremium.openHub('report'); return; }
      // v25 (user): "make ai features work offline even on the html file" —
      // a network failure no longer dead-ends the report: the same data is
      // analyzed on-device (localWeeklyReport) and rendered identically.
      if (err && (err.code === 'network' || /fetch|network/i.test(String(err.message || '')))) {
        data = { report: localWeeklyReport() };
      } else {
        body.innerHTML = '<div style="color:var(--red);padding:16px;text-align:center;">' + (err.message || 'Error') + '</div>';
        return;
      }
    }
    const r = data.report || {};
      body.style.textAlign = '';
      body.innerHTML =
        '<div class="vai-report-head"><h4>' + (r.headline || '') + '</h4><p>' + (r.summary || '') + '</p></div>' +
        '<div class="vai-report-grid">' +
          '<div class="vai-report-col wins"><h5>' + T('WINS', 'انتصاراتك') + '</h5><ul>' +
            (r.wins || []).map(function (x) { return '<li><i class="fa-solid fa-circle-check"></i><span>' + x + '</span></li>'; }).join('') + '</ul></div>' +
          '<div class="vai-report-col imps"><h5>' + T('IMPROVE', 'للتحسين') + '</h5><ul>' +
            (r.improvements || []).map(function (x) { return '<li><i class="fa-solid fa-arrow-trend-up"></i><span>' + x + '</span></li>'; }).join('') + '</ul></div>' +
        '</div>' +
        '<div class="vai-report-col" style="margin-bottom:10px;"><h5>' + T('NEXT WEEK FOCUS', 'تركيز الأسبوع القادم') + '</h5><ul>' +
          (r.focus || []).map(function (x) { return '<li><i class="fa-solid fa-bullseye" style="color:var(--accent)"></i><span>' + x + '</span></li>'; }).join('') + '</ul></div>' +
        '<div class="vai-note"><i class="fa-solid fa-bolt"></i> ' + (r.note || '') + '</div>';
  }

  // ═══════════ 4) ProgressIQ — Smart Weight Coach (premium, local) ════════
  // The local safe-progression engine (≤10% rule) runs the show — works
  // offline, instantly, for every premium subscriber.
  function openProgressIQ(exerciseName) {
    if (typeof VoltaPremium !== 'undefined' && !VoltaPremium.gate('progression')) return;
    let ex = exerciseName || '';
    try { if (!ex && typeof deState !== 'undefined' && deState.workouts && deState.workouts[deState.currentWorkout]) ex = deState.workouts[deState.currentWorkout].name; } catch (e) {}
    // v8: pull this exercise's real history from the ProgressIQ database —
    // every set the AI counted for the user is already in there, so the
    // coach starts from THEIR numbers, not from empty inputs.
    const history = ex ? progressDbFor(ex) : [];
    const last = history[0] || null;
    const histHtml = history.length
      ? '<div class="vai-prog-hist">' +
          '<h6><i class="fa-solid fa-database"></i> ' + T('YOUR LOGGED SETS — COUNTED BY THE AI', 'مجموعاتك المسجلة — عُدّت بالذكاء الاصطناعي') + '</h6>' +
          history.slice(0, 5).map(function (h) {
            const d = new Date(h.at || Date.now()).toLocaleDateString(ar() ? 'ar-EG' : 'en-GB', { month: 'short', day: 'numeric' });
            return '<div class="vai-prog-hist-row">' +
              '<b>' + (h.sets || 1) + ' × ' + (h.bestSet || h.reps || 0) + '</b>' +
              '<span>' + (h.weight ? (h.weight + ' kg') : T('bodyweight', 'وزن الجسم')) + (h.tempoSec ? ' · ~' + h.tempoSec + 's/rep' : '') + '</span>' +
              '<small>' + d + '</small></div>';
          }).join('') +
        '</div>'
      : '';
    const autoNote = history.length
      ? '<small style="color:var(--green);font-size:.75rem;font-weight:600;"><i class="fa-solid fa-circle-check"></i> ' +
          T('ProgressIQ is reading your ' + history.length + ' logged day' + (history.length > 1 ? 's' : '') + ' of AI-counted sets for this exercise — leave the inputs empty to use them.',
             'بروغريس آيكيو يقرأ ' + history.length + ' يوم' + (history.length > 1 ? 'ًا' : '') + ' من مجموعاتك المعدودة بالذكاء الاصطناعي لهذا التمرين — اترك الحقول فارغة لاستخدامها.') + '</small>'
      : '';
    const inner = ensureModal('vai-prog-modal').querySelector('.vai-inner');
    inner.innerHTML =
      head('fa-dumbbell', 'ProgressIQ', 'بروغريس آيكيو',
        T('AI studies your last sets and prescribes your next weight, reps and rest.', 'يدرس الذكاء الاصطناعي مجموعاتك السابقة ويحدد لك الوزن والتكرارات والراحة القادمة.'),
        'قواعد آمنة: لا يزيد الوزن أكثر من ١٠٪ عن آخر جلسة') +
      '<div style="display:flex;flex-direction:column;gap:10px;margin-bottom:14px;">' +
        '<input type="text" id="vai-prog-exercise" value="' + String(ex).replace(/"/g, '&quot;') + '" placeholder="' + T('Exercise name', 'اسم التمرين') + '" style="padding:11px 13px;border:1.5px solid var(--line);border-radius:10px;font:inherit;">' +
        autoNote +
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">' +
          '<input type="number" id="vai-prog-weight" min="0" max="500" placeholder="' + T('Last kg', 'آخر وزن كجم') + '"' + (last && last.weight ? ' value="' + last.weight + '"' : '') + ' style="padding:11px 10px;border:1.5px solid var(--line);border-radius:10px;font:inherit;">' +
          '<input type="number" id="vai-prog-reps" min="1" max="100" placeholder="' + T('Reps', 'تكرارات') + '"' + (last ? ' value="' + (last.bestSet || last.reps || 8) + '"' : '') + ' style="padding:11px 10px;border:1.5px solid var(--line);border-radius:10px;font:inherit;">' +
          '<input type="number" id="vai-prog-sets" min="1" max="20" placeholder="' + T('Sets', 'مجموعات') + '"' + (last ? ' value="' + (last.sets || 3) + '"' : '') + ' style="padding:11px 10px;border:1.5px solid var(--line);border-radius:10px;font:inherit;">' +
        '</div>' +
        '<small style="color:var(--muted);font-size:.75rem;">' + T('Optional: enter your last session numbers for a sharper prescription — or leave empty and let AI start conservatively.', 'اختياري: أدخل أرقام آخر جلسة لوصف أدق — أو اتركها فارغة وسيبدأ الذكاء الاصطناعي بحذر.') + '</small>' +
      '</div>' +
      '<div id="vai-prog-body" style="text-align:center;padding:10px 0 4px;">' +
        '<button class="vp-cta vp-cta-blue" onclick="VoltaAI.getProgression()"><i class="fa-solid fa-wand-magic-sparkles"></i> ' + T('Get my prescription', 'احسب تمريني القادم') + '</button>' +
      '</div>' +
      '<div id="vai-prog-history-slot">' + histHtml + '</div>';
    openIt('vai-prog-modal');
  }

  function progressionHtml(data) {
    const sug = data.suggestion || {};
    const progColors = { increase: 'var(--green)', hold: 'var(--accent)', decrease: 'var(--amber)', 'new': 'var(--accent)' };
    const progIcons = { increase: 'fa-arrow-up', hold: 'fa-equals', decrease: 'fa-arrow-down', 'new': 'fa-star' };
    return '<div class="vai-total">' +
        '<span class="m-type" style="background:' + (progColors[data.progression] || 'var(--accent)') + ';color:#fff;">' +
          '<i class="fa-solid ' + (progIcons[data.progression] || 'fa-dumbbell') + '"></i> ' + (data.progression || '').toUpperCase() +
        '</span>' +
      '</div>' +
      '<div class="vai-prog-prescription">' +
        '<div class="vai-prog-big">' + (sug.weight ? sug.weight + ' kg' : T('Bodyweight', 'وزن الجسم')) + '</div>' +
        '<div class="vai-prog-sub">' + (sug.sets || 3) + ' × ' + (sug.reps || 8) + ' · ' + T('rest', 'راحة') + ' ' + (sug.restSec || 90) + 's · RPE ' + (sug.rpe || 8) + '</div>' +
      '</div>' +
      '<div class="vai-note" style="margin-bottom:10px;"><i class="fa-solid fa-brain"></i> ' + (data.reason || '') + '</div>' +
      '<div class="vai-report-col wins" style="margin-bottom:8px;"><h5>' + T('WARMUP', 'الإحماء') + '</h5><ul><li><i class="fa-solid fa-fire"></i><span>' + (data.warmup || '') + '</span></li></ul></div>' +
      '<div class="vai-report-col imps"><h5>' + T('SAFETY', 'السلامة') + '</h5><ul><li><i class="fa-solid fa-shield-heart"></i><span>' + (data.safety || '') + '</span></li></ul></div>';
  }

  async function getProgression() {
    const body = document.getElementById('vai-prog-body');
    const exEl = document.getElementById('vai-prog-exercise');
    const exercise = exEl ? exEl.value.trim() : '';
    if (!exercise) { toast(T('Enter the exercise name first.', 'أدخل اسم التمرين أولاً.'), 'info'); return; }
    if (!body) return;
    body.innerHTML = '<div style="padding:18px;color:var(--muted);"><i class="fa-solid fa-spinner fa-spin"></i> ' + T('ProgressIQ is thinking…', 'بروغريس آيكيو يحلل…') + '</div>';
    const wNum = function (id) { const el = document.getElementById(id); if (!el || !el.value) return null; const v = parseFloat(el.value); return isFinite(v) && v > 0 ? v : null; };
    // v8 — the ProgressIQ DATABASE: every set the AI counted for this
    // exercise is in here (RepSense, the workout popup, manual entries).
    // Typed numbers are treated as today's entry: they are saved into the
    // database AND used as the newest log.
    const dbLogs = progressDbFor(exercise);
    const lastLogs = dbLogs.map(function (d) { return { date: d.date, sets: d.sets, reps: d.bestSet || d.reps, weight: d.weight }; });
    const w = wNum('vai-prog-weight'), r = wNum('vai-prog-reps'), s = wNum('vai-prog-sets');
    if (w || r || s) {
      progressDbAdd(exercise, { reps: r || 8, sets: s || 3, weight: w || 0, source: 'manual-progressiq' });
      lastLogs.unshift({ date: new Date().toISOString().slice(0, 10), sets: s || 3, reps: r || 8, weight: w || 0 });
    }
    const user = u();
    const bodyWeight = (user && user.profile && user.profile.weight) || null;
    // LOCAL engine (offline-first) — identical ≤10% safety rule.
    await new Promise(function (res) { setTimeout(res, 350); });
    const local = VoltaLocalAI.progressionLocal(exercise, lastLogs, bodyWeight);
    body.style.textAlign = '';
    body.innerHTML = progressionHtml(local);
    // v8: keep the history list in sync (manual entries may have been added)
    const slot = document.getElementById('vai-prog-history-slot');
    if (slot) {
      const hist = progressDbFor(exercise);
      slot.innerHTML = hist.length
        ? '<div class="vai-prog-hist">' +
            '<h6><i class="fa-solid fa-database"></i> ' + T('YOUR LOGGED SETS — COUNTED BY THE AI', 'مجموعاتك المسجلة — عُدّت بالذكاء الاصطناعي') + '</h6>' +
            hist.slice(0, 5).map(function (h) {
              const d = new Date(h.at || Date.now()).toLocaleDateString(ar() ? 'ar-EG' : 'en-GB', { month: 'short', day: 'numeric' });
              return '<div class="vai-prog-hist-row">' +
                '<b>' + (h.sets || 1) + ' × ' + (h.bestSet || h.reps || 0) + '</b>' +
                '<span>' + (h.weight ? (h.weight + ' kg') : T('bodyweight', 'وزن الجسم')) + (h.tempoSec ? ' · ~' + h.tempoSec + 's/rep' : '') + '</span>' +
                '<small>' + d + '</small></div>';
            }).join('') +
          '</div>'
        : '';
    }
  }

  // ═════════ 5) RecoveryIQ — Muscle Recovery Guide (premium, local) ═══════
  // MULTI-ANSWER + CONDITION-AWARE: reads soreness, sleep, energy, the
  // (optional) sore area, the user's injury from the survey, and the last
  // 7 days of sessions — then answers SEVERAL questions at once:
  // what to train, what to avoid, how today's condition changes the plan,
  // and a concrete recovery-action list. Fully offline (local model).
  const RECOVERY_LOG_KEY = 'volta_recovery_log';
  function recoveryHistory() {
    try { return JSON.parse(localStorage.getItem(RECOVERY_LOG_KEY) || '[]'); } catch (e) { return []; }
  }
  function pushRecoveryHistory(overall) {
    try {
      const all = recoveryHistory();
      const today = (typeof localDateStr === 'function') ? localDateStr() : new Date().toISOString().slice(0, 10);
      const found = all.find(function (x) { return x.d === today; });
      if (found) found.s = overall;
      else all.push({ d: today, s: overall });
      localStorage.setItem(RECOVERY_LOG_KEY, JSON.stringify(all.slice(-14)));
    } catch (e) {}
  }

  // ══════════════ RecoveryIQ — FULL SCREEN (v4, not a popup) ══════════════
  // The exact same content (inputs + results body + 7-check trend) renders
  // into #recovery-screen-container inside the real tab-recovery screen.
  function recoveryScreenHtml() {
    return head('fa-battery-three-quarters', 'RecoveryIQ', 'Recovery IQ', /* v45: brand stays Latin in AR */
        T('Answers your recovery questions from your last 7 days of training + how you feel right now.', 'يجيب على أسئلة استشفائك من تدريبات آخر ٧ أيام + حالتك الآن.'),
        'نموذج استشفاء متقدم · لا يوصي أبداً بتدريب عضلة مرهقة') +
      '<div class="vai-recov-inputs">' +
        '<div class="vai-recov-in"><label>' + T('Soreness', 'التعب العضلي') + '</label>' +
          '<select id="vai-recov-soreness">' +
            '<option value="none">' + T('None', 'لا يوجد') + '</option>' +
            '<option value="mild">' + T('Mild', 'خفيف') + '</option>' +
            '<option value="moderate" selected>' + T('Moderate', 'متوسط') + '</option>' +
            '<option value="severe">' + T('Severe', 'شديد') + '</option>' +
          '</select></div>' +
        '<div class="vai-recov-in"><label>' + T('Sleep (hours)', 'النوم (ساعات)') + '</label>' +
          '<input type="number" id="vai-recov-sleep" min="0" max="14" step="0.5" placeholder="7.5"></div>' +
        '<div class="vai-recov-in"><label>' + T('Energy', 'الطاقة') + '</label>' +
          '<select id="vai-recov-energy">' +
            '<option value="1">1 · ' + T('Exhausted', 'منهك') + '</option>' +
            '<option value="2">2 · ' + T('Low', 'منخفضة') + '</option>' +
            '<option value="3" selected>3 · ' + T('Normal', 'عادية') + '</option>' +
            '<option value="4">4 · ' + T('Good', 'جيدة') + '</option>' +
            '<option value="5">5 · ' + T('Amazing', 'ممتازة') + '</option>' +
          '</select></div>' +
      '</div>' +
      '<div class="vai-recov-in vai-recov-area-row"><label>' + T('Sore area (optional)', 'المنطقة المتعبة (اختياري)') + '</label>' +
        '<select id="vai-recov-area">' +
          '<option value="">' + T('— none selected —', '— بدون تحديد —') + '</option>' +
          '<option value="Chest">' + T('Chest', 'الصدر') + '</option>' +
          '<option value="Back">' + T('Back', 'الظهر') + '</option>' +
          '<option value="Legs">' + T('Legs', 'الأرجل') + '</option>' +
          '<option value="Shoulders">' + T('Shoulders', 'الأكتاف') + '</option>' +
          '<option value="Arms">' + T('Arms', 'الذراعين') + '</option>' +
          '<option value="Core">' + T('Core', 'البطن') + '</option>' +
          '<option value="Full Body">' + T('Full body', 'كل الجسم') + '</option>' +
        '</select></div>' +
      '<div id="vai-recov-body" style="text-align:center;padding:10px 0 4px;">' +
        '<button class="vp-cta vp-cta-blue" onclick="VoltaAI.getRecovery()"><i class="fa-solid fa-wand-magic-sparkles"></i> ' + T('Check my recovery', 'افحص استشفائي') + '</button>' +
      '</div>' +
      '<div class="vai-recov-trend" id="vai-recov-trend"></div>';
  }

  // Locked state for FREE users who somehow land on the screen (defense in
  // depth — every entry point already gates, this covers direct showTab calls).
  function renderRecoveryLocked() {
    const holder = document.getElementById('recovery-screen-container');
    if (!holder) return;
    holder.innerHTML =
      '<div class="vai-recov-locked">' +
        '<i class="fa-solid fa-lock"></i>' +
        '<h3>' + T('RecoveryIQ is a Premium feature', 'Recovery IQ ميزة بريميوم') + '</h3>' +
        '<p>' + T('Advanced AI recovery readings, per-muscle readiness, ready-in times and your 7-check trend — unlock everything with Volta Premium.', 'قراءات استشفاء متقدمة بالذكاء الاصطناعي، جاهزية كل عضلة، أوقات الجاهزية واتجاه آخر ٧ فحوصات — افتح كل شيء مع فولتا بريميوم.') + '</p>' +
        '<button class="vp-cta" onclick="VoltaPremium.openHub(\'recovery\')"><i class="fa-solid fa-bolt"></i> ' + T('Unlock with Premium', 'افتح مع بريميوم') + '</button>' +
      '</div>';
  }

  function renderRecoveryScreen() {
    const holder = document.getElementById('recovery-screen-container');
    if (!holder) return;
    holder.innerHTML = recoveryScreenHtml();
    try { holder.dataset.lang = (typeof store !== 'undefined' && store.lang) || 'en'; } catch (e) {}
    try { renderRecoveryTrend(); } catch (e) {}
  }

  // Idempotent: called by showTab('recovery') — renders the right content for
  // the user's premium state without wiping an in-progress AI result.
  function ensureRecoveryScreen() {
    const holder = document.getElementById('recovery-screen-container');
    if (!holder) return;
    // v43 (user): premium features are premium AGAIN — the v29 "free for
    // everyone" rule is gone, so the locked panel renders for free users.
    const premium = (typeof VoltaPremium === 'undefined') || VoltaPremium.isPremium();
    if (!premium) {
      // Only render the locked panel if the screen isn't already showing it
      if (!holder.querySelector('.vai-recov-locked')) renderRecoveryLocked();
      return;
    }
    const bodyEl = document.getElementById('vai-recov-body');
    const onScreen = bodyEl && holder.contains(bodyEl);
    // Re-render when the language changed (labels are render-time translated)
    // — but never wipe an in-progress AI result.
    const langNow = (typeof store !== 'undefined' && store.lang) || 'en';
    const langRendered = holder.dataset.lang || null;
    if (onScreen && langRendered && langRendered !== langNow && !holder.querySelector('.vai-answer')) {
      renderRecoveryScreen();
      return;
    }
    // Premium: render the inputs unless they are already on screen
    if (!onScreen) renderRecoveryScreen();
  }

  function openRecoveryIQ() {
    if (typeof VoltaPremium !== 'undefined' && !VoltaPremium.gate('recovery')) return;
    renderRecoveryScreen();
    if (typeof showTab === 'function') showTab('recovery');
  }

  function renderRecoveryTrend() {
    const el = document.getElementById('vai-recov-trend');
    if (!el) return;
    const hist = recoveryHistory().slice(-7);
    if (hist.length < 2) { el.innerHTML = ''; return; }
    el.innerHTML = '<b>' + T('YOUR LAST 7 CHECKS', 'آخر ٧ فحوصات') + '</b><div class="vai-trend-bars">' +
      hist.map(function (x) {
        const h = Math.max(8, Math.min(100, x.s));
        const col = x.s >= 75 ? 'var(--green)' : x.s >= 55 ? 'var(--amber)' : 'var(--red)';
        const d = new Date(x.d + 'T12:00:00').toLocaleDateString(ar() ? 'ar-EG' : 'en-GB', { weekday: 'short' });
        return '<span class="vai-trend-bar" title="' + x.d + ': ' + x.s + '/100"><i style="height:' + h + '%;background:' + col + ';"></i><small>' + d + '</small></span>';
      }).join('') + '</div>';
  }

  // Build weekLogs from the user's real sessions (shared with the local model).
  function collectWeekLogs() {
    const weekLogs = [];
    const user = u();
    if (user && user.sessions && user.sessions.length) {
      const now = Date.now();
      const muscleOf = (window.VoltaLocalAI && VoltaLocalAI.muscleOf) || function () { return 'Full Body'; };
      user.sessions.slice(-40).forEach(function (s) {
        const d = new Date(s.date || s.loggedAt || Date.now());
        if (isNaN(d) || now - d.getTime() > 7 * 864e5) return;
        const names = [];
        if (s.exercises) (s.exercises || []).forEach(function (x) { if (x && x.name) names.push(x.name); });
        if (s.name) names.push(s.name);
        let groups = names.map(muscleOf).filter(function (g, i, a) { return g !== 'Full Body' && a.indexOf(g) === i; });
        if (!groups.length) groups = [s.sport || 'Full Body'];
        weekLogs.push({
          date: (s.date || '').slice(0, 10) || d.toISOString().slice(0, 10),
          muscleGroups: groups.slice(0, 4),
          minutes: Math.max(0, Math.min(300, Math.round(Number(s.duration) || 0)))
        });
      });
      weekLogs.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    }
    return weekLogs.slice(-14);
  }

  // The user's injury from the survey/profile — feeds the local model so the
  // answers respect the user's condition (knees / lower back / shoulders).
  function userInjury() {
    const user = u();
    if (!user) return 'None';
    const inj = (user.survey && user.survey.injury) || (user.profile && user.profile.injury) || 'None';
    return inj || 'None';
  }

  function recoveryInputs() {
    const sel = document.getElementById('vai-recov-soreness');
    const sleepEl = document.getElementById('vai-recov-sleep');
    const energyEl = document.getElementById('vai-recov-energy');
    const areaEl = document.getElementById('vai-recov-area');
    const sleepV = sleepEl && sleepEl.value !== '' ? parseFloat(sleepEl.value) : null;
    return {
      soreness: sel ? sel.value : 'none',
      sleepH: (sleepV != null && isFinite(sleepV)) ? sleepV : null,
      energy: energyEl ? parseInt(energyEl.value, 10) : 3,
      soreArea: areaEl ? areaEl.value : ''
    };
  }

  // Multi-answer renderer: muscle grid + several direct answers + recovery
  // actions + injury note. Every item comes from the local model and changes
  // with the user's condition inputs.
  function recoveryHtml(data) {
    const statusColors = { recovered: 'var(--green)', fresh: 'var(--accent)', fatigued: 'var(--amber)', overworked: 'var(--red)' };
    const T2 = T;
    let html = '<div class="vai-recov-top">' +
      '<div class="vai-recov-score"><b>' + (data.overall != null ? data.overall : '—') + '</b><span>/100</span><small>' + T2('RECOVERY', 'الاستشفاء') + '</small></div>' +
      (data.weeklyLoadMin ? '<div class="vai-recov-load"><b>' + data.weeklyLoadMin + '</b><small>' + T2('MIN THIS WEEK', 'د هذا الأسبوع') + '</small></div>' : '') +
      '<div class="vai-recov-verdict" style="color:' + (data.overall >= 75 ? 'var(--green)' : data.overall >= 55 ? 'var(--amber)' : 'var(--red)') + ';">' + (data.verdict || '') + '</div>' +
      '</div>';
    if (data.summary) html += '<div class="vai-note" style="margin-bottom:10px;"><i class="fa-solid fa-user-check"></i> ' + data.summary + '</div>';
    html += '<div class="vai-recov-grid">' +
      (data.muscles || []).map(function (m) {
        let ready = '';
        if (typeof m.readyIn === 'number' && m.readyIn > 0) {
          ready = m.readyIn >= 24
            ? '<span class="vai-ready"><i class="fa-regular fa-clock"></i> ' + T2('ready in ~', 'جاهز بعد ~') + Math.round(m.readyIn / 24) + ' ' + T2('d', 'يوم') + '</span>'
            : '<span class="vai-ready"><i class="fa-regular fa-clock"></i> ' + T2('ready in ~', 'جاهز بعد ~') + m.readyIn + ' ' + T2('h', 'س') + '</span>';
        } else {
          ready = '<span class="vai-ready ok"><i class="fa-solid fa-check"></i> ' + T2('ready now', 'جاهز الآن') + '</span>';
        }
        return '<div class="vai-recov-item" style="border-inline-start:4px solid ' + (statusColors[m.status] || 'var(--accent)') + ';">' +
          '<b>' + m.group + '</b>' +
          '<span class="vai-recov-status" style="color:' + (statusColors[m.status] || 'var(--accent)') + ';">' + (m.status || '') + ' · ' + m.score + '%</span>' +
          ready +
          '<small>' + (m.advice || '') + '</small>' +
        '</div>';
      }).join('') +
      '</div>';
    // ─── MULTI-ANSWER section: several direct answers, not one blob ───
    if (data.answers && data.answers.length) {
      html += '<div class="vai-answers-head"><i class="fa-solid fa-comments"></i> ' + T2('YOUR ANSWERS', 'إجاباتك') + '</div>' +
        data.answers.map(function (a) {
          return '<div class="vai-answer"><span class="vai-answer-ic"><i class="fa-solid ' + (a.icon || 'fa-circle-question') + '"></i></span>' +
            '<div><b>' + (a.title || '') + '</b><span>' + (a.text || '') + '</span></div></div>';
        }).join('');
    }
    if (data.todayFocus) html += '<div class="vai-note" style="margin-bottom:8px;"><i class="fa-solid fa-bullseye"></i> <b>' + T2('Today', 'اليوم') + ':</b> ' + data.todayFocus + '</div>';
    if (data.avoid && data.avoid.length) html += '<div class="vai-note" style="margin-bottom:8px;"><i class="fa-solid fa-ban" style="color:var(--red)"></i> <b>' + T2('Avoid today', 'تجنب اليوم') + ':</b> ' + data.avoid.join(', ') + '</div>';
    // ─── v30 (user): "make workouts made for the user to recover" — the
    // reading now comes with a CONCRETE do-this-now recovery session,
    // tailored to the soreness / sore area / energy / sleep / injury
    // inputs the user just entered (generated by
    // VoltaLocalAI.recoveryWorkoutLocal). ───
    if (data.workout && data.workout.blocks && data.workout.blocks.length) {
      // v43: the header shows the ACCURATE net-burn estimate (per-block METs,
    // resting baseline subtracted) so the number is visible BEFORE logging.
    var _wkcal = 0;
    try { _wkcal = recoveryWorkoutKcal(data.workout, (u() && u().profile && u().profile.weight) || 70); } catch (e) {}
    html += '<div class="vai-answers-head"><i class="fa-solid fa-person-walking"></i> ' + T2('YOUR RECOVERY WORKOUT', 'تمرين الاستشفاء الخاص بك') + ' · ' + data.workout.totalMin + ' ' + T2('MIN', 'دقيقة') +
      (_wkcal > 0 ? ' · ≈' + _wkcal + ' ' + T2('KCAL', 'سعرة') : '') + '</div>' +
        '<div class="vai-recov-session">' +
          '<div class="vai-recov-session-title">' + (data.workout.title || '') + '</div>' +
          data.workout.blocks.map(function (b, i) {
            return '<div class="vai-recov-move" style="animation-delay:' + (i * 0.05) + 's;">' +
              '<span class="vai-recov-move-min">' + b.mins + '<small>' + T2('min', 'د') + '</small></span>' +
              '<div class="vai-recov-move-txt"><b>' + b.name + '</b><span>' + (b.how || '') + '</span></div>' +
            '</div>';
          }).join('') +
          (data.workout.note ? '<div class="vai-recov-session-note"><i class="fa-solid fa-circle-info"></i> ' + data.workout.note + '</div>' : '') +
          '<button class="vp-cta vp-cta-blue vai-recov-log-btn" id="vai-recov-log-btn" onclick="VoltaAI.logRecoverySession()"><i class="fa-solid fa-check-to-slot"></i> ' + T2('Log this recovery session', 'سجّل جلسة الاستشفاء') + '</button>' +
        '</div>';
    }
    // ─── concrete recovery actions (multiple, condition-specific) ───
    if (data.actions && data.actions.length) {
      html += '<div class="vai-answers-head"><i class="fa-solid fa-list-check"></i> ' + T2('RECOVERY ACTIONS', 'خطوات الاستشفاء') + '</div>' +
        '<div class="vai-actions">' + data.actions.map(function (x) {
          return '<div class="vai-action"><i class="fa-solid fa-circle-check" style="color:var(--green)"></i><span>' + x + '</span></div>';
        }).join('') + '</div>';
    }
    if (data.injuryNote) html += '<div class="vai-safety high"><i class="fa-solid fa-band-aid"></i><span>' + data.injuryNote + '</span></div>';
    if (data.tip) html += '<div class="vai-note"><i class="fa-solid fa-lightbulb" style="color:var(--amber)"></i> ' + data.tip + '</div>';
    return html;
  }

  async function getRecovery() {
    const body = document.getElementById('vai-recov-body');
    if (!body) return;
    body.innerHTML = '<div style="padding:18px;color:var(--muted);"><i class="fa-solid fa-spinner fa-spin"></i> ' + T('RecoveryIQ is reading your week…', 'Recovery IQ يقرأ أسبوعك…') + '</div>';
    const weekLogs = collectWeekLogs();
    const inputs = recoveryInputs();
    const injury = userInjury();
    // LOCAL engine — multi-answer, condition-aware, works offline.
    await new Promise(function (res) { setTimeout(res, 450); });
    const local = VoltaLocalAI.recoveryLocal(weekLogs, inputs, { injury: injury, lang: ar() ? 'ar' : 'en' });
    // v30 (user): attach the generated RECOVERY WORKOUT (concrete session).
    try {
      local.workout = VoltaLocalAI.recoveryWorkoutLocal(weekLogs, inputs, { injury: injury, lang: ar() ? 'ar' : 'en' });
      lastRecoveryWorkout = local.workout;
    } catch (e) { lastRecoveryWorkout = null; }
    body.style.textAlign = '';
    body.innerHTML = recoveryHtml(local);
    pushRecoveryHistory(local.overall);
    renderRecoveryTrend();
    // v43: after a fresh generation, restore the correct button state —
    // if today's recovery session was already logged the button shows it.
    try { paintRecoveryLogBtn(recoveryLoggedToday(u())); } catch (e) {}
  }

  // v30 (user): "make workouts made for the user to recover" — one tap logs
  // the generated recovery session as a REAL 'Stretching' session with the
  // workout's own duration, so it lands in the rings, the streaks history
  // and the weekly charts like any other session.
  // v43 (user):
  //   "make recovery iq let you recover 1 session per day, and i shouldnt be
  //    able to log the same session more than once" → HARD 1/day limit, plus
  //    the session is tagged isRecovery so the guard is bullet-proof.
  //   "recovery session burns atleast 80 calorie which doesnt make sense, use
  //    more accurate formulas" → the old math charged the WHOLE session at
  //    MET 2.3 (≈2.8 kcal/min at 70 kg — 80+ kcal for any 30-min block).
  //    The new engine scores EVERY BLOCK with its own MET and subtracts the
  //    resting baseline (net energy expenditure):
  //      easy walk 3.0 · mobility/stretching 2.3 · breathing 1.5 ·
  //      injury-safe activation 2.5 (ACSM: kcal/min = MET × 3.5 × kg / 200).
  //    Result: a gentle 20-min session ≈ 35 kcal, a full 45-min session ≈
  //    85 kcal — real-world numbers instead of a flat floor.
  var lastRecoveryWorkout = null;
  function recoveryBlockMet(b) {
    const n = String((b && b.name) || '').toLowerCase();
    if (n.indexOf('walk') !== -1 || n.indexOf('مشي') !== -1) return 3.0;
    if (n.indexOf('breathing') !== -1 || n.indexOf('تنفس') !== -1) return 1.5;
    if (n.indexOf('safe') !== -1 || n.indexOf('آمن') !== -1) return 2.5;
    return 2.3; // mobility / stretching moves
  }
  function recoveryWorkoutKcal(w, weight) {
    try {
      if (!w || !w.blocks || !w.blocks.length) return 0;
      const perMet = 3.5 * (weight || 70) / 200;   // kcal per minute per MET
      let gross = 0;
      w.blocks.forEach(function (b) { gross += (b.mins || 0) * recoveryBlockMet(b) * perMet; });
      const resting = (w.totalMin || 0) * 1.0 * perMet; // 1 MET baseline (what you'd burn sitting)
      return Math.max(1, Math.round(gross - resting));  // NET energy expenditure
    } catch (e) { return 0; }
  }
  function recoveryLoggedToday(user) {
    try {
      const today = (typeof localDateStr === 'function') ? localDateStr() : new Date().toISOString().slice(0, 10);
      return (user.sessions || []).some(function (s) {
        return s.date === today && (s.isRecovery === true || s.sport === 'Stretching');
      });
    } catch (e) { return false; }
  }
  function logRecoverySession() {
    const w = lastRecoveryWorkout;
    if (!w || !w.totalMin) {
      toast(T('Generate a recovery reading first.', 'أنشئ قراءة استشفاء أولاً.'));
      return;
    }
    try {
      const user = u();
      if (!user) return;
      if (!user.sessions) user.sessions = [];
      // v43: ONE recovery session per day — the same session can never be
      // logged twice, and a freshly generated one is refused too.
      if (recoveryLoggedToday(user)) {
        toast(T('One recovery session per day — you already logged yours today. See you tomorrow!',
                'جلسة استشفاء واحدة في اليوم — لقد سجّلت جلسة اليوم بالفعل. إلى الغد!'), 'info');
        try { if (window.VoltaSounds) VoltaSounds.play('pop'); } catch (e) {}
        paintRecoveryLogBtn(true);
        return;
      }
      let weight = 70;
      try { if (user.profile && user.profile.weight) weight = user.profile.weight; } catch (e) {}
      const cals = recoveryWorkoutKcal(w, weight);
      user.sessions.push({
        sport: 'Stretching',
        date: (typeof localDateStr === 'function') ? localDateStr() : new Date().toISOString().slice(0, 10),
        duration: w.totalMin,
        calories: cals,
        intensity: 'Light',
        note: w.title || 'Recovery session',
        isRecovery: true
      });
      try { if (typeof saveUser === 'function') saveUser((typeof store !== 'undefined' && store.session) || '', user); } catch (e) {}
      try { renderHome(); renderTracker(); } catch (e) {}
      try { if (window.VoltaFeatures && VoltaFeatures.renderStreaksTab) VoltaFeatures.renderStreaksTab(); } catch (e) {}
      try { checkDailyGoalReached(); } catch (e) {}
      try { if (window.VoltaSounds) VoltaSounds.play('success'); } catch (e) {}
      toast(T('Recovery session logged — ' + w.totalMin + ' min · ≈' + cals + ' kcal', 'تم تسجيل جلسة الاستشفاء — ' + w.totalMin + ' د · ≈' + cals + ' سعرة'), 'success');
      paintRecoveryLogBtn(true);
    } catch (e) {
      toast(T('Could not log the session.', 'تعذر تسجيل الجلسة.'));
    }
  }

  // v43: the log button reflects the 1/day rule — when today's recovery is
  // already in the log the button turns green, says "Logged today" and the
  // click handler short-circuits (VoltaAI.logRecoverySession also re-checks).
  function paintRecoveryLogBtn(logged) {
    try {
      const btn = document.getElementById('vai-recov-log-btn');
      if (!btn) return;
      if (logged) {
        btn.classList.add('vai-recov-logged');
        btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> ' + T('Logged today — one session per day', 'تم تسجيل اليوم — جلسة واحدة يومياً');
        btn.setAttribute('onclick', '');
        btn.style.opacity = '.85';
      } else {
        btn.classList.remove('vai-recov-logged');
        btn.innerHTML = '<i class="fa-solid fa-check-to-slot"></i> ' + T('Log this recovery session', 'سجّل جلسة الاستشفاء');
        btn.setAttribute('onclick', 'VoltaAI.logRecoverySession()');
        btn.style.opacity = '';
      }
    } catch (e) {}
  }

  // ═══════════════════════ lifecycle ═════════════════════════════════════
  // Stop the shared camera when the workout-detail popup closes.
  document.addEventListener('click', function (e) {
    const overlay = e.target && e.target.closest ? e.target.closest('.modal-overlay') : null;
    if (overlay && !overlay.classList.contains('active')) {
      const id = overlay.id || '';
      if (id === 'vai-form-modal' || id === 'vai-rep-modal' || id === 'workout-detail-modal') {
        if (ActiveEngine) { try { ActiveEngine.stop(); } catch (e2) {} ActiveEngine = null; }
        // v9: release the camera session (lingering close — no re-prompt
        // when the next exercise/feature starts within the window).
        closeCamera();
      }
    }
  }, true);

  return {
    openFormSense: openFormSense,
    checkMyForm: checkMyForm,
    openRepSense: openRepSense,
    repToggle: repToggle,
    repAdjust: repAdjust,
    repFinish: repFinish,
    openWeeklyReport: openWeeklyReport,
    generateReport: generateReport,
    closeAiModal: closeIt,
    openProgressIQ: openProgressIQ,
    getProgression: getProgression,
    openRecoveryIQ: openRecoveryIQ,
    getRecovery: getRecovery,
    logRecoverySession: logRecoverySession,
    renderRecoveryScreen: renderRecoveryScreen,
    ensureRecoveryScreen: ensureRecoveryScreen,
    // shared-camera engine for the workout-detail popup (volta.js)
    AssistEngine: AssistEngine,
    claimEngine: claimEngine,
    saveRepSession: saveRepSession,
    verdictHtml: verdictHtml,
    getActiveEngine: function () { return ActiveEngine; },
    // v9: camera session manager (one prompt per session) + in-workout gate
    closeCamera: closeCamera,
    shutdownCamera: shutdownCamera,
    inWorkout: inWorkout,
    goToTodaysWorkout: goToTodaysWorkout
  };
})();
