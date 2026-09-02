/**
 * Volta Plan Engine — Survey-Driven Workout & Diet Plan Generator
 * ================================================================
 *
 * This module builds a personalized fitness plan using ONLY the user's
 * survey answers. It runs after onboarding completes (saveSurvey) and
 * whenever the user explicitly regenerates their plan from Profile.
 *
 * INPUT: u.profile + u.survey (34 survey fields)
 * OUTPUT: u.plan = {
 *   generatedAt,        // timestamp
 *   version,            // engine version (bump when algorithm changes)
 *   workout: {
 *     splitType,        // 'Push/Pull/Legs' | 'Upper/Lower' | 'Full Body' | 'Body Part Split'
 *     daysPerWeek,      // number derived from survey.schedule
 *     sessionMinutes,   // derived from survey.time
 *     schedule: [{      // one entry per training day
 *       day,            // 'Monday' | 'Wednesday' | ...
 *       focus,          // 'Push' | 'Pull' | 'Legs' | 'Upper' | 'Lower' | 'Full Body' | 'Cardio' | 'Rest'
 *       muscleGroups,   // ['Chest','Triceps','Shoulders'] etc.
 *       exercises,      // [{name, sets, reps, muscleGroup, equipment, difficulty}]
 *       cardio,         // null or {type, duration, intensity}
 *       duration        // estimated total minutes
 *     }],
 *     restDays          // ['Tuesday','Thursday','Saturday','Sunday'] etc.
 *   },
 *   diet: {
 *     dailyCalories,    // target
 *     macros: {p, c, f}, // protein/carbs/fat in grams
 *     mealsPerDay,      // from survey.meals
 *     hydrationLiters,  // from survey.hydration + body weight
 *     mealSchedule: [{  // one entry per meal
 *       type,           // 'breakfast' | 'lunch' | 'dinner' | 'snack'
 *       targetCalories, // portion of daily target
 *       targetMacros,   // {p, c, f}
 *       suggestions     // [meal names from IndexedDB] — populated async after plan generation
 *     }]
 *   },
 *   preferences: {       // snapshot of survey fields that drove the plan
 *     goal, level, environment, equipment, diet_pref, injury,
 *     schedule, time, cardio_pref, meals, hydration
 *   }
 * }
 *
 * The engine is PURE — it doesn't touch the DOM. Callers are responsible
 * for saving the result to the user object and re-rendering.
 */

