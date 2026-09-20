/**
 * VOLTA — js/volta-cloud-ai.js (v32)
 * ═══════════════════════════════════════════════════════════════════════════
 * THE CLOUD AI BRAIN (OpenRouter) — replaces the v31 offline-AI kit.
 *
 * WHY THIS EXISTS (v32, user):
 *   "i dont like the current ai state, remove all of this" — the on-device
 *   SLM / vector-DB / ring-buffer machinery never had a model to load, so
 *   open questions degraded to canned knowledge-base answers. ALL of that
 *   is removed. Open questions now get REAL answers streamed token-by-token
 *   from OpenRouter (the user's own API key, preloaded below).
 *
 * WHAT THIS MODULE DOES:
 *   1. LOCAL COMMANDS, still instant & offline: "log 500 ml water",
 *      "i ate a 400 kcal sandwich", "i weigh 82 kg", "open diet" — parsed
 *      here and executed against the REAL app storage (same write surface
 *      the old kit used: VoltaAppBridge).
 *   2. OPEN QUESTIONS → OpenRouter chat completions with streaming:
 *      • free-model FALLBACK CHAIN (max 3 slugs, auto-failover when a
 *        provider is rate-limited — free pools fluctuate)
 *      • only delta.content is shown (reasoning deltas are skipped, so
 *        reasoning models work too)
 *      • the athlete's live app data (profile / plan / streak / diet /
 *        water / sessions) is injected into the system prompt
 *      • in-memory conversation history (last 12 turns)
 *   3. STATUS CHIP + AI panel in the chat header — the key is user-editable
 *      (stored ONLY in localStorage on their device), the model is
 *      selectable, and a live "requests left today" quota is shown
 *      (free tier: 50/day).
 *
 * KEY HANDLING: the default key below is the one the user supplied. If it
 * is ever rejected (401) the chat shows a clear "replace the key" message
 * and the panel lets them paste a new one without touching any code.
 * ═══════════════════════════════════════════════════════════════════════════
 */
