 













































window.VoltaFoodModel = (function () {
  'use strict';

   
   
   
   
  var BASE = (function () {
    try { return new URL('.', document.baseURI || location.href).href; }
    catch (e) { return './'; }
  })();

  var RUNTIME_DIR = 'vendor/transformers/';
  var RUNTIME_JS = RUNTIME_DIR + 'transformers.min.js';
  var CDN_RUNTIME = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
  var MODEL_ID = 'onnx-community/swin-finetuned-food101-ONNX';
  var MODEL_DIR = 'vendor/models/' + MODEL_ID + '/';
  var MODEL_FILE = 'onnx/model_quantized.onnx';

  var state = {
    probed: false, available: false,
    loading: null, lib: null, pipe: null, device: null, dtype: null,
    threshold: 0.12
  };

   
   
   
   
   
  async function fetchOk(url, method) {
    try {
      var r = await fetch(url, { method: method || 'HEAD' });
      if (r.ok) return true;
    } catch (e) {   }
    try {
      var r2 = await fetch(url, { cache: 'force-cache' });
      if (r2.ok && r2.body && r2.body.cancel) { try { r2.body.cancel(); } catch (e3) {} }
      return r2.ok;
    } catch (e2) { return false; }
  }
  function online() {
    return !(typeof navigator !== 'undefined' && navigator.onLine === false);
  }
  function normalizeLabel(s) {
    return String(s || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\u0600-\u06ff ]+/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  function deplural(w) {
    if (w.length > 4 && w.slice(-3) === 'ies') return w.slice(0, -3) + 'y';
    if (w.length > 3 && w.slice(-1) === 's' && w.slice(-2) !== 'ss') return w.slice(0, -1);
    return w;
  }

   
  async function probe() {
    if (state.probed) return state.available;
    state.probed = true;
    try {
      var hasRuntime = await fetchOk(BASE + RUNTIME_JS);
      var hasModel = await fetchOk(BASE + MODEL_DIR + MODEL_FILE);
      if (hasRuntime && hasModel) { state.available = true; return true; }
      if (online()) { state.available = true; return true; }
    } catch (e) { }
    state.available = false;
    return false;
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

   
   
   
   
   
   
   
   
   
  var _webgpuOk = null;
  async function webgpuReady() {
    if (_webgpuOk !== null) return _webgpuOk;
    try {
      if (typeof navigator === 'undefined' || !navigator.gpu || !navigator.gpu.requestAdapter) return (_webgpuOk = false);
      var ad = await navigator.gpu.requestAdapter();
      return (_webgpuOk = !!ad);
    } catch (e) { return (_webgpuOk = false); }
  }

  async function load() {
    if (state.pipe) return true;
    if (state.loading) return state.loading;
    if (!(await probe())) return false;
    state.loading = (async function () {
      var lib = await runtime();
      var env = lib.env;
       
      env.allowLocalModels = true;
      env.localModelPath = BASE + 'vendor/models/';
      env.allowRemoteModels = true;
      try {
        if (env.backends && env.backends.onnx && env.backends.onnx.wasm) {
           
          env.backends.onnx.wasm.wasmPaths = BASE + RUNTIME_DIR;
        }
      } catch (e) {}

       
       
      var attempts = [];
      if (await webgpuReady()) attempts.push({ device: 'webgpu', dtype: 'q8', local: true });
      attempts.push({ device: 'wasm', dtype: 'q8', local: true });
      attempts.push({ device: 'wasm', dtype: 'q8', local: false });
      attempts.push({ device: 'wasm', dtype: 'q4', local: false });

      var lastErr = null;
      for (var i = 0; i < attempts.length; i++) {
        var a = attempts[i];
        try {
          env.allowLocalModels = a.local !== false;
          state.pipe = await lib.pipeline('image-classification', MODEL_ID, {
            device: a.device,
            dtype: a.dtype,
            progress_callback: function (p) {
              if (p && p.status === 'progress' && p.total) {
                try { console.info('[FoodModel] ' + p.file + ' ' + Math.round(100 * p.loaded / p.total) + '%'); } catch (e) {}
              }
            }
          });
          state.device = a.device; state.dtype = a.dtype;
          try { console.log('[FoodModel] Swin-Food101 ready · device=' + a.device + ' · dtype=' + a.dtype); } catch (e) {}
          return true;
        } catch (e) { lastErr = e; try { console.warn('[FoodModel] attempt failed (' + a.device + '/' + a.dtype + '):', e && e.message); } catch (e2) {} }
      }
      throw lastErr || new Error('all model load attempts failed');
    })();
    try { return await state.loading; }
    catch (e) {
      console.warn('[FoodModel] load failed — engine path stays active:', e && e.message);
      state.available = false;
      state.loading = null;
      return false;
    }
  }

   
  function toDataUrl(srcLike) {
    return new Promise(function (resolve, reject) {
      if (typeof srcLike === 'string') return resolve(srcLike);
      var el = srcLike;
      if (el && el.tagName === 'IMG') {
        if (el.src && /^data:|^https?:/.test(el.src)) {
          if (el.complete && el.naturalWidth) return resolve(el.src);
          el.onload = function () { resolve(el.src); };
          el.onerror = function () { reject(new Error('image decode failed')); };
          return;
        }
      }
      try {
        var c = document.createElement('canvas');
        var w = (el && (el.naturalWidth || el.width)) || 0, h = (el && (el.naturalHeight || el.height)) || 0;
        if (el && el.tagName === 'CANVAS' && el.width) { resolve(el.toDataURL('image/jpeg', 0.94)); return; }
        if (!w || !h) return reject(new Error('empty image'));
        var maxSide = Math.max(w, h);
        var scale = Math.min(1, 1024 / maxSide);
        var nw = Math.round(w * scale), nh = Math.round(h * scale);
        c.width = nw; c.height = nh;
        var ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, nw, nh);
        ctx.drawImage(el, 0, 0, nw, nh);
        resolve(c.toDataURL('image/jpeg', 0.94));
      } catch (e) { reject(e); }
    });
  }

  function toSquareDataUrl(srcLike) {
    return new Promise(function (resolve, reject) {
      if (typeof srcLike === 'string') return resolve(srcLike);
      var el = srcLike;
      if (el && el.tagName === 'IMG') {
        if (el.src && /^data:|^https?:/.test(el.src)) {
          if (el.complete && el.naturalWidth) return resolve(el.src);
          el.onload = function () { resolve(el.src); };
          el.onerror = function () { reject(new Error('image decode failed')); };
          return;
        }
      }
      try {
        var c = document.createElement('canvas');
        var w = (el && (el.naturalWidth || el.width)) || 0, h = (el && (el.naturalHeight || el.height)) || 0;
        if (el && el.tagName === 'CANVAS' && el.width) { resolve(el.toDataURL('image/jpeg', 0.94)); return; }
        if (!w || !h) return reject(new Error('empty image'));
        var side = Math.min(w, h), sx = (w - side) / 2, sy = (h - side) / 2;
        c.width = Math.min(1024, side); c.height = Math.min(1024, side);
        var ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(el, sx, sy, side, side, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.94));
      } catch (e) { reject(e); }
    });
  }

   
  async function classify(srcLike) {
    if (!(await load()) || !state.pipe) return [];
    var input = await toDataUrl(srcLike);
    var out = await state.pipe(input, { topk: 10 });
    if (!out) return [];
    if (!Array.isArray(out)) out = [out];
    return out.map(function (o) {
      return { label: String((o && o.label) || ''), prob: Number((o && o.score) || 0) };
    }).filter(function (o) { return o.label; });
  }

  async function classifyMultiPass(srcLike) {
    if (!(await load()) || !state.pipe) return [];
    var passes = [];
    try { passes.push(await toDataUrl(srcLike)); } catch (e) {}
    try { passes.push(await toSquareDataUrl(srcLike)); } catch (e) {}
    if (!passes.length) return [];
    var merged = {};
    var mergedList = [];
    for (var i = 0; i < passes.length; i++) {
      try {
        var out = await state.pipe(passes[i], { topk: 10 });
        if (!out) continue;
        if (!Array.isArray(out)) out = [out];
        for (var j = 0; j < out.length; j++) {
          var lbl = String((out[j] && out[j].label) || '');
          var prob = Number((out[j] && out[j].score) || 0);
          if (!lbl) continue;
          if (!merged[lbl]) { merged[lbl] = { label: lbl, prob: 0, count: 0, maxProb: 0 }; mergedList.push(merged[lbl]); }
          merged[lbl].prob += prob;
          merged[lbl].count += 1;
          if (prob > merged[lbl].maxProb) merged[lbl].maxProb = prob;
        }
      } catch (e) {}
    }
    mergedList.forEach(function (e) {
      e.prob = (e.maxProb * 0.6) + ((e.prob / e.count) * 0.4);
    });
    mergedList.sort(function (a, b) { return b.prob - a.prob; });
    return mergedList.slice(0, 10);
  }

   
  var CUISINE_HINTS = {
    pizza: 'Italian', pasta: 'Italian', lasagna: 'Italian', risotto: 'Italian', gelato: 'Italian',
    sushi: 'Japanese', ramen: 'Japanese', teriyaki: 'Japanese', tempura: 'Japanese', miso: 'Japanese',
    taco: 'Mexican', burrito: 'Mexican', quesadilla: 'Mexican', nachos: 'Mexican',
    curry: 'Indian', biryani: 'Indian', tandoori: 'Indian', naan: 'Indian', samosa: 'Indian', dal: 'Indian',
    falafel: 'Egyptian', hummus: 'Levantine', shawarma: 'Levantine', tabbouleh: 'Levantine', kofta: 'Egyptian',
    koshari: 'Egyptian', koshary: 'Egyptian', ful: 'Egyptian', taameya: 'Egyptian', molokhia: 'Egyptian',
    mahshi: 'Egyptian', feteer: 'Egyptian', hawawshi: 'Egyptian', foul: 'Egyptian',
    tagine: 'Moroccan', tajine: 'Moroccan', couscous: 'Moroccan', bastilla: 'Moroccan',
    paella: 'Spanish', tapas: 'Spanish', gazpacho: 'Spanish',
    burger: 'American', hotdog: 'American', barbecue: 'American', pancake: 'American',
    pho: 'Vietnamese', spring: 'Vietnamese', banh: 'Vietnamese',
    kimchi: 'Korean', bibimbap: 'Korean',
    dumpling: 'Chinese', fried: 'Chinese', noodle: 'Chinese', chow: 'Chinese'
  };
  var ALIASES = {
    hamburger: 'burger', cheeseburger: 'burger', burgers: 'burger',
    'hot dog': 'hotdog', 'hot dogs': 'hotdog',
    omelette: 'omelet', omelet: 'omelet', omelettes: 'omelet', scrambled: 'eggs', egg: 'eggs',
    porridge: 'oatmeal', oatmeal: 'oatmeal', congee: 'porridge',
    fries: 'fries', 'french fries': 'fries', chips: 'fries',
    spaghetti: 'pasta', macaroni: 'pasta', carbonara: 'pasta', penne: 'pasta', linguine: 'pasta',
    'ice cream': 'ice cream', sundae: 'ice cream',
    doughnut: 'donut', doughnuts: 'donut', donuts: 'donut',
    biscuit: 'cookie', biscuits: 'cookie', cookies: 'cookie',
    sausages: 'sausage', bacon: 'bacon',
    prawns: 'shrimp', shrimps: 'shrimp',
    aubergine: 'eggplant', courgette: 'zucchini', coriander: 'cilantro',
    capsicum: 'bell pepper', 'bell peppers': 'bell pepper',
    'spring rolls': 'spring roll', 'spring roll': 'spring roll',
    gyros: 'shawarma', doner: 'shawarma', kebabs: 'kebab',
    koshary: 'koshari', fava: 'ful', 'fava beans': 'ful', 'foul mudammas': 'ful',
    'grilled cheese': 'grilled cheese', baguettes: 'baguette', croissants: 'croissant',
    smoothies: 'smoothie', milkshakes: 'milkshake', 'milk shake': 'milkshake',
    waffle: 'waffles', pancakes: 'pancakes', pretzels: 'pretzel',
     
    'pizza pie': 'pizza', 'pizza pizza pie': 'pizza',
    'french loaf': 'baguette', 'bagel bagel': 'bagel', 'guacamole guacamole': 'guacamole',
     
    'baby back ribs': 'ribs', 'bread pudding': 'pudding', 'breakfast burrito': 'burrito',
    'beet salad': 'salad', 'caesar salad': 'salad', 'caprese salad': 'salad',
    'greek salad': 'salad', 'seaweed salad': 'salad', 'cheese plate': 'cheese',
    'chicken quesadilla': 'quesadilla', 'chicken wings': 'chicken wings',
    'chocolate cake': 'cake', 'carrot cake': 'cake', 'red velvet cake': 'cake',
    'strawberry shortcake': 'cake', 'cheesecake': 'cheesecake',
    'clam chowder': 'soup', 'lobster bisque': 'soup', 'french onion soup': 'soup',
    'miso soup': 'miso', 'hot and sour soup': 'soup',
    'club sandwich': 'sandwich', 'grilled cheese sandwich': 'grilled cheese',
    'lobster roll sandwich': 'sandwich', 'pulled pork sandwich': 'pork',
    'crab cakes': 'crab', 'croque madame': 'sandwich', 'cup cakes': 'cupcake',
    'deviled eggs': 'eggs', 'eggs benedict': 'eggs', 'huevos rancheros': 'eggs',
    'filet mignon': 'steak', 'prime rib': 'steak', 'pork chop': 'pork',
    'peking duck': 'duck', 'fish and chips': 'fish', 'fried calamari': 'calamari',
    'fried rice': 'fried rice', 'frozen yogurt': 'yogurt', 'garlic bread': 'bread',
    'gnocchi': 'pasta', 'ravioli': 'pasta', 'macaroni and cheese': 'mac and cheese',
    'spaghetti bolognese': 'pasta bolognese', 'spaghetti carbonara': 'pasta carbonara',
    'macarons': 'cookie', 'chocolate mousse': 'mousse', 'creme brulee': 'creme brulee',
    'shrimp and grits': 'shrimp', 'tuna tartare': 'tuna', 'beef carpaccio': 'beef',
    'beef tartare': 'beef', 'dumplings': 'dumpling', 'gyoza': 'dumpling',
    'beignets': 'beignet', 'bruschetta': 'bruschetta', 'cannoli': 'cannoli',
    'ceviche': 'ceviche', 'churros': 'churros', 'couscous': 'couscous',
    'edamame': 'edamame', 'escargots': 'escargot', 'foie gras': 'foie gras',
    'french toast': 'french toast', 'lasagna': 'lasagna', 'mussels': 'mussels',
    'nachos': 'nachos', 'omelette': 'omelet', 'onion rings': 'onion rings',
    'pad thai': 'pad thai', 'pancakes': 'pancakes', 'panna cotta': 'panna cotta',
    'pho': 'pho', 'poutine': 'poutine', 'ramen': 'ramen', 'risotto': 'risotto',
    'samosa': 'samosa', 'sashimi': 'sashimi', 'scallops': 'scallops',
    'takoyaki': 'takoyaki', 'tiramisu': 'tiramisu', 'waffles': 'waffles'
  };

  function tokenize(s) {
    return normalizeLabel(s).split(' ').filter(Boolean).map(deplural);
  }

   




   
   
   
  var GENERIC_LABELS = {
    plate: 1, dish: 1, bowl: 1, tray: 1, plateware: 1, food: 1, meal: 1,
    lunch: 1, dinner: 1, breakfast: 1, dining: 1, table: 1, 'soup bowl': 1,
    'mixing bowl': 1, 'dining table': 1, 'plate rack': 1,
    'tray table': 1, 'chopstick': 1, 'spatula': 1, 'ladle': 1, 'strainer': 1,
    'wok': 1, 'frypan': 1, 'caldron': 1, 'coffeepot': 1, 'teapot': 1
  };

  function mapLabelToMeal(label, allMeals, opts) {
    opts = opts || {};
    var lab = normalizeLabel(label);
    if (!lab) return { meal: null, score: 0, candidates: [] };
    if (GENERIC_LABELS[lab]) return { meal: null, score: 0, candidates: [] };
     
     
     
    var toks0 = lab.split(' ');
    var aliasHit = ALIASES[lab] || null;
    if (!aliasHit) {
      for (var t0 = 0; t0 < toks0.length && !aliasHit; t0++) {
        aliasHit = ALIASES[toks0[t0]] || null;
      }
      for (var b0 = 0; b0 < toks0.length - 1 && !aliasHit; b0++) {
        var bi = toks0[b0] + ' ' + toks0[b0 + 1];
        aliasHit = ALIASES[bi] || null;
      }
    }
    var hintCuisine = null;
    for (var k in CUISINE_HINTS) { if (lab.indexOf(k) !== -1) { hintCuisine = CUISINE_HINTS[k]; break; } }
    if (!hintCuisine && aliasHit) { for (var k2 in CUISINE_HINTS) { if (aliasHit.indexOf(k2) !== -1) { hintCuisine = CUISINE_HINTS[k2]; break; } } }
    var labTokens = tokenize(aliasHit ? aliasHit + ' ' + label : label);

    var best = null, bestScore = 0, scored = [];
    for (var i = 0; i < allMeals.length; i++) {
      var m = allMeals[i];
      if (!m || !m.name) continue;
      var nameN = normalizeLabel(m.name);
      var hay = nameN + ' ' + normalizeLabel((m.ingredients || []).join(' ')) + ' ' +
                normalizeLabel((m.tags || []).join(' ')) + ' ' + normalizeLabel(m.desc || '');
      var score = 0;
      if (hintCuisine && (m.cuisine === hintCuisine || (m.tags || []).indexOf(hintCuisine) !== -1)) score += 6;
      if (aliasHit && (nameN.indexOf(normalizeLabel(aliasHit)) !== -1)) score += 40;
      if (nameN === lab) score += 100;
      if (nameN.indexOf(lab) !== -1) score += 24;                     
      if (lab.indexOf(nameN) !== -1 && nameN.length >= 4) score += 14;  
      var nameTokens = tokenize(m.name);
      var hayTokens = tokenize(hay);
      for (var t = 0; t < labTokens.length; t++) {
        var w = labTokens[t]; if (w.length < 3) continue;
         
         
        var wt = Math.min(w.length, 8);
        if (nameTokens.indexOf(w) !== -1) score += wt;              
        else if (hayTokens.indexOf(w) !== -1) score += 3;           
      }
      if (score > 0) scored.push({ meal: m, score: score });
      if (score > bestScore) { bestScore = score; best = m; }
    }
    scored.sort(function (a, b) { return b.score - a.score; });
    var candidates = scored.slice(0, 8);
    var minScore = (typeof opts.minScore === 'number') ? opts.minScore : 10;
    if (best && bestScore >= minScore) return { meal: best, score: bestScore, candidates: candidates };
    return { meal: null, score: bestScore, candidates: candidates };
  }

   
  async function scanPhoto(dataUrl, opts) {
    opts = opts || {};
    if (!(await load()) || !state.pipe) return null;
    var tops = await classifyMultiPass(dataUrl);
    if (!tops.length) return null;
    var allMeals = (window.VoltaMealEngine && window.VoltaMealEngine.allMeals) ? window.VoltaMealEngine.allMeals() : [];
    if (!allMeals.length) return null;
    var toApp = (window.VoltaMealEngine && window.VoltaMealEngine.toAppMeal) ? window.VoltaMealEngine.toAppMeal : function (x) { return x; };
    var best = null;
    for (var i = 0; i < tops.length; i++) {
      var mp = mapLabelToMeal(tops[i].label, allMeals, { minScore: 5 });
      if (!mp.meal) continue;
      var w = mp.score >= 30 ? 2.6 : (mp.score >= 14 ? 1.7 : (mp.score >= 6 ? 1.2 : 1.05));
      var total = tops[i].prob * w + 0.001 * (8 - i);
      if (!best || total > best.total) {
        best = { total: total, score: mp.score, meal: mp.meal, label: tops[i].label,
                 prob: tops[i].prob, rank: i, candidates: mp.candidates };
      }
    }
    if (!best || best.score < 5) return null;
    var minProb = Math.max(0.04, Math.min(state.threshold, 0.20));
    if (best.prob < minProb) return null;
    var app = toApp(best.meal);
    var data = {
      name: app.name, nameEn: app.nameEn, nameAr: app.nameAr,
      description: app.desc, descAr: app.descAr,
      calories: app.kcal, protein: app.p, carbs: app.c, fat: app.f,
      ingredients: app.ingredients || [],
      cuisine: app.cuisine, mealType: app.mealType, tags: app.tags,
      gemini: true, engine: true, modelMatch: true,
      modelLabel: best.label, modelConfidence: best.prob,
      __source: 'on-device model'
    };
    return {
      data: data,
      label: best.label,
      confidence: best.prob,
      rank: best.rank,
      top: tops,
      candidates: best.candidates.map(function (c) { return toApp(c.meal); })
    };
  }

  return {
    available: function () { return probe().then(function () { return state.available; }); },
    ready: load,
    status: function () {
      return { probed: state.probed, available: state.available, backend: 'transformers.js',
               model: MODEL_ID, device: state.device, dtype: state.dtype };
    },
    classify: classify,
    classifyMultiPass: classifyMultiPass,
    resolveMeal: mapLabelToMeal,
    scanPhoto: scanPhoto,
    _internals: { normalizeLabel: normalizeLabel, tokenize: tokenize, ALIASES: ALIASES, CUISINE_HINTS: CUISINE_HINTS }
  };
})();
