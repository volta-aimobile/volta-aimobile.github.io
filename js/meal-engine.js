 





























window.VoltaMealEngine = (function () {
  'use strict';

   
   
   
   
  var DB = (window.VOLTA_COUNTRY_MEALS) || {};
  (function mergeV60() {
    var v60 = window.VOLTA_COUNTRY_MEALS_V60;
    if (!v60) return;
    for (var c in v60) {
      if (Object.prototype.hasOwnProperty.call(v60, c)) {
        DB[c] = (DB[c] || []).concat(v60[c] || []);
      }
    }
  })();
  (function mergeSnacksV64() {
    var s = window.VOLTA_COUNTRY_SNACKS_V64;
    if (!s) return;
    for (var c2 in s) {
      if (Object.prototype.hasOwnProperty.call(s, c2)) {
        DB[c2] = (DB[c2] || []).concat(s[c2] || []);
      }
    }
  })();
  var ALIAS = window.VOLTA_COUNTRY_ALIAS || {};
  var FALLBACK_POOL = 'International';

   
  function hashStr(s) {
    s = String(s || '');
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

   
  var _isoNames = null;
  function isoToName(code) {
    try {
      if (!_isoNames) _isoNames = new Intl.DisplayNames(['en'], { type: 'region' });
      return _isoNames.of(String(code).toUpperCase()) || '';
    } catch (e) { return ''; }
  }
  function cuisineForCountry(country) {
    var c = String(country || '').trim();
    if (!c) return FALLBACK_POOL;
    if (c.indexOf('ISO:') === 0) {
      var nm = isoToName(c.slice(4));
      if (nm) c = nm; else return FALLBACK_POOL;
    }
    var low = c.toLowerCase();
     
    for (var pool in ALIAS) {
      var list = ALIAS[pool] || [];
      for (var i = 0; i < list.length; i++) {
        if (String(list[i]).toLowerCase() === low) return DB[pool] ? pool : FALLBACK_POOL;
      }
    }
     
    for (var pool2 in ALIAS) {
      var list2 = ALIAS[pool2] || [];
      for (var j = 0; j < list2.length; j++) {
        var al = String(list2[j]).toLowerCase();
        if (al.length >= 4 && (low.indexOf(al) !== -1 || al.indexOf(low) !== -1)) {
          return DB[pool2] ? pool2 : FALLBACK_POOL;
        }
      }
    }
     
    if (DB[c]) return c;
    return FALLBACK_POOL;
  }

  function poolNames() { return Object.keys(DB); }

   
  var GF_ING = /(wheat|barley|bulgur|couscous|semolina|pita|pasta|noodle|bread|tortilla|wrap|breadcrumb|malt|flour|soy sauce|oatmeal|rolled oats|croissant|bagel|pretzel|cous cous|freekeh|lsemen|dough)/i;
  function dietFilter(pref) {
    pref = String(pref || 'None');
    return function (m) {
      if (pref === 'Vegan') return m.diet === 'vegan';
      if (pref === 'Vegetarian') return m.diet === 'vegetarian' || m.diet === 'vegan';
      if (pref === 'Keto') return m.diet === 'keto';
      if (pref === 'Gluten-free') {
        var tags = (m.tags || []).map(function (t) { return String(t).toLowerCase(); });
        if (m.diet === 'gluten-free' || tags.indexOf('gluten-free') !== -1) return true;
        var blob = [m.name, m.desc, (m.ingredients || []).join(' ')].join(' ');
        return !GF_ING.test(blob);
      }
      return true;    
    };
  }

   
  function toAppMeal(m) {
    return {
      name: m.name,
      nameEn: m.name,
      nameAr: m.nameAr || '',
      desc: m.desc || '',
      descEn: m.desc || '',
      descAr: m.descAr || (m.nameAr ? '' : ''),
      baseName: m.name,
      kcal: m.kcal, p: m.p, c: m.c, f: m.f,
      fiber: m.fiber || 0,
      diet: m.diet, mealType: m.mealType,
      cuisine: m.cuisine,
      tags: (m.tags || []).slice(0),
      ingredients: (m.ingredients || []).slice(0),
      ingredientsAr: [],
      recipe: (m.recipe || []).slice(0),
      image: '',
      gemini: true,           
      engine: true            
    };
  }

   
   
   
   
   
  var SLOT_SPLIT = { breakfast: 0.165, lunch: 0.19, dinner: 0.105, snack: 0.04 };
   
  function familyKey(name) {
    return String(name || '')
      .replace(/^(Vegan |Vegetarian )/, '')
      .replace(/ \((Lactose-Free|Gluten-Free)\)/, '')
      .replace(/ — (Keto|High-Protein|Light)$/, '')
      .replace(/ (Bowl|Wrap|Bites)$/, '');
  }
  function pickForType(pool, type, targetKcal, rand, count, usedNames) {
    var cand = pool.filter(function (m) { return m.mealType === type; });
    if (!cand.length) cand = pool.filter(function (m) { return m.mealType === 'snack' || m.mealType === type; });
    if (!cand.length) cand = pool.slice();
     
    var arr = cand.slice();
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
     
     
     
     
     
    var wantLight = (type === 'dinner' || type === 'snack') && typeof window.mealLightness === 'function';
    var scored = arr.map(function (m) {
      var fit = targetKcal ? Math.abs((m.kcal || 0) - targetKcal) / targetKcal : 0;
      var lf = wantLight ? window.mealLightness(m) * 0.35 : 0;
      return { m: m, s: fit + rand() * 0.55 - lf };
    }).sort(function (a, b) { return a.s - b.s; });
    var out = [];
    var usedFam = {};
    out.forEach(function (x) { usedFam[x] = 1; });
    for (var k = 0; k < scored.length && out.length < count; k++) {
      var m = scored[k].m;
      var nm = m.name, fam = familyKey(m.name);
      if (usedNames[nm] || (usedFam[fam] && out.length < count - 0 && (k < scored.length - count))) continue;
      usedNames[nm] = 1; usedFam[fam] = 1;
      out.push(m);
    }
     
    for (var k2 = 0; k2 < scored.length && out.length < count; k2++) {
      var m2 = scored[k2].m;
      if (usedNames[m2.name]) continue;
      usedNames[m2.name] = 1;
      out.push(m2);
    }
    return out;
  }

   




  function generateDay(opts) {
    opts = opts || {};
    var cuisine = cuisineForCountry(opts.country);
    var full = DB[cuisine] || DB[FALLBACK_POOL] || [];
    if (!full.length) return [];
    var rand = rng(hashStr([
      opts.email || '', new Date(opts.day || Date.now()).toDateString(),
      cuisine, opts.dietPref || 'None', opts.seed || 0
    ].join('|')));
    var filtered = full.filter(dietFilter(opts.dietPref));
    if (filtered.length < 8) filtered = full;    
    var targets = opts.targets || { kcal: 2000 };
    var daily = Number(targets.kcal) || 2000;
    var platesCount = daily >= 2600 ? 4 : (daily >= 2000 ? 3 : 2);
    var used = {};
    var out = [];
    ['breakfast', 'lunch', 'dinner', 'snack'].forEach(function (type) {
      var tgt = daily * SLOT_SPLIT[type];
      var picks = pickForType(filtered, type, tgt, rand, platesCount, used);
      picks.forEach(function (m) { out.push(toAppMeal(m)); });
    });
    return out;
  }

   
  function buildRecord(opts) {
    var meals = generateDay(opts);
    var loc = opts.loc || {};
    return {
      day: new Date(opts.day || Date.now()).toDateString(),
      email: opts.email || '',
      diet: opts.dietPref || 'None',
      lang: (opts.lang === 'ar') ? 'ar' : 'en',
      translations: {},
      country: loc.country || opts.country || '',
      city: loc.city || opts.city || '',
      source: 'engine',
      at: Date.now(),
      seed: opts.seed || 0,
      meals: meals
    };
  }

   
  var KEYWORDS = {
    green: ['salad', 'greens', 'spinach', 'veg', 'kale', 'cucumber', 'avocado', 'zucchini', 'herb', 'cabbage', 'lettuce', 'green bean', 'asparagus', 'pesto', 'edamame', 'okra', 'gomen', 'sukuma', 'molokhia', 'sabzi', 'bok choy', 'broccoli'],
    red: ['tomato', 'pizza', 'chili', 'shakshuka', 'berries', 'salsa', 'harissa', 'pepper', 'watermelon', 'strawberry', 'curry', 'menemen', 'brava', 'jollof', 'wat', 'tigray', 'pasta al pomodoro'],
    yellow: ['curry', 'sweet potato', 'egg', 'mango', 'corn', 'pumpkin', 'cheese', 'pineapple', 'butter', 'noodle', 'turmeric', 'banana', 'honey', 'lemon', 'omelette', 'pilau', 'plov', 'biryani', 'frittata'],
    brown: ['rice', 'chicken', 'beef', 'meat', 'stir', 'roast', 'potato', 'burger', 'steak', 'oats', 'quinoa', 'lentil', 'bean', 'chickpea', 'bread', 'pasta', 'shawarma', 'kebab', 'kofta', 'bulgur', 'peanut', 'falafel', 'biryani', 'jollof', 'doner', 'shawarma', 'koshari', 'mujaddara', 'Adobo', 'rendang', 'kabsa', 'machboos'],
    white: ['yogurt', 'oat', 'milk', 'rice', 'tofu', 'cottage', 'chia', 'pancake', 'cream', 'coconut', 'fish', 'cod', 'potato', 'pasta', 'mozzarella', 'feta', 'labneh', 'mushroom', 'onion', 'garlic', 'banana', 'cauliflower', 'humming', 'hummus', 'labneh', 'porridge', 'congee'],
    dark: ['chocolate', 'coffee', 'beef', 'salmon', 'tuna', 'soy', 'date', 'prune', 'walnut', 'brownie', 'cocoa', 'tea', 'bittersweet', 'molasses', 'mole']
  };
   




  function matchProfile(profile, opts) {
    opts = opts || {};
    var cuisine = cuisineForCountry(opts.country);
    var dom = (profile && profile.dominant) || 'brown';
    var kws = KEYWORDS[dom] || [];
    var hour = (typeof opts.hour === 'number') ? opts.hour : new Date().getHours();
    var mealTypeBonus = (hour >= 5 && hour < 11) ? 'breakfast'
                      : (hour >= 11 && hour < 15) ? 'lunch'
                      : (hour >= 16 && hour < 22) ? 'dinner' : 'snack';
    var source = DB[cuisine] || [];
    var dietF = dietFilter(opts.dietPref);
    var pool = source.filter(function (m) { return dietF(m); });
    if (pool.length < 10) {
      pool = source.concat(DB[FALLBACK_POOL] || []);
    }
    var scored = pool.map(function (meal) {
      var score = 0;
      var hay = ((meal.name || '') + ' ' + ((meal.ingredients || []).join(' ')) + ' ' + ((meal.tags || []).join(' ')) + ' ' + (meal.desc || '')).toLowerCase();
      for (var i = 0; i < kws.length; i++) { if (hay.indexOf(kws[i]) !== -1) score += 3; }
      if (meal.mealType === mealTypeBonus) score += 1.5;
      if (meal.mealType === 'lunch' || meal.mealType === 'dinner') score += 0.5;
      return { meal: meal, score: score };
    }).sort(function (a, b) { return b.score - a.score; });
    var seen = {}; var out = [];
    for (var i = 0; i < scored.length && out.length < 10; i++) {
      var m = scored[i].meal;
      if (!m || seen[m.name]) continue;
      seen[m.name] = 1; out.push(toAppMeal(m));
    }
    return { candidates: out, cuisine: cuisine };
  }

   
  function search(query, opts) {
    opts = opts || {};
    var q = String(query || '').toLowerCase().trim();
    if (!q) return [];
    var cuisine = cuisineForCountry(opts.country);
    var src = (DB[cuisine] || []).concat(DB[FALLBACK_POOL] || []);
    var dietF = dietFilter(opts.dietPref);
    return src.filter(function (m) {
      if (!dietF(m)) return false;
      var hay = ((m.name || '') + ' ' + (m.nameAr || '') + ' ' + (m.desc || '') + ' ' + ((m.ingredients || []).join(' '))).toLowerCase();
      return hay.indexOf(q) !== -1;
    }).slice(0, 12).map(toAppMeal);
  }

   
  function catalog(country, dietPref, maxNames) {
    var cuisine = cuisineForCountry(country);
    var pool = (DB[cuisine] || []).filter(dietFilter(dietPref));
    var names = [];
    var seen = {};
    for (var i = 0; i < pool.length && names.length < (maxNames || 90); i++) {
      var n = pool[i].name;
      if (seen[n]) continue;
      seen[n] = 1;
      names.push(n);
    }
    return { cuisine: cuisine, count: pool.length, names: names };
  }

  return {
    cuisineForCountry: cuisineForCountry,
    poolNames: poolNames,
    generateDay: generateDay,
    buildRecord: buildRecord,
    matchProfile: matchProfile,
    search: search,
    catalog: catalog,
    toAppMeal: toAppMeal,
     
     
    allMeals: function () {
      var out = [];
      for (var k in DB) { var pool = DB[k]; for (var i = 0; i < pool.length; i++) out.push(pool[i]); }
      return out;
    },
    FALLBACK_POOL: FALLBACK_POOL,
    TOTAL: Object.keys(DB).reduce(function (a, k) { return a + DB[k].length; }, 0)
  };
})();
