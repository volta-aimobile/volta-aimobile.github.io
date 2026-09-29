 













































window.VoltaAI = (function () {

   
  function ar() { return typeof store !== 'undefined' && store.lang === 'ar'; }
  function T(en, arTxt) { return ar() ? arTxt : en; }
  function TA(en, arTxt) { return ' data-ar="' + arTxt + '"'; }  
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

   
   
   
   
  function ensureModal(id) {
    let m = document.getElementById(id);
    if (m) return m;
    m = document.createElement('div');
    m.id = id;
    m.className = 'modal-overlay';
    m.style.zIndex = '10011';
    m.innerHTML =
      '<div class="modal-content vai-modal">' +
         
        '<button class="modal-close" onclick="VoltaAI.closeAiModal(\'' + id + '\')" aria-label="Close"></button>' +
        '<div class="vai-inner" id="' + id + '-body"></div>' +
      '</div>';
    document.body.appendChild(m);
     
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
   
   
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    const ids = ['vai-form-modal', 'vai-rep-modal', 'vai-report-modal', 'vai-prog-modal', 'premium-modal'];
    for (let i = 0; i < ids.length; i++) {
      const m = document.getElementById(ids[i]);
      if (m && m.classList.contains('active')) { closeIt(ids[i]); e.preventDefault(); return; }
    }
  });
   
  function onModalClosed(id) {
    if (id === 'vai-form-modal' || id === 'vai-rep-modal') {
      if (ActiveEngine) {
         
         
        if (id === 'vai-rep-modal') { try { autoSaveRepModalSet(ActiveEngine); } catch (e) {} }
        try { ActiveEngine.stop(); } catch (e) {} ActiveEngine = null;
      }
       
       
      closeCamera();
    }
  }
   
   
  async function autoSaveRepModalSet(eng) {
    try {
      if (!eng || !eng.counter || !(eng.counter.reps > 0)) return;
      const r = eng.finishSet();
      if (!(r.reps > 0)) return;
      await saveRepSession({ type: 'rep', exercise: eng.exercise, reps: r.reps, durationSec: r.durationSec, tempoSec: r.tempoSec || 0 });
      eng.counter.reps = 0; eng.counter.repIntervals = [];
      try { toast(T('Set saved: ' + r.reps + ' reps · ' + r.durationSec + 's', 'تم حفظ المجموعة: ' + r.reps + ' تكرار · ' + r.durationSec + ' ث'), 'success'); } catch (e) {}
    } catch (e) {   }
  }

  function head(icon, titleEn, titleAr, subEn, subAr) {
    return '<div class="vai-head">' +
      '<span class="vp-home-ic"><i class="fa-solid ' + icon + '"></i></span>' +
      '<div><h3' + TA(titleEn, titleAr) + '>' + T(titleEn, titleAr) + '</h3>' +
      '<small' + TA(subEn, subAr) + '>' + T(subEn, subAr) + '</small></div></div>';
  }

   
   
   
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

   
   
   
   
  function cameraEnabledInSettings() {
    try { return localStorage.getItem('fb_cam') !== 'false'; } catch (e) { return true; }
  }
  function markCameraAsked() {
    try { localStorage.setItem('fb_cam_asked', 'true'); } catch (e) {}
  }

   
   
   
   
   
   
   
   
   
   
   
   
   
  const CAM_LINGER_MS = 90000;
  let CamStream = null;         
  let CamAcquiring = null;      
  let CamLingerTimer = null;    
  let CamHeld = 0;              

  function camStreamLive() {
    return !!(CamStream && CamStream.active && CamStream.getTracks().some(function (t) { return t.readyState === 'live'; }));
  }
  async function acquireCamera() {
     
    if (camStreamLive()) { if (CamLingerTimer) { clearTimeout(CamLingerTimer); CamLingerTimer = null; } return CamStream; }
     
     
    if (CamAcquiring) return CamAcquiring;
    CamAcquiring = navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 960 } },
      audio: false
    }).then(function (s) {
      CamStream = s;
      CamAcquiring = null;
      markCameraAsked();        
      return s;
    }).catch(function (err) {
      CamAcquiring = null;
      throw err;
    });
    return CamAcquiring;
  }
  function camHold() { CamHeld++; if (CamLingerTimer) { clearTimeout(CamLingerTimer); CamLingerTimer = null; } }
  function camDrop() { CamHeld = Math.max(0, CamHeld - 1); }
   
   
   
  function closeCamera() {
    if (!camStreamLive()) return;
    if (CamLingerTimer) clearTimeout(CamLingerTimer);
    CamLingerTimer = setTimeout(function () {
      CamLingerTimer = null;
      if (CamHeld > 0) return;                  
      shutdownCamera();
    }, CAM_LINGER_MS);
  }
   
  function shutdownCamera() {
    if (CamLingerTimer) { clearTimeout(CamLingerTimer); CamLingerTimer = null; }
    CamHeld = 0;
    if (CamStream) {
      try { CamStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      CamStream = null;
    }
  }
   
  window.addEventListener('pagehide', shutdownCamera);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') shutdownCamera();
  });

   
   
   
   
   
   
   
  let ActiveEngine = null;

  function AssistEngine(opts) {
    this.exercise = opts.exercise || 'exercise';
    this.videoEl = opts.videoEl || null;
    this.onStatus = opts.onStatus || function () {};    
    this.onReps = opts.onReps || function () {};        
    this.onForm = opts.onForm || function () {};        
     
     
    this.onPose = opts.onPose || null;
    this.formOn = false;
    this.repsOn = false;
    this.stream = null;
    this.loop = null;
    this.autoFormTimer = null;
    this.formBusy = false;
    this.counter = null;
    this.poseReady = false;           
    this.poseFailed = false;          
    this._lastPoseStatus = '';        
    this.startedAt = 0;
    this.lang = opts.lang || (ar() ? 'ar' : 'en');
    this.beepOn = opts.beep !== false;                  
    this.frames = [];                                   
    this._snapCv = null; this._snapCtx = null;
  }
   
   
   
   
  AssistEngine.prototype.bindPoseCounter = function (exerciseName) {
    this.exercise = exerciseName || this.exercise;
    if (!(window.VoltaPoseEngine && VoltaPoseEngine.status() === 'ready')) return false;
    this.counter = new VoltaPoseEngine.PoseRepCounter(this.exercise, this.lang);
    this.poseReady = true;
    this._lastPoseStatus = '';                 
    return true;
  };
  AssistEngine.prototype.start = async function () {
    if (!this.videoEl) return false;
     
     
     
    if (!cameraEnabledInSettings()) { this.onStatus('off'); return false; }
    this.onStatus('starting');
     
     
     
     
    try {
      this.stream = await acquireCamera();
      camHold();
    } catch (err) {
      const name = (err && err.name) || '';
      this.onStatus(name === 'NotAllowedError' ? 'denied' : (name === 'NotFoundError' || name === 'OverconstrainedError') ? 'nocam' : 'error');
      return false;
    }
     
     
     
     
    try {
      this.videoEl.srcObject = this.stream;
    } catch (err) {
      camDrop();
      this.stream = null;
      this.onStatus('error');
      return false;
    }
    try { await this.videoEl.play(); } catch (e) {}
     
     
     
     
     
     
    const self = this;
    this.counter = null;
    if (this.onPose) this.onPose({ status: 'loading' });
    const poseInit = (window.VoltaPoseEngine)
      ? VoltaPoseEngine.ensure()
      : Promise.resolve(false);
    poseInit.then(function (okPose) {
      if (self.__stopped) return;
      const ready = !!(okPose && window.VoltaPoseEngine && VoltaPoseEngine.status() === 'ready');
      if (ready) {
        self.bindPoseCounter(self.exercise);
      } else {
         
         
        self.poseFailed = true;
        self.counter = (window.VoltaLocalAI) ? new VoltaLocalAI.MotionRepCounter() : null;
        if (self.onPose) self.onPose({ status: 'unavailable' });
      }
    }).catch(function () {
      if (self.__stopped) return;
      self.poseFailed = true;
      self.counter = (window.VoltaLocalAI) ? new VoltaLocalAI.MotionRepCounter() : null;
      if (self.onPose) self.onPose({ status: 'unavailable' });
    });
    this.startedAt = Date.now();
     
     
     
     
    this._lastProcessAt = 0; this._lastProcessCost = 0;
    this.loop = setInterval(function () {
      if (!self.counter || !self.videoEl || !self.videoEl.videoWidth) return;
      const nowT = Date.now();
      const gap = (self._lastProcessCost > 350) ? 460 : 125;
      if (nowT - self._lastProcessAt < gap) return;
      self._lastProcessAt = nowT;
      const f0 = performance.now();
      const r = self.counter.process(self.videoEl, nowT);
      self._lastProcessCost = performance.now() - f0;
      if (r.counted) self._onRepCounted();              
       
      const st = r.pose ? r.pose.status : null;
      if (st && st !== self._lastPoseStatus) {
        self._lastPoseStatus = st;
        if (self.onPose) self.onPose({ status: st, label: r.pose.label, labelAr: r.pose.labelAr, why: r.pose.why });
      }
      if (self.repsOn) self.onReps(r);
    }, 60);
     
     
    if (this.formOn) this.checkFormNow();
    this.onStatus('live');
    return true;
  };
   
   
   
  AssistEngine.prototype._onRepCounted = function () {
    if (this.beepOn) { try { if (typeof playDoneBeep === 'function') playDoneBeep(); } catch (e) {} }
    try { if (typeof vibrateDevice === 'function') vibrateDevice([70]); } catch (e) {}
    this._captureFrame(false);
  };
   
   
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
       
       
       
      if (this.stream) this.checkFormNow();
      if (!this.autoFormTimer) this.autoFormTimer = setInterval(function () { self.checkFormNow(); }, 20000);
    } else if (this.autoFormTimer) {
      clearInterval(this.autoFormTimer); this.autoFormTimer = null;
    }
  };
  AssistEngine.prototype.repAdjust = function (delta) {
    if (!this.counter) return;
     
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
     
     
     
     
     
    const isAr = (this.lang === 'ar');
    if (this.poseReady && m.poseStatus === 'no_person') {
      finish({
        ok: true, onDevice: true, poseBlocked: 'no_person', exercise: this.exercise,
        exerciseType: m.poseLabel || '', verdict: 'okay', score: 50,
        measured: { reps: 0, durationSec: m.durationSec || 0 },
        results: [{ icon: 'fa-user-slash', verdict: 'warn',
          title: isAr ? 'لم يُكتشف شخص في الإطار' : 'No person detected in frame',
          text: isAr ? ('افتح الكاميرا على جسمك كاملاً ثم نفّذ بعض تكرارات ' + this.exercise + ' — فحص الأداء يعمل فقط على الوضعية الصحيحة للتمرين.')
                     : ('Step back so your FULL body is in frame, then perform a few reps of ' + this.exercise + '. The form check only analyses the correct pose for the exercise.') }],
        issues: [], cues: [], safety: isAr ? 'أوقف المجموعة فوراً إذا شعرت بألم حاد أو دوار أو تنميل.' : 'Stop the set immediately if you feel sharp pain, dizziness or numbness.', safetyLevel: 'medium'
      });
      return;
    }
    if (this.poseReady && m.poseStatus === 'wrong') {
      const lbl = isAr ? (m.poseLabelAr || m.poseLabel || '') : (m.poseLabel || '');
      finish({
        ok: true, onDevice: true, poseBlocked: 'wrong', exercise: this.exercise,
        exerciseType: m.poseLabel || '', verdict: 'okay', score: 50,
        measured: { reps: 0, durationSec: m.durationSec || 0 },
        results: [{ icon: 'fa-person-circle-xmark', verdict: 'warn',
          title: isAr ? ('هذه ليست وضعية ' + lbl) : ('That is not the ' + lbl + ' pose'),
          text: isAr ? ('فحص الأداء مقفل على تمرين ' + lbl + ' فقط — ضبط التمرين أعلاه أو انتقل إلى التمرين الصحيح ليبدأ التحليل.')
                     : ('The form check is LOCKED to ' + lbl + ' — set the right exercise above (or move to it) and the analysis starts automatically.') }],
        issues: [], cues: [], safety: isAr ? 'أوقف المجموعة فوراً إذا شعرت بألم حاد أو دوار أو تنميل.' : 'Stop the set immediately if you feel sharp pain, dizziness or numbness.', safetyLevel: 'medium'
      });
      return;
    }
     
     
    const local = VoltaLocalAI.formCheckLocal(this.exercise, m, { lang: this.lang, durationSec: m.durationSec });
     
     
    if (this.poseReady && m.poseStatus === 'ok') {
      local.poseVerified = true;
      local.poseLabel = m.poseLabel;
      if (Array.isArray(m.poseFindings) && m.poseFindings.length) {
        local.results = m.poseFindings.concat(local.results || []);
      }
    } else if (this.poseFailed) {
      local.poseFallback = true;    
    }
     
     
    if (deep) {
      if (!this.frames.length) this._captureFrame(true);    
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
        } catch (e) {   }
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
    this.__stopped = true;    
    if (this.loop) { clearInterval(this.loop); this.loop = null; }
    if (this.autoFormTimer) { clearInterval(this.autoFormTimer); this.autoFormTimer = null; }
     
     
     
     
    if (this.stream) { camDrop(); this.stream = null; }
    try { if (this.videoEl) this.videoEl.srcObject = null; } catch (e) {}
    this.formOn = false; this.repsOn = false;
    this.frames = [];
    if (ActiveEngine === this) ActiveEngine = null;
    this.onStatus('stopped');
  };
   


  function claimEngine(engine) {
    if (ActiveEngine && ActiveEngine !== engine) { try { ActiveEngine.stop(); } catch (e) {} }
    ActiveEngine = engine;
  }

   
   
   
   
   
   
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
    if (parts.length < 2) return null;    
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

   
   
   
   
   
  const PROGRESS_DB_KEY = 'volta_progress_db';
  function progressDbRead() {
    try { return JSON.parse(localStorage.getItem(PROGRESS_DB_KEY) || '{}'); } catch (e) { return {}; }
  }
  function progressDbWrite(db) {
    try { localStorage.setItem(PROGRESS_DB_KEY, JSON.stringify(db)); } catch (e) {}
  }
   
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
       
      db[exercise] = db[exercise].slice(0, 60);
      progressDbWrite(db);
    } catch (e) {}
  }
   
  function progressDbFor(exercise) {
    try {
      exercise = String(exercise || '').trim();
      if (!exercise) return [];
      const db = progressDbRead();
      const rows = (db[exercise] || []).filter(function (r) {
        return !email() || !r.email || r.email === email();
      });
       
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

   
  async function saveRepSession(payload) {
     
     
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

   
   
   
   
   
   
  function poseChipT(en, arTxt) { return (ar() ? arTxt : en); }
  function poseChipHtml(id) {
    return '<span class="vai-pose-chip" id="' + id + '" style="display:none;"></span>';
  }
  function updatePoseChip(id, pose) {
    const el = document.getElementById(id);
    if (!el) return;
    const p = pose || {};
    el.style.display = 'inline-flex';
    el.classList.remove('ok', 'wrong', 'warn', 'loading');
    if (p.status === 'ok') {
      el.classList.add('ok');
      el.innerHTML = '<i class="fa-solid fa-person"></i> ' + poseChipT('✓ ' + (p.label || 'correct pose'), '✓ ' + (p.labelAr || p.label || 'الوضعية صحيحة'));
    } else if (p.status === 'wrong') {
      el.classList.add('wrong');
      const lbl = ar() ? (p.labelAr || p.label || '') : (p.label || '');
      el.innerHTML = '<i class="fa-solid fa-person-circle-xmark"></i> ' + poseChipT('✗ not ' + lbl, '✗ ليست ' + lbl);
    } else if (p.status === 'no_person') {
      el.classList.add('warn');
      el.innerHTML = '<i class="fa-solid fa-user-slash"></i> ' + poseChipT('no person in frame', 'لا يوجد شخص في الإطار');
    } else if (p.status === 'loading') {
      el.classList.add('loading');
      el.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ' + poseChipT('pose engine loading…', 'جارٍ تحميل محرك الوضعيات…');
    } else if (p.status === 'unavailable') {
       
       
       
      el.style.display = 'none';
    }
  }

   
  function openFormSense(exercise) {
    if (typeof VoltaPremium === 'undefined' || !VoltaPremium.gate('form-check')) return;
     
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
        poseChipHtml('vai-form-posechip') +
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
      },
      onPose: function (p) { updatePoseChip('vai-form-posechip', p); }
    });
    claimEngine(eng);
    eng.setForm(true);
    eng.start();
  }

   
   
   
  async function checkMyForm() {
    if (!ActiveEngine) return;
    const btn = document.getElementById('vai-form-check-btn');
    const deep = !!(navigator.onLine && (typeof window.VOLTA_GEMINI_KEY === 'string' && window.VOLTA_GEMINI_KEY));
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ' + T(deep ? 'AI is analyzing your movement…' : 'AI is reading your movement…', 'الذكاء الاصطناعي يحلل حركتك…'); }
    try {
      const exEl = document.getElementById('vai-form-exercise');
      if (exEl && exEl.value && exEl.value !== ActiveEngine.exercise) {
         
         
        ActiveEngine.exercise = exEl.value;
        ActiveEngine.bindPoseCounter(exEl.value);
      }
      await ActiveEngine.checkFormNow(deep);
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> ' + T('Check My Form', 'دقّق أدائي'); }
    }
  }

   
   
   
  function cameraHelpHtml(exercise) {
    let info = null;
    try { if (typeof getWorkoutInfo === 'function') info = getWorkoutInfo(exercise || '', ''); } catch (e) {}
     
     
     
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
            (d.poseVerified ? '<span class="vai-ai-tag" style="background:rgba(48,209,88,.16);color:#30d158;"><i class="fa-solid fa-person"></i> ' + T('POSE VERIFIED', 'تم التحقق من الوضعية') + '</span>' : '') +
            (d.ai && d.ai.checked ? '<span class="vai-ai-tag"><i class="fa-solid fa-wand-magic-sparkles"></i> ' + T('GEMINI VISION CHECK', 'فحص رؤية جيميني') + '</span>' : '') +
            '<small>' + (d.exercise || '') + (d.exerciseType ? ' · ' + d.exerciseType : '') + '</small></div>' +
        '</div>';
     
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

   
  function openRepSense(exercise) {
    if (typeof VoltaPremium === 'undefined' || !VoltaPremium.gate('rep-count')) return;
     
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
        poseChipHtml('vai-rep-posechip') +
      '</div>' +
      '<label style="font-size:.78rem;color:var(--muted);">' + T('Exercise', 'التمرين') + '</label>' +
      '<input type="text" id="vai-rep-exercise" value="' + String(exercise || '').replace(/"/g, '&quot;') + '" placeholder="' + T('e.g. Push-ups', 'مثال: تمارين ضغط') + '" style="margin:6px 0 12px;" />' +
      '<div class="vai-rep-hud">' +
         
         
         
        '<div class="vai-rep-num"><b id="vai-rep-count">0</b></div>' +
      '</div>' +
      '<div class="vai-feedback" id="vai-rep-feedback"></div>' +
      '<div class="vp-btn-row">' +
        '<button class="btn ghost" id="vai-rep-toggle" onclick="VoltaAI.repToggle()"><i class="fa-solid fa-pause"></i> <span>' + T('Pause', 'إيقاف مؤقت') + '</span></button>' +
      '</div>';
     
     
     
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
           
           
          if (r.counted) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
        }
        const ph = document.getElementById('vai-rep-phase');
        if (ph) ph.textContent = '';  
        const fb = document.getElementById('vai-rep-feedback');
         
         
        if (r.poseLoading) {
          if (fb) fb.innerHTML = '<b><i class="fa-solid fa-spinner fa-spin"></i></b> ' + T('Pose engine loading — counting starts when it is ready…', 'جارٍ تحميل محرك الوضعيات — يبدأ العد عند جهوزيته…');
        } else if (r.feedback === 'no_person') {
          if (fb) fb.innerHTML = '<b><i class="fa-solid fa-user-slash"></i></b> ' + T('No person detected — step back so your full body is in frame.', 'لم يتم اكتشاف شخص — ابتعد قليلاً ليظهر جسمك كاملاً.');
        } else if (r.feedback === 'wrong') {
          const lbl = ar() ? ((r.pose && r.pose.labelAr) || r.pose.label || '') : ((r.pose && r.pose.label) || '');
          if (fb) fb.innerHTML = '<b><i class="fa-solid fa-person-circle-xmark"></i></b> ' + T('That is not ' + lbl + ' — the counter ONLY counts ' + lbl + ' reps.', 'هذه ليست ' + lbl + ' — العدّاد يعد تكرارات ' + lbl + ' فقط.');
        } else if (r.feedback === 'no_movement') {
          if (fb) fb.innerHTML = '<b><i class="fa-solid fa-robot"></i></b> ' + T('No movement detected — step back so your full body is in frame.', 'لا يوجد حركة — ابتعد قليلاً ليظهر جسمك كاملاً.');
        } else if (r.counted && r.tempoSec) {
          if (fb) fb.innerHTML = '<b><i class="fa-solid fa-robot"></i></b> ' + T('Auto-counted — steady rhythm, ' + r.tempoSec + 's per rep. Keep going!', 'عدّ تلقائي — إيقاع ثابت، ' + r.tempoSec + ' ث لكل تكرار. استمر!');
        }
      },
      onPose: function (p) { updatePoseChip('vai-rep-posechip', p); }
    });
    claimEngine(eng);
    eng.setReps(true);
    eng.start();
  }

  function repToggle() {
     
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
    eng._lastProcessAt = 0; eng._lastProcessCost = 0;
    eng.loop = setInterval(function () {
      if (!eng.counter || !eng.videoEl || !eng.videoEl.videoWidth) return;
      const nowT = Date.now();
      const gap = (eng._lastProcessCost > 350) ? 460 : 125;
      if (nowT - eng._lastProcessAt < gap) return;
      eng._lastProcessAt = nowT;
      const f0 = performance.now();
      const r = eng.counter.process(eng.videoEl, nowT);
      eng._lastProcessCost = performance.now() - f0;
      if (r.counted) eng._onRepCounted();    
       
      const st2 = r.pose ? r.pose.status : null;
      if (st2 && st2 !== eng._lastPoseStatus) {
        eng._lastPoseStatus = st2;
        if (eng.onPose) eng.onPose({ status: st2, label: r.pose.label, labelAr: r.pose.labelAr, why: r.pose.why });
      }
      if (eng.repsOn && eng.onReps) eng.onReps(r);
    }, 60);
  }

  function repAdjust(delta) {
    if (ActiveEngine) ActiveEngine.repAdjust(delta);
  }

  async function repFinish() {
    if (!ActiveEngine) return;
    const exEl = document.getElementById('vai-rep-exercise');
    const renamed = exEl && exEl.value && exEl.value !== ActiveEngine.exercise ? exEl.value : null;
    if (renamed) ActiveEngine.exercise = renamed;
    const r = ActiveEngine.finishSet();
    if (r.reps <= 0) { toast(T('No reps counted yet — step into frame and start moving, the AI counts for you.', 'لا يوجد عد بعد — ادخل في الإطار وابدأ الحركة، الذكاء الاصطناعي يعدّ تلقائياً.'), 'info'); return; }
    await saveRepSession({ type: 'rep', exercise: ActiveEngine.exercise, reps: r.reps, durationSec: r.durationSec, tempoSec: r.tempoSec || 0 });
    toast(T('Set saved: ' + r.reps + ' reps · ' + r.durationSec + 's' + (r.tempoSec ? ' · ~' + r.tempoSec + 's/rep' : ''),
            'تم حفظ المجموعة: ' + r.reps + ' تكرار · ' + r.durationSec + ' ث' + (r.tempoSec ? ' · ~' + r.tempoSec + ' ث/تكرار' : '')), 'success');
    if (ActiveEngine && ActiveEngine.counter) { ActiveEngine.counter.reps = 0; ActiveEngine.counter.repIntervals = []; }
     
     
    if (renamed) ActiveEngine.bindPoseCounter(renamed);
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

   
   
   
  function openProgressIQ(exerciseName) {
    if (typeof VoltaPremium !== 'undefined' && !VoltaPremium.gate('progression')) return;
    let ex = exerciseName || '';
    try { if (!ex && typeof deState !== 'undefined' && deState.workouts && deState.workouts[deState.currentWorkout]) ex = deState.workouts[deState.currentWorkout].name; } catch (e) {}
     
     
     
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
     
     
     
     
    const dbLogs = progressDbFor(exercise);
    const lastLogs = dbLogs.map(function (d) { return { date: d.date, sets: d.sets, reps: d.bestSet || d.reps, weight: d.weight }; });
    const w = wNum('vai-prog-weight'), r = wNum('vai-prog-reps'), s = wNum('vai-prog-sets');
    if (w || r || s) {
      progressDbAdd(exercise, { reps: r || 8, sets: s || 3, weight: w || 0, source: 'manual-progressiq' });
      lastLogs.unshift({ date: new Date().toISOString().slice(0, 10), sets: s || 3, reps: r || 8, weight: w || 0 });
    }
    const user = u();
    const bodyWeight = (user && user.profile && user.profile.weight) || null;
     
    await new Promise(function (res) { setTimeout(res, 350); });
    const local = VoltaLocalAI.progressionLocal(exercise, lastLogs, bodyWeight);
    body.style.textAlign = '';
    body.innerHTML = progressionHtml(local);
     
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

   
   
   
  function recoveryScreenHtml() {
    return head('fa-battery-three-quarters', 'RecoveryIQ', 'Recovery IQ',  
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

   
   
  function renderRecoveryLocked() {
    const holder = document.getElementById('recovery-screen-container');
    if (!holder) return;
    holder.innerHTML =
      '<div class="vai-recov-locked">' +
        '<i class="fa-solid fa-lock"></i>' +
        '<h3>' + T('RecoveryIQ is a Premium feature', 'Recovery IQ ميزة Premium') + '</h3>' +
        '<p>' + T('Advanced AI recovery readings, per-muscle readiness, ready-in times and your 7-check trend — unlock everything with Volta Premium.', 'قراءات استشفاء متقدمة بالذكاء الاصطناعي، جاهزية كل عضلة، أوقات الجاهزية واتجاه آخر ٧ فحوصات — افتح كل شيء مع Volta Premium.') + '</p>' +
        '<button class="vp-cta" onclick="VoltaPremium.openHub(\'recovery\')"><i class="fa-solid fa-bolt"></i> ' + T('Unlock with Premium', 'افتح مع Premium') + '</button>' +
      '</div>';
  }

  function renderRecoveryScreen() {
    const holder = document.getElementById('recovery-screen-container');
    if (!holder) return;
    holder.innerHTML = recoveryScreenHtml();
    try { holder.dataset.lang = (typeof store !== 'undefined' && store.lang) || 'en'; } catch (e) {}
    try { renderRecoveryTrend(); } catch (e) {}
  }

   
   
  function ensureRecoveryScreen() {
    const holder = document.getElementById('recovery-screen-container');
    if (!holder) return;
     
     
    const premium = (typeof VoltaPremium === 'undefined') || VoltaPremium.isPremium();
    if (!premium) {
       
      if (!holder.querySelector('.vai-recov-locked')) renderRecoveryLocked();
      return;
    }
    const bodyEl = document.getElementById('vai-recov-body');
    const onScreen = bodyEl && holder.contains(bodyEl);
     
     
    const langNow = (typeof store !== 'undefined' && store.lang) || 'en';
    const langRendered = holder.dataset.lang || null;
    if (onScreen && langRendered && langRendered !== langNow && !holder.querySelector('.vai-answer')) {
      renderRecoveryScreen();
      return;
    }
     
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
     
    if (data.answers && data.answers.length) {
      html += '<div class="vai-answers-head"><i class="fa-solid fa-comments"></i> ' + T2('YOUR ANSWERS', 'إجاباتك') + '</div>' +
        data.answers.map(function (a) {
          return '<div class="vai-answer"><span class="vai-answer-ic"><i class="fa-solid ' + (a.icon || 'fa-circle-question') + '"></i></span>' +
            '<div><b>' + (a.title || '') + '</b><span>' + (a.text || '') + '</span></div></div>';
        }).join('');
    }
    if (data.todayFocus) html += '<div class="vai-note" style="margin-bottom:8px;"><i class="fa-solid fa-bullseye"></i> <b>' + T2('Today', 'اليوم') + ':</b> ' + data.todayFocus + '</div>';
    if (data.avoid && data.avoid.length) html += '<div class="vai-note" style="margin-bottom:8px;"><i class="fa-solid fa-ban" style="color:var(--red)"></i> <b>' + T2('Avoid today', 'تجنب اليوم') + ':</b> ' + data.avoid.join(', ') + '</div>';
     
     
     
     
     
    if (data.workout && data.workout.blocks && data.workout.blocks.length) {
       
     
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
     
    await new Promise(function (res) { setTimeout(res, 450); });
    const local = VoltaLocalAI.recoveryLocal(weekLogs, inputs, { injury: injury, lang: ar() ? 'ar' : 'en' });
     
    try {
      local.workout = VoltaLocalAI.recoveryWorkoutLocal(weekLogs, inputs, { injury: injury, lang: ar() ? 'ar' : 'en' });
      lastRecoveryWorkout = local.workout;
    } catch (e) { lastRecoveryWorkout = null; }
    body.style.textAlign = '';
    body.innerHTML = recoveryHtml(local);
    pushRecoveryHistory(local.overall);
    renderRecoveryTrend();
     
     
    try { paintRecoveryLogBtn(recoveryLoggedToday(u())); } catch (e) {}
  }

   
   
   
   
   
   
   
   
   
   
   
   
   
   
   
   
   
  var lastRecoveryWorkout = null;
  function recoveryBlockMet(b) {
    const n = String((b && b.name) || '').toLowerCase();
    if (n.indexOf('walk') !== -1 || n.indexOf('مشي') !== -1) return 3.0;
    if (n.indexOf('breathing') !== -1 || n.indexOf('تنفس') !== -1) return 1.5;
    if (n.indexOf('safe') !== -1 || n.indexOf('آمن') !== -1) return 2.5;
    return 2.3;  
  }
  function recoveryWorkoutKcal(w, weight) {
    try {
      if (!w || !w.blocks || !w.blocks.length) return 0;
      const perMet = 3.5 * (weight || 70) / 200;    
      let gross = 0;
      w.blocks.forEach(function (b) { gross += (b.mins || 0) * recoveryBlockMet(b) * perMet; });
      const resting = (w.totalMin || 0) * 1.0 * perMet;  
      return Math.max(1, Math.round(gross - resting));   
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

   
   
  document.addEventListener('click', function (e) {
    const overlay = e.target && e.target.closest ? e.target.closest('.modal-overlay') : null;
    if (overlay && !overlay.classList.contains('active')) {
      const id = overlay.id || '';
      if (id === 'vai-form-modal' || id === 'vai-rep-modal' || id === 'workout-detail-modal') {
        if (ActiveEngine) { try { ActiveEngine.stop(); } catch (e2) {} ActiveEngine = null; }
         
         
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
     
    AssistEngine: AssistEngine,
    claimEngine: claimEngine,
     
    poseChipHtml: poseChipHtml,
    updatePoseChip: updatePoseChip,
    saveRepSession: saveRepSession,
    verdictHtml: verdictHtml,
    getActiveEngine: function () { return ActiveEngine; },
     
    closeCamera: closeCamera,
    shutdownCamera: shutdownCamera,
    inWorkout: inWorkout,
    goToTodaysWorkout: goToTodaysWorkout
  };
})();