window.VoltaCloudAI = (function () {
  'use strict';

  /* ─── config ─────────────────────────────────────────────────────────── */
  var DEFAULT_KEY = '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';
  var LS_KEY = 'volta_or_key';
  var LS_MODEL = 'volta_or_model';
  var API_URL = 'https://openrouter.ai/api/v1/chat/completions';
  var AUTH_URL = 'https://openrouter.ai/api/v1/auth/key';
  var TIMEOUT_MS = 90 * 1000;      // hard cap for one streaming turn
  var MAX_TOKENS = 1000;           // headroom: reasoning models spend tokens thinking
  var HISTORY_TURNS = 12;          // conversation memory sent to the model

  // free-model fallback chain — OpenRouter tries them IN ORDER when a
  // provider errors/rate-limits. Verified working (v32 tests).
  var DEFAULT_CHAIN = [
    'inclusionai/ling-3.0-flash-sante:free',
    'z-ai/glm-5.2:free',
    'liquid/lfm-2.5-2.6b:free'
  ];

  var MODEL_PRESETS = [
    { id: '', label: 'Auto — free fallback chain (recommended)' },
    { id: 'inclusionai/ling-3.0-flash-sante:free', label: 'Ling 3.0 Flash Santé · free' },
    { id: 'z-ai/glm-5.2:free', label: 'GLM 5.2 · free' },
    { id: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B · free' },
    { id: 'liquid/lfm-2.5-2.6b:free', label: 'LFM 2.5 2.6B · free' },
    { id: 'nvidia/nemotron-3.5-lightning:free', label: 'Nemotron 3.5 Lightning · free' }
  ];

  /* ─── state ──────────────────────────────────────────────────────────── */
  var state = {
    history: [],          // [{role:'user'|'assistant', content}]
    busy: false,
    lastModel: null,
    quota: null,          // {used, limit, remaining} — free daily requests
    lastError: null
  };

  /* ─── tiny helpers (all defensive — the app must never crash) ────────── */
  function ar() {
    try { return typeof store !== 'undefined' && store.lang === 'ar'; } catch (e) { return false; }
  }
  function T(en, arTxt) { return ar() ? arTxt : en; }
  function today() {
    try { return typeof localDateStr === 'function' ? localDateStr() : new Date().toISOString().slice(0, 10); }
    catch (e) { return new Date().toISOString().slice(0, 10); }
  }
  function curUser() {
    try { return typeof currentUser === 'function' ? currentUser() : null; } catch (e) { return null; }
  }
  function userEmail(u) {
    u = u || curUser();
    try { return (u && u.email) || (typeof store !== 'undefined' && store.session) || ''; } catch (e) { return ''; }
  }

  function getKey() {
    try {
      var k = localStorage.getItem(LS_KEY);
      if (k && k.trim()) return k.trim();
    } catch (e) {}
    return DEFAULT_KEY;
  }
  function setKey(k) {
    try { localStorage.setItem(LS_KEY, String(k || '').trim()); } catch (e) {}
  }
  function getChain() {
    var m = '';
    try { m = (localStorage.getItem(LS_MODEL) || '').trim(); } catch (e) {}
    if (m) return [m];
    return DEFAULT_CHAIN.slice();
  }
  function modelLabel() {
    var m = '';
    try { m = (localStorage.getItem(LS_MODEL) || '').trim(); } catch (e) {}
    if (m) return m;
    return T('Auto (free chain)', 'تلقائي (سلسلة مجانية)');
  }

  /* ═════════════════════════════════════════════════════════════════════
   * 1) VoltaAppBridge — write surface over the REAL app data
   *    (identical to the proven v31 bridge — localStorage water, diet log,
   *    profile weight — so every command keeps working exactly as before)
   * ═════════════════════════════════════════════════════════════════════ */
  function VoltaAppBridge() { this.listeners = new Set(); }

  VoltaAppBridge.prototype._waterKey = function () { return 'volta_water_' + userEmail(); };

  VoltaAppBridge.prototype._readWater = function () {
    try {
      var raw = localStorage.getItem(this._waterKey());
      if (!raw) return { date: today(), ml: 0 };
      var v = JSON.parse(raw);
      if (!v || typeof v !== 'object') return { date: today(), ml: 0 };
      if (v.date !== today()) return { date: today(), ml: 0 };
      return { date: v.date, ml: Number(v.ml) || 0 };
    } catch (e) { return { date: today(), ml: 0 }; }
  };
  VoltaAppBridge.prototype._writeWater = function (ml) {
    var cur = this._readWater();
    var rec = { date: today(), ml: Math.max(0, Math.round(cur.ml + ml)) };
    try { localStorage.setItem(this._waterKey(), JSON.stringify(rec)); } catch (e) {}
    return rec;
  };
  VoltaAppBridge.prototype._waterTargetLiters = function () {
    try { if (typeof waterTargetLiters === 'function') return Number(waterTargetLiters()) || 0; } catch (e) {}
    var u = curUser();
    var w = Number(u && u.profile && u.profile.weight) || 0;
    return w > 0 ? Math.round(w * 0.033 * 10) / 10 : 0;
  };

  /** Live app user → compact snapshot (drives the system prompt). */
  VoltaAppBridge.prototype.readUser = function () {
    var u = curUser() || {};
    var p = u.profile || {}, g = u.goalPlan || {}, s = u.survey || {};
    var dp = (u.dailyPlan && u.dailyPlan.dailyPlan) ? u.dailyPlan.dailyPlan : null;
    var cur = dp ? (dp[(u.dailyPlan && u.dailyPlan.currentDay) || 0] || dp[0]) : null;
    var tdy = today();

    var meals = [], kcalEaten = 0;
    try {
      if (typeof getDietLog === 'function') {
        meals = (getDietLog() || []).filter(Boolean).map(function (x) {
          return { date: x.date || String(x.loggedAt || '').slice(0, 10), name: x.name || 'meal', kcal: Number(x.kcal) || 0 };
        });
        kcalEaten = Math.round(meals.filter(function (m) { return m.date === tdy; })
          .reduce(function (a, m) { return a + m.kcal; }, 0));
      }
    } catch (e) {}

    var sessions = (u.sessions || []).filter(Boolean).map(function (z) {
      var kcal = Number(z.kcal) || 0;
      try { if (typeof kcalForSession === 'function') kcal = kcalForSession(z); } catch (e) {}
      return { date: z.date || tdy, kind: z.kind || z.title || z.type || 'training', minutes: Number(z.duration || z.minutes) || 0, kcal: Math.round(kcal) };
    });
    var kcalBurnt = Math.round(sessions.filter(function (x) { return x.date === tdy; })
      .reduce(function (a, x) { return a + x.kcal; }, 0));

    var todayPlan = 'no plan yet';
    if (cur && Array.isArray(cur.workouts) && cur.workouts.length) {
      var day = ((u.dailyPlan && u.dailyPlan.currentDay) || 0) + 1;
      var names = cur.workouts.map(function (w) { return w && w.name; }).filter(Boolean);
      if (names.length) todayPlan = 'Day ' + day + ': ' + names.join(', ');
    }

    var w = this._readWater();
    var targetMl = Math.round((this._waterTargetLiters() || 0) * 1000);

    return {
      name: p.name || String(userEmail(u) || 'athlete').split('@')[0],
      gender: p.gender || '', age: Number(p.age) || 0,
      weightKg: Number(p.weight) || 0, heightCm: Number(p.height) || 0,
      goal: p.goal || g.goal || 'general fitness',
      sport: p.sport || '', level: p.level || '', injury: p.injury || 'none',
      streak: Number(u.streak) || 0,
      waterMl: w.ml, waterTargetMl: targetMl,
      kcalEaten: kcalEaten,
      kcalTarget: Number(g.targetCals || (u.plan && u.plan.diet && u.plan.diet.dailyCalories)) || 0,
      kcalBurnt: kcalBurnt,
      todayPlan: todayPlan,
      recentSessions: sessions.slice(-8),
      recentMeals: meals.slice(-6)
    };
  };

  /* ─── write surface — writes go through the APP's own functions ─────── */

  VoltaAppBridge.prototype.addWater = function (ml) {
    if (!isFinite(ml) || ml <= 0 || ml > 5000) return { ok: false, data: { error: 'ml must be 1..5000' } };
    var rec = this._writeWater(ml);
    this._emit();
    return { ok: true, data: { waterMl: rec.ml } };
  };

  VoltaAppBridge.prototype.addMeal = function (description, kcal) {
    if (!isFinite(kcal) || kcal <= 0 || kcal > 5000) return { ok: false, data: { error: 'kcal must be 1..5000' } };
    var email = userEmail();
    if (!email) return { ok: false, data: { error: 'not logged in' } };
    var total = 0;
    try {
      var log = (typeof getDietLog === 'function' ? getDietLog() : []) || [];
      log.push({
        id: Date.now(),
        name: String(description || 'meal').slice(0, 60),
        kcal: Math.round(kcal),
        date: today(),
        loggedAt: new Date().toISOString(),
        source: 'coach-ai'
      });
      if (typeof saveDietLog === 'function') saveDietLog(log);
      var tdy = today();
      total = Math.round(log.filter(function (x) { return (x.date && x.date === tdy) || (!x.date && String(x.loggedAt || '').indexOf(tdy) === 0); })
        .reduce(function (a, x) { return a + (Number(x.kcal) || 0); }, 0));
      try { if (typeof renderDietLog === 'function') renderDietLog(); } catch (e) {}
      try { if (typeof renderDiet === 'function') renderDiet(); } catch (e) {}
      try { if (typeof renderHome === 'function') renderHome(); } catch (e) {}
    } catch (e) { return { ok: false, data: { error: String(e) } }; }
    this._emit();
    return { ok: true, data: { kcalEaten: total } };
  };

  VoltaAppBridge.prototype.setWeight = function (kg) {
    if (!isFinite(kg) || kg < 25 || kg > 400) return { ok: false, data: { error: 'kg must be 25..400' } };
    var u = curUser();
    var email = userEmail(u);
    if (!u || !email) return { ok: false, data: { error: 'not logged in' } };
    try {
      u.profile = u.profile || {};
      u.profile.weight = Math.round(kg * 10) / 10;
      if (typeof saveUser === 'function') saveUser(email, u);
      try { if (typeof renderHome === 'function') renderHome(); } catch (e) {}
    } catch (e) { return { ok: false, data: { error: String(e) } }; }
    this._emit();
    return { ok: true, data: { weightKg: u.profile.weight } };
  };

  VoltaAppBridge.prototype.onChange = function (fn) {
    var self = this;
    this.listeners.add(fn);
    return function () { self.listeners.delete(fn); };
  };
  VoltaAppBridge.prototype._emit = function () {
    var fns = Array.from(this.listeners);
    for (var i = 0; i < fns.length; i++) { try { fns[i](); } catch (e) {} }
  };

  var bridge = new VoltaAppBridge();

  /* ═════════════════════════════════════════════════════════════════════
   * 2) LOCAL COMMANDS — instant, offline, executed against the app
   * ═════════════════════════════════════════════════════════════════════ */
  var TAB_MAP = {
    home: 'home', dashboard: 'home',
    diet: 'diet', nutrition: 'diet', food: 'diet',
    workouts: 'daily', workout: 'daily', training: 'daily', gym: 'daily',
    daily: 'daily', discipline: 'daily',
    streaks: 'streaks', streak: 'streaks',
    sports: 'sports', sport: 'sports',
    mood: 'moodmorph', moodmorph: 'moodmorph',
    more: 'settings', settings: 'settings', profile: 'profile',
    recovery: 'recovery', weather: 'weather', reminders: 'reminders'
  };

  function num(s) { return parseFloat(String(s).replace(',', '.')); }
  function mlFor(n, unit) {
    var u = String(unit || '').toLowerCase();
    if (u.indexOf('millil') === 0) return n;
    if (u === 'cl') return n * 10;
    if (u === 'dl') return n * 100;
    if (u === 'l' || u.indexOf('liter') === 0 || u.indexOf('litre') === 0 || u === 'لتر' || u === 'لترا') return n * 1000;
    if (u.indexOf('glass') === 0 || u === 'كوب' || u === 'كوبين' || u === 'كوبان') return n * 250;
    if (u.indexOf('cup') === 0 || u === 'أكواب') return n * 240;
    return n; // bare number after "water" verb → assume ml
  }


  function parseWater(q) {
    var m = q.match(/(?:log|add|record|drank|drink|had|took|شربت|سجّل|سجل)[^.]{0,50}?(\d+(?:[.,]\d+)?)\s*(ml|milliliters?|millilitres?|cl|dl|l\b|liters?|litres?|glasses?|glass|cups?|cup|كوب(?:ين|ان)?|أكواب|مل|لتر)?[^.]{0,30}?(?:water|ماء|الماء)/i);
    if (!m) return null;
    var n = num(m[1]);
    if (!isFinite(n) || n <= 0) return null;
    var ml = mlFor(n, m[2] || 'ml');
    if (ml <= 0 || ml > 5000) return null;
    return { tool: 'log_water', args: { ml: Math.round(ml) } };
  }

  function parseMeal(q) {
    var m = q.match(/(?:i\s+(?:just\s+)?(?:ate|had|consumed)|log(?:ged)?|أكلت|تناولت|سجّل|سجل)[^.]{0,60}?(\d+(?:[.,]\d+)?)\s*(?:kcal|calories?|cal\b|سعرات?|سعرة|كالوري)/i);
    if (!m) return null;
    var kcal = num(m[1]);
    if (!isFinite(kcal) || kcal < 20 || kcal > 5000) return null;
    var d = q.match(/(?:ate|had|consumed|أكلت|تناولت)\s+(?:an?\s+)?([^0-9]{1,50}?)\s*\d+(?:[.,]\d+)?\s*(?:kcal|calories?|cal\b|سعرات?|سعرة|كالوري)/i);
    var desc = d ? d[1].replace(/\s+/g, ' ').trim() : '';
    if (!desc) desc = q.replace(/\d+/g, '').replace(/(kcal|calories|cal|سعرة|سعرات|كالوري|i\s+just\s+ate|ate|had|consumed|logged|log)/gi, '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return { tool: 'log_meal', args: { desc: desc || 'meal', kcal: Math.round(kcal) } };
  }

  function parseWeight(q) {
    var m = q.match(/(?:i\s+(?:am|'m|weigh)|my weight is|weight is|weight:|أزن|وزني)\D{0,10}?(\d+(?:[.,]\d+)?)\s*(?:kg|kgs|kilos?|kilograms?|كيلو|كجم|كج)\b/i);
    if (!m) return null;
    var kg = num(m[1]);
    if (!isFinite(kg) || kg < 25 || kg > 400) return null;
    return { tool: 'log_weight', args: { kg: kg } };
  }

  function parseNavigate(q) {
    var m = q.match(/^\s*(?:open|go to|show(?: me)?|switch to|navigate to|take me to|افتح|اذهب\s*(?:إلى|لـ|الى))\s+(?:the\s+|my\s+)?([a-zA-Z\u0600-\u06FF ]{2,24})\s*(?:tab|page|screen|تبويب|صفحة)?\s*[!.]?$/i);
    if (!m) return null;
    var key = m[1].trim().toLowerCase();
    if (!TAB_MAP[key]) {
      // try last word ("open the diet tab", "go to my sports tab")
      var words = key.split(/\s+/);
      for (var i = words.length - 1; i >= 0; i--) {
        if (TAB_MAP[words[i]]) { key = words[i]; break; }
      }
    }
    if (!TAB_MAP[key]) return null;
    return { tool: 'navigate_tab', args: { tab: TAB_MAP[key] } };
  }

  function parseCommand(q) {
    q = String(q || '').trim();
    if (!q || q.length > 140) return null;
    return parseWater(q) || parseMeal(q) || parseWeight(q) || parseNavigate(q);
  }

  function onNavigate(tab) {
    try { if (window.VoltaCoachChat && window.VoltaCoachChat.close) window.VoltaCoachChat.close(); } catch (e) {}
    if (typeof showTab === 'function') { try { showTab(tab); } catch (e) {} }
  }

  function summarizeToolResult(name, result) {
    var d = result && result.data;
    if (!result || result.ok === false) return 'Hmm, that didn\'t work — ' + ((result && result.error) || 'unknown error');
    switch (name) {
      case 'log_water': {
        var t = 0; try { t = bridge._waterTargetLiters() * 1000; } catch (e) {}
        return T('💧 Logged. You\'re at ' + d.waterMl + (t ? ' / ' + Math.round(t) : '') + ' ml today.',
                 '💧 تم التسجيل. وصلت إلى ' + d.waterMl + (t ? ' / ' + Math.round(t) : '') + ' مل اليوم.');
      }
      case 'log_meal': return T('🍽 Logged (~' + d.kcalEaten + ' kcal total today).', '🍽 تم التسجيل (~' + d.kcalEaten + ' سعرة اليوم).');
      case 'log_weight': return T('⚖️ Weight saved: ' + d.weightKg + ' kg.', '⚖️ تم حفظ الوزن: ' + d.weightKg + ' كجم.');
      case 'navigate_tab': return T('Opening ' + d.navigatedTo + ' ⚡', 'أفتح ' + d.navigatedTo + ' ⚡');
      default: return 'Done ✓';
    }
  }

  function runCommand(cmd) {
    if (cmd.tool === 'log_water') {
      var r = bridge.addWater(cmd.args.ml);
      return { type: 'tool_result', text: summarizeToolResult('log_water', r), tool: cmd };
    }
    if (cmd.tool === 'log_meal') {
      var r2 = bridge.addMeal(cmd.args.desc, cmd.args.kcal);
      return { type: 'tool_result', text: summarizeToolResult('log_meal', r2), tool: cmd };
    }
    if (cmd.tool === 'log_weight') {
      var r3 = bridge.setWeight(cmd.args.kg);
      return { type: 'tool_result', text: summarizeToolResult('log_weight', r3), tool: cmd };
    }
    if (cmd.tool === 'navigate_tab') {
      onNavigate(cmd.args.tab);
      return { type: 'tool_result', text: summarizeToolResult('navigate_tab', { ok: true, data: { navigatedTo: cmd.args.tab } }), tool: cmd };
    }
    return null;
  }

  /* ═════════════════════════════════════════════════════════════════════
   * 3) OPEN QUESTIONS → OpenRouter (streaming)
   * ═════════════════════════════════════════════════════════════════════ */
  function systemPrompt() {
    var u = {};
    try { u = bridge.readUser(); } catch (e) {}
    var lines = [
      'name: ' + u.name, 'age: ' + (u.age || '?'), 'gender: ' + (u.gender || '?'),
      'height: ' + (u.heightCm || '?') + ' cm', 'weight: ' + (u.weightKg || '?') + ' kg',
      'goal: ' + u.goal, 'sport: ' + (u.sport || '?'), 'level: ' + (u.level || '?'), 'injury: ' + (u.injury || 'none'),
      'streak: ' + u.streak + ' days',
      'water today: ' + u.waterMl + '/' + u.waterTargetMl + ' ml',
      'calories today: ' + u.kcalEaten + ' eaten / ' + u.kcalTarget + ' target / ~' + u.kcalBurnt + ' burnt',
      'today\'s plan: ' + u.todayPlan
    ];
    if (u.recentSessions && u.recentSessions.length) {
      lines.push('recent sessions: ' + u.recentSessions.map(function (s) { return s.date + ' ' + s.kind + ' ' + s.minutes + 'min ~' + s.kcal + 'kcal'; }).join('; '));
    }
    return [
      'You are VOLTA Coach AI — the coach inside the VOLTA fitness app.',
      'STYLE: concise, energetic, practical. Short paragraphs and lists. Use **bold** for key numbers. At most 1-2 emoji.',
      'LANGUAGE: always reply in the language of the user\'s message (usually English or Arabic).',
      'DATA: you are given the athlete\'s live app data — use it and cite the real numbers. If a value is "?" or missing, tell them what to fill in the app; never invent numbers.',
      'SCOPE: fitness, training, nutrition, recovery, motivation. You are not a doctor — for pain or medical issues recommend a professional.',
      'LOGGING: the app itself executes commands like "log 500 ml water", "I ate a 600 kcal sandwich", "I weigh 82 kg", "open diet" BEFORE they reach you — never claim you logged anything yourself.',
      '',
      'ATHLETE DATA (live from the app):',
      lines.map(function (l) { return '- ' + l; }).join('\n')
    ].join('\n');
  }

  function mapError(status, message) {
    state.lastError = (status || '') + ' ' + (message || '');
    if (status === 401) {
      return T('**Cloud AI key rejected** — open the ☁ AI chip in this chat header and paste a valid OpenRouter key (the current one no longer works).',
               '**تم رفض مفتاح الذكاء السحابي** — افتح شارة ☁ في رأس المحادثة وألصق مفتاح OpenRouter صالحًا (المفتاح الحالي لم يعد يعمل).');
    }
    if (status === 402) {
      return T('**No credits on this OpenRouter key** — it only runs free models. Pick a free model in the ☁ AI chip, or add credits at openrouter.ai.',
               '**لا توجد رصيد في مفتاح OpenRouter** — يعمل بالنماذج المجانية فقط. اختر نموذجًا مجانيًا من شارة ☁ أو أضف رصيدًا من openrouter.ai.');
    }
    if (status === 429) {
      return T('**Rate limit reached** (free tier: 50 requests/day, or the free providers are busy). Wait a minute and try again — or switch models in the ☁ AI chip.',
               '**تم بلوغ حد الاستخدام** (الفئة المجانية: 50 طلبًا/يوم أو مزودو النماذج المجانية مشغولون). انتظر دقيقة وحاول مجددًا — أو بدّل النموذج من شارة ☁.');
    }
    if (status === 404) {
      return T('**Model not found** — the selected model slug is invalid. Open the ☁ AI chip and choose a valid model.',
               '**النموذج غير موجود** — معرف النموذج المحدد غير صالح. افتح شارة ☁ واختر نموذجًا صالحًا.');
    }
    return T('**Cloud AI error** — ' + String(message || status || 'unknown').slice(0, 140) + '. Try again in a moment.',
             '**خطأ في الذكاء السحابي** — ' + String(message || status || 'غير معروف').slice(0, 140) + '. حاول مجددًا بعد قليل.');
  }

  /**
   * One chat turn: local command → instant result; otherwise a streamed
   * OpenRouter completion. onToken fires with visible text fragments.
   * @returns {Promise<{type:'tool_result'|'chat'|'error', text:string, model?:string}>}
   */
  function handle(q, opts) {
    opts = opts || {};
    if (state.busy) return Promise.resolve({ type: 'error', text: T('One question at a time — the coach is still answering.', 'سؤال واحد في كل مرة — المدرب ما زال يجيب.') });

    var cmd = parseCommand(q);
    if (cmd) {
      var out = runCommand(cmd);
      if (out) return Promise.resolve(out);
    }
    return askCloud(q, opts);
  }

  function buildMessages(q) {
    var msgs = [{ role: 'system', content: systemPrompt() }];
    var h = state.history.slice(-HISTORY_TURNS * 2);
    for (var i = 0; i < h.length; i++) msgs.push({ role: h[i].role, content: h[i].content });
    msgs.push({ role: 'user', content: String(q || '').slice(0, 2000) });
    return msgs;
  }

  function askCloud(q, opts, _retried) {
    state.busy = true;
    refreshChip('busy');

    var ctrl = ('AbortController' in window) ? new AbortController() : null;
    var killer = setTimeout(function () { try { ctrl && ctrl.abort(); } catch (e) {} }, TIMEOUT_MS);

    var done = false;
    function finish(out) {
      if (done) return;
      done = true;
      clearTimeout(killer);
      state.busy = false;
      refreshChip(out.type === 'chat' ? 'ok' : (out.type === 'error' ? 'err' : 'ok'));
      return out;
    }

    var body = {
      models: getChain(),
      messages: buildMessages(q),
      stream: true,
      max_tokens: MAX_TOKENS
    };

    return fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + getKey(),
        'Content-Type': 'application/json',
        'X-Title': 'VOLTA Coach AI'
      },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      if (res.status !== 200) {
        return res.text().then(function (txt) {
          var msg = '', code = res.status;
          try { var j = JSON.parse(txt); msg = j.error && j.error.message; code = (j.error && j.error.code) || res.status; } catch (e) { msg = String(txt).slice(0, 140); }
          // one silent retry on transient upstream errors
          if (!_retried && (code === 429 || code === 502 || code === 503 || code === 504)) {
            return new Promise(function (r) { setTimeout(r, 1800); }).then(function () {
              state.busy = false;
              return askCloud(q, opts, true);
            });
          }
          return { type: 'error', text: mapError(code, msg) };
        });
      }
      if (!res.body || !res.body.getReader) {
        // no streaming support — plain JSON
        return res.json().then(function (j) {
          var c = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
          if (!c) return { type: 'error', text: mapError(0, 'empty reply') };
          state.lastModel = j.model || getChain()[0];
          state.history.push({ role: 'user', content: q }, { role: 'assistant', content: c });
          fetchQuota();
          return { type: 'chat', text: c, model: state.lastModel };
        });
      }

      /* ── SSE stream: only delta.content is shown ── */
      var reader = res.body.getReader();
      var dec = new TextDecoder();
      var buf = '', full = '', model = null;

      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return;
          buf += dec.decode(r.value, { stream: true });
          var lines = buf.split('\n');
          buf = lines.pop();
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line || line.indexOf('data:') !== 0) continue;
            var payload = line.slice(5).trim();
            if (payload === '[DONE]') continue;
            try {
              var j = JSON.parse(payload);
              if (j.model) model = j.model;
              var ch = j.choices && j.choices[0];
              var delta = ch && ch.delta;
              if (delta && typeof delta.content === 'string' && delta.content) {
                full += delta.content;
                if (opts.onToken) { try { opts.onToken(delta.content); } catch (e) {} }
              }
            } catch (e) { /* keep-alive / partial line — ignore */ }
          }
          return pump();
        });
      }

      return pump().then(function () {
        // strip any reasoning leakage some models put into content
        var text = String(full).replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^\s*<\/?think>\s*$/gm, '').trim();
        if (!text) {
          return { type: 'error', text: T('The model thought but didn\'t answer — try rephrasing or switch models in the ☁ AI chip.',
                                           'فكر النموذج لكنه لم يجب — أعد صياغة سؤالك أو بدّل النموذج من شارة ☁.') };
        }
        state.lastModel = model || getChain()[0];
        state.history.push({ role: 'user', content: String(q || '') }, { role: 'assistant', content: text });
        if (state.history.length > HISTORY_TURNS * 4) state.history = state.history.slice(-HISTORY_TURNS * 2);
        fetchQuota();
        return { type: 'chat', text: text, model: state.lastModel };
      }).catch(function (e) {
        if (String(e).indexOf('Abort') !== -1) return { type: 'error', text: T('**Cloud AI timed out** — the free providers are busy. Try again.', '**انتهت مهلة الذكاء السحابي** — المزودون المجانيون مشغولون. حاول مجددًا.') };
        return { type: 'error', text: mapError(0, String(e)) };
      });
    }).catch(function (e) {
      state.busy = false;
      refreshChip('err');
      if (String(e).indexOf('Abort') !== -1) {
        return { type: 'error', text: T('**Cloud AI timed out** — try again.', '**انتهت مهلة الذكاء السحابي** — حاول مجددًا.') };
      }
      return { type: 'error', text: T('**No internet** — VOLTA\'s quick answers and commands still work offline, but open questions need a connection.',
                                       '**لا يوجد اتصال بالإنترنت** — الإجابات السريعة والأوامر تعمل دون اتصال، لكن الأسئلة المفتوحة تحتاج إنترنت.') };
    }).then(function (out) {
      return finish(out || { type: 'error', text: 'error' });
    });
  }

  /* ─── quota (free requests left today) ──────────────────────────────── */
  function fetchQuota() {
    return fetch(AUTH_URL, { headers: { 'Authorization': 'Bearer ' + getKey() } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var d = j && j.data;
        if (d && d.free_model_daily_requests) {
          state.quota = {
            remaining: d.free_model_daily_requests.remaining,
            limit: d.free_model_daily_requests.limit,
            used: d.free_model_daily_requests.used
          };
          renderQuota();
        }
      }).catch(function () {});
  }

  /* ═════════════════════════════════════════════════════════════════════
   * 4) Status chip + Cloud AI settings panel in the chat header
   * ═════════════════════════════════════════════════════════════════════ */
  function chipLabel(kind) {
    if (kind === 'busy') return T('thinking…', 'يفكر…');
    if (kind === 'err') return T('cloud AI error', 'خطأ الذكاء السحابي');
    return T('Cloud AI', 'ذكاء سحابي');
  }

  function refreshChip(kind) {
    var chip = document.getElementById('vcoach-ai-status');
    if (!chip) return;
    chip.setAttribute('data-on', kind === 'busy' ? 'busy' : (kind === 'err' ? '0' : '1'));
    var lbl = chip.querySelector('.vcoach-status-label');
    if (lbl) lbl.textContent = chipLabel(kind);
    var dot = chip.querySelector('.vcoach-status-dot');
    if (dot) {
      dot.style.background = kind === 'err' ? '#ff7d7d' : (kind === 'busy' ? '#ffd166' : '#7dd87d');
      dot.style.boxShadow = '0 0 6px rgba(125,216,125,.8)';
    }
  }

  function ensureStatusChip() {
    var head = document.querySelector('#volta-ai-chat-modal .vcoach-head');
    if (!head || document.getElementById('vcoach-ai-status')) return;
    var chip = document.createElement('button');
    chip.type = 'button';
    chip.id = 'vcoach-ai-status';
    chip.className = 'vcoach-status';
    chip.title = T('Cloud AI (OpenRouter) status & settings', 'حالة الذكاء السحابي (OpenRouter) والإعدادات');
    chip.innerHTML = '<span class="vcoach-status-dot"></span><span class="vcoach-status-label">' + T('Cloud AI', 'ذكاء سحابي') + '</span>';
    chip.addEventListener('click', function (e) { e.stopPropagation(); openAiPanel(); });
    head.appendChild(chip);
    refreshChip('ok');
    fetchQuota();
  }

  function renderQuota() {
    var el = document.getElementById('vai-quota');
    if (el && state.quota) {
      el.textContent = state.quota.remaining + ' / ' + state.quota.limit + ' ' + T('left today', 'متبقية اليوم');
    }
    var row = document.getElementById('vai-quota-row');
    if (row && state.quota) row.style.display = '';
  }

  function openAiPanel() {
    var panel = document.getElementById('vcoach-ai-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'vcoach-ai-panel';
      panel.className = 'vcoach-ai-panel';
      var opts = MODEL_PRESETS.map(function (m) {
        return '<option value="' + m.id + '">' + m.label + '</option>';
      }).join('');
      panel.innerHTML =
        '<div class="vai-head"><b>' + T('Cloud AI — OpenRouter', 'الذكاء السحابي — OpenRouter') + '</b>' +
          '<button type="button" class="vai-close" id="vai-close">&times;</button></div>' +
        '<div class="vai-body">' +
          '<div class="vai-row"><span>' + T('Provider', 'المزود') + '</span><b>OpenRouter</b></div>' +
          '<div class="vai-row"><span>' + T('Model', 'النموذج') + '</span><b id="vai-model-now">—</b></div>' +
          '<div class="vai-row" id="vai-quota-row" style="display:none"><span>' + T('Free requests', 'الطلبات المجانية') + '</span><b id="vai-quota">—</b></div>' +
          '<label class="vai-label">' + T('API key (stored only on this device)', 'مفتاح API (يُحفظ على هذا الجهاز فقط)') + '</label>' +
          '<input id="vai-or-key" class="vai-input" type="password" spellcheck="false" autocomplete="off" placeholder="sk-or-v1-…" />' +
          '<label class="vai-label">' + T('Model', 'النموذج') + '</label>' +
          '<select id="vai-or-model" class="vai-select">' + opts + '</select>' +
          '<div class="vai-btns">' +
            '<button type="button" class="vai-btn primary" id="vai-save">' + T('Save & test', 'حفظ واختبار') + '</button>' +
          '</div>' +
          '<small class="vai-note" id="vai-note">' +
            T('Real AI answers are streamed from OpenRouter using the free tier (50 requests/day, resets daily). The key lives in this browser only. Quick data answers and commands (log water / meals / weight, open tabs) still work fully offline.',
               'تُبَثّ إجابات الذكاء الحقيقي من OpenRouter عبر الفئة المجانية (50 طلبًا/يوم، تتجدد يوميًا). المفتاح يُحفظ في هذا المتصفح فقط. الإجابات السريعة والأوامر (تسجيل الماء/الوجبات/الوزن، فتح التبويبات) تعمل دون إنترنت تمامًا.') +
          '</small>' +
        '</div>';
      (document.querySelector('#volta-ai-chat-modal .vcoach-window') || document.body).appendChild(panel);
      document.getElementById('vai-close').addEventListener('click', function () { panel.classList.remove('open'); });

      document.getElementById('vai-save').addEventListener('click', function () {
        var btn = this;
        btn.disabled = true;
        var keyIn = document.getElementById('vai-or-key');
        var modelIn = document.getElementById('vai-or-model');
        var note = document.getElementById('vai-note');
        var key = (keyIn.value || '').trim();
        if (key) setKey(key);
        else { try { localStorage.removeItem(LS_KEY); } catch (e) {} }
        try { localStorage.setItem(LS_MODEL, modelIn.value || ''); } catch (e) {}
        note.textContent = T('Testing…', 'جارٍ الاختبار…');
        ping().then(function (ok) {
          btn.disabled = false;
          if (ok) {
            note.textContent = T('✓ Connected — the key and model work. Free requests left today are shown above.',
                                  '✓ متصل — المفتاح والنموذج يعملان. الطلبات المجانية المتبقية اليوم ظاهرة أعلاه.');
            refreshPanel(); fetchQuota();
          } else {
            note.textContent = T('✗ ' + (state.lastError || 'connection failed') + ' — replace the key if it was rejected (401).',
                                  '✗ ' + (state.lastError || 'فشل الاتصال') + ' — استبدل المفتاح إذا كان مرفوضًا (401).');
          }
        });
      });
    }
    panel.classList.add('open');
    refreshPanel();
    fetchQuota();
  }

  function refreshPanel() {
    var set = function (id, txt) { var el = document.getElementById(id); if (el) el.textContent = txt; };
    set('vai-model-now', modelLabel());
    try {
      var keyIn = document.getElementById('vai-or-key');
      if (keyIn && !keyIn.value) {
        var saved = '';
        try { saved = localStorage.getItem(LS_KEY) || ''; } catch (e) {}
        keyIn.value = saved || DEFAULT_KEY;
      }
      var modelIn = document.getElementById('vai-or-model');
      if (modelIn) {
        var cur = '';
        try { cur = (localStorage.getItem(LS_MODEL) || '').trim(); } catch (e) {}
        modelIn.value = cur;
      }
    } catch (e) {}
    renderQuota();
  }

  /** tiny completion to verify key + model actually work */
  function ping() {
    return fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + getKey(),
        'Content-Type': 'application/json',
        'X-Title': 'VOLTA Coach AI'
      },
      body: JSON.stringify({ model: getChain()[0], messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 })
    }).then(function (r) {
      if (r.status === 200) return true;
      return r.text().then(function (t) {
        var msg = ''; try { msg = JSON.parse(t).error.message; } catch (e) {}
        state.lastError = (r.status === 401 ? 'Key rejected (401)' : (r.status + ' ' + msg)).slice(0, 120);
        return false;
      });
    }).catch(function (e) {
      state.lastError = 'No internet';
      return false;
    });
  }

  /* ─── boot strap ────────────────────────────────────────────────────── */
  function domReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }
  domReady(function () {
    // the chat modal is created by volta-chat-ai.js on its own DOMContentLoaded
    // (which fires BEFORE this handler — script order) but stay defensive:
    setTimeout(ensureStatusChip, 250);
    var iv = setInterval(function () {
      if (document.getElementById('vcoach-ai-status')) { clearInterval(iv); return; }
      ensureStatusChip();
      if (document.getElementById('vcoach-ai-status')) clearInterval(iv);
    }, 1500);
    setTimeout(function () { clearInterval(iv); }, 20000);
  });

  /* ─── public surface ────────────────────────────────────────────────── */
  return {
    handle: handle,                 // one turn: {type:'tool_result'|'chat'|'error', text, model?}
    isCommand: function (q) { return !!parseCommand(q); },
    clearHistory: function () { state.history = []; },
    health: function () {
      return { provider: 'OpenRouter', model: state.lastModel || modelLabel(), busy: state.busy, quota: state.quota, lastError: state.lastError };
    },
    boot: ensureStatusChip
  };
})();