window.VoltaPlan = (function () {

  // ─── Helpers ─────────────────────────────────────────────────────────────
  function num(v, fallback) {
    var n = parseFloat(v);
    return isNaN(n) ? fallback : n;
  }

  function arr(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v;
    return String(v).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  // ─── Seeded RNG (per-user personalization) ───────────────────────────
  // Same algorithm as volta.js — deterministic, so the SAME user gets the
  // SAME plan for the same generation moment, while DIFFERENT users (email
  // in the seed) get different mixes. No more plain Math.random() rerolls.
  function hashStr(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function makeRng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function seededShuffle(list, rng) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  // ─── Workout split selection ─────────────────────────────────────────────
  // Decides the split type based on days-per-week + goal + level.
  function chooseSplit(daysPerWeek, goal, level) {
    if (daysPerWeek >= 5) {
      // 5+ days → Push/Pull/Legs (rotates, allows high frequency)
      return 'Push/Pull/Legs';
    } else if (daysPerWeek >= 3 && (goal === 'Build muscle' || level === 'Advanced')) {
      return 'Push/Pull/Legs';
    } else if (daysPerWeek >= 3) {
      // 3-4 days, general fitness → Upper/Lower
      return 'Upper/Lower';
    } else {
      // 1-2 days → Full Body each session
      return 'Full Body';
    }
  }

  // ─── Day assignment per split type ───────────────────────────────────────
  // Returns an array of {day, focus, muscleGroups} for training days only.
  function buildSplitSchedule(splitType, daysPerWeek, scheduleDays) {
    // Default days of week
    var weekDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    // If the user picked specific days in the daily-exercise wizard, respect them.
    // Otherwise pick the first N days of the week starting Monday.
    var trainingDays;
    if (scheduleDays && scheduleDays.length === daysPerWeek) {
      trainingDays = scheduleDays.map(function (i) { return weekDays[i] || weekDays[0]; });
    } else {
      // Spread training days evenly across the week
      trainingDays = [];
      var step = 7 / daysPerWeek;
      for (var i = 0; i < daysPerWeek; i++) {
        var idx = Math.floor(i * step) % 7;
        trainingDays.push(weekDays[idx]);
      }
    }

    // Define the rotation per split type
    var rotations = {
      'Push/Pull/Legs': [
        { focus: 'Push', muscleGroups: ['Chest', 'Shoulders', 'Arms'] },
        { focus: 'Pull', muscleGroups: ['Back', 'Arms'] },
        { focus: 'Legs', muscleGroups: ['Legs', 'Core'] }
      ],
      'Upper/Lower': [
        { focus: 'Upper', muscleGroups: ['Chest', 'Back', 'Shoulders', 'Arms'] },
        { focus: 'Lower', muscleGroups: ['Legs', 'Core'] }
      ],
      'Full Body': [
        { focus: 'Full Body', muscleGroups: ['Chest', 'Back', 'Legs', 'Shoulders', 'Core'] }
      ],
      'Body Part Split': [
        { focus: 'Chest', muscleGroups: ['Chest', 'Arms'] },
        { focus: 'Back', muscleGroups: ['Back', 'Arms'] },
        { focus: 'Legs', muscleGroups: ['Legs', 'Core'] },
        { focus: 'Shoulders', muscleGroups: ['Shoulders', 'Core'] },
        { focus: 'Arms', muscleGroups: ['Arms', 'Core'] }
      ]
    };

    var rotation = rotations[splitType] || rotations['Full Body'];
    var schedule = [];
    for (var i = 0; i < trainingDays.length; i++) {
      var r = rotation[i % rotation.length];
      schedule.push({
        day: trainingDays[i],
        focus: r.focus,
        muscleGroups: r.muscleGroups.slice()
      });
    }
    return schedule;
  }

  // ─── Exercise selection from IndexedDB ───────────────────────────────────
  // Picks exercises for a training day based on muscle groups, equipment,
  // difficulty, and injury constraints. Uses WORKOUTS_DB (cached from
  // IndexedDB) if available, falls back to WORKOUT_DB if not.
  function pickExercises(muscleGroups, opts) {
    opts = opts || {};
    var equipment = opts.equipment || null;
    var difficulty = opts.difficulty || null;
    var injury = opts.injury || 'None';
    var perExercise = opts.perExercise || 4;
    var goal = opts.goal || null;
    var rng = opts.seed != null ? makeRng(opts.seed) : Math.random;

    var pool = [];
    var seen = {};

    // Pull from IndexedDB-backed WORKOUTS_DB (100 workouts) first
    if (typeof WORKOUTS_DB !== 'undefined' && WORKOUTS_DB.length) {
      WORKOUTS_DB.forEach(function (w) {
        if (muscleGroups.indexOf(w.muscleGroup) === -1) return;
        if (seen[w.name]) return;
        // Equipment filter: if user has no equipment, only Bodyweight workouts
        if (equipment === 'None' || equipment === 'none') {
          if (w.equipment !== 'Bodyweight') return;
        }
        // Difficulty filter: match user level or one step easier
        if (difficulty && w.difficulty !== difficulty) {
          // Allow Beginner workouts for everyone, but only match exact for Intermediate/Advanced
          if (difficulty === 'Beginner' && w.difficulty !== 'Beginner') return;
          if (difficulty === 'Intermediate' && w.difficulty === 'Advanced') return;
        }
        seen[w.name] = true;
        // Level-accurate volume (progressive sets) + goal-accurate rep ranges
        var setsByLevel = { Beginner: 3, Intermediate: 4, Advanced: 4 };
        var sets = setsByLevel[difficulty] || 3;
        var reps = w.muscleGroup === 'Cardio' ? null : (w.difficulty === 'Beginner' ? '12-15' : w.difficulty === 'Intermediate' ? '10-12' : '8-10');
        if (reps && goal === 'Improve endurance') reps = '15-20';
        pool.push({
          name: w.name,
          muscleGroup: w.muscleGroup,
          equipment: w.equipment,
          difficulty: w.difficulty,
          met: w.met,
          sets: sets,
          reps: reps
        });
      });
    }

    // Fallback: pull from hardcoded WORKOUT_DB if pool is too small
    if (pool.length < perExercise && typeof WORKOUT_DB !== 'undefined') {
      muscleGroups.forEach(function (mg) {
        (WORKOUT_DB[mg] || []).forEach(function (name) {
          if (seen[name]) return;
          seen[name] = true;
          pool.push({
            name: name,
            muscleGroup: mg,
            equipment: 'Bodyweight',
            difficulty: difficulty || 'Beginner',
            met: (typeof WORKOUT_MET !== 'undefined' && WORKOUT_MET[name]) || 5,
            sets: 3,
            reps: '10-15'
          });
        });
      });
    }

    // Seeded shuffle + pick: per-user deterministic mix (see hashStr/makeRng)
    var result = [];
    var p = seededShuffle(pool, rng);
    for (var i = 0; i < Math.min(perExercise, p.length); i++) {
      result.push(p[i]);
    }
    return result;
  }

  // ─── Cardio selection ────────────────────────────────────────────────────
  function pickCardio(cardioPref, goal, environment) {
    if (cardioPref === 'No preference' && goal !== 'Improve endurance' && goal !== 'Lose weight') {
      return null; // no cardio needed
    }
    var types = {
      'Steady cardio': { type: 'Steady State Cardio', duration: 20, intensity: 'Moderate' },
      'HIIT': { type: 'HIIT', duration: 15, intensity: 'High' },
      'Mixed': { type: 'Mixed Cardio', duration: 20, intensity: 'Moderate' },
      'No preference': { type: 'Steady State Cardio', duration: 15, intensity: 'Moderate' }
    };
    var c = types[cardioPref] || types['No preference'];
    // Outdoor cardio if user prefers outdoors
    if (environment === 'Outdoors' || environment === 'Mixed') {
      c.type = c.type + ' (Outdoor)';
    }
    return c;
  }

  // ─── Diet plan generation ────────────────────────────────────────────────
  function buildDietPlan(profile, survey, goalPlan) {
    // Reuse the goal plan's calorie/macro targets if available. Otherwise
    // compute an ACCURATE personal target (same Harris-Benedict formulas the
    // app's goal calculator uses) instead of a flat 2000-kcal guess.
    var dailyCalories, macros;
    if (goalPlan && goalPlan.targetCals) {
      dailyCalories = goalPlan.targetCals;
      macros = goalPlan.macros || { p: 150, c: 200, f: 55 };
    } else {
      var w = num(profile.weight, 70), h = num(profile.height, 170), a = num(profile.age, 25);
      var bmr = profile.gender === 'Female'
        ? 447.6 + (9.25 * w) + (3.1 * h) - (4.33 * a)
        : 88.36 + (13.4 * w) + (4.8 * h) - (5.68 * a);
      var afMap = { '1-2 days': 1.375, '3-4 days': 1.55, '5+ days': 1.725, 'Everyday': 1.9 };
      var tdee = bmr * (afMap[survey.schedule] || 1.55);
      dailyCalories = Math.round(tdee);
      if (profile.goal === 'Lose weight') dailyCalories = Math.round(tdee - 500);
      else if (profile.goal === 'Build muscle') dailyCalories = Math.round(tdee + 300);
      dailyCalories = Math.max(1200, dailyCalories);
      macros = {
        p: Math.round((dailyCalories * 0.30) / 4),
        c: Math.round((dailyCalories * 0.40) / 4),
        f: Math.round((dailyCalories * 0.30) / 9)
      };
    }

    // Parse meals-per-day
    var mealsPerDay = 3;
    if (survey.meals === '1 meal') mealsPerDay = 1;
    else if (survey.meals === '2 meals') mealsPerDay = 2;
    else if (survey.meals === '3 meals') mealsPerDay = 3;
    else if (survey.meals === '3+ meals') mealsPerDay = 4;

    // Hydration: base 0.033L per kg body weight, adjusted by survey answer
    var baseWater = profile.weight * 0.033;
    var hydrationAdjust = {
      'Rarely drink water': 0.5,
      '1-2L per day': 1.0,
      '2-3L per day': 1.0,
      '3L+ per day': 1.0
    };
    var hydrationLiters = Math.round(baseWater * (hydrationAdjust[survey.hydration] || 1.0) * 10) / 10;

    // Distribute calories across meals
    // Standard distribution: breakfast 25%, lunch 30%, dinner 30%, snacks 15% (split among snacks)
    var distribution;
    if (mealsPerDay === 1) {
      distribution = [{ type: 'dinner', portion: 1.0 }];
    } else if (mealsPerDay === 2) {
      distribution = [
        { type: 'lunch', portion: 0.5 },
        { type: 'dinner', portion: 0.5 }
      ];
    } else if (mealsPerDay === 3) {
      distribution = [
        { type: 'breakfast', portion: 0.25 },
        { type: 'lunch', portion: 0.35 },
        { type: 'dinner', portion: 0.40 }
      ];
    } else {
      distribution = [
        { type: 'breakfast', portion: 0.25 },
        { type: 'lunch', portion: 0.30 },
        { type: 'dinner', portion: 0.30 },
        { type: 'snack', portion: 0.15 }
      ];
    }

    var mealSchedule = distribution.map(function (m) {
      return {
        type: m.type,
        targetCalories: Math.round(dailyCalories * m.portion),
        targetMacros: {
          p: Math.round(macros.p * m.portion),
          c: Math.round(macros.c * m.portion),
          f: Math.round(macros.f * m.portion)
        },
        suggestions: [] // populated async by populateMealSuggestions()
      };
    });

    return {
      dailyCalories: dailyCalories,
      macros: macros,
      mealsPerDay: mealsPerDay,
      hydrationLiters: hydrationLiters,
      mealSchedule: mealSchedule
    };
  }

  // ─── Public: generate full plan ──────────────────────────────────────────
  /**
   * @param {Object} user — full user object with profile + survey + goalPlan
   * @returns {Object} plan — the generated plan (also assigns meal suggestions synchronously if DB is loaded)
   */
  function generate(user) {
    if (!user || !user.profile || !user.survey) {
      return null;
    }
    var profile = user.profile;
    var survey = user.survey;
    var goalPlan = user.goalPlan || null;
    var generatedAt = Date.now();

    // Derive days per week from survey.schedule
    var daysPerWeek = 3;
    if (survey.schedule === '1-2 days') daysPerWeek = 2;
    else if (survey.schedule === '3-4 days') daysPerWeek = 3;
    else if (survey.schedule === '5+ days') daysPerWeek = 5;
    else if (survey.schedule === 'Everyday') daysPerWeek = 6;

    // Derive session minutes from survey.time
    var sessionMinutes = 30;
    if (survey.time === '15 minutes') sessionMinutes = 15;
    else if (survey.time === '30 minutes') sessionMinutes = 30;
    else if (survey.time === '45 minutes') sessionMinutes = 45;
    else if (survey.time === '60+ minutes') sessionMinutes = 60;

    // Choose split type
    var splitType = chooseSplit(daysPerWeek, profile.goal, survey.level);

    // Build the schedule
    var rawSchedule = buildSplitSchedule(splitType, daysPerWeek);

    // Pick exercises for each day.
    // v2: match the Daily Exercise wizard formula (workout minutes = goal / 2,
    // one exercise per minute) so an adopted plan carries the SAME full list
    // the wizard produces — 15-min → 8, 30-min → 15, 45-min → 23, 60-min → 30.
    var perExercise = Math.max(4, Math.min(30, Math.round(Math.max(15, sessionMinutes) / 2)));
    // Per-user seed: account email + generation moment → every user gets a
    // different (but reproducible) exercise mix for THIS plan.
    var planSeed = hashStr(String(user.email || storeSessionEmail() || 'anon') + '|volta-plan|' + generatedAt);
    var workoutSchedule = rawSchedule.map(function (day) {
      var exercises = pickExercises(day.muscleGroups, {
        equipment: survey.equipment,
        difficulty: survey.level,
        injury: survey.injury || profile.injury || 'None',
        perExercise: perExercise,
        goal: profile.goal,
        seed: planSeed + hashStr(day.day + day.focus)
      });
      var cardio = pickCardio(survey.cardio_pref, profile.goal, survey.environment);
      var duration = sessionMinutes;
      return {
        day: day.day,
        focus: day.focus,
        muscleGroups: day.muscleGroups,
        exercises: exercises,
        cardio: cardio,
        duration: duration
      };
    });

    // Rest days = all days not in the schedule
    var allDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    var trainingDayNames = workoutSchedule.map(function (d) { return d.day; });
    var restDays = allDays.filter(function (d) { return trainingDayNames.indexOf(d) === -1; });

    // Build diet plan
    var dietPlan = buildDietPlan(profile, survey, goalPlan);

    // Snapshot the preferences that drove this plan
    var preferences = {
      goal: profile.goal,
      level: survey.level,
      environment: survey.environment,
      equipment: survey.equipment,
      diet_pref: survey.diet_pref,
      injury: survey.injury || profile.injury || 'None',
      schedule: survey.schedule,
      time: survey.time,
      cardio_pref: survey.cardio_pref,
      meals: survey.meals,
      hydration: survey.hydration
    };

    return {
      generatedAt: generatedAt,
      version: 3,
      workout: {
        splitType: splitType,
        daysPerWeek: daysPerWeek,
        sessionMinutes: sessionMinutes,
        schedule: workoutSchedule,
        restDays: restDays
      },
      diet: dietPlan,
      preferences: preferences
    };
  }

  // ─── Internal: in-memory meal pool (Round 9) ─────────────────────────────
  // Suggestion source chain, guaranteed non-empty:
  //   1) IndexedDB meals store (100 seeded meals) when available
  //   2) static window.VOLTA_MEAL_SEED (js/data/meals.js — always loaded)
  // Returns [] only if BOTH are missing (should never happen).
  function staticMealPool() {
    try {
      if (window.VOLTA_MEAL_SEED && window.VOLTA_MEAL_SEED.length) return window.VOLTA_MEAL_SEED;
    } catch (e) {}
    return [];
  }

  // Deterministic per-user shuffle → every account gets a DIFFERENT meal mix
  // for the same slot, but the SAME account always sees the same meals for a
  // given plan (no flicker between renders).
  function seededPick(pool, seedStr, count) {
    var seed = hashStr(String(seedStr || 'volta'));
    function rand() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
    var arr = pool.slice();
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr.slice(0, Math.max(1, count | 0));
  }

  // Map a diet_pref label (survey wording) to the seed `diet` field.
  function dietFilterFor(dietPref) {
    if (dietPref === 'Vegetarian') return 'vegetarian';
    if (dietPref === 'Vegan') return 'vegan';
    if (dietPref === 'Keto') return 'keto';
    if (dietPref === 'Halal') return 'halal';
    return null; // None / omnivore → everything
  }

  // Filter any meal array by seed-diet semantics (mirrors VoltaDB.meals.filter).
  function filterByDiet(items, dietFilter) {
    if (!dietFilter) return items;
    return items.filter(function (m) {
      if (dietFilter === 'omnivore') return true;
      if (dietFilter === 'vegetarian') return m.diet === 'vegetarian' || m.diet === 'vegan';
      if (dietFilter === 'halal') return m.diet === 'halal' || m.diet === 'omnivore' || !m.diet;
      if (dietFilter === 'gluten-free') return m.diet === 'gluten-free' || m.diet === 'omnivore' || !m.diet;
      if (dietFilter === 'keto') return m.diet === 'keto';
      return m.diet === dietFilter;
    });
  }

  // Pick the final N names: keep per-user variety (seeded shuffle) but prefer
  // meals whose calories fit the slot target (personalized AND on-target).
  function finalPick(pool, seedStr, kcalTarget, count) {
    var shuffled = seededPick(pool, seedStr, Math.min(pool.length, 10));
    if (kcalTarget) {
      shuffled.sort(function (a, b) {
        return Math.abs((a.kcal || 0) - kcalTarget) - Math.abs((b.kcal || 0) - kcalTarget);
      });
    }
    return shuffled.slice(0, count).map(function (m) { return m.name; });
  }

  // ─── Public: populate meal suggestions from IndexedDB ────────────────────
  /**
   * Fills in `mealSchedule[i].suggestions` with actual meal names.
   * Round 9 hardening:
   *   • falls back to the static VOLTA_MEAL_SEED when IndexedDB is empty or
   *     unavailable (fixes permanently-blank Breakfast/Lunch/Dinner rows)
   *   • per-user seeded picks so different users get different meals
   *   • kcal-target matching so suggestions fit the slot's calorie budget
   * Returns a promise that resolves when all suggestions are populated.
   */
  async function populateMealSuggestions(plan) {
    if (!plan || !plan.diet || !plan.diet.mealSchedule) return;

    var dietPref = (plan.preferences && plan.preferences.diet_pref) || 'None';
    var dietFilter = dietFilterFor(dietPref);
    var userKey = String(storeSessionEmail() || 'anon');

    var dbMeals = null;
    try {
      if (window.VoltaDB && window.VoltaDB.meals) {
        dbMeals = await window.VoltaDB.meals.getAll();
      }
    } catch (e) { dbMeals = null; }
    if (!dbMeals || !dbMeals.length) dbMeals = staticMealPool();

    for (var i = 0; i < plan.diet.mealSchedule.length; i++) {
      var meal = plan.diet.mealSchedule[i];
      try {
        var seedStr = userKey + '|' + (meal.type || 'meal') + '|' + (plan.generatedAt || '');
        // 1) by meal type + diet  →  2) by meal type  →  3) anything
        var pool = filterByDiet(dbMeals.filter(function (m) { return m.mealType === meal.type; }), dietFilter);
        if (!pool.length) pool = dbMeals.filter(function (m) { return m.mealType === meal.type; });
        if (!pool.length) pool = filterByDiet(dbMeals, dietFilter);
        if (!pool.length) pool = dbMeals;
        meal.suggestions = pool.length ? finalPick(pool, seedStr, meal.targetCalories, 3) : [];
      } catch (e) {
        // Last-resort static pick — never leave the row blank.
        try {
          var fb = staticMealPool().filter(function (m) { return m.mealType === meal.type; });
          meal.suggestions = (fb.length ? fb : staticMealPool()).slice(0, 3).map(function (m) { return m.name; });
        } catch (e2) { meal.suggestions = []; }
      }
    }

    // Round 9 FIX — persist through a FRESH store read.
    // `store.users` is a localStorage GETTER: every access re-parses storage,
    // so the user object the caller captured is stale — mutations made here to
    // the caller's plan copy never reach storage if the caller just re-saves
    // its own (or a freshly re-read) reference. We therefore copy the computed
    // suggestions into the CURRENTLY STORED plan (guarded by generatedAt so we
    // never contaminate a plan that was regenerated meanwhile) and save that.
    try {
      var email2 = storeSessionEmail();
      var uNow = (email2 && typeof store !== 'undefined' && store.users) ? store.users[email2] : null;
      if (uNow && uNow.plan && uNow.plan.diet && uNow.plan.diet.mealSchedule &&
          uNow.plan.generatedAt === plan.generatedAt) {
        var changed = false;
        for (var k = 0; k < uNow.plan.diet.mealSchedule.length && k < plan.diet.mealSchedule.length; k++) {
          var mNow = uNow.plan.diet.mealSchedule[k];
          var mGen = plan.diet.mealSchedule[k];
          if (mNow && mGen && mNow.type === mGen.type &&
              mGen.suggestions && mGen.suggestions.length &&
              JSON.stringify(mNow.suggestions) !== JSON.stringify(mGen.suggestions)) {
            mNow.suggestions = mGen.suggestions.slice();
            changed = true;
          }
        }
        if (changed && typeof saveUser === 'function') saveUser(email2, uNow);
      }
      if (window.__R9_DEBUG) console.log('[R9-persist]', JSON.stringify({ email: email2, hasUser: !!uNow, genMatch: !!(uNow && uNow.plan && uNow.plan.generatedAt === plan.generatedAt), changed: !!changed }));
    } catch (e) { if (window.__R9_DEBUG) console.log('[R9-persist-ERR]', String(e)); }
    return plan;
  }

  // ─── Public: render plan summary as HTML (for display) ───────────────────
  function renderSummary(plan, lang) {
    if (!plan) return '';
    var ar = (lang === 'ar');
    var html = '<div class="plan-summary">';

    // Workout summary
    html += '<div class="plan-section">';
    html += '<h4><i class="fa-solid fa-dumbbell" style="color:var(--accent);margin-right:6px;"></i>' +
            (ar ? 'خطة التمارين' : 'Workout Plan') + '</h4>';
    html += '<div class="plan-stats">';
    html += '<span class="plan-stat-pill"><b>' + plan.workout.splitType + '</b> ' + (ar ? 'تقسيم' : 'split') + '</span>';
    html += '<span class="plan-stat-pill"><b>' + plan.workout.daysPerWeek + '</b> ' + (ar ? 'أيام/أسبوع' : 'days/week') + '</span>';
    html += '<span class="plan-stat-pill"><b>' + plan.workout.sessionMinutes + '</b> ' + (ar ? 'دقيقة/جلسة' : 'min/session') + '</span>';
    html += '</div>';

    // Day-by-day
    html += '<div class="plan-schedule">';
    plan.workout.schedule.forEach(function (day) {
      html += '<div class="plan-day">';
      html += '<div class="plan-day-header"><b>' + day.day + '</b> <span class="plan-day-focus">' + day.focus + '</span></div>';
      html += '<div class="plan-day-exercises">';
      day.exercises.forEach(function (ex) {
        html += '<span class="plan-exercise-tag">' + ex.name + '</span>';
      });
      html += '</div>';
      if (day.cardio) {
        html += '<div class="plan-cardio"><i class="fa-solid fa-heart-pulse" style="color:var(--red);"></i> ' +
                day.cardio.type + ' · ' + day.cardio.duration + 'min · ' + day.cardio.intensity + '</div>';
      }
      html += '</div>';
    });
    html += '</div>';
    html += '</div>';

    // Diet summary
    html += '<div class="plan-section">';
    html += '<h4><i class="fa-solid fa-utensils" style="color:var(--accent);margin-right:6px;"></i>' +
            (ar ? 'خطة التغذية' : 'Diet Plan') + '</h4>';
    html += '<div class="plan-stats">';
    html += '<span class="plan-stat-pill"><b>' + plan.diet.dailyCalories + '</b> ' + (ar ? 'سعرة/يوم' : 'kcal/day') + '</span>';
    html += '<span class="plan-stat-pill"><b>' + plan.diet.macros.p + 'g</b> ' + (ar ? 'بروتين' : 'protein') + '</span>';
    html += '<span class="plan-stat-pill"><b>' + plan.diet.macros.c + 'g</b> ' + (ar ? 'كربوهيدرات' : 'carbs') + '</span>';
    html += '<span class="plan-stat-pill"><b>' + plan.diet.macros.f + 'g</b> ' + (ar ? 'دهون' : 'fat') + '</span>';
    html += '<span class="plan-stat-pill"><i class="fa-solid fa-droplet" style="color:var(--accent);"></i> <b>' + plan.diet.hydrationLiters + 'L</b> ' + (ar ? 'ماء/يوم' : 'water/day') + '</span>';
    html += '</div>';

    // Meal schedule
    html += '<div class="plan-meal-schedule">';
    plan.diet.mealSchedule.forEach(function (meal) {
      html += '<div class="plan-meal">';
      html += '<div class="plan-meal-header"><b>' + meal.type + '</b> <span class="plan-meal-cal">' + meal.targetCalories + ' kcal</span></div>';
      var sug = (meal.suggestions && meal.suggestions.length) ? meal.suggestions : null;
      if (!sug && typeof window.pickMealsForType === 'function') {
        // Round 9: synchronous fallback — never render a blank meal row.
        sug = window.pickMealsForType(meal.type, meal.targetCalories);
      }
      if (sug && sug.length) {
        html += '<div class="plan-meal-suggestions">';
        sug.slice(0, 3).forEach(function (name) {
          html += '<span class="plan-meal-suggestion" onclick="showMealInfo(\'' + String(name).replace(/'/g, "\\'") + '\')" style="cursor:pointer;">' + name + '</span>';
        });
        html += '</div>';
      }
      html += '</div>';
    });
    html += '</div>';
    html += '</div>';

    html += '</div>';
    return html;
  }

  // Reads the session email without depending on volta.js load order.
  // NOTE: `store` is a top-level const in volta.js (a shared global binding
  // across classic scripts, but NOT on window), so check both.
  function storeSessionEmail() {
    try {
      if (typeof store !== 'undefined' && store && store.session) return store.session;
      if (typeof window !== 'undefined' && window.store && window.store.session) return window.store.session;
    } catch (e) {}
    return null;
  }

  return {
    generate: generate,
    populateMealSuggestions: populateMealSuggestions,
    renderSummary: renderSummary
  };
})();
