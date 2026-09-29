 









































window.VoltaLocalLLM = (function () {
  'use strict';

   
  var BASE = (function () {
    try { return new URL('.', document.baseURI || location.href).href; }
    catch (e) { return './'; }
  })();
  var RUNTIME_JS = 'vendor/transformers/transformers.min.js';
  var CDN_RUNTIME = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

  var LS_ENABLED = 'volta_local_llm_on';         
  var LS_MODEL = 'volta_local_llm_model_v62';    
  var LS_PREFER = 'volta_local_llm_prefer';      

  var MODELS = [
    { id: 'onnx-community/SmolLM2-135M-Instruct-ONNX', short: 'SmolLM2 135M',
      label: 'SmolLM2 135M · included with the app · English · offline',
      bundled: true, arabic: false },
    { id: 'onnx-community/SmolLM2-360M-Instruct-ONNX', short: 'SmolLM2 360M',
      label: 'SmolLM2 360M · download ~290 MB · English · smarter',
      bundled: false, arabic: false },
    { id: 'onnx-community/Qwen2.5-0.5B-Instruct', short: 'Qwen 2.5 0.5B',
      label: 'Qwen 2.5 0.5B · download ~500 MB · English + Arabic',
      bundled: false, arabic: true }
  ];
  function modelMeta(id) {
    for (var i = 0; i < MODELS.length; i++) if (MODELS[i].id === id) return MODELS[i];
    return MODELS[0];
  }
  function defaultModel() { return MODELS[0].id; }

   
  var state = {
    phase: 'idle',         
    progress: 0,           
    loadedBytes: 0, totalBytes: 0,
    model: null, device: null, dtype: null,
    error: null,
    lib: null, generator: null,
    loadPromise: null,
    busy: false            
  };

   
  function ar() {
    try { return typeof store !== 'undefined' && store.lang === 'ar'; } catch (e) { return false; }
  }
  function T(en, arTxt) { return ar() ? arTxt : en; }
  function online() { return !(typeof navigator !== 'undefined' && navigator.onLine === false); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function modelId() {
    var v = lsGet(LS_MODEL);
    for (var i = 0; i < MODELS.length; i++) if (MODELS[i].id === v) return v;
    return defaultModel();
  }
  function modelShort(id) { return modelMeta(id || modelId()).short; }
  function isBundled(id) { return !!modelMeta(id || modelId()).bundled; }
  function webgpuLikely() {
    try { return !!(navigator.gpu); } catch (e) { return false; }
  }
   
   
   
   
   
  var _webgpuOk = null;
  async function webgpuReady() {
    if (_webgpuOk !== null) return _webgpuOk;
    try {
      if (!webgpuLikely()) return (_webgpuOk = false);
      var ad = await navigator.gpu.requestAdapter();
      return (_webgpuOk = !!ad);
    } catch (e) { return (_webgpuOk = false); }
  }
   
   
  function webgpuOkCached() { return _webgpuOk; }
   
   
  function isArabicText(q) {
    return /[\u0600-\u06FF\u0750-\u077F]/.test(String(q || ''));
  }

   
  async function runtime() {
    if (state.lib) return state.lib;
    try { state.lib = await import(BASE + RUNTIME_JS); return state.lib; }
    catch (eLocal) {
      if (!online()) throw new Error('offline and no vendored transformers runtime');
      state.lib = await import(CDN_RUNTIME);
      return state.lib;
    }
  }

   
  function noteProgress(p) {
     
     
    if (!p) return;
    if (p.status === 'progress' && p.total) {
      state.loadedBytes = p.loaded || 0; state.totalBytes = p.total;
      if (state.totalBytes > 0) state.progress = Math.max(state.progress, Math.min(1, p.loaded / p.total));
      if (/\.onnx($|\?)/.test(p.file || '')) state.phase = 'downloading';
    } else if ((p.status === 'initiate' || p.status === 'download') &&
               (state.phase === 'idle' || state.phase === 'ready')) {
      state.phase = 'downloading';
    }
    refreshChip();
    try { renderPanelState(); } catch (e) {}
  }

  function ensure(opts) {
    opts = opts || {};
    if (state.generator) return Promise.resolve(true);
    if (state.loadPromise) return state.loadPromise;
    state.phase = 'downloading'; state.progress = 0; state.error = null;
    refreshChip();
    state.loadPromise = (async function () {
      try {
        var lib = await runtime();
        var env = lib.env;
        var id = modelId();
        var bundled = isBundled(id);
        try {
          env.allowLocalModels = true;
          env.localModelPath = BASE + 'vendor/models/';
           
           
          env.allowRemoteModels = true;
          if (env.backends && env.backends.onnx && env.backends.onnx.wasm) {
            env.backends.onnx.wasm.wasmPaths = BASE + 'vendor/transformers/';
          }
        } catch (e) {}

         
         
         
         
         
         
         
        var attempts = [];
        if (!opts.forceWasm && (await webgpuReady())) attempts.push({ device: 'webgpu', dtype: 'q8' });
        attempts.push({ device: 'wasm', dtype: 'q8' });

        var lastErr = null;
        for (var i = 0; i < attempts.length; i++) {
          var a = attempts[i];
          try {
            if (state.phase !== 'downloading') { state.phase = 'loading'; refreshChip(); }
            state.generator = await lib.pipeline('text-generation', id, {
              device: a.device,
              dtype: a.dtype,
              progress_callback: noteProgress
            });
            state.model = id; state.device = a.device; state.dtype = a.dtype;
            state.phase = 'ready'; state.progress = 1;
            try { console.log('[LocalLLM] ' + id + ' ready · device=' + a.device + ' · dtype=' + a.dtype); } catch (e) {}
            refreshChip(); renderPanelState();
            return true;
          } catch (e) {
            lastErr = e;
            try { console.warn('[LocalLLM] attempt failed (' + a.device + '/' + a.dtype + '):', e && e.message); } catch (e2) {}
          }
        }
        throw lastErr || new Error('all load attempts failed');
      } catch (e) {
        state.phase = 'failed';
        state.error = (e && (e.message || e.name)) || 'load error';
        state.loadPromise = null;
        try { console.warn('[LocalLLM] model load failed:', state.error); } catch (e2) {}
        refreshChip(); renderPanelState();
        return false;
      }
    })();
    return state.loadPromise;
  }

   


  function warm() {
    try {
      if (!enabled() || state.generator || state.loadPromise) return;
      ensure();
    } catch (e) {}
  }

  try {
    if (typeof window !== 'undefined') {
      window.addEventListener('load', function () {
        setTimeout(function () {
          try {
            if (enabled() && !state.generator && !state.loadPromise) {
              ensure();
            }
          } catch (e) {}
        }, 300);
      });
    }
  } catch (e) {}

   
   
   
   
  function messagesFor(q) {
    var msgs = [];
    try {
      msgs = (window.VoltaCloudAI && window.VoltaCloudAI.messagesFor)
        ? window.VoltaCloudAI.messagesFor(q)
        : [{ role: 'user', content: q }];
    } catch (e) { msgs = [{ role: 'user', content: q }]; }
    var sys = '';
    for (var i = 0; i < msgs.length; i++) {
      if (msgs[i] && msgs[i].role === 'system') { sys = String(msgs[i].content || ''); break; }
    }
     
    var data = '';
    var m = /ATHLETE DATA[^:\n]*:\n?([\s\S]*)$/.exec(sys);
    if (m) data = m[1].trim();
    if (data.length > 700) data = data.slice(0, 700) + '…';
    var compact = [
      'You are VOLTA Coach AI — the coach inside the VOLTA fitness app.',
      'Answer in English. Be concise: 2-4 short sentences or a short list.',
      'Give practical, actionable coaching advice — exact steps, cues and drills the athlete can do right now. Never mention videos, links, images or channels.',
      'SAFETY: prioritize injury prevention. Never tell the athlete to train through pain. For pain or injuries, suggest stopping, safer alternative exercises, and seeing a professional. You are not a doctor.',
      data ? '\nATHLETE DATA (live from the app):\n' + data : ''
    ].join('\n');
    var rest = [];
    for (var j = 0; j < msgs.length; j++) {
      if (msgs[j] && msgs[j].role !== 'system') rest.push(msgs[j]);
    }
     
    var hist = rest.slice(-5);
    var out = [{ role: 'system', content: compact }];
    for (var k = 0; k < hist.length; k++) out.push(hist[k]);
    if (!out.length || out[out.length - 1].role !== 'user') out.push({ role: 'user', content: String(q || '') });
    return out;
  }

   
   







  async function generate(messages, opts) {
    opts = opts || {};
    if (!state.generator) {
      var ok = await ensure();
      if (!ok || !state.generator) throw new Error(state.error || 'model not ready');
    }
    if (state.busy) throw new Error('the on-device model is still answering');
    state.busy = true;
    refreshChip();

    var lib = state.lib;
    var streamed = '';
    var streamer = null;
    try {
      streamer = new lib.TextStreamer(state.generator.tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: function (tok) {
          streamed += tok;
          if (typeof opts.onToken === 'function') {
            try { opts.onToken(tok); } catch (e) {}
          }
        }
      });
    } catch (e) { streamer = null; }

    try {
      var out = await state.generator(messages, {
        max_new_tokens: opts.maxNewTokens || 220,
        do_sample: true,
        temperature: 0.4,
        top_p: 0.9,
        repetition_penalty: 1.15,
        streamer: streamer || undefined
      });
       
       
      var gen = out && out[0] && out[0].generated_text;
      var text = '';
      if (Array.isArray(gen)) {
        var last = gen[gen.length - 1];
        text = (last && last.content) || '';
      } else if (typeof gen === 'string') {
        text = gen;
      }
       
       
      var reply = (streamed && streamed.trim()) ? streamed : text;
      return String(reply || '').trim();
    } finally {
      state.busy = false;
      refreshChip();
    }
  }

   
   
   
  function enabled() {
    var v = lsGet(LS_ENABLED);
    return v === null ? true : v === '1';
  }
  function setEnabled(v) {
    lsSet(LS_ENABLED, v ? '1' : '0');
    refreshChip(); renderPanelState();
  }
  function preferLocal() { return lsGet(LS_PREFER) !== '0'; }   
  function setPreferLocal(v) { lsSet(LS_PREFER, v ? '1' : '0'); }
  function setModel(id) {
    for (var i = 0; i < MODELS.length; i++) {
      if (MODELS[i].id === id) { lsSet(LS_MODEL, id); return; }
    }
  }
  function ready() { return state.phase === 'ready' && !!state.generator; }
  function canAnswer() { return enabled() && ready(); }
   
   
  function canTake(q) {
    return canAnswer() && (modelMeta().arabic || !isArabicText(q));
  }
   
   
   
   
  function couldTake(q) {
    return enabled() && (modelMeta().arabic || !isArabicText(q));
  }
  function supportsArabic() { return !!modelMeta().arabic; }

   
  function chipLabelFor() {
    if (state.phase === 'downloading') {
      var pct = Math.round(state.progress * 100);
      return T('loading ' + pct + '%', 'تحميل ' + pct + '%');
    }
    if (state.phase === 'loading') return T('loading model…', 'تحميل النموذج…');
    if (state.phase === 'ready') return T('On-Device AI', 'ذكاء على الجهاز');
    if (state.phase === 'failed') return T('on-device AI error', 'خطأ النموذج المحلي');
    return T('On-Device AI', 'ذكاء على الجهاز');
  }

  function refreshChip() {
    var chip = document.getElementById('vcoach-llm-status');
    if (!chip) return;
    var on = enabled() ? '1' : '0';
    if (state.phase === 'downloading' || state.phase === 'loading') on = 'busy';
    chip.setAttribute('data-on', on);
    var lbl = chip.querySelector('.vcoach-status-label');
    if (lbl) lbl.textContent = chipLabelFor();
    var dot = chip.querySelector('.vcoach-status-dot');
    if (dot) {
      dot.style.background = (state.phase === 'failed') ? '#ff7d7d'
        : ((state.phase === 'downloading' || state.phase === 'loading') ? '#ffd166' : '#7dd87d');
      dot.style.boxShadow = '0 0 6px rgba(125,216,125,.8)';
    }
  }

   


  function ensureLocalChip() { return; }

   
   

  function renderPanelState() {
    var st = document.getElementById('vllm-state');
    if (!st) return;
    var setBtn = function (id, on) { var b = document.getElementById(id); if (b) b.style.display = on ? '' : 'none'; };
    var bundled = isBundled();

    if (state.phase === 'downloading' || state.phase === 'loading') {
      st.textContent = T(state.phase === 'downloading' ? 'loading…' : 'preparing…',
                         state.phase === 'downloading' ? 'جارٍ التحميل…' : 'جارٍ التحضير…');
      setBtn('vllm-download', false); setBtn('vllm-disable', false); setBtn('vllm-cpu-dl', false);
    } else if (state.phase === 'ready') {
      st.textContent = modelShort() + ' · ' + (state.device || 'webgpu') + ' · ' + T('ready', 'جاهز');
      setBtn('vllm-download', false); setBtn('vllm-disable', true); setBtn('vllm-cpu-dl', false);
    } else if (state.phase === 'failed') {
       
       
      var noGpu = bundled && (webgpuOkCached() === false || /webgpu/i.test(state.error || ''));
      st.textContent = noGpu
        ? T('needs WebGPU — use the CPU build below', 'يحتاج WebGPU — استخدم نسخة المعالج أدناه')
        : T('error — try again', 'خطأ — حاول مجددًا');
      setBtn('vllm-download', !noGpu);
      setBtn('vllm-cpu-dl', noGpu && online());
      setBtn('vllm-disable', false);
    } else {
      st.textContent = enabled()
        ? T(bundled ? 'enabled — bundled, no download' : 'enabled — not downloaded yet',
            bundled ? 'مفعّل — مضمّن مع التطبيق، دون تنزيل' : 'مفعّل — لم يُنزَّل بعد')
        : T('off', 'موقف');
      setBtn('vllm-download', true);
      setBtn('vllm-cpu-dl', false);
      setBtn('vllm-disable', false);
    }

    var dl = document.getElementById('vllm-download');
    if (dl) {
      dl.textContent = bundled ? T('Load & enable', 'تحميل وتفعيل') : T('Download & enable', 'تنزيل وتفعيل');
    }

    var prog = document.getElementById('vllm-progress');
    if (prog) {
      var show = (state.phase === 'downloading');
      prog.style.display = show ? '' : 'none';
      if (show) {
        var bar = document.getElementById('vllm-bar');
        if (bar) bar.style.width = Math.round(state.progress * 100) + '%';
        var txt = document.getElementById('vllm-progress-txt');
        if (txt) {
          var mb = function (n) { return (n / 1048576).toFixed(0) + ' MB'; };
          txt.textContent = (state.totalBytes ? (mb(state.loadedBytes) + ' / ' + mb(state.totalBytes)) : (Math.round(state.progress * 100) + '%'));
        }
      }
    }
    var pref = document.getElementById('vllm-prefer');
    if (pref) pref.checked = preferLocal();
    var note = document.getElementById('vllm-note');
    if (note) {
      note.textContent = state.phase === 'ready'
        ? T('The bundled model answers fully OFFLINE — zero network, zero API keys. "Prefer on-device AI" makes it answer first; turn it off to try the cloud first.',
           'النموذج المضمّن يجيب دون إنترنت تمامًا — دون شبكة ودون أي مفتاح. خيار «تفضيل الذكاء على الجهاز» يجعله يجيب أولاً؛ أوقفه لتجربة السحابة أولاً.')
        : (bundled
          ? T('A real AI language model (SmolLM2 via transformers.js) is INCLUDED with this app — no download, no API key, and it never leaves your device. It answers English chat; Arabic questions are answered by the built-in bilingual knowledge base. Bigger models (Arabic LLM, smarter English) are optional downloads below.',
             'نموذج ذكاء اصطناعي حقيقي (SmolLM2 عبر transformers.js) مضمّن مع التطبيق — دون تنزيل ودون أي مفتاح ولا يغادر جهازك أبدًا. يجيب على المحادثة الإنجليزية؛ أما الأسئلة العربية فيجيب عنها قاعدة المعرفة ثنائية اللغة المدمجة. النماذج الأكبر (ذكاء عربي أو إنجليزي أقوى) تنزيلات اختيارية أدناه.')
          : T('This model downloads once from HuggingFace, is cached by this browser, and after that the chatbot works fully offline with no API key.',
             'يُنزَّل هذا النموذج مرة واحدة من HuggingFace ويخزّنه المتصفح، وبعد ذلك يعمل المدرب دون إنترنت تمامًا ودون أي مفتاح.'));
    }
  }

   

  function wirePanel() {
    var sel = document.getElementById('vllm-model');
    if (sel && !sel.__vllmWired) {
      sel.__vllmWired = true;
      sel.innerHTML = MODELS.map(function (m) {
        return '<option value="' + m.id + '">' + m.label + '</option>';
      }).join('');
      sel.value = modelId();
      sel.addEventListener('change', function () {
        setModel(sel.value);
         
        if (state.generator) {
          try { if (state.generator.dispose) state.generator.dispose(); } catch (e) {}
          state.generator = null; state.phase = 'idle'; state.progress = 0; state.loadPromise = null;
          refreshChip(); renderPanelState();
        }
      });
    }
    var dl = document.getElementById('vllm-download');
    if (dl && !dl.__vllmWired) {
      dl.__vllmWired = true;
      dl.addEventListener('click', function () {
         
        setEnabled(true);
        dl.disabled = true;
        ensure().then(function (ok) {
          dl.disabled = false;
          if (ok) {
            try { if (typeof showVoltaToast === 'function') showVoltaToast(T('On-device AI ready — the chatbot now works offline.', 'الذكاء على الجهاز جاهز — يعمل المدرب الآن دون إنترنت.'), 'success'); } catch (e) {}
          } else {
            try { if (typeof showVoltaToast === 'function') showVoltaToast(T('Could not load the model — see the AI panel for options.', 'تعذر تحميل النموذج — راجع خيارات لوحة الذكاء.'), 'error'); } catch (e) {}
          }
        });
      });
    }
     
    var cpu = document.getElementById('vllm-cpu-dl');
    if (cpu && !cpu.__vllmWired) {
      cpu.__vllmWired = true;
      cpu.addEventListener('click', function () {
        if (!online()) {
          try { if (typeof showVoltaToast === 'function') showVoltaToast(T('Go online once to download the CPU build (~136 MB).', 'اتصل بالإنترنت مرة واحدة لتنزيل نسخة المعالج (~136 ميجابايت).'), 'error'); } catch (e) {}
          return;
        }
        setEnabled(true);
        cpu.disabled = true;
        ensure({ forceWasm: true }).then(function (ok) {
          cpu.disabled = false;
          if (ok) {
            try { if (typeof showVoltaToast === 'function') showVoltaToast(T('CPU build ready — the on-device AI now works on this browser.', 'نسخة المعالج جاهزة — يعمل الذكاء على الجهاز الآن في هذا المتصفح.'), 'success'); } catch (e) {}
          } else {
            try { if (typeof showVoltaToast === 'function') showVoltaToast(T('Download failed — check the connection and try again.', 'فشل التنزيل — تحقق من الاتصال وحاول مجددًا.'), 'error'); } catch (e) {}
          }
        });
      });
    }
    var dis = document.getElementById('vllm-disable');
    if (dis && !dis.__vllmWired) {
      dis.__vllmWired = true;
      dis.addEventListener('click', function () {
        setEnabled(false);
        renderPanelState();
      });
    }
    var pref = document.getElementById('vllm-prefer');
    if (pref && !pref.__vllmWired) {
      pref.__vllmWired = true;
      pref.addEventListener('change', function () { setPreferLocal(!!pref.checked); });
    }
    renderPanelState();
  }

   
  function domReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }
  domReady(function () {
     
     
     
    setTimeout(function () { try { warm(); } catch (e) {} }, 1500);
  });

   
  return {
    ensure: ensure,
    warm: warm,
    generate: generate,
    messagesFor: messagesFor,
    wirePanel: wirePanel,
    ready: function () { return ready(); },
    canAnswer: function () { return canAnswer(); },
    canTake: function (q) { return canTake(q); },
    couldTake: function (q) { return couldTake(q); },
    supportsArabic: function () { return supportsArabic(); },
    isArabicText: function (q) { return isArabicText(q); },
    webgpuOkCached: function () { return webgpuOkCached(); },
    enabled: function () { return enabled(); },
    setEnabled: function (v) { setEnabled(!!v); },
    preferLocal: function () { return preferLocal(); },
    setPreferLocal: function (v) { setPreferLocal(!!v); },
    setModel: setModel,
    modelId: function () { return modelId(); },
    models: function () { return MODELS.slice(); },
    status: function () {
      return {
        phase: state.phase, enabled: enabled(), preferLocal: preferLocal(),
        model: state.model || modelId(), device: state.device, dtype: state.dtype,
        progress: state.progress, busy: state.busy, error: state.error
      };
    },
    boot: ensureLocalChip
  };
})();
