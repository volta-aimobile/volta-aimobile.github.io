 















































window.VoltaPlan = (function () {

   
  function num(v, fallback) {
    var n = parseFloat(v);
    return isNaN(n) ? fallback : n;
  }

  function arr(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v;
    return String(v).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }

   
   
   
   
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

   
   
  function chooseSplit(daysPerWeek, goal, level) {
    if (daysPerWeek >= 5) {
       
      return 'Push/Pull/Legs';
    } else if (daysPerWeek >= 3 && (goal === 'Build muscle' || level === 'Advanced')) {
      return 'Push/Pull/Legs';
    } else if (daysPerWeek >= 3) {
       
      return 'Upper/Lower';
    } else {
       
      return 'Full Body';
    }
  }

   
   
  function buildSplitSchedule(splitType, daysPerWeek, scheduleDays) {
     
    var weekDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

     
     
    var trainingDays;
    if (scheduleDays && scheduleDays.length === daysPerWeek) {
      trainingDays = scheduleDays.map(function (i) { return weekDays[i] || weekDays[0]; });
    } else {
       
      trainingDays = [];
      var step = 7 / daysPerWeek;
      for (var i = 0; i < daysPerWeek; i++) {
        var idx = Math.floor(i * step) % 7;
        trainingDays.push(weekDays[idx]);
      }
    }

     
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

   
   
   
   
   
  function __peNeedsEquipName(name) {
    if (window.WORKOUT_DB_NEEDS_EQUIP && window.WORKOUT_DB_NEEDS_EQUIP[name]) return true;
    var n = String(name || '').toLowerCase();
    return /(pull[ -]?up|chin[ -]?up|hanging|inverted row|muscle[ -]?up|dip[ -]?bar)/.test(n);
  }
  function __peUserNoEquip(rawEquipment) {
    if (typeof window.userHasNoEquipment === 'function') return window.userHasNoEquipment(rawEquipment);
    if (rawEquipment === null || rawEquipment === undefined) return true;
    var t = String(rawEquipment).trim().toLowerCase();
    if (!t) return true;
    if (/^(none|no|nothing|nope|nil|n\/a|na|zero|0|-|_)$/.test(t)) return true;
    if (t.indexOf('none') !== -1 || t.indexOf('no equipment') !== -1 || t.indexOf('nothing') !== -1) return true;
    return false;
  }

   
   
   
  function pickExercises(muscleGroups, opts) {
    opts = opts || {};
    var equipment = opts.equipment || null;
    var difficulty = opts.difficulty || null;
    var injury = opts.injury || 'None';
    var perExercise = opts.perExercise || 4;
    var perGroup = opts.perGroup || 0;       
    var goal = opts.goal || null;
    var rng = opts.seed != null ? makeRng(opts.seed) : Math.random;
     
    var noEquip = __peUserNoEquip(equipment);
     
    if (perGroup > 0) perExercise = Math.max(1, muscleGroups.length) * perGroup;

    var pool = [];
    var seen = {};

     
    if (typeof WORKOUTS_DB !== 'undefined' && WORKOUTS_DB.length) {
      WORKOUTS_DB.forEach(function (w) {
        if (muscleGroups.indexOf(w.muscleGroup) === -1) return;
        if (seen[w.name]) return;
         
         
         
        if (noEquip) {
          if (String(w.equipment || '').toLowerCase() !== 'bodyweight') return;
          if (__peNeedsEquipName(w.name)) return;
        }
         
        if (difficulty && w.difficulty !== difficulty) {
           
          if (difficulty === 'Beginner' && w.difficulty !== 'Beginner') return;
          if (difficulty === 'Intermediate' && w.difficulty === 'Advanced') return;
        }
        seen[w.name] = true;
         
         
        var sets = 2;
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

     
    if (pool.length < perExercise && typeof WORKOUT_DB !== 'undefined') {
      muscleGroups.forEach(function (mg) {
        (WORKOUT_DB[mg] || []).forEach(function (name) {
          if (seen[name]) return;
           
          if (noEquip && __peNeedsEquipName(name)) return;
          seen[name] = true;
          pool.push({
            name: name,
            muscleGroup: mg,
            equipment: 'Bodyweight',
            difficulty: difficulty || 'Beginner',
            met: (typeof WORKOUT_MET !== 'undefined' && WORKOUT_MET[name]) || 5,
            sets: 2,
            reps: '10-15'
          });
        });
      });
    }

     
    var result = [];
    var p = seededShuffle(pool, rng);
    if (perGroup > 0) {
       
       
      var quota = {};
      muscleGroups.forEach(function (g) { quota[g] = perGroup; });
      for (var i = 0; i < p.length; i++) {
        var g = p[i].muscleGroup;
        if (quota[g] > 0) { result.push(p[i]); quota[g]--; }
        if (result.length >= perExercise) break;
      }
    } else {
      for (var j = 0; j < Math.min(perExercise, p.length); j++) {
        result.push(p[j]);
      }
    }
    return result;
  }

   
  function pickCardio(cardioPref, goal, environment) {
    if (cardioPref === 'No preference' && goal !== 'Improve endurance' && goal !== 'Lose weight') {
      return null;  
    }
    var types = {
      'Steady cardio': { type: 'Steady State Cardio', duration: 20, intensity: 'Moderate' },
      'HIIT': { type: 'HIIT', duration: 15, intensity: 'High' },
      'Mixed': { type: 'Mixed Cardio', duration: 20, intensity: 'Moderate' },
      'No preference': { type: 'Steady State Cardio', duration: 15, intensity: 'Moderate' }
    };
    var c = types[cardioPref] || types['No preference'];
     
    if (environment === 'Outdoors' || environment === 'Mixed') {
      c.type = c.type + ' (Outdoor)';
    }
    return c;
  }

   
  function buildDietPlan(profile, survey, goalPlan) {
     
     
     
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

     
    var mealsPerDay = 3;
    if (survey.meals === '1 meal') mealsPerDay = 1;
    else if (survey.meals === '2 meals') mealsPerDay = 2;
    else if (survey.meals === '3 meals') mealsPerDay = 3;
    else if (survey.meals === '3+ meals') mealsPerDay = 4;

     
     
     
     
     
     
     
    var hydrationLiters = Math.round(profile.weight * 0.033 * 10) / 10;

     
     
     
     
     
     
     
    var distribution;
    if (mealsPerDay === 1) {
       
       
       
       
      distribution = [
        { type: 'breakfast', portion: 0.25 },
        { type: 'lunch', portion: 0.30 },
        { type: 'dinner', portion: 0.30 },
        { type: 'snack', portion: 0.15 }
      ];
    } else if (mealsPerDay === 2) {
      distribution = [
        { type: 'lunch', portion: 0.45 },
        { type: 'dinner', portion: 0.40 },
        { type: 'snack', portion: 0.15 }
      ];
    } else if (mealsPerDay === 3) {
      distribution = [
        { type: 'breakfast', portion: 0.25 },
        { type: 'lunch', portion: 0.30 },
        { type: 'dinner', portion: 0.30 },
        { type: 'snack', portion: 0.15 }
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
        suggestions: []  
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

   
   



  function generate(user) {
    if (!user || !user.profile || !user.survey) {
      return null;
    }
    var profile = user.profile;
    var survey = user.survey;
    var goalPlan = user.goalPlan || null;
    var generatedAt = Date.now();

     
     
     
     
     
    var daysPerWeek = 3;
    if (survey.schedule === '1-2 days') daysPerWeek = 2;
    else if (survey.schedule === '3-4 days') daysPerWeek = 4;
    else if (survey.schedule === '5+ days') daysPerWeek = 5;
    else if (survey.schedule === 'Everyday') daysPerWeek = 6;

     
     
     
    var sessionMinutes = 30;
    if (survey.time === '15 minutes') sessionMinutes = 15;
    else if (survey.time === '30 minutes') sessionMinutes = 30;
    else if (survey.time === '45 minutes') sessionMinutes = 45;
    else if (survey.time === '60+ minutes') sessionMinutes = 45;

     
    var splitType = chooseSplit(daysPerWeek, profile.goal, survey.level);

     
    var rawSchedule = buildSplitSchedule(splitType, daysPerWeek);

     
     
     
     
     
     
     
     
     
    var perGroup = (sessionMinutes >= 45) ? 5 : (sessionMinutes >= 30 ? 4 : 2);
    var V28_GROUPS = ['Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core'];
     
     
    var planSeed = hashStr(String(user.email || storeSessionEmail() || 'anon') + '|volta-plan|' + generatedAt);
    var workoutSchedule = rawSchedule.map(function (day) {
      var exercises = pickExercises(V28_GROUPS, {
        equipment: survey.equipment,
        difficulty: survey.level,
        injury: survey.injury || profile.injury || 'None',
        perGroup: perGroup,
        goal: profile.goal,
        seed: planSeed + hashStr(day.day + day.focus)
      });
       
       
      var byGroup = {};
      exercises.forEach(function (ex) {
        var g = ex.muscleGroup || 'Core';
        (byGroup[g] = byGroup[g] || []).push(ex);
      });
      var gkeys = V28_GROUPS.filter(function (g) { return byGroup[g] && byGroup[g].length; });
      var interleaved = [];
      var more = true;
      while (more) {
        more = false;
        gkeys.forEach(function (g) {
          if (byGroup[g].length) { interleaved.push(byGroup[g].shift()); more = true; }
        });
      }
      exercises = interleaved.length ? interleaved : exercises;
      var cardio = pickCardio(survey.cardio_pref, profile.goal, survey.environment);
      var duration = sessionMinutes;
      return {
        day: day.day,
        focus: 'Full Body',
        muscleGroups: V28_GROUPS.slice(),
        exercises: exercises,
        cardio: cardio,
        duration: duration
      };
    });

     
    var allDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    var trainingDayNames = workoutSchedule.map(function (d) { return d.day; });
    var restDays = allDays.filter(function (d) { return trainingDayNames.indexOf(d) === -1; });

     
    var dietPlan = buildDietPlan(profile, survey, goalPlan);

     
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
      version: 4,
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

   
   
   
   
   
  function staticMealPool() {
    try {
      if (window.VOLTA_MEAL_SEED && window.VOLTA_MEAL_SEED.length) return window.VOLTA_MEAL_SEED;
    } catch (e) {}
    return [];
  }

   
   
   
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

   
  function dietFilterFor(dietPref) {
    if (dietPref === 'Vegetarian') return 'vegetarian';
    if (dietPref === 'Vegan') return 'vegan';
    if (dietPref === 'Keto') return 'keto';
    if (dietPref === 'Halal') return 'halal';
     
     
     
    if (dietPref === 'Gluten-free') return 'gluten-free';
    return null;  
  }

   
   
   
   
  function filterByDiet(items, dietFilter) {
    if (!dietFilter) return items;
    return items.filter(function (m) {
      if (dietFilter === 'omnivore') return true;
      if (dietFilter === 'vegetarian') return m.diet === 'vegetarian' || m.diet === 'vegan';
      if (dietFilter === 'halal') return m.diet === 'halal' || m.diet === 'omnivore' || !m.diet;
      if (dietFilter === 'gluten-free') {
        var tags = (m.tags || []).map(function (t) { return String(t).toLowerCase(); });
        if (tags.indexOf('allergen: gluten') !== -1) return false;
        if (m.diet === 'gluten-free' || tags.indexOf('gluten free') !== -1) return true;
        var blob = [m.name, m.desc, (m.ingredients || []).join(' ')].join(' ').toLowerCase();
        return !/(wheat|barley|bulgur|couscous|semolina|pita|pasta|noodle|bread|tortilla|wrap|breadcrumb|malt|flour|soy sauce|oatmeal|rolled oats|croissant|bagel|pretzel)/.test(blob);
      }
      if (dietFilter === 'keto') return m.diet === 'keto';
      return m.diet === dietFilter;
    });
  }

   
   
   
   
   
   
  function finalPick(pool, seedStr, kcalTarget, count, mealType) {
    var wantLight = (mealType === 'dinner' || mealType === 'snack') &&
      typeof window.mealLightness === 'function' && typeof window.mealSlotSortKey === 'function';
    var shuffled = wantLight
      ? seededPick(pool, seedStr, pool.length)
      : seededPick(pool, seedStr, Math.min(pool.length, 10));
    if (kcalTarget) {
      shuffled.sort(function (a, b) {
        if (wantLight) {
          return window.mealSlotSortKey(a, kcalTarget, true) - window.mealSlotSortKey(b, kcalTarget, true);
        }
        return Math.abs((a.kcal || 0) - kcalTarget) - Math.abs((b.kcal || 0) - kcalTarget);
      });
    }
    return shuffled.slice(0, count).map(function (m) { return m.name; });
  }

   
   








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
         
        var pool = filterByDiet(dbMeals.filter(function (m) { return m.mealType === meal.type; }), dietFilter);
        if (!pool.length) pool = dbMeals.filter(function (m) { return m.mealType === meal.type; });
        if (!pool.length) pool = filterByDiet(dbMeals, dietFilter);
        if (!pool.length) pool = dbMeals;
        meal.suggestions = pool.length ? finalPick(pool, seedStr, meal.targetCalories, 3, meal.type) : [];
      } catch (e) {
         
        try {
          var fb = staticMealPool().filter(function (m) { return m.mealType === meal.type; });
          meal.suggestions = (fb.length ? fb : staticMealPool()).slice(0, 3).map(function (m) { return m.name; });
        } catch (e2) { meal.suggestions = []; }
      }
    }

     
     
     
     
     
     
     
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

   
  function renderSummary(plan, lang) {
    if (!plan) return '';
    var ar = (lang === 'ar');
    var html = '<div class="plan-summary">';

     
    html += '<div class="plan-section">';
    html += '<h4><i class="fa-solid fa-dumbbell" style="color:var(--accent);margin-right:6px;"></i>' +
            (ar ? 'خطة التمارين' : 'Workout Plan') + '</h4>';
    html += '<div class="plan-stats">';
    html += '<span class="plan-stat-pill"><b>' + plan.workout.splitType + '</b> ' + (ar ? 'تقسيم' : 'split') + '</span>';
    html += '<span class="plan-stat-pill"><b>' + plan.workout.daysPerWeek + '</b> ' + (ar ? 'أيام/أسبوع' : 'days/week') + '</span>';
    html += '<span class="plan-stat-pill"><b>' + plan.workout.sessionMinutes + '</b> ' + (ar ? 'دقيقة/جلسة' : 'min/session') + '</span>';
    html += '</div>';

     
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

     
    html += '<div class="plan-meal-schedule">';
    plan.diet.mealSchedule.forEach(function (meal) {
      html += '<div class="plan-meal">';
      html += '<div class="plan-meal-header"><b>' + meal.type + '</b> <span class="plan-meal-cal">' + meal.targetCalories + ' kcal</span></div>';
      var sug = (meal.suggestions && meal.suggestions.length) ? meal.suggestions : null;
      if (!sug && typeof window.pickMealsForType === 'function') {
         
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
