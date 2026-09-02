/**
 * Volta Features Module (new)
 * =============================================================
 * Adds the requested feature set on top of the existing app:
 *   - Units toggle (metric kg/cm <-> imperial lb/ft)
 *   - Dashboard weekly plan cards (workout + diet)
 *   - Streaks & Progress tab: report card, heatmap, weekly volume,
 *     weight trend, workout history, badges & achievements wall
 *   - Custom Workout Builder
 *   - Data Export / Import (JSON + CSV)
 *
 * All user-facing strings are bilingual (EN + AR) via _t().
 * Loaded BEFORE volta.js; uses volta.js globals lazily at call time.
 */
window.VoltaFeatures = (function () {
  'use strict';

  // ────────────────────────────────────────────────────────────
  // Shared helpers
  // ────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function ar() { try { return (typeof store !== 'undefined' && store.lang === 'ar'); } catch (e) { return false; } }
  function t(en, arTxt) { return ar() ? arTxt : en; }
  function U() { try { return (typeof currentUser === 'function') ? currentUser() : null; } catch (e) { return null; } }
  function save(u) { try { if (typeof saveUser === 'function' && typeof store !== 'undefined') saveUser(store.session, u); } catch (e) {} }
  function todayStr() { try { return (typeof localDateStr === 'function') ? localDateStr() : new Date().toISOString().slice(0, 10); } catch (e) { return new Date().toISOString().slice(0, 10); } }
  function toast(msg, type) { try { if (typeof showVoltaToast === 'function') showVoltaToast(msg, type || 'success'); } catch (e) {} }
  function kcalForSessionSafe(s) {
    try { if (typeof kcalForSession === 'function') return kcalForSession(s); } catch (e) {}
    return (s && s.calories) || 0;
  }

  // ────────────────────────────────────────────────────────────
  // 1) UNITS — metric (kg, cm) / imperial (lb, ft)
  // Stored in localStorage 'fb_units' so it survives per device.
  // Internal storage stays metric everywhere; only display converts.
  // ────────────────────────────────────────────────────────────
  function getUnits() { try { return localStorage.getItem('fb_units') === 'imperial' ? 'imperial' : 'metric'; } catch (e) { return 'metric'; } }
  function setUnits(u) {
    try {
      localStorage.setItem('fb_units', u === 'imperial' ? 'imperial' : 'metric');
    } catch (e) {}
    try { applySettings(); } catch (e) {}
    try { renderHome(); } catch (e) {}
    try { renderProfile(); } catch (e) {}
    try { renderStreaksTab(); } catch (e) {}
    toast(t('Units: Imperial (lb, ft)', 'الوحدات: إمبراطورية (رطل، قدم)'), 'success');
  }
  function KG_TO_LB() { return 2.2046226218; }
  function fmtWeight(kg, withUnit) {
    const v = parseFloat(kg); if (isNaN(v)) return '--';
    if (getUnits() === 'imperial') {
      const lb = Math.round(v * KG_TO_LB() * 10) / 10;
      return withUnit === false ? lb : (lb + (ar() ? ' رطل' : ' lb'));
    }
    return withUnit === false ? v : (v + (ar() ? ' كجم' : ' kg'));
  }
  function weightUnit() { return getUnits() === 'imperial' ? (ar() ? 'رطل' : 'lb') : (ar() ? 'كجم' : 'kg'); }
  function weightInputToKg(val) {
    const v = parseFloat(val); if (isNaN(v)) return NaN;
    return getUnits() === 'imperial' ? v / KG_TO_LB() : v;
  }
  function kgToDisplay(kg) {
    const v = parseFloat(kg); if (isNaN(v)) return '--';
    return getUnits() === 'imperial' ? (Math.round(v * KG_TO_LB() * 10) / 10) : v;
  }
  function fmtHeight(cm) {
    const v = parseFloat(cm); if (isNaN(v)) return '--';
    if (getUnits() === 'imperial') {
      const totalIn = v / 2.54;
      const ft = Math.floor(totalIn / 12);
      const inch = Math.round(totalIn - ft * 12);
      return ft + "'" + inch + '"';
    }
    return v + (ar() ? ' سم' : ' cm');
  }

  // ────────────────────────────────────────────────────────────
  // 2) DASHBOARD PLAN CARDS — weekly workout plan + diet plan
  // ────────────────────────────────────────────────────────────
  var DAY_LABELS = {
    Mon: ['Mon', 'الإثنين'], Tue: ['Tue', 'الثلاثاء'], Wed: ['Wed', 'الأربعاء'],
    Thu: ['Thu', 'الخميس'], Fri: ['Fri', 'الجمعة'], Sat: ['Sat', 'السبت'], Sun: ['Sun', 'الأحد']
  };
  // Split-type + focus-chip translations (values produced by plan-engine.js).
  var SPLIT_AR = {
    'Push/Pull/Legs': 'دفع/سحب/أرجل',
    'Upper/Lower': 'علوي/سفلي',
    'Full Body': 'كامل الجسم',
    'Body Part Split': 'تقسيم حسب العضلة',
    'Custom': 'مخصص'
  };
  var FOCUS_AR = {
    'Push': 'دفع', 'Pull': 'سحب', 'Legs': 'أرجل',
    'Upper': 'علوي', 'Lower': 'سفلي', 'Full Body': 'كامل الجسم',
    'Chest': 'الصدر', 'Back': 'الظهر', 'Shoulders': 'الأكتاف', 'Arms': 'الذراعين', 'Core': 'البطن'
  };
  function splitLabel(s) { return ar() ? (SPLIT_AR[s] || s) : s; }
  function focusLabel(f) { return ar() ? (FOCUS_AR[f] || f) : f; }
  function dayLabel(d) {
    const key = (d || '').slice(0, 3);
    const pair = DAY_LABELS[key];
    if (!pair) return d;
    return ar() ? pair[1] : pair[0];
  }
  function mealLabel(type) {
    const map = {
      breakfast: ['Breakfast', 'الفطور'], lunch: ['Lunch', 'الغداء'],
      dinner: ['Dinner', 'العشاء'], snack: ['Snacks', 'وجبات خفيفة']
    };
    const pair = map[(type || '').toLowerCase()];
    return pair ? (ar() ? pair[1] : pair[0]) : type;
  }
  // Arabic display name for an exercise when available (uses the app-wide
  // WORKOUT_AR_NAMES dictionary; falls back to the English data name).
  function workoutNameDisplay(name) {
    try {
      if (ar() && typeof WORKOUT_AR_NAMES !== 'undefined' && WORKOUT_AR_NAMES) {
        const keys = Object.keys(WORKOUT_AR_NAMES);
        for (let i = 0; i < keys.length; i++) {
          if (keys[i].toLowerCase() === (name || '').toLowerCase()) return WORKOUT_AR_NAMES[keys[i]];
        }
      }
    } catch (e) {}
    return name;
  }
  // ─── Round 18 (amended R11/R13): dashboard workout plan shows 1 DAY at a time ───
  // Per user request the weekly schedule is chunked into pages of ONE day.
  // The pager starts on the page that contains TODAY (falls back to page 1
  // if today is a rest day), the ‹ › arrows flip one day at a time with a
  // "1 of 7" → "2 of 7" counter, and the whole card is styled more compactly
  // (see the .plan-* overrides in volta-redesign.css).
  var DASH_PLAN_PAGE_SIZE = 1;
  var dashPlanPage = -1; // -1 = auto → resolve to today's page on next render
  function shiftDashboardPlanPage(delta) {
    dashPlanPage = Math.max(0, (dashPlanPage < 0 ? 0 : dashPlanPage) + delta);
    try { renderDashboardPlan(); } catch (e) {}
  }
  function dashPlanPrevPage() { shiftDashboardPlanPage(-1); }
  function dashPlanNextPage() { shiftDashboardPlanPage(1); }

  function renderDashboardPlan() {
    const u = U();
    const panel = document.getElementById('your-plan-panel');
    const content = document.getElementById('your-plan-content');
    if (!panel || !content) return;
    if (!u || !u.plan) {
      // Per user report: "i opened the app and there's no plan". Don't leave
      // the YOUR PERSONAL PLAN section empty — show a friendly create CTA
      // instead of hiding the panel entirely.
      panel.style.display = 'block';
      content.innerHTML =
        '<div style="text-align:center;padding:18px 12px;">' +
          '<div style="width:52px;height:52px;border-radius:14px;background:var(--accent-soft);color:var(--accent);display:flex;align-items:center;justify-content:center;font-size:1.3rem;margin:0 auto 10px;"><i class="fa-solid fa-clipboard-list"></i></div>' +
          '<b style="display:block;margin-bottom:4px;">' + esc(t('No plan yet', 'لا توجد خطة بعد')) + '</b>' +
          '<p style="color:var(--muted);font-size:.82rem;margin:0 0 12px;">' +
            esc(t('Generate a personalized workout + diet plan in one tap, or start a new one from the Daily tab.', 'أنشئ خطة تمارين وتغذية مخصصة بضغطة واحدة، أو ابدأ خطة جديدة من تبويب الانضباط اليومي.')) + '</p>' +
          '<button class="btn primary small" onclick="regeneratePlan()"><i class="fa-solid fa-wand-magic-sparkles"></i> ' + esc(t('Generate My Plan', 'أنشئ خطتي')) + '</button>' +
        '</div>';
      return;
    }
    panel.style.display = 'block';
    let html = '';
    const w = u.plan.workout || {};
    const sched = Array.isArray(w.schedule) ? w.schedule : [];
    if (sched.length) {
      const split = w.splitType || 'Custom';
      const days = w.daysPerWeek || sched.length;
      const mins = w.sessionMinutes || 30;
      html += '<div class="plan-week-grid">';
      html += '<div class="plan-split-card">' +
        '<div class="plan-split-head ph-workout">' +
          '<span class="plan-split-title"><i class="fa-solid fa-dumbbell"></i> ' + esc(t('WORKOUT PLAN', 'خطة التمارين')) + '</span>' +
          '<div class="plan-split-stats">' +
            '<div class="plan-split-stat"><b>' + esc(splitLabel(split)) + '</b><span>' + t('SPLIT', 'التقسيم') + '</span></div>' +
            '<div class="plan-split-stat"><b>' + days + '</b><span>' + t('DAYS / WK', 'أيام / أسبوع') + '</span></div>' +
            '<div class="plan-split-stat"><b>' + mins + 'm</b><span>' + t('PER SESSION', 'لكل جلسة') + '</span></div>' +
          '</div>' +
        '</div>';
      const todayKey = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date().getDay()];
      // Round 11/13/18: resolve + clamp the visible ONE-day window, then
      // render ONLY that day (the rest of the week stays reachable via ‹ ›
      // or the See More popup, which shows the whole week).
      const pageCount = Math.max(1, Math.ceil(sched.length / DASH_PLAN_PAGE_SIZE));
      if (dashPlanPage < 0) {
        let todayIdx = -1;
        for (let di = 0; di < sched.length; di++) {
          if ((sched[di].day || '').slice(0, 3) === todayKey) { todayIdx = di; break; }
        }
        dashPlanPage = (todayIdx >= 0) ? Math.floor(todayIdx / DASH_PLAN_PAGE_SIZE) : 0;
      }
      if (dashPlanPage >= pageCount) dashPlanPage = pageCount - 1;
      if (dashPlanPage < 0) dashPlanPage = 0;
      const pageStart = dashPlanPage * DASH_PLAN_PAGE_SIZE;
      const pageDays = sched.slice(pageStart, pageStart + DASH_PLAN_PAGE_SIZE);
      if (pageCount > 1) {
        // Round 18: counter reads exactly "1 of 7", "2 of 7", … (one day per page).
        const rangeTxt = (pageStart + 1) + ' ' + t('of', 'من') + ' ' + sched.length;
        html += '<div class="plan-pager" style="display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:2px 2px 6px;">' +
          '<span style="font-size:.68rem;font-weight:700;color:var(--muted);letter-spacing:.02em;">' + esc(rangeTxt) + '</span>' +
          '<button type="button" onclick="dashPlanPrevPage()" aria-label="Previous day"' + (dashPlanPage > 0 ? '' : ' disabled') + ' style="width:26px;height:26px;border:none;border-radius:8px;background:var(--accent-soft);color:var(--accent);font-size:.7rem;cursor:pointer;display:flex;align-items:center;justify-content:center;' + (dashPlanPage > 0 ? '' : 'opacity:.35;cursor:default;') + '"><i class="fa-solid fa-chevron-left"></i></button>' +
          '<button type="button" onclick="dashPlanNextPage()" aria-label="Next day"' + (dashPlanPage < pageCount - 1 ? '' : ' disabled') + ' style="width:26px;height:26px;border:none;border-radius:8px;background:var(--accent-soft);color:var(--accent);font-size:.7rem;cursor:pointer;display:flex;align-items:center;justify-content:center;' + (dashPlanPage < pageCount - 1 ? '' : 'opacity:.35;cursor:default;') + '"><i class="fa-solid fa-chevron-right"></i></button>' +
        '</div>';
      }
      pageDays.forEach(function (day, i) {
        const exercises = (day.exercises || []);
        const isToday = (day.day || '').slice(0, 3) === todayKey;
        html += '<div class="plan-day-row" style="animation-delay:' + (i * 0.06) + 's">';
        html += '<div class="plan-day-head">' +
          '<span class="plan-day-name"><i class="fa-regular fa-calendar" style="color:var(--accent);font-size:.78rem;"></i> ' + esc(dayLabel(day.day || '')) + '</span>' +
          (isToday ? '<span class="plan-focus-chip" style="background:var(--accent);color:#fff;">' + esc(t('Today', 'اليوم')) + '</span>' : '') +
          (day.focus ? '<span class="plan-focus-chip">' + esc(focusLabel(day.focus)) + '</span>' : '') +
          (exercises.length ? '<span class="plan-day-kcal">' + exercises.length + ' ' + t('exercises', 'تمارين') + '</span>' : '') +
        '</div>';
        if (exercises.length) {
          html += '<div class="plan-ex-grid">';
          exercises.forEach(function (ex) {
            const reps = ex.sets ? (ex.sets + '×' + (ex.reps || '10')) : (ex.reps || '');
            html += '<span class="plan-ex-chip"><i class="fa-solid fa-dumbbell"></i>' + esc(workoutNameDisplay(ex.name)) +
              (reps ? ' <small style="color:var(--muted);font-weight:700;">' + esc(reps) + '</small>' : '') + '</span>';
          });
          html += '</div>';
        }
        if (day.cardio && (day.cardio.type || day.cardio.duration)) {
          html += '<span class="plan-hiitt-note plan-hiit-note"><i class="fa-solid fa-heart-pulse"></i>' +
            esc((day.cardio.type || 'Cardio') + (day.cardio.duration ? ' · ' + day.cardio.duration + 'm' : '') +
            (day.cardio.intensity ? ' · ' + day.cardio.intensity : '')) + '</span>';
        }
        html += '</div>';
      });
      // Round 12 (amended R13): "See More" — opens the full-plan popup
      // (plan-view-modal) with EVERY training day of the week. Per user
      // request the popup is WORKOUT-ONLY: no diet section, no Train button.
      html += '<button type="button" class="btn ghost small dash-plan-see-more" style="width:100%;margin-top:12px;justify-content:center;" onclick="openPlanViewPopup()"><i class="fa-solid fa-eye"></i> ' + esc(t('See More', 'عرض الكل')) + '</button>';
      html += '</div>';
    }
    const d = u.plan.diet || {};
    if (d.dailyCalories || (d.mealSchedule && d.mealSchedule.length)) {
      const m = d.macros || {};
      html += '<div class="plan-split-card">' +
        '<div class="plan-split-head ph-diet">' +
          '<span class="plan-split-title"><i class="fa-solid fa-utensils"></i> ' + esc(t('DIET PLAN', 'خطة التغذية')) + '</span>' +
          '<div class="plan-split-stats">' +
            '<div class="plan-split-stat"><b>' + (d.dailyCalories || '--') + '</b><span>' + t('KCAL / DAY', 'سعرة / يوم') + '</span></div>' +
            '<div class="plan-split-stat"><b>' + (m.p != null ? m.p : '--') + 'g</b><span>' + t('PROTEIN', 'بروتين') + '</span></div>' +
            '<div class="plan-split-stat"><b>' + (m.c != null ? m.c : '--') + 'g</b><span>' + t('CARBS', 'كارب') + '</span></div>' +
            '<div class="plan-split-stat"><b>' + (m.f != null ? m.f : '--') + 'g</b><span>' + t('FAT', 'دهون') + '</span></div>' +
          '</div>' +
        '</div>';
      (d.mealSchedule || []).forEach(function (meal, i) {
        html += '<div class="plan-meal-row" style="animation-delay:' + (i * 0.05) + 's">';
        html += '<div class="plan-meal-head">' +
          '<span class="plan-meal-name"><i class="fa-solid fa-bowl-food" style="color:var(--accent);font-size:.78rem;"></i> ' + esc(mealLabel(meal.type)) + '</span>' +
          (meal.targetCalories ? '<span class="plan-meal-kcal">' + meal.targetCalories + ' ' + t('KCAL', 'سعرة') + '</span>' : '') +
        '</div>';
        let sug = null;
        if (typeof window.suggestionsForSlot === 'function') {
          // Round 10: meals follow the AI-Generated Meals engine — today's
          // AI meals of this slot's type first, personalized pool backfill.
          try { sug = window.suggestionsForSlot(meal.type, meal.targetCalories, 3); } catch (e) { sug = null; }
        }
        if (!sug || !sug.length) sug = (meal.suggestions && meal.suggestions.length) ? meal.suggestions : null;
        if (!sug && typeof window.pickMealsForType === 'function') {
          // Round 9: synchronous fallback — the dashboard diet card never shows blank meal rows.
          sug = window.pickMealsForType(meal.type, meal.targetCalories);
        }
        if (sug && sug.length) {
          html += '<div class="plan-food-grid">';
          sug.forEach(function (s) { html += '<span class="plan-food-chip"><i class="fa-solid fa-check"></i>' + esc(typeof s === 'string' ? s : (s.name || '')) + '</span>'; });
          html += '</div>';
        }
        html += '</div>';
      });
      if (d.hydrationLiters) {
        html += '<span class="plan-water-note"><i class="fa-solid fa-droplet"></i>' +
          (ar() ? ('الهدف اليومي من الماء: ' + d.hydrationLiters + ' لتر') : (d.hydrationLiters + 'L WATER / DAY')) + '</span>';
      }
      html += '</div>';
    }
    if (!html) { panel.style.display = 'none'; return; }
    content.innerHTML = html;
  }

  // Public API (extended as sections are defined below)
  var API = {
    esc: esc, t: t, ar: ar, U: U, save: save, todayStr: todayStr, toast: toast,
    getUnits: getUnits, setUnits: setUnits, fmtWeight: fmtWeight, weightUnit: weightUnit,
    weightInputToKg: weightInputToKg, kgToDisplay: kgToDisplay, fmtHeight: fmtHeight,
    renderDashboardPlan: renderDashboardPlan
  };

  // ────────────────────────────────────────────────────────────
  // 3) STREAKS & PROGRESS TAB
  // ────────────────────────────────────────────────────────────
  function sessionsAll() { const u = U(); return (u && u.sessions) || []; }

  function computeStreakStats() {
    const u = U() || {};
    const sessions = sessionsAll();
    let totalKcal = 0, totalMin = 0;
    sessions.forEach(function (s) { totalKcal += kcalForSessionSafe(s); totalMin += (Number(s.duration) || 0); });
    // best streak: derive from consecutive training days over all history
    const daySet = {};
    sessions.forEach(function (s) { if (s.date) daySet[s.date] = 1; });
    const days = Object.keys(daySet).sort();
    let best = 0, run = 0, prev = null;
    days.forEach(function (dstr) {
      if (prev !== null) {
        const diff = Math.round((new Date(dstr + 'T00:00:00') - new Date(prev + 'T00:00:00')) / 86400000);
        run = (diff === 1) ? run + 1 : 1;
      } else run = 1;
      if (run > best) best = run;
      prev = dstr;
    });
    return {
      streak: u.streak || 0,
      best: Math.max(best, u.streak || 0, u.streakBest || 0),
      total: sessions.length,
      totalMin: totalMin,
      totalKcal: Math.round(totalKcal)
    };
  }

  // ---------- Weekly Report Card ----------
  var REPORT_AR = {
    grade: ['Report Card', 'بطاقة التقرير'],
    training: ['Training', 'التدريب'], consistency: ['Consistency', 'الانتظام'],
    nutrition: ['Nutrition', 'التغذية'], progress: ['Progress', 'التقدم'],
    noteGreat: ['Excellent week! Keep this rhythm going.', 'أداء ممتاز هذا الأسبوع! حافظ على هذا الإيقاع.'],
    noteGood: ['Good week! One extra small session each day will raise your grade.', 'أسبوع جيد! خطوة صغيرة إضافية كل يوم سترفع تقييمك.'],
    noteFair: ['A good start — aim for one more session this week.', 'بداية جيدة — استهدف جلسة إضافية هذا الأسبوع.'],
    noteLow: ['Next week is a fresh start! Begin with a short session today.', 'الأسبوع القادم فرصة جديدة! ابدأ بجلسة قصيرة اليوم.'],
    noData: ['Not enough data this week yet. Complete your workouts to fill the report.', 'لا توجد بيانات كافية هذا الأسبوع بعد. أكمل تمارينك ليظهر التقرير.']
  };
  function gradeFor(pct) {
    if (pct >= 95) return 'A+'; if (pct >= 85) return 'A'; if (pct >= 70) return 'B';
    if (pct >= 55) return 'C'; if (pct >= 40) return 'D'; return 'F';
  }
  function gradeColor(g) {
    if (g === 'A+' || g === 'A') return 'var(--green)';
    if (g === 'B') return 'var(--accent-dark)';
    if (g === 'C') return 'var(--amber)';
    return 'var(--red)';
  }
  function computeWeeklyReport() {
    const u = U() || {};
    const sessions = sessionsAll();
    const now = new Date();
    const dow = now.getDay() === 0 ? 6 : now.getDay() - 1; // Monday = 0
    const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
    let weekMin = 0; const daySet = {};
    const daysLogs = {};
    sessions.forEach(function (s) {
      if (!s.date) return;
      const d = new Date(s.date + 'T00:00:00');
      const diff = Math.round((d - startOfWeek) / 86400000);
      if (diff >= 0 && diff < 7) {
        weekMin += (Number(s.duration) || 0);
        daySet[s.date] = 1;
      }
    });
    // nutrition: days this week with logged meals
    try {
      const log = (typeof getDietLog === 'function') ? getDietLog() : [];
      log.forEach(function (x) { const d = (x.date || (x.loggedAt || '').slice(0, 10)); if (d) daysLogs[d] = 1; });
    } catch (e) {}
    let loggedDays = 0;
    Object.keys(daysLogs).forEach(function (d) {
      const diff = Math.round((new Date(d + 'T00:00:00') - startOfWeek) / 86400000);
      if (diff >= 0 && diff < 7) loggedDays++;
    });
    const daysTarget = (u.plan && u.plan.workout && u.plan.workout.daysPerWeek) || 5;
    const trainedDays = Object.keys(daySet).length;
    const dailyGoal = Math.max(1, Math.round((typeof getDailyGoalMinutes === 'function' ? getDailyGoalMinutes() : 30) / 2));
    const minTarget = dailyGoal * daysTarget;
    // subject percentages
    const pTrain = Math.min(100, Math.round((weekMin / Math.max(1, minTarget)) * 100));
    const pCons = Math.min(100, Math.round((trainedDays / Math.max(1, daysTarget)) * 100));
    const pNut = Math.min(100, Math.round((loggedDays / 7) * 100));
    // progress: weight movement toward goal this week
    let pProg = 0;
    const wl = (u.weightLog || []);
    if (u.goalPlan && wl.length >= 2) {
      const start = parseFloat(u.goalPlan.startWeight), target = parseFloat(u.goalPlan.targetWeight);
      const first = wl[0].kg, last = wl[wl.length - 1].kg;
      if (!isNaN(start) && !isNaN(target) && start !== target) {
        const total = Math.abs(start - target);
        const done = Math.abs(first - last);
        pProg = Math.max(0, Math.min(100, Math.round((done / total) * 100)));
      }
    } else if (trainedDays >= Math.max(1, Math.ceil(daysTarget * 0.6))) pProg = 75;
    const overall = Math.round(pTrain * 0.35 + pCons * 0.3 + pNut * 0.2 + pProg * 0.15);
    return {
      weekMin: weekMin, trainedDays: trainedDays, daysTarget: daysTarget,
      pTrain: pTrain, pCons: pCons, pNut: pNut, pProg: pProg,
      overall: overall, grade: gradeFor(overall)
    };
  }
  function renderWeeklyReport() {
    const body = document.getElementById('weekly-report-body');
    if (!body) return;
    const rep = computeWeeklyReport();
    const R = REPORT_AR;
    const pct = rep.overall;
    const note = pct >= 85 ? R.noteGreat : pct >= 70 ? R.noteGood : pct >= 40 ? R.noteFair : R.noteLow;
    const hasData = rep.weekMin > 0 || rep.trainedDays > 0;
    body.innerHTML =
      '<div class="report-card-wrap">' +
        '<div class="report-grade-box">' +
          '<div class="report-grade-circle" style="--grade-pct:' + pct * 3.6 + 'deg;background:conic-gradient(' + gradeColor(rep.grade) + ' ' + (pct * 3.6) + 'deg, var(--line) 0deg);">' +
            '<b style="color:' + gradeColor(rep.grade) + ';font-size:2.6rem;">' + rep.grade + '</b>' +
          '</div>' +
          '<span class="report-grade-label">' + esc(t(R.grade[0] + ' · ' + pct + '%', R.grade[1] + ' · ' + pct + '%')) + '</span>' +
        '</div>' +
        '<div class="report-subjects">' +
          reportSubject(t(R.training[0], R.training[1]), t(rep.weekMin + ' min this week', rep.weekMin + ' دقيقة هذا الأسبوع'), rep.pTrain) +
          reportSubject(t(R.consistency[0], R.consistency[1]), t(Math.min(rep.trainedDays, rep.daysTarget) + '/' + rep.daysTarget + ' days', Math.min(rep.trainedDays, rep.daysTarget) + '/' + rep.daysTarget + ' أيام'), rep.pCons) +
          reportSubject(t(R.nutrition[0], R.nutrition[1]), t('meals logged', 'وجبات مسجلة'), rep.pNut) +
          reportSubject(t(R.progress[0], R.progress[1]), t('goal progress', 'تقدم الهدف'), rep.pProg) +
        '</div>' +
      '</div>' +
      '<div class="report-note"><i class="fa-solid fa-lightbulb"></i> ' + esc(t(hasData ? note[0] : R.noData[0], hasData ? note[1] : R.noData[1])) + '</div>';
  }
  function reportSubject(name, sub, pct) {
    return '<div class="report-subject">' +
      '<div class="report-subject-head"><span>' + esc(name) + ' <small style="color:var(--muted);font-weight:600;">· ' + esc(sub) + '</small></span><b>' + pct + '%</b></div>' +
      '<div class="report-subject-bar"><div class="report-subject-fill" style="width:' + pct + '%;"></div></div>' +
    '</div>';
  }

  // ---------- Activity heatmap (MONTHLY view with prev/next navigation) ----------
  // Per user request the heatmap shows ONE month at a time; the ‹ › buttons
  // move between months (never into the future). heatOffset 0 = current month.
  var heatOffset = 0;
  var HM_MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var HM_MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  function heatNavMonth(dir) {
    var now = new Date();
    var target = new Date(now.getFullYear(), now.getMonth() + heatOffset + dir, 1);
    // Never navigate past the current month, never before year 2000.
    var isFuture = target.getFullYear() > now.getFullYear() ||
      (target.getFullYear() === now.getFullYear() && target.getMonth() > now.getMonth());
    if (isFuture || target.getFullYear() < 2000) return;
    heatOffset += dir;
    renderHeatmap();
    // Re-check the chart render guards so the label updates even if grid is hidden
    try { if (typeof renderStreaksTab === 'function' && document.getElementById('streak-heatmap') && document.getElementById('streak-heatmap').isConnected === false) renderStreaksTab(); } catch (e) {}
  }
  function renderHeatmap() {
    const el = document.getElementById('streak-heatmap');
    if (!el) return;
    const sessions = sessionsAll();
    const byDate = {};
    sessions.forEach(function (s) {
      if (!s.date) return;
      byDate[s.date] = (byDate[s.date] || 0) + (Number(s.duration) || 0);
    });
    const today = new Date(); today.setHours(0, 0, 0, 0);
    // Month being viewed (offset from the current month, 0 = this month)
    const view = new Date(today.getFullYear(), today.getMonth() + heatOffset, 1);
    // Month label — localized
    const labelEl = document.getElementById('hm-month-label');
    if (labelEl) {
      labelEl.textContent = ar()
        ? (HM_MONTHS_AR[view.getMonth()] + ' ' + view.getFullYear())
        : (HM_MONTHS_EN[view.getMonth()] + ' ' + view.getFullYear());
    }
    // Disable the next button on the current month (nothing newer to see)
    var nextBtn = document.getElementById('hm-next-btn');
    if (nextBtn) nextBtn.disabled = (heatOffset >= 0);
    var prevBtn = document.getElementById('hm-prev-btn');
    if (prevBtn) prevBtn.disabled = false;
    // Grid spans full weeks: from the Monday on/before the 1st to the Sunday
    // on/after the last day (Monday-first, same as the old 17-week grid).
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const last = new Date(view.getFullYear(), view.getMonth() + 1, 0);
    const startDow = first.getDay() === 0 ? 6 : first.getDay() - 1;
    const endDow = last.getDay() === 0 ? 6 : last.getDay() - 1;
    const gridStart = new Date(first.getFullYear(), first.getMonth(), 1 - startDow);
    const gridEnd = new Date(last.getFullYear(), last.getMonth(), last.getDate() + (6 - endDow));
    const DAYS = Math.round((gridEnd - gridStart) / 86400000) + 1;
    let html = '';
    for (let i = 0; i < DAYS; i++) {
      const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      const mins = byDate[key] || 0;
      let lvl = 0;
      if (mins > 0) lvl = 1;
      if (mins >= 15) lvl = 2;
      if (mins >= 30) lvl = 3;
      if (mins >= 45) lvl = 4;
      const isToday = key === todayStr();
      const inMonth = d.getMonth() === view.getMonth();
      const delay = Math.min(0.4, i * 0.006);
      html += '<span class="hm-cell hm' + lvl + (isToday ? ' hm-today' : '') + (inMonth ? '' : ' hm-out') + '" style="animation-delay:' + delay + 's" title="' + key + ' · ' + mins + ' min"></span>';
    }
    el.innerHTML = html;
  }

  // ---------- Weekly volume chart (last 8 weeks) ----------
  var volumeChart = null;
  function renderVolumeChart() {
    const canvas = document.getElementById('volumeChart');
    if (!canvas || typeof Chart === 'undefined') return;
    const sessions = sessionsAll();
    const now = new Date();
    const dow = now.getDay() === 0 ? 6 : now.getDay() - 1;
    const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
    const labels = [], data = [], volumeRanges = [];
    for (let w = 7; w >= 0; w--) {
      const start = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - w * 7);
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
      let mins = 0;
      sessions.forEach(function (s) {
        if (!s.date) return;
        const d = new Date(s.date + 'T00:00:00');
        if (d >= start && d < end) mins += (Number(s.duration) || 0);
      });
      // Short tick label ('W1'…'W8') so 8 bars never overlap on narrow
      // screens — the full date range lives in the tooltip title instead.
      volumeRanges.push((start.getMonth() + 1) + '/' + start.getDate() + ' – ' + (end.getMonth() + 1) + '/' + end.getDate());
      labels.push(t('W' + (8 - w), 'أ' + (8 - w)));
      data.push(mins);
    }
    if (volumeChart) volumeChart.destroy();
    const font = { family: ar() ? 'Cairo' : 'Barlow', size: 12, weight: 600 };
    volumeChart = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: { labels: labels, datasets: [{ data: data, backgroundColor: data.map(function (m, i) { return i === 7 ? '#4a7bd9' : 'rgba(100,149,237,.6)'; }), borderRadius: 8, borderSkipped: false, maxBarThickness: 38, label: t('Minutes', 'دقائق') }] },
      options: {
        // Round 15 (responsive fix): height comes from the .v-chart-box
        // wrapper (clamp 180–250px) — correct proportions on every device.
        maintainAspectRatio: false,
        resizeDelay: 120,
        plugins: { legend: { display: false }, tooltip: { titleFont: font, bodyFont: font, callbacks: { title: function (items) { return volumeRanges[items[0].dataIndex] || items[0].label; }, label: function (c) { return ' ' + c.parsed.y + ' ' + t('min', 'دقيقة'); } } } },
        scales: {
          y: { beginAtZero: true, grid: { color: 'rgba(100,149,237,.12)', drawBorder: false }, ticks: { color: '#55627e', font: font, precision: 0 } },
          x: { grid: { display: false }, ticks: { color: '#55627e', font: font, maxRotation: 0, autoSkip: false, autoSkipPadding: 8 } }
        },
        animation: { duration: 900, easing: 'easeOutQuart' }
      }
    });
    // Round 15: re-measure after the tab-entrance cascade settles (a
    // mid-animation bounding-rect measure locks the canvas at ~98% size),
    // only when the panel is really visible.
    setTimeout(function () {
      try {
        var cv = document.getElementById('volumeChart');
        if (volumeChart && cv && cv.offsetParent !== null) volumeChart.resize();
      } catch (e) {}
    }, 620);
  }

  // ---------- Weight log + trend chart — REMOVED per user request ----------
  // The Weight Trend panel no longer exists in the Streaks tab. Body weight is
  // now collected by the weekly check-in survey (showWeeklyProgressSurvey),
  // which saves it to u.profile.weight + u.weeklySurveyHistory.

  // ---------- Workout history ----------
  var INTENSITY_AR = { 'Light': 'خفيف', 'Moderate': 'معتدل', 'Intense': 'شديد', 'Extreme': 'شديد جداً' };
  function intensityLabel(v) {
    if (!v) return '';
    return ar() ? (INTENSITY_AR[v] || v) : v;
  }
  var SPORT_ICONS = {
    'Daily Exercise': 'fa-dumbbell', 'Running': 'fa-person-running', 'Cycling': 'fa-person-biking',
    'Swimming': 'fa-person-swimming', 'Walking': 'fa-person-walking', 'Yoga': 'fa-spa',
    'Boxing': 'fa-hand-fist', 'Football': 'fa-futbol', 'Basketball': 'fa-basketball',
    'HIIT': 'fa-bolt', 'Marathon': 'fa-person-running', 'Gym Workout': 'fa-dumbbell'
  };
  function sportIcon(sport) { return SPORT_ICONS[sport] || 'fa-medal'; }
  function renderHistory() {
    const el = document.getElementById('history-list');
    if (!el) return;
    const sessions = sessionsAll().slice().sort(function (a, b) { return (a.date < b.date ? 1 : -1); }).slice(0, 60);
    if (!sessions.length) {
      el.innerHTML = '<div class="history-empty"><i class="fa-solid fa-clock-rotate-left"></i> ' +
        t('No workouts logged yet. Complete a workout to start your history!', 'لا توجد تمارين مسجلة بعد. أكمل تمرينك الأول لتبدأ السجل!') + '</div>';
      return;
    }
    const groups = {};
    sessions.forEach(function (s) { (groups[s.date] = groups[s.date] || []).push(s); });
    let html = '';
    Object.keys(groups).sort().reverse().forEach(function (date) {
      let label = date;
      try {
        const d = new Date(date + 'T00:00:00');
        label = d.toLocaleDateString(ar() ? 'ar-EG' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
      } catch (e) {}
      html += '<div class="history-day-group"><div class="history-day-head">' + esc(label) + '</div>';
      groups[date].forEach(function (s, i) {
        const kcal = Math.round(kcalForSessionSafe(s));
        const sportName = (typeof getSportName === 'function') ? getSportName(s.sport) : s.sport;
        // Round 18: session notes are now prominent — the note-only logger
        // saves them, so give them a clearly visible line with an icon.
        const noteLine = s.note
          ? '<small class="history-note"><i class="fa-solid fa-note-sticky"></i> ' + esc(s.note) + '</small>'
          : '<small></small>';
        html += '<div class="history-row" style="animation-delay:' + (i * 0.04) + 's">' +
          '<span class="history-ico"><i class="fa-solid ' + sportIcon(s.sport) + '"></i></span>' +
          '<div class="history-main"><b>' + esc(sportName || s.sport) + '</b>' +
          noteLine + '</div>' +
          '<div class="history-nums">' +
            '<span class="history-pill"><i class="fa-regular fa-clock"></i> ' + (Number(s.duration) || 0) + ' ' + t('min', 'د') + '</span>' +
            (kcal ? '<span class="history-pill hp-kcal"><i class="fa-solid fa-fire"></i> ' + kcal + ' ' + t('kcal', 'سعرة') + '</span>' : '') +
            (s.intensity ? '<span class="history-pill hp-int">' + esc(intensityLabel(s.intensity)) + '</span>' : '') +
          '</div></div>';
      });
      html += '</div>';
    });
    el.innerHTML = html;
  }

  // ---------- Badges & Achievements ----------
  var BADGES = [
    { id: 'first', icon: 'fa-shoe-prints', name: ['First Steps', 'الخطوات الأولى'], desc: ['Complete your first workout', 'أكمل أول تمرين'], test: function (s) { return s.total >= 1; }, prog: function (s) { return [Math.min(1, s.total), 1]; } },
    { id: 'w10', icon: 'fa-dumbbell', name: ['Getting Serious', 'جدي وبجدية'], desc: ['10 workouts completed', '10 تمارين مكتملة'], test: function (s) { return s.total >= 10; }, prog: function (s) { return [s.total, 10]; } },
    { id: 'w50', icon: 'fa-dumbbell', name: ['Iron Habit', 'عادة حديدية'], desc: ['50 workouts completed', '50 تمريناً مكتملًا'], test: function (s) { return s.total >= 50; }, prog: function (s) { return [s.total, 50]; } },
    { id: 'w100', icon: 'fa-crown', name: ['Centurion', 'المئوي'], desc: ['100 workouts completed', '100 تمرين مكتمل'], test: function (s) { return s.total >= 100; }, prog: function (s) { return [s.total, 100]; } },
    { id: 's3', icon: 'fa-fire', name: ['On Fire', 'مشتعل'], desc: ['3-day streak', 'سلسلة 3 أيام'], test: function (s) { return s.streak >= 3; }, prog: function (s) { return [s.streak, 3]; } },
    { id: 's7', icon: 'fa-fire-flame-curved', name: ['Week Warrior', 'محارب الأسبوع'], desc: ['7-day streak', 'سلسلة 7 أيام'], test: function (s) { return s.streak >= 7; }, prog: function (s) { return [s.streak, 7]; } },
    { id: 's30', icon: 'fa-mountain', name: ['Unstoppable', 'لا يُوقف'], desc: ['30-day streak', 'سلسلة 30 يوماً'], test: function (s) { return s.streak >= 30; }, prog: function (s) { return [s.streak, 30]; } },
    { id: 'm500', icon: 'fa-hourglass-half', name: ['Time Investor', 'مستثمر الوقت'], desc: ['500 total minutes', '500 دقيقة إجمالية'], test: function (s) { return s.totalMin >= 500; }, prog: function (s) { return [s.totalMin, 500]; } },
    { id: 'k5000', icon: 'fa-bomb', name: ['Furnace', 'فرن السعرات'], desc: ['Burn 5,000 kcal', 'احرق 5000 سعرة'], test: function (s) { return s.totalKcal >= 5000; }, prog: function (s) { return [s.totalKcal, 5000]; } },
    { id: 'goal', icon: 'fa-bullseye', name: ['Goal Getter', 'صائد الأهداف'], desc: ['Set a weight goal', 'حدد هدف وزن'], test: function (s, u) { return !!(u && u.goalPlan && u.goalPlan.targetWeight); }, prog: function (s, u) { return [u && u.goalPlan && u.goalPlan.targetWeight ? 1 : 0, 1]; } },
    { id: 'goaldone', icon: 'fa-trophy', name: ['Target Down', 'الهدف تحقق'], desc: ['Reach your weight goal', 'حقق هدف الوزن'], test: function (s, u) { if (!u || !u.goalPlan) return false; const a = parseFloat(u.goalPlan.startWeight), b = parseFloat(u.goalPlan.targetWeight), c = u.profile && u.profile.weight; if (isNaN(a) || isNaN(b) || !c) return false; return a > b ? c <= b : c >= b; }, prog: function (s, u) { if (!u || !u.goalPlan) return [0, 1]; const a = parseFloat(u.goalPlan.startWeight), b = parseFloat(u.goalPlan.targetWeight), c = u.profile && u.profile.weight; if (isNaN(a) || isNaN(b) || !c || a === b) return [0, 1]; const p = a > b ? (a - c) / (a - b) : (c - a) / (b - a); return [Math.max(0, Math.min(1, p)), 1]; } },
    { id: 'scale', icon: 'fa-weight-scale', name: ['Scale Master', 'سيد الميزان'], desc: ['Log weight 5 times', 'سجل وزنك 5 مرات'], test: function (s, u) { return ((u && u.weightLog) || []).length >= 5; }, prog: function (s, u) { return [((u && u.weightLog) || []).length, 5]; } },
    { id: 'nutri', icon: 'fa-carrot', name: ['Nutrition Ninja', 'نينجا التغذية'], desc: ['Log 20 meals', 'سجل 20 وجبة'], test: function (s, u) { return dietCount(u) >= 20; }, prog: function (s, u) { return [dietCount(u), 20]; } },
    { id: 'w50', icon: 'fa-dumbbell', name: ['Workout Machine', 'آلة التمرين'], desc: ['Complete 50 workouts', 'أكمل 50 تمريناً'], test: function (s, u) { return ((u && u.sessions) || []).length >= 50; }, prog: function (s, u) { return [((u && u.sessions) || []).length, 50]; } },
    { id: 'builder', icon: 'fa-hammer', name: ['Architect', 'المهندس'], desc: ['Create a custom workout', 'أنشئ تمريناً مخصصاً'], test: function (s, u) { return ((u && u.customWorkouts) || []).length >= 1; }, prog: function (s, u) { return [((u && u.customWorkouts) || []).length, 1]; } },
    { id: 'marathon', icon: 'fa-person-running', name: ['Endurance', 'التحمل'], desc: ['Log a run or marathon', 'سجل جلسة جري'], test: function (s, u) { return (u && u.sessions || []).some(function (x) { return /run|marathon/i.test(x.sport || ''); }); }, prog: function (s, u) { return [(u && u.sessions || []).some(function (x) { return /run|marathon/i.test(x.sport || ''); }) ? 1 : 0, 1]; } },
    { id: 'week', icon: 'fa-calendar-check', name: ['Perfect Week', 'أسبوع مثالي'], desc: ['Train 7 days in a row this week', 'تمرّن 7 أيام هذا الأسبوع'], test: function (s) { return weekTrainedDaysLocal() >= 7; }, prog: function (s) { return [weekTrainedDaysLocal(), 7]; } },
    { id: 'honor', icon: 'fa-award', name: ['Honor Roll', 'لوحة الشرف'], desc: ['Earn a weekly grade A', 'احصل على تقدير A الأسبوعي'], test: function (s, u) { return computeWeeklyReport().overall >= 85; }, prog: function (s, u) { return [computeWeeklyReport().overall >= 85 ? 1 : 0, 1]; } }
  ];
  function dietCount(u) {
    try { return ((typeof getDietLog === 'function') ? getDietLog() : []).length; } catch (e) { return 0; }
  }
  function weekTrainedDaysLocal() {
    try { if (typeof getWeekTrainedDays === 'function') return getWeekTrainedDays(); } catch (e) {}
    return 0;
  }
  function renderBadges() {
    const grid = document.getElementById('badges-grid');
    const prog = document.getElementById('badges-progress');
    if (!grid) return;
    const stats = computeStreakStats();
    const u = U() || {};
    let unlockedCount = 0;
    let html = '';
    BADGES.forEach(function (b, i) {
      const unlocked = !!b.test(stats, u);
      if (unlocked) unlockedCount++;
      const pr = b.prog(stats, u) || [0, 1];
      const pct = Math.max(0, Math.min(100, Math.round((pr[0] / Math.max(1, pr[1])) * 100)));
      html += '<div class="badge-tile ' + (unlocked ? 'unlocked' : 'locked') + '" style="animation-delay:' + (i * 0.04) + 's">' +
        (unlocked ? '<span class="badge-check"><i class="fa-solid fa-check"></i></span>' : '') +
        '<span class="badge-tile-icon"><i class="fa-solid ' + b.icon + '"></i></span>' +
        '<div class="badge-tile-name">' + esc(t(b.name[0], b.name[1])) + '</div>' +
        '<div class="badge-tile-desc">' + esc(t(b.desc[0], b.desc[1])) + '</div>' +
        (unlocked ? '' : '<div class="badge-tile-bar"><i style="width:' + pct + '%;"></i></div>') +
      '</div>';
    });
    grid.innerHTML = html;
    if (prog) {
      const total = BADGES.length;
      const pct = Math.round((unlockedCount / total) * 100);
      prog.innerHTML = '<i class="fa-solid fa-medal" style="color:var(--accent-dark);"></i> ' +
        '<b>' + unlockedCount + '</b> / ' + total + ' ' + t('badges earned', 'شارة مكتسبة') +
        '<div class="badge-total-bar"><div class="badge-total-fill" style="width:' + pct + '%;"></div></div>';
    }
  }

  // ---------- Tab entry ----------
  function renderStreaksTab() {
    const stats = computeStreakStats();
    const set = function (id, v) { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('sk-streak', stats.streak);
    set('sk-best', stats.best);
    animateTxt('sk-total', stats.total);
    animateTxt('sk-mins', stats.totalMin);
    renderWeeklyReport();
    renderHeatmap();
    renderVolumeChart();
    // Weight Trend chart removed per user request (weight comes from the
    // weekly check-in survey now) — renderWeightChart is gone.
    renderHistory();
    renderBadges();
    setTimeout(applyTranslationsSafe, 30);
  }
  function animateTxt(id, target) {
    const el = document.getElementById(id);
    if (!el) return;
    try { if (typeof animateCount === 'function') { animateCount(el, target); return; } } catch (e) {}
    el.textContent = target;
  }
  function applyTranslationsSafe() { try { if (typeof applyTranslations === 'function') applyTranslations(); } catch (e) {} }

  // ────────────────────────────────────────────────────────────
  // 4) CUSTOM WORKOUT BUILDER
  // ────────────────────────────────────────────────────────────
  var builderState = { picked: [], muscle: 'All' };
  function getCustomWorkouts() { const u = U() || {}; if (!Array.isArray(u.customWorkouts)) u.customWorkouts = []; return u.customWorkouts; }

  function builderLibraryAll() {
    // Merge WORKOUTS_DB (seed), WORKOUT_DB names and WORKOUT_INFO keys.
    var out = [], seen = {};
    function push(name, muscle) {
      const key = (name || '').toLowerCase();
      if (!name || seen[key]) return;
      seen[key] = 1;
      out.push({ name: name, muscle: muscle || '' });
    }
    try { (typeof WORKOUTS_DB !== 'undefined' ? WORKOUTS_DB : []).forEach(function (w) { push(w.name, w.muscleGroup); }); } catch (e) {}
    try {
      var db = (typeof WORKOUT_DB !== 'undefined') ? WORKOUT_DB : {};
      Object.keys(db).forEach(function (m) { (db[m] || []).forEach(function (n) { push(n, m); }); });
    } catch (e) {}
    try {
      Object.keys(typeof WORKOUT_INFO !== 'undefined' ? WORKOUT_INFO : {}).forEach(function (n) { push(n, (WORKOUT_INFO[n] || {}).muscle || ''); });
    } catch (e) {}
    return out;
  }
  var BUILDER_MUSCLES = ['All', 'Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core', 'Cardio'];
  function openWorkoutBuilder() {
    builderState = { picked: [], muscle: 'All' };
    var nameInput = document.getElementById('builder-wname');
    if (nameInput) nameInput.value = '';
    var search = document.getElementById('builder-search');
    if (search) search.value = '';
    // muscle chips
    var chips = document.getElementById('builder-muscle-chips');
    if (chips) {
      const labels = { All: t('All', 'الكل'), Chest: t('Chest', 'الصدر'), Back: t('Back', 'الظهر'), Legs: t('Legs', 'الرجلين'), Shoulders: t('Shoulders', 'الأكتاف'), Arms: t('Arms', 'الذراعين'), Core: t('Core', 'البطن'), Cardio: t('Cardio', 'كارديو') };
      chips.innerHTML = BUILDER_MUSCLES.map(function (m) {
        return '<button type="button" class="builder-mchip' + (m === 'All' ? ' active' : '') + '" data-muscle="' + m + '" onclick="pickBuilderMuscle(\'' + m + '\')">' + esc(labels[m] || m) + '</button>';
      }).join('');
    }
    renderBuilderLibrary();
    renderBuilderSelected();
    try { openModal('builder-modal'); } catch (e) {}
    setTimeout(applyTranslationsSafe, 30);
  }
  function closeWorkoutBuilder() { try { closeModal('builder-modal'); } catch (e) {} }
  function pickBuilderMuscle(m) {
    builderState.muscle = m;
    document.querySelectorAll('#builder-muscle-chips .builder-mchip').forEach(function (c) {
      c.classList.toggle('active', c.getAttribute('data-muscle') === m);
    });
    renderBuilderLibrary();
  }
  function renderBuilderLibrary() {
    var box = document.getElementById('builder-library');
    if (!box) return;
    var q = (document.getElementById('builder-search') || {}).value || '';
    q = q.trim().toLowerCase();
    var all = builderLibraryAll();
    var filtered = all.filter(function (x) {
      if (builderState.muscle !== 'All') {
        var mus = (x.muscle || '').toLowerCase();
        if (mus.indexOf(builderState.muscle.toLowerCase()) === -1) {
          // loose mapping: Core->core etc.
          return false;
        }
      }
      if (q && x.name.toLowerCase().indexOf(q) === -1) return false;
      return true;
    }).slice(0, 60);
    var pickedKeys = {};
    builderState.picked.forEach(function (p) { pickedKeys[p.name.toLowerCase()] = 1; });
    box.innerHTML = filtered.map(function (x) {
      const picked = pickedKeys[x.name.toLowerCase()];
      return '<button type="button" class="builder-lib-item' + (picked ? ' picked' : '') + '" onclick="toggleBuilderExercise(\'' + esc(x.name).replace(/'/g, '&#39;') + '\', \'' + esc(x.muscle).replace(/'/g, '&#39;') + '\')">' +
        '<span>' + esc(x.name) + '<small>' + esc(x.muscle || '') + '</small></span>' +
        '<span class="bli-plus">' + (picked ? '<i class="fa-solid fa-check"></i>' : '<i class="fa-solid fa-plus"></i>') + '</span>' +
      '</button>';
    }).join('') || ('<div class="history-empty">' + t('No exercises match your search.', 'لا توجد تمارين مطابقة للبحث.') + '</div>');
  }
  function toggleBuilderExercise(name, muscle) {
    var idx = -1;
    for (var i = 0; i < builderState.picked.length; i++) {
      if (builderState.picked[i].name.toLowerCase() === name.toLowerCase()) { idx = i; break; }
    }
    if (idx >= 0) builderState.picked.splice(idx, 1);
    else builderState.picked.push({ name: name, muscle: muscle || '', sets: 3, reps: '10-12' });
    renderBuilderLibrary();
    renderBuilderSelected();
  }
  function renderBuilderSelected() {
    var box = document.getElementById('builder-selected');
    if (!box) return;
    var count = document.getElementById('builder-count');
    if (count) count.textContent = builderState.picked.length;
    box.innerHTML = builderState.picked.map(function (p, i) {
      return '<div class="builder-sel-row">' +
        '<span class="bsr-name">' + esc(p.name) + '</span>' +
        '<label>' + t('SETS', 'مجموعات') + '</label>' +
        '<input type="number" min="1" max="20" value="' + (p.sets || 3) + '" onchange="updateBuilderExercise(' + i + ', \'sets\', this.value)" />' +
        '<label>' + t('REPS', 'عديدات') + '</label>' +
        '<input type="text" value="' + esc(p.reps || '10-12') + '" onchange="updateBuilderExercise(' + i + ', \'reps\', this.value)" />' +
        '<button type="button" class="bsr-btn bsr-up" title="Up" onclick="moveBuilderExercise(' + i + ',-1)"><i class="fa-solid fa-arrow-up"></i></button>' +
        '<button type="button" class="bsr-btn bsr-down" title="Down" onclick="moveBuilderExercise(' + i + ',1)"><i class="fa-solid fa-arrow-down"></i></button>' +
        '<button type="button" class="bsr-btn" title="Remove" onclick="toggleBuilderExercise(\'' + esc(p.name).replace(/'/g, '&#39;') + '\', \'\')"><i class="fa-solid fa-xmark"></i></button>' +
      '</div>';
    }).join('') || ('<div class="history-empty">' + t('Pick exercises from the library above.', 'اختر التمارين من المكتبة أعلاه.') + '</div>');
  }
  function updateBuilderExercise(i, field, val) {
    if (!builderState.picked[i]) return;
    if (field === 'sets') builderState.picked[i].sets = Math.max(1, parseInt(val, 10) || 3);
    else builderState.picked[i].reps = String(val).slice(0, 12);
  }
  function moveBuilderExercise(i, dir) {
    var j = i + dir;
    if (i < 0 || j < 0 || j >= builderState.picked.length) return;
    var tmp = builderState.picked[i];
    builderState.picked[i] = builderState.picked[j];
    builderState.picked[j] = tmp;
    renderBuilderSelected();
  }
  function saveCustomWorkout() {
    var nameInput = document.getElementById('builder-wname');
    var name = ((nameInput && nameInput.value) || '').trim();
    if (!name) { toast(t('Give your workout a name first', 'اختر اسماً لتمرينك أولاً'), 'error'); return; }
    if (!builderState.picked.length) { toast(t('Add at least one exercise', 'أضف تمريناً واحداً على الأقل'), 'error'); return; }
    var u = U(); if (!u) return;
    if (!Array.isArray(u.customWorkouts)) u.customWorkouts = [];
    u.customWorkouts.push({
      id: 'cw_' + Date.now(),
      name: name.slice(0, 40),
      exercises: builderState.picked.map(function (p) { return { name: p.name, muscle: p.muscle, sets: p.sets || 3, reps: p.reps || '10-12' }; }),
      createdAt: Date.now()
    });
    save(u);
    builderState = { picked: [], muscle: builderState.muscle };
    renderBuilderSelected();
    renderCustomWorkoutsList();
    closeWorkoutBuilder();
    toast(t('Custom workout saved!', 'تم حفظ التمرين المخصص!'));
    try { if (typeof VoltaNotifications !== 'undefined' && VoltaNotifications.checkBadgeUnlock) VoltaNotifications.checkBadgeUnlock(); } catch (e) {}
  }
  function deleteCustomWorkout(id) {
    var u = U(); if (!u) return;
    u.customWorkouts = (u.customWorkouts || []).filter(function (w) { return w.id !== id; });
    save(u);
    renderCustomWorkoutsList();
    toast(t('Workout deleted', 'تم حذف التمرين'));
  }
  function applyCustomWorkoutToToday(id) {
    var u = U(); if (!u) return;
    var cw = (u.customWorkouts || []).filter(function (w) { return w.id === id; })[0];
    if (!cw) return;
    // Build (or update) the daily plan so TODAY uses these exercises —
    // the existing completion flow (timers, streaks, kcal) keeps working.
    if (typeof deState === 'undefined') return;
    if (!deState.dailyPlan || !deState.dailyPlan.length) {
      deState.dailyPlan = [{ dayIndex: 0, label: cw.name, workouts: [], completed: false, completedAt: null }];
      deState.muscles = ['Custom'];
      deState.numDays = 1;
      deState.daysOfWeek = [];
      deState.currentDay = 0;
    }
    var day = deState.dailyPlan[deState.currentDay] || deState.dailyPlan[0];
    day.workouts = cw.exercises.map(function (ex) {
      return { name: ex.name, info: (typeof getWorkoutInfo === 'function') ? getWorkoutInfo(ex.name, ex.muscle) : { muscle: ex.muscle }, done: false };
    });
    deState.workouts = day.workouts;
    deState.currentWorkout = 0;
    deState.restUntil = 0;
    deState.restDone = false;
    deState.step = 4;
    deState.initialized = true;
    deState.planChoiceMade = true;
    deState.planSource = 'custom';
    if (typeof saveDailyPlan === 'function') saveDailyPlan();
    if (typeof renderDailyExercise === 'function') renderDailyExercise();
    toast(t('"' + cw.name + '" is today\'s workout!', '"' + cw.name + '" صارت تمرين اليوم!'));
  }
  function quickLogCustomWorkout(id) {
    var u = U(); if (!u) return;
    var cw = (u.customWorkouts || []).filter(function (w) { return w.id === id; })[0];
    if (!cw) return;
    // Round 8: quick-log estimate — 45s of work per set (the old code counted
    // 1 FULL minute per set), calories from each exercise's OWN MET × exact time.
    var totalMin = 0, kcal = 0;
    var weight = (u.profile && u.profile.weight) || 70;
    cw.exercises.forEach(function (ex) {
      var met = 5.0;
      try { met = (typeof WORKOUT_MET !== 'undefined' && WORKOUT_MET[ex.name]) ? WORKOUT_MET[ex.name] : 5.0; } catch (e) {}
      var mins = Math.max(0.3, ((ex.sets || 3) * 45) / 60);
      totalMin += mins;
      kcal += met * weight * (mins / 60);
    });
    totalMin = Math.round(totalMin * 10) / 10;
    u.sessions.push({
      sport: 'Daily Exercise', date: todayStr(), duration: totalMin,
      calories: Math.max(1, Math.round(kcal)), intensity: 'Moderate', note: cw.name + ' (custom)'
    });
    save(u);
    try { if (typeof bumpStreak === 'function') bumpStreak(); } catch (e) {}
    renderCustomWorkoutsList();
    try { renderHome(); } catch (e) {}
    toast(t('Logged ' + cw.name + ' · ' + Math.round(kcal) + ' kcal', 'تم تسجيل ' + cw.name + ' · ' + Math.round(kcal) + ' سعرة'));
  }
  function renderCustomWorkoutsList() {
    var box = document.getElementById('custom-workouts-list');
    if (!box) return;
    var list = getCustomWorkouts();
    // Per user request the Daily tab stays clean — the saved-custom-workouts
    // section only renders when the user actually HAS custom workouts.
    if (!list.length) { box.innerHTML = ''; box.style.display = 'none'; return; }
    box.style.display = '';
    box.innerHTML = list.map(function (cw, i) {
      return '<div class="custom-workout-card" style="animation-delay:' + (i * 0.05) + 's">' +
        '<div class="cwc-main"><b><i class="fa-solid fa-hammer" style="color:var(--accent);margin-inline-end:6px;"></i>' + esc(cw.name) + '</b>' +
        '<small>' + cw.exercises.length + ' ' + t('exercises', 'تمارين') + ' · ' + esc(cw.exercises.slice(0, 3).map(function (e) { return e.name; }).join(', ')) + (cw.exercises.length > 3 ? '…' : '') + '</small></div>' +
        '<div class="cwc-actions">' +
          '<button class="btn primary small" onclick="applyCustomWorkoutToToday(\'' + cw.id + '\')"><i class="fa-solid fa-calendar-day"></i> ' + t('Set as today', 'حدد لليوم') + '</button>' +
          '<button class="btn ghost small" onclick="quickLogCustomWorkout(\'' + cw.id + '\')"><i class="fa-solid fa-bolt"></i> ' + t('Quick log', 'تسجيل سريع') + '</button>' +
          '<button class="btn ghost small" onclick="deleteCustomWorkout(\'' + cw.id + '\')" title="Delete"><i class="fa-solid fa-trash" style="color:var(--red);"></i></button>' +
        '</div></div>';
    }).join('');
    setTimeout(applyTranslationsSafe, 20);
  }

  // ────────────────────────────────────────────────────────────
  // 6) DATA EXPORT / IMPORT (JSON + CSV)
  // ────────────────────────────────────────────────────────────
  function downloadFile(name, content, mime) {
    var blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 400);
  }
  function csvEscape(v) {
    var s = String(v == null ? '' : v);
    if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function exportDataJSON() {
    var u = U();
    if (!u) { toast(t('Log in first', 'سجّل الدخول أولاً'), 'error'); return; }
    var data = {
      app: 'Volta', version: 1, exportedAt: new Date().toISOString(), email: store.session,
      profile: u.profile, survey: u.survey, streak: u.streak, sessions: u.sessions,
      reminders: u.reminders, dailyPlan: u.dailyPlan, goalPlan: u.goalPlan, plan: u.plan,
      customWorkouts: u.customWorkouts, weightLog: u.weightLog,
      weeklySurveyHistory: u.weeklySurveyHistory,
      dietLog: (function () { try { return (typeof getDietLog === 'function') ? getDietLog() : []; } catch (e) { return []; } })(),
      settings: { theme: store.theme, lang: store.lang, units: getUnits(), locationEnabled: store.locationEnabled }
    };
    downloadFile('volta-backup-' + todayStr() + '.json', JSON.stringify(data, null, 2), 'application/json');
    toast(t('Backup downloaded (JSON)', 'تم تنزيل النسخة الاحتياطية (JSON)'));
  }
  function sessionsToCSV(sessions) {
    var rows = [['date', 'sport', 'duration_min', 'calories', 'intensity', 'note']];
    (sessions || []).forEach(function (s) {
      rows.push([s.date, s.sport, s.duration, s.calories != null ? Math.round(kcalForSessionSafe(s)) : '', s.intensity || '', s.note || '']);
    });
    return rows.map(function (r) { return r.map(csvEscape).join(','); }).join('\n');
  }
  function exportDataCSV() {
    var u = U();
    if (!u) { toast(t('Log in first', 'سجّل الدخول أولاً'), 'error'); return; }
    downloadFile('volta-sessions-' + todayStr() + '.csv', sessionsToCSV(u.sessions), 'text/csv');
    setTimeout(function () {
      var log = [];
      try { log = (typeof getDietLog === 'function') ? getDietLog() : []; } catch (e) {}
      var rows = [['date', 'name', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'serving', 'mealType']];
      log.forEach(function (x) {
        rows.push([x.date || (x.loggedAt || '').slice(0, 10), x.name, x.kcal, x.protein || '', x.carbs || '', x.fat || '', x.serving || '', x.mealType || '']);
      });
      downloadFile('volta-dietlog-' + todayStr() + '.csv', rows.map(function (r) { return r.map(csvEscape).join(','); }).join('\n'), 'text/csv');
    }, 500);
    toast(t('CSV exports downloaded (sessions + diet log)', 'تم تنزيل ملفات CSV (الجلسات + سجل الوجبات)'));
  }
  function importDataFile(input) {
    var file = input && input.files && input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var text = String(reader.result || '');
      try {
        if (file.name.toLowerCase().endsWith('.json') || text.trim().charAt(0) === '{') {
          importJSON(text);
        } else {
          importSessionsCSV(text);
        }
      } catch (e) {
        toast(t('Import failed: ' + e.message, 'فشل الاستيراد: ' + e.message), 'error');
      }
      input.value = '';
    };
    reader.readAsText(file);
  }
  function importJSON(text) {
    var data = JSON.parse(text);
    if (!data || data.app !== 'Volta') throw new Error(t('Not a Volta backup file', 'الملف ليس نسخة Volta احتياطية'));
    var u = U();
    if (!u) { toast(t('Log in first', 'سجّل الدخول أولاً'), 'error'); return; }
    var n = 0;
    ['profile', 'survey', 'sessions', 'reminders', 'dailyPlan', 'goalPlan', 'plan', 'customWorkouts', 'weightLog', 'weeklySurveyHistory'].forEach(function (k) {
      if (data[k] !== undefined) { u[k] = data[k]; n++; }
    });
    if (data.streak != null) u.streak = data.streak;
    save(u);
    if (Array.isArray(data.dietLog) && data.dietLog.length && typeof saveDietLog === 'function') {
      try {
        var key = 'volta_diet_log_' + store.session;
        localStorage.setItem(key, JSON.stringify(data.dietLog));
        if (typeof VoltaDB !== 'undefined' && VoltaDB.dietLog && VoltaDB.users) {
          VoltaDB.dietLog.add && data.dietLog.forEach(function (x) { try { VoltaDB.dietLog.add(x); } catch (e) {} });
        }
        try { if (typeof VoltaCloudSync !== 'undefined' && VoltaCloudSync.syncDietLogToCloud) VoltaCloudSync.syncDietLogToCloud(store.session, data.dietLog); } catch (e) {}
      } catch (e) {}
    }
    if (data.settings) {
      try {
        if (data.settings.theme) { store.theme = data.settings.theme; }
        if (data.settings.lang) { store.lang = data.settings.lang; }
        if (data.settings.units) { localStorage.setItem('fb_units', data.settings.units); }
      } catch (e) {}
    }
    try { applySettings(); } catch (e) {}
    try { renderHome(); } catch (e) {}
    try { renderStreaksTab(); } catch (e) {}
    try { renderCustomWorkoutsList(); } catch (e) {}
    toast(t('Backup restored (' + n + ' sections)', 'تمت استعادة النسخة الاحتياطية (' + n + ' أقسام)'));
  }
  function importSessionsCSV(text) {
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (lines.length < 2) throw new Error(t('CSV has no data rows', 'لا توجد بيانات في الملف'));
    var u = U(); if (!u) return;
    if (!Array.isArray(u.sessions)) u.sessions = [];
    var added = 0;
    for (var i = 1; i < lines.length; i++) {
      var cells = lines[i].split(',').map(function (c) { return c.replace(/^"|"$/g, '').replace(/""/g, '"').trim(); });
      var date = cells[0], sport = cells[1], dur = parseInt(cells[2], 10) || 0;
      if (!date || !sport || !dur) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      var cals = parseInt(cells[3], 10);
      u.sessions.push({ sport: sport, date: date, duration: dur, calories: isNaN(cals) ? undefined : cals, intensity: cells[4] || 'Moderate', note: cells[5] || 'imported' });
      added++;
    }
    save(u);
    try { renderStreaksTab(); renderHome(); } catch (e) {}
    toast(t('Imported ' + added + ' sessions', 'تم استيراد ' + added + ' جلسة'));
  }

  // Expose everything needed by inline HTML handlers
  API.computeStreakStats = computeStreakStats;
  API.renderStreaksTab = renderStreaksTab;
  API.renderWeeklyReport = renderWeeklyReport;
  API.BADGES = BADGES;
  API.openWorkoutBuilder = openWorkoutBuilder;
  API.closeWorkoutBuilder = closeWorkoutBuilder;
  API.renderBuilderLibrary = renderBuilderLibrary;
  API.renderBuilderSelected = renderBuilderSelected;
  API.pickBuilderMuscle = pickBuilderMuscle;
  API.toggleBuilderExercise = toggleBuilderExercise;
  API.updateBuilderExercise = updateBuilderExercise;
  API.moveBuilderExercise = moveBuilderExercise;
  API.saveCustomWorkout = saveCustomWorkout;
  API.renderCustomWorkoutsList = renderCustomWorkoutsList;
  API.applyCustomWorkoutToToday = applyCustomWorkoutToToday;
  API.quickLogCustomWorkout = quickLogCustomWorkout;
  API.deleteCustomWorkout = deleteCustomWorkout;
  API.heatNavMonth = heatNavMonth;
  API.exportDataJSON = exportDataJSON;
  API.exportDataCSV = exportDataCSV;
  API.importDataFile = importDataFile;
  API.dashPlanPrevPage = dashPlanPrevPage;
  API.dashPlanNextPage = dashPlanNextPage;

  return API;
})();

// ── Global bindings so inline onclick="..." handlers work ──
(function () {
  var V = window.VoltaFeatures;
  var globals = [
    'setUnits', 'renderStreaksTab', 'openWorkoutBuilder', 'closeWorkoutBuilder',
    'renderBuilderLibrary', 'renderBuilderSelected', 'pickBuilderMuscle', 'toggleBuilderExercise', 'updateBuilderExercise',
    'moveBuilderExercise', 'saveCustomWorkout', 'renderCustomWorkoutsList', 'applyCustomWorkoutToToday',
    'quickLogCustomWorkout', 'deleteCustomWorkout', 'heatNavMonth', 'exportDataJSON', 'exportDataCSV', 'importDataFile',
    'dashPlanPrevPage', 'dashPlanNextPage'
  ];
  globals.forEach(function (name) {
    if (V[name]) { try { Object.defineProperty(window, name, { value: V[name], writable: true, configurable: true }); } catch (e) { window[name] = V[name]; } }
  });
})();
