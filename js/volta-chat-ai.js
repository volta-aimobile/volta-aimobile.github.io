 
























window.VoltaCoachChat = (function () {
  'use strict';

  var state = { open: false, history: [], welcomed: false };

   
   
   
   
  var _qArabic = false;
  function ar() {
    try {
      if (typeof store !== 'undefined' && store.lang === 'ar') return true;
    } catch (e) {}
    return _qArabic;
  }
  function T(en, arTxt) { return ar() ? arTxt : en; }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function u() {
    try { return typeof currentUser === 'function' ? currentUser() : null; } catch (e) { return null; }
  }

   
   
  function trackedWaterMl() {
    try {
      var usr = u();
      if (!usr || !usr.email) return null;
      var raw = localStorage.getItem('volta_water_' + usr.email);
      if (!raw) return null;
      var v = JSON.parse(raw);
      var todayKey = (typeof localDateStr === 'function') ? localDateStr() : new Date().toISOString().slice(0, 10);
      if (v && typeof v === 'object' && v.date === todayKey) return Number(v.ml) || 0;
    } catch (e) {}
    return null;
  }

   
  function snapshot() {
    var x = u() || {};
    var s = x.survey || {};
    var p = x.profile || {};
    var g = x.goalPlan || {};
    var dp = (x.dailyPlan && x.dailyPlan.dailyPlan) ? x.dailyPlan.dailyPlan : null;
    var cur = dp ? (dp[x.dailyPlan.currentDay || 0] || dp[0]) : null;
    var todayKey = (typeof todayStr === 'function') ? todayStr() : new Date().toISOString().slice(0, 10);
    var sessions = x.sessions || [];
    var todaySessions = sessions.filter(function (z) { return z && z.date === todayKey; });
    var eatenK = 0;
    try {
      if (typeof getDietLog === 'function') {
        (getDietLog() || []).forEach(function (z) {
          if ((z.date && z.date === todayKey) || (!z.date && String(z.loggedAt || '').indexOf(todayKey) === 0)) eatenK += (z.kcal || 0);
        });
      }
    } catch (e) {}
    var burnedK = 0;
    try {
      todaySessions.forEach(function (z) { burnedK += (typeof kcalForSession === 'function') ? kcalForSession(z) : 0; });
    } catch (e) {}
    return {
      name: p.name || '', gender: p.gender || '', age: p.age, height: p.height, weight: p.weight,
      goal: p.goal || (g.goal) || '', sport: p.sport || '', level: p.level || '', injury: p.injury || 'None',
      time: s.time || '', schedule: s.schedule || '', sleep: s.sleep || '', meals: s.meals || '',
      hydration: s.hydration || '', equipment: s.equipment || '',
      targetWeight: g.targetWeight, targetCals: g.targetCals, tdee: g.tdee,
      macros: g.macros || {}, targetDate: g.targetDate, daysNeeded: g.daysNeeded,
      streak: x.streak || 0,
      planDays: dp ? dp.length : 0, planDay: dp ? ((x.dailyPlan.currentDay || 0) + 1) : 0,
      todayWorkouts: cur ? (cur.workouts || []) : [],
      doneToday: cur ? (cur.workouts || []).filter(function (w) { return w && w.done; }).length : 0,
      sessionsTotal: sessions.length,
      minutesToday: todaySessions.reduce(function (a, z) { return a + (z.duration || 0); }, 0),
      eatenToday: Math.round(eatenK), burnedToday: Math.round(burnedK),
      dietDaily: (x.plan && x.plan.diet && x.plan.diet.dailyCalories) || g.targetCals || 0,
      waterGoal: (x.plan && x.plan.diet && x.plan.diet.hydrationLiters) || '',
       
       
       
      dietPlan: (function () {
        var d = x.plan && x.plan.diet;
        if (!d) return null;
        var todayKey2 = todayKey;
        var logged = {};
        try {
          if (typeof getDietLog === 'function') {
            (getDietLog() || []).forEach(function (z) {
              if ((z && z.date) === todayKey2) logged[(z.name || '').toLowerCase()] = 1;
            });
          }
        } catch (e2) {}
        var slots = (d.mealSchedule || []).map(function (s) {
          var sug = (s.suggestions || []).map(function (n) { return String(n || ''); });
          return {
            type: s.type,
            targetCalories: s.targetCalories || 0,
            suggestions: sug,
            loggedToday: sug.some(function (n) { return logged[n.toLowerCase()]; })
          };
        });
        return {
          dailyCalories: d.dailyCalories || 0,
          macros: d.macros || {},
          hydrationLiters: d.hydrationLiters || 0,
          slots: slots
        };
      })(),
      workoutPlan: (function () {
        var w = x.plan && x.plan.workout;
        if (!w) return null;
        var sched = (w.schedule || []).map(function (day) {
          return {
            day: day.day || '',
            focus: day.focus || '',
            count: (day.exercises || []).length,
            exercises: (day.exercises || []).map(function (e) { return String(e.name || ''); })
          };
        });
        var todayIdx = -1;
        var wk = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        var t3 = wk[new Date().getDay()];
        for (var i = 0; i < sched.length; i++) {
          if (String(sched[i] && sched[i].day || '').slice(0,3) === t3) { todayIdx = i; break; }
        }
        return {
          splitType: w.splitType || 'Custom',
          daysPerWeek: w.daysPerWeek || sched.length,
          sessionMinutes: w.sessionMinutes || 30,
          restDays: w.restDays || [],
          schedule: sched,
          todayIdx: todayIdx,
          source: x.plan.source || ''
        };
      })()
    };
  }

   
  function mealNameFor(s, n) {
    var nm = String(n || '');
    if (!ar()) return nm;
    try {
      if (typeof getMealName === 'function') {
        var probe = { name: nm };
        var out = getMealName(probe);
        if (out && out !== nm) return out;
      }
    } catch (e) {}
    return nm;
  }
  function slotLabel(type) {
    var map = { breakfast: ['Breakfast', 'الفطور'], lunch: ['Lunch', 'الغداء'], dinner: ['Dinner', 'العشاء'], snack: ['Snack', 'سناك'] };
    var r = map[type] || [type, type];
    return ar() ? r[1] : r[0];
  }
  function dietPlanSummary(s, onlySlot) {
    var dp = s.dietPlan;
    if (!dp) return T('No diet plan yet — finish the goal setup or regenerate your plan and I\'ll track every meal with you.', 'لا توجد خطة غذائية بعد — أكمل إعداد الهدف أو أعد توليد الخطة وسأتتبع كل وجبة معك.');
    var lines = [];
    lines.push(T('Your diet plan targets **' + dp.dailyCalories + ' kcal**' +
      (dp.macros && dp.macros.p ? ' · ' + dp.macros.p + 'g P / ' + (dp.macros.c || '--') + 'g C / ' + (dp.macros.f || '--') + 'g F' : '') +
      (dp.hydrationLiters ? ' · ' + dp.hydrationLiters + 'L water' : '') + '.', 'خطتك الغذائية تستهدف **' + dp.dailyCalories + ' سعرة**' +
      (dp.macros && dp.macros.p ? ' · بروتين ' + dp.macros.p + ' / كارب ' + (dp.macros.c || '--') + ' / دهون ' + (dp.macros.f || '--') : '') +
      (dp.hydrationLiters ? ' · ماء ' + dp.hydrationLiters + ' لتر' : '') + '.'));
    (dp.slots || []).forEach(function (slot) {
      if (onlySlot && slot.type !== onlySlot) return;
      var names = (slot.suggestions || []).slice(0, 3).map(function (n) { return mealNameFor(s, n); });
      var flag = slot.loggedToday ? ' ✓' : '';
      if (names.length) {
        lines.push('• ' + slotLabel(slot.type) + ' (' + (slot.targetCalories || '--') + ' kcal): ' + names.join('، ') + flag);
      } else {
        lines.push('• ' + slotLabel(slot.type) + ' (' + (slot.targetCalories || '--') + ' kcal) — ' + T('tap the DIET PLAN card to fill suggestions', 'افتح بطاقة الخطة لتعبئة الاقتراحات'));
      }
    });
    if (onlySlot && !lines.some(function (l) { return l.indexOf('•') === 0; })) {
      return T('Your plan has no ' + onlySlot + ' slot — meals per day is set to ' + ((s.dietPlan.slots || []).length) + '.', 'خطتك لا تحتوي وجبة ' + onlySlot + ' — عدد الوجبات المضبوط ' + ((s.dietPlan.slots || []).length) + '.');
    }
    var wp = s.workoutPlan;
    if (wp) {
      var td = (wp.schedule || [])[(wp.todayIdx != null && wp.todayIdx >= 0 ? wp.todayIdx : 0)];
      lines.push(T('Training side today: ', 'جانب التمرين اليوم: ') + (td ? (td.focus || 'Training') + ' · ' + (td.count || 0) + ' ' + T('exercises', 'تمارين') : T('rest day', 'يوم راحة')) + '.');
    }
    return lines.join('\n');
  }
  function workoutPlanSummary(s) {
    var wp = s.workoutPlan;
    if (!wp) return T('No workout plan yet — generate one from the survey or build a custom plan and I\'ll coach every rep.', 'لا توجد خطة تمارين بعد — أنشئ واحدة من الاستبيان أو ابنِ خطة مخصصة وسأرشد كل تكرار.');
    var lines = [];
    lines.push(T('Your plan: **' + (wp.splitType || 'Custom') + '** · ' + wp.daysPerWeek + T(' days/week · ', ' أيام/أسبوع · ') + wp.sessionMinutes + T(' min/session', ' دقيقة/جلسة') + '.', 'خطتك: **' + (wp.splitType || 'Custom') + '** · ' + wp.daysPerWeek + ' أيام/أسبوع · ' + wp.sessionMinutes + ' دقيقة/جلسة.'));
    (wp.schedule || []).forEach(function (day, i) {
      var mark = (i === wp.todayIdx) ? ' ← ' + T('today', 'اليوم') : '';
      var ex = (day.exercises || []).slice(0, 4).map(function (n) {
        return ar() ? ((typeof WORKOUT_AR_NAMES !== 'undefined' && WORKOUT_AR_NAMES[n]) || n) : n;
      });
      lines.push('• ' + (day.day || ('Day ' + (i + 1))) + ' — ' + (day.focus || 'Training') + ' (' + (day.count || 0) + T(' ex', ' تمرين') + ')' + mark + (ex.length ? ': ' + ex.join('، ') + ((day.count || 0) > 4 ? ' …' : '') : ''));
    });
    if ((wp.restDays || []).length) {
      lines.push(T('Rest days: ' + wp.restDays.join(', ') + '.', 'أيام الراحة: ' + wp.restDays.join('، ') + '.'));
    } else {
      lines.push(T('The days not listed above are your rest days.', 'الأيام غير المذكورة أعلاه هي أيام راحتك.'));
    }
    var dp = s.dietPlan;
    if (dp) lines.push(T('Fuel side: ' + dp.dailyCalories + ' kcal target today.', 'جانب الوقود: هدف ' + dp.dailyCalories + ' سعرة اليوم.'));
    return lines.join('\n');
  }
  function bothPlansSummary(s) {
    var parts = [];
    parts.push(T('Here\'s your full picture — training AND fuel:', 'هذه صوركتك الكاملة — التمرين والوقود معًا:'));
    parts.push('');
    parts.push(workoutPlanSummary(s));
    parts.push('');
    parts.push(dietPlanSummary(s));
    return parts.join('\n');
  }
  function restDaysAnswer(s) {
    var wp = s.workoutPlan;
    if (!wp) return T('No workout plan yet, so no rest days are set. Generate a plan and the schedule protects your recovery automatically.', 'لا توجد خطة تمارين بعد، لذا لا توجد أيام راحة مضبوطة. أنشئ خطة وسيحمي جدولك استشفاءك تلقائيًا.');
    var wk = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    var training = {};
    (wp.schedule || []).forEach(function (d) {
      var k = String(d.day || '').slice(0, 3).toLowerCase();
      for (var i = 0; i < 7; i++) { if (wk[i].slice(0, 3).toLowerCase() === k) training[i] = 1; }
    });
    if (Object.keys(training).length === 0) {
      return T('Your plan uses numbered days, so rest falls between them — ' + wp.daysPerWeek + ' training days, the others recover.', 'خطتك تستخدم أيامًا مرقمة، فالراحة بينها — ' + wp.daysPerWeek + ' أيام تدريب والباقي استشفاء.');
    }
    var rest = [];
    for (var j = 0; j < 7; j++) { if (!training[j]) rest.push(ar() ? ['الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت','الأحد'][j] : wk[j]); }
    var out = rest.length
      ? T('Your rest days are **' + rest.join(', ') + '** — ' + wp.daysPerWeek + ' training days spread around them.', 'أيام راحتك هي **' + rest.join('، ') + '** — ' + wp.daysPerWeek + ' أيام تدريب موزعة حولها.')
      : T('Your plan trains every day of the week — consider giving at least one day fully off.', 'خطتك تتدرب كل أيام الأسبوع — فكر في إعطاء يوم واحد راحة كاملة على الأقل.');
    out += T('\nRecovery is where muscle is built: sleep 7-9h, hit ' + (s.waterGoal || '2.5') + 'L water, and keep rest-day protein high.', '\nالاستشفاء هو حيث تُبنى العضلات: نم 7-9 ساعات، اشرب ' + (s.waterGoal || '2.5') + ' لتر ماء، وحافظ على بروتين عالٍ في أيام الراحة.');
    return out;
  }

   
  function listTodayWorkouts(s) {
    if (!s.todayWorkouts.length) {
      return T("You don't have a training day generated yet — open the Daily Exercise tab and start a plan, and I'll coach you through every exercise.",
              "لا يوجد يوم تدريب مُنشأ بعد — افتح تبويب التمرين اليومي وابدأ خطة، وسأرشدك في كل تمرين.");
    }
    var names = s.todayWorkouts.map(function (w, i) {
      var nm = ar() ? ((typeof WORKOUT_AR_NAMES !== 'undefined' && WORKOUT_AR_NAMES[w.name]) || w.name) : w.name;
      return (i + 1) + '. ' + nm + ' — ' + (w.sets || 2) + '×' + (w.reps || '10-12') + (w.done ? ' ✓' : '');
    }).join('\n');
    return T('Today is day ', 'اليوم ') + s.planDay + T(' of ', ' من ') + s.planDays + T('. Your list (', '. قائمتك (') +
            s.doneToday + T(' done):\n', ' تم):\n') + names;
  }

  function fmtNum(n) { return (n == null || isNaN(n)) ? '--' : Math.round(Number(n)); }

   
   
   
  var INTENTS = [
    {
      id: 'greet', re: /^(hi|hey|hello|yo|salam|salaam|سلام|مرحبا|اهلا|أهلا|هلا|صباح|مساء)\b/i,
      fn: function (s) {
        return T('Hey' + (s.name ? ' ' + s.name : '') + '! ⚡ I\'m your Volta coach — the AI model built into this app answers every training question right on your device, and your plan, sessions and diet log answer instantly too. Ask me anything — drills, technique, nutrition, recovery.',
                'أهلاً' + (s.name ? ' ' + s.name : '') + '! ⚡ أنا مدربك في فولتا — محرك المعرفة المدمج يجيب أسئلة الرياضة والتدريب فوراً، وبياناتك (خطتك وجلساتك وسجل غذائك) أمامي مباشرة. اسألني أي شيء — تمارين، تقنية، تغذية، استشفاء.');
      }
    },
     
     
     
     
     
     
    {
      id: 'my-plan', re: /(my plan|both plans|full plan|my schedule|خطتي|خطتيا|الخطة|برنامجي)/i,
      fn: function (s) { return bothPlansSummary(s); }
    },
    {
      id: 'diet-plan', re: /(diet plan|nutrition plan|meal plan|meal schedule|what.*eat today|خطة (الغذاء|التغذية|الاكل|الوجبات)|ماذا آكل|النظام الغذائي)/i,
      fn: function (s) { return dietPlanSummary(s); }
    },
    {
      id: 'workout-plan', re: /(workout plan|training plan|training split|weekly plan|training week|خطة (التمارين|التدريب|التمرين)|برنامج التمارين|تدريبات الاسبوع)/i,
      fn: function (s) { return workoutPlanSummary(s); }
    },
    {
      id: 'meal-slot', re: /(what('| i)?s? (for|at) (breakfast|lunch|dinner|snack)|my (breakfast|lunch|dinner|snack)|tonight'?s dinner|ما.*(فطور|غداء|عشاء|سناك|وجبة خفيفة)|عشاء الليلة)/i,
      fn: function (s, q) {
        var slot = null;
        var m = q.match(/breakfast|lunch|dinner|snack|فطور|غداء|عشاء|سناك|خفيفة/i);
        if (m) {
          var w2 = String(m[0]).toLowerCase();
          if (/فطور/.test(w2)) slot = 'breakfast';
          else if (/غداء/.test(w2)) slot = 'lunch';
          else if (/عشاء/.test(w2)) slot = 'dinner';
          else if (/سناك|خفيفة/.test(w2)) slot = 'snack';
          else slot = w2;
        }
        return dietPlanSummary(s, slot);
      }
    },
    {
      id: 'rest-days', re: /(rest days?|off days?|days off|recovery days?|أيام (الراحة|الاستشفاء)|راحة)/i,
      fn: function (s) { return restDaysAnswer(s); }
    },
    {
      id: 'workout-today', re: /(today'?s? workout|what.*(do|train).*(today|now)|my workout|workout list|today'?s? plan|تمارين اليوم|تمرين اليوم|قائمة التمارين|خطة اليوم|اتدرب ايه|أتمرن ماذا)/i,
      fn: function (s) { return listTodayWorkouts(s); }
    },
    {
      id: 'rest', re: /(rest|break|pause|استراحة|راحة|break time)/i,
      fn: function (s) {
        return T('Your plan has a 60-second rest after every 2 exercises — enough to breathe, not enough to go cold. Sip water, shake the arms, and start the next pair on time.',
                'خطتك فيها راحة 60 ثانية بعد كل تمرينين — تكفي لتلتقط نفسك دون أن يبرد جسمك. اشرب قليلاً من الماء وحرّك ذراعيك وابدأ الزوج التالي في وقته.') +
              (s.injury && s.injury !== 'None'
                ? T('\nAnd since you noted ' + s.injury + ' pain — skip anything that tweaks it and tell me, I\'ll adapt.',
                   '\nوبما أنك ذكرت ألماً في ' + s.injury + ' — تجاوز أي تمرين يهيّجه وأخبرني لأكيّف الخطة.')
                : '');
      }
    },
    {
      id: 'calories-burned', re: /(burn(ed|ing)?|kcal burnt|calories burn|سعرات محروقة|حرقت|حرق)/i,
      fn: function (s) {
        if (!s.burnedToday && !s.minutesToday) {
          return T('Nothing logged yet today. Your first exercise in Daily Exercise will start the counter — every MET-accurate calorie shows up in the flame.',
                  'لا يوجد تسجيل اليوم بعد. أول تمرين في التمرين اليومي سيبدأ العداد — كل سعرة محسوبة بدقة MET ستظهر في اللهب.');
        }
        return T('You\'ve burned about ', 'لقد حرقت حوالي ') + fmtNum(s.burnedToday) + T(' kcal in ', ' سعرة في ') + fmtNum(s.minutesToday) + T(' minutes today. Keep the pace and the flame keeps growing. 🔥',
                ' دقيقة اليوم. حافظ على إيقاعك واللهب يكبر. 🔥');
      }
    },
    {
      id: 'calories-left', re: /(calories? left|kcal left|how many (more )?calories|remaining calories|سعرات متبقية|المتبقي|كم سعرة)/i,
      fn: function (s) {
        if (!s.dietDaily) return T('No calorie target is set yet — finish the goal setup and I\'ll track your budget to the kcal.', 'لا يوجد هدف سعرات بعد — أكمل إعداد الهدف وسأتابع ميزانيتك بدقة.');
        var left = Math.max(0, Math.round(s.dietDaily + s.burnedToday - s.eatenToday));
        return T('Target ' + fmtNum(s.dietDaily) + ' kcal' + (s.burnedToday ? ' + ' + fmtNum(s.burnedToday) + ' burned' : '') + ' − ' + fmtNum(s.eatenToday) + ' eaten ≈ **' + fmtNum(left) + ' kcal left** today. Log meals in the Diet tab and I\'ll keep this live.',
                'هدفك ' + fmtNum(s.dietDaily) + ' سعرة' + (s.burnedToday ? ' + ' + fmtNum(s.burnedToday) + ' محروقة' : '') + ' − ' + fmtNum(s.eatenToday) + ' مأكولة ≈ **باقي ' + fmtNum(left) + ' سعرة** اليوم. سجّل وجباتك في تبويب التغذية وسأحدّث الرقم.');
      }
    },
    {
      id: 'protein', re: /(protein|بروتين)/i,
      fn: function (s) {
        var p = s.macros && s.macros.p;
        var perKg = (s.weight && p) ? (p / s.weight).toFixed(1) : null;
        return T(p
            ? 'Your daily protein target is **' + p + 'g**' + (perKg ? ' (~' + perKg + 'g per kg)' : '') + '. Spread it over ' + (s.meals || '3') + ' meals — chicken, fish, eggs, Greek yogurt, lentils; 30-40g per meal absorbs better than one giant hit.'
            : 'Aim for **1.6-2g protein per kg** — for you that\'s about ' + (s.weight ? Math.round(s.weight * 1.8) : '120-160') + 'g a day. Chicken, fish, eggs, dairy, lentils; spread it across your meals.',
          p
            ? 'هدفك اليومي من البروتين **' + p + ' جرام**' + (perKg ? ' (~' + perKg + ' جرام لكل كجم)' : '') + '. وزّعه على ' + (s.meals || '3') + ' وجبات — دجاج وسمك وبيض وزبادي يوناني وعدس؛ 30-40 جراماً في الوجبة يمتص أفضل من جرعة واحدة ضخمة.'
            : 'استهدف **1.6-2 جرام بروتين لكل كجم** — يعني لك حوالي ' + (s.weight ? Math.round(s.weight * 1.8) : '120-160') + ' جراماً يومياً. دجاج وسمك وبيض وألبان وعدس، موزعة على وجباتك.');
      }
    },
    {
      id: 'eat', re: /(what.*(eat|food|meal)|meal idea|any food|food idea|اكل|آكل|وجبة|اقترح وجبة)/i,
      fn: function (s) {
        return T('Match the plate to the goal (' + (s.goal || 'general fitness') + '): half vegetables, a palm of protein, a fist of carbs, and don\'t fear the healthy fats. Tap any meal chip in your DIET PLAN card — they\'re one tap from being logged.',
                'ناسب الطبق مع هدفك (' + (s.goal || 'لياقة عامة') + '): نصفها خضروات، وكفّ بروتين، وقبضة كربوهيدرات، ولا تخف من الدهون الصحية. اضغط أي رقاقة وجبة في بطاقة خطة التغذية — تسجيلها بضغطة واحدة.');
      }
    },
    {
      id: 'water', re: /(water|hydrat|drink|ماء|الماء|اشرب|ترطيب|سوائل)/i,
      fn: function (s) {
        var goal = s.waterGoal || (s.hydration && /3L|3\+/.test(s.hydration) ? '3' : '2');
         
         
        var sofar = trackedWaterMl();
        if (sofar != null) {
          return T('You\'re at **' + sofar + ' ml** so far today — aim for **' + goal + 'L**. Fill a bottle now, sip during every rest, and tell me each glass so I can keep counting.',
                  'وصلت إلى **' + sofar + ' مل** حتى الآن اليوم — استهدف **' + goal + ' لتر**. املأ قارورة الآن واشرب في كل استراحة، وأخبرني بكل كأس لأحسبها لك.');
        }
        return T('Aim for **' + goal + 'L** today. Fill a bottle now, sip during every rest — the 60s breaks are perfect for it, and your water strip ticks up in the Diet tab.',
                'استهدف **' + goal + ' لتر** اليوم. املأ قارورة الآن واشرب في كل استراحة — فترات الراحة الـ60 ثانية مثالية لذلك، وشريط الماء في تبويب التغذية يتحدث.');
      }
    },
    {
      id: 'progress', re: /(my progress|how am i doing|stats|progress|تقدمي|كيف حالي|إحصائيات|احصائيات)/i,
      fn: function (s) {
        if (ar()) {
          return 'ملخص سريع: ' + s.sessionsTotal + ' جلسة مسجلة' +
                 (s.streak ? '، وسلسلة **' + s.streak + ' يوم** 🔥' : '') +
                 '. اليوم: ' + s.doneToday + '/' + s.todayWorkouts.length + ' تمرين، ' + fmtNum(s.minutesToday) + ' دقيقة، ' + fmtNum(s.burnedToday) + ' سعرة.' +
                 (s.doneToday < s.todayWorkouts.length ? ' التكرار القادم هو الأهم — هيا.' : ' أكملت يومك كاملاً. أسطورة. 💪');
        }
        return 'Quick snapshot: ' + s.sessionsTotal + ' sessions logged' +
               (s.streak ? ', streak **' + s.streak + 'd** 🔥' : '') +
               '. Today: ' + s.doneToday + '/' + s.todayWorkouts.length + ' exercises, ' + fmtNum(s.minutesToday) + ' min, ' + fmtNum(s.burnedToday) + ' kcal.' +
               (s.doneToday < s.todayWorkouts.length ? ' The next rep is the one that counts — go get it.' : ' Full house today. Legend. 💪');
      }
    },
    {
      id: 'weight-goal', re: /(weight|kg|lose|gain|target|goal weight|وزن|هدفي|اخسر|ازيد|أزيد)/i,
      fn: function (s) {
        if (s.targetWeight && s.weight) {
          var diff = Math.round((Number(s.targetWeight) - Number(s.weight)) * 10) / 10;
          var dir = diff < 0 ? T('lose **' + Math.abs(diff) + 'kg**', 'تفقد **' + Math.abs(diff) + ' كجم**') : T('gain **' + diff + 'kg**', 'تكسب **' + diff + ' كجم**');
          return T('You\'re at ' + s.weight + 'kg, target ' + s.targetWeight + 'kg — ' + dir + ' to go' +
                   (s.daysNeeded ? T(', about ' + s.daysNeeded + ' days at your current pace', '، حوالي ' + s.daysNeeded + ' يوماً بإيقاعك الحالي') : '') + '. ' +
                   (s.targetCals ? T('Your engine runs on **' + fmtNum(s.targetCals) + ' kcal/day** — respect it and the scale follows.', 'محركك يعمل على **' + fmtNum(s.targetCals) + ' سعرة/يوم** — التزم بها والميزان يتبع.') : ''),
                  'أنت عند ' + s.weight + ' كجم والهدف ' + s.targetWeight + ' كجم — ' + dir +
                  (s.daysNeeded ? '، حوالي ' + s.daysNeeded + ' يوماً بإيقاعك' : '') + '. ' +
                  (s.targetCals ? 'سعراتك اليومية **' + fmtNum(s.targetCals) + '** — التزم بها والميزان يتبع.' : ''));
        }
        return T('Set your target weight in the Profile tab and I\'ll compute the daily calories and the timeline for you.',
                 'حدد وزنك المستهدف في تبويب الملف الشخصي وسأحسب لك السعرات اليومية والجدول الزمني.');
      }
    },
    {
      id: 'streak', re: /(streak|سلسلة|تتابع)/i,
      fn: function (s) {
        return s.streak
          ? T('**' + s.streak + '-day streak** 🔥 — every day you show up, the habit gets cheaper and the results get closer. Protect it: even a short session keeps the chain alive.',
             '**سلسلة ' + s.streak + ' يوم** 🔥 — كل يوم تحضر فيه، تصبح العادة أسهل والنتائج أقرب. احمِها: حتى جلسة قصيرة تُبقي السلسلة حية.')
          : T('No streak yet — today is day 1 if you want it. One exercise is enough to light the first flame. 🔥',
             'لا سلسلة بعد — اليوم يمكن أن يكون اليوم الأول. تمرين واحد يكفي لإشعال أول لهب. 🔥');
      }
    },
    {
      id: 'sore', re: /(sore|soreness|tired|fatigue|exhaust|recovery|استشفاء|تعب|مرهق|إرهاق|ارهق|عضلاتي)/i,
      fn: function (s) {
        return T('Soreness peaks 24-48h after a session — it\'s adaptation, not damage. Keep moving (light walking, easy reps), hydrate, and sleep 7h+; that\'s where recovery actually happens.' +
                 (s.sleep && /less|أقل|5/i.test(s.sleep) ? ' Your sleep answer says under 6h — that\'s the #1 thing to fix for recovery AND fat loss.' : '') +
                 (s.injury && s.injury !== 'None' ? ' For your ' + s.injury + ': warm it up gently, never train through sharp pain.' : ''),
                 'ألم العضلات يبلغ ذروته بعد 24-48 ساعة — إنه تكيّف وليس ضرراً. استمر في الحركة (مشي خفيف، تكرارات سهلة)، اشرب ماءً، ونم 7 ساعات أو أكثر؛ فالاستشفاء الحقيقي يحدث هناك.' +
                 (s.sleep && /أقل|less|5/i.test(s.sleep) ? ' إجابتك عن النوم تقول أقل من 6 ساعات — هذا أول ما يجب إصلاحه للاستشفاء وحرق الدهون معاً.' : '') +
                 (s.injury && s.injury !== 'None' ? ' وبالنسبة لـ' + s.injury + ': سخّنها برفق ولا تتمرن أبداً وسط ألم حاد.' : ''));
      }
    },
    {
      id: 'cardio', re: /(cardio|run|running|jog|كارديو|جري|ركض)/i,
      fn: function (s) {
        return T((s.goal === 'Lose weight' || s.goal === 'Improve endurance')
            ? 'Cardio is your engine: 2-3 sessions this week, 20-30 min at a pace where you can still talk. The Sports tab tracks every minute and every calorie for you.'
            : 'Cardio as a side dish: 1-2 easy 20-min sessions a week keeps the heart healthy without eating your muscle. Log it from the Sports tab and it feeds your rings.',
          ((s.goal === 'Lose weight' || s.goal === 'Improve endurance')
            ? 'الكارديو هو محركك: 2-3 جلسات هذا الأسبوع، 20-30 دقيقة بإيقاع تستطيع معه الكلام. تبويب الرياضات يسجل كل دقيقة وكل سعرة.'
            : 'الكارديو كطبق جانبي: 1-2 جلسة سهلة مدتها 20 دقيقة أسبوعياً تحفظ صحة قلبك دون أن تأكل عضلاتك. سجلها من تبويب الرياضات وستغذي حلقاتك.'));
      }
    },
    {
      id: 'motivation', re: /(motivat|inspire|quote|pump me|lazy|dont feel|don.t feel|همة|تحفيز|حماس|كسل|كسول)/i,
      fn: function (s) {
        var quotes = [
          T('Discipline is choosing what you want MOST over what you want NOW. Your ' + (s.time || '15-minute') + ' session is the whole ask for today.', 'الانضباط هو أن تختار ما تريده أكثر على ما تريده الآن. جلستك (' + (s.time || '15 دقيقة') + ') هي كل المطلوب اليوم.'),
          T('You don\'t need motivation — you need 2 exercises. Start the first one and watch what happens to the rest of the day.', 'لا تحتاج حماساً — تحتاج تمرينين فقط. ابدأ الأول وشاهد ما يحدث لبقية يومك.'),
          T('Every rep you do today is a rep your future self doesn\'t have to fight for. ' + (s.name ? 'Go, ' + s.name + '.' : 'Go.'), 'كل تكرار تؤديه اليوم هو تكرار لن يناضل من أجله نفسك المستقبلي. ' + (s.name ? 'هيا يا ' + s.name + '.' : 'هيا.')),
          T('The flame on your dashboard doesn\'t grow by itself. 🔥 Give it something to burn.', 'اللهب على لوحتك لا يكبر وحده. 🔥 أعطه ما يحرقه.')
        ];
        return quotes[Math.floor(Math.random() * quotes.length)];
      }
    },
    {
      id: 'plan', re: /(my plan|plan overview|the plan|how many (exercises|workouts)|خطتي|الخطة|كم تمرين)/i,
      fn: function (s) {
        var per = { '15 minutes': 2, '30 minutes': 4, '45 minutes': 5 }[s.time] || 2;
        return T('Your plan: ' + (s.planDays || 'multi-day') + ' days, ' + (s.time || '15 minutes') + ' sessions. Every day is full-body — ' + per + ' exercises per muscle group (chest, back, legs, shoulders, arms, core) = ' + (per * 6) + ' exercises, 2 sets each, with a 60s rest after every 2. ' + (s.schedule ? 'You train ' + s.schedule + '.' : ''),
                'خطتك: ' + (s.planDays || 'عدة أيام') + ' أيام، وجلسات ' + (s.time || '15 دقيقة') + '. كل يوم شامل للجسم — ' + per + ' تمارين لكل مجموعة عضلية (صدر، ظهر، أرجل، أكتاف، ذراعين، بطن) = ' + (per * 6) + ' تمريناً، مجموعتان لكل تمرين، وراحة 60 ثانية بعد كل تمرينين. ' + (s.schedule ? 'تتدرب ' + s.schedule + '.' : ''));
      }
    },
    {
      id: 'bmi', re: /(bmi|body mass|كتلة الجسم)/i,
      fn: function (s) {
        if (!s.weight || !s.height) return T('Add your height and weight in Profile and I\'ll compute your BMI instantly.', 'أضف طولك ووزنك في الملف الشخصي وسأحسب مؤشر كتلة جسمك فوراً.');
        var bmi = s.weight / Math.pow(s.height / 100, 2);
        var cat = bmi < 18.5 ? T('underweight', 'نقص وزن') : bmi < 25 ? T('healthy range', 'النطاق الصحي') : bmi < 30 ? T('overweight', 'زيادة وزن') : T('obese', 'سمنة');
        return T('Your BMI is **' + bmi.toFixed(1) + '** (' + cat + '). It\'s a rough screen, not a verdict — muscle, frame and waist tell the real story.',
                 'مؤشر كتلة جسمك **' + bmi.toFixed(1) + '** (' + cat + '). إنه فحص تقريبي وليس حكماً — العضلات والقوام ومحيط الخصر يحكون القصة الحقيقية.');
      }
    },
    {
      id: 'equipment', re: /(equipment|gear|what do i need|معدات|عدة|أدوات)/i,
      fn: function (s) {
        return T(s.equipment && !/none|لا/i.test(s.equipment)
            ? 'You told me you have: ' + s.equipment + '. Your plans already only include exercises you can actually do — everything is calibrated to that.'
            : 'You\'re equipment-free — and your plans are already 100% bodyweight. No gear needed; gravity is the best gym membership anyway.',
          s.equipment && !/none|لا/i.test(s.equipment)
            ? 'أخبرتني أن لديك: ' + s.equipment + '. خططك أصلاً لا تحتوي إلا على تمارين تستطيع أداءها فعلاً — كل شيء مضبوط على ذلك.'
            : 'أنت بلا معدات — وخططك بالفعل 100% بوزن الجسم. لا تحتاج شيئاً؛ فالجاذبية أفضل اشتراك صالة على أي حال.');
      }
    },
    {
      id: 'form', re: /(form|technique|how (do|to) (i )?(do|perform)|correct way|أداء|طريقة|صحيح|أدي)/i,
      fn: function (s, q) {
         
        var hit = null;
        try {
          if (typeof WORKOUT_INFO !== 'undefined') {
            Object.keys(WORKOUT_INFO).forEach(function (k) {
              if (!hit && q.toLowerCase().indexOf(k.toLowerCase()) !== -1) hit = k;
            });
          }
        } catch (e) {}
        if (hit) {
          var info = WORKOUT_INFO[hit];
          return T('**' + hit + '** (' + (info.muscle || '') + '): ', '**' + hit + '** (' + (info.muscle || '') + '): ') + (ar() ? 'اضغط على التمرين في قائمتك لرؤية صور البداية والنهاية. ' : 'Tap the exercise in your list to see the start/end pose images. ') + (info.desc || '');
        }
        return T('Tap any exercise in your Daily Exercise list — the popup shows the correct start and end poses, the exact muscles, the calorie burn, and Coach AI form cues.',
                 'اضغط أي تمرين في قائمة التمرين اليومي — ستظهر لك صور وضعيتي البداية والنهاية والعضلات المستهدفة والسعرات وتلميحات الأداء.');
      }
    },
    {
      id: 'thanks', re: /(thanks|thank you|shukran|شكرا|متشكر|تمام كده|bye|goodbye)/i,
      fn: function (s) {
        return T('Anytime' + (s.name ? ', ' + s.name : '') + '. ⚡ Now go earn that flame.', 'في أي وقت' + (s.name ? ' يا ' + s.name : '') + '. ⚡ والآن اذهب واكسب لهبك.');
      }
    }
  ];

   
   
   
   
  function tryIntents(q) {
    var s = snapshot();
    for (var i = 0; i < INTENTS.length; i++) {
      if (INTENTS[i].re.test(q)) {
        return ar() && INTENTS[i].arFn ? INTENTS[i].arFn(s, q) : INTENTS[i].fn(s, q);
      }
    }
    return null;
  }

  function brain(q) {
    var quick = tryIntents(q);
    if (quick != null) return quick;
    var s = snapshot();
     
     
     
     
     
    return T('Hang on — my AI engine is still loading on your device. Give it a few seconds and ask again; your plan, sessions and diet log answer instantly in the meantime.',
            'لحظة — محرك الذكاء على جهازك ما زال يحمّل. انتظر ثوانٍ وأعد السؤال؛ بياناتك (الخطة والجلسات وسجل الغذاء) تجيب فوراً في هذه الأثناء.');
  }

   
  function ensureButton() {
    if (document.getElementById('volta-ai-chat-btn')) return;
    var b = document.createElement('button');
    b.id = 'volta-ai-chat-btn';
    b.type = 'button';
    b.setAttribute('aria-label', T('Coach AI chat', 'محادثة المدرب الذكي'));
     
     
     
    b.innerHTML = '<i class="fa-solid fa-comment-dots"></i>';
    b.addEventListener('click', function (e) { e.stopPropagation(); toggle(); });
    document.body.appendChild(b);
  }

   
  function ensureModal() {
    if (document.getElementById('volta-ai-chat-modal')) return;
    var m = document.createElement('div');
    m.id = 'volta-ai-chat-modal';
    m.className = 'modal-overlay';
    m.style.zIndex = '10020';
    m.innerHTML =
      '<div class="modal-content vcoach-window">' +
        '<button class="modal-close" type="button" id="vcoach-close" aria-label="Close"></button>' +
        '<div class="vcoach-head">' +
          '<span class="vcoach-ava"><i class="fa-solid fa-comment-dots"></i></span>' +
          '<div class="vcoach-head-txt">' +
            '<b>' + esc(T('Coach AI', 'المدرب الذكي')) + '</b>' +
          '</div>' +
        '</div>' +
        '<div class="vcoach-loadbar-wrap" id="vcoach-loadbar-wrap" style="display:none;">' +
          '<div class="vcoach-loadbar-info">' +
            '<span class="vcoach-loadbar-text" id="vcoach-loadbar-text">' + esc(T('Loading AI model…', 'جارٍ تحميل نموذج الذكاء…')) + '</span>' +
            '<span class="vcoach-loadbar-pct" id="vcoach-loadbar-pct">0%</span>' +
          '</div>' +
          '<div class="vcoach-loadbar-track"><div class="vcoach-loadbar-fill" id="vcoach-loadbar-fill"></div></div>' +
        '</div>' +
        '<div class="vcoach-body" id="vcoach-body"></div>' +
        '<div class="vcoach-chips" id="vcoach-chips"></div>' +
        '<div class="vcoach-input-wrap">' +
          '<textarea id="vcoach-input" rows="1" placeholder="' + esc(T('Ask me anything about your training…', 'اسألني أي شيء عن تدريبك…')) + '"></textarea>' +
          '<button type="button" id="vcoach-send" aria-label="' + esc(T('Send', 'إرسال')) + '"><i class="fa-solid fa-paper-plane"></i></button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(m);

    document.getElementById('vcoach-close').addEventListener('click', close);
    m.addEventListener('click', function (e) { if (e.target === m) close(); });
    document.getElementById('vcoach-send').addEventListener('click', sendCurrent);
    var input = document.getElementById('vcoach-input');
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCurrent(); }
    });
    input.addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 96) + 'px';
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.open) close();
    });
  }

  var loadbarTimer = null;
  function showLoadBar() {
    var wrap = document.getElementById('vcoach-loadbar-wrap');
    if (!wrap) return;
    wrap.style.display = '';
    updateLoadBar(3);
    if (loadbarTimer) clearInterval(loadbarTimer);
    loadbarTimer = setInterval(function () {
      try {
        var st = window.VoltaLocalLLM && window.VoltaLocalLLM.status ? window.VoltaLocalLLM.status() : null;
        if (!st) return;
        if (st.phase === 'ready') {
          updateLoadBar(100);
          if (loadbarTimer) { clearInterval(loadbarTimer); loadbarTimer = null; }
          setTimeout(function () { hideLoadBar(); }, 500);
        } else if (st.phase === 'downloading' || st.phase === 'loading') {
          var p = Math.round((st.progress || 0) * 100);
          if (p < 5) p = 5;
          if (p > 99) p = 99;
          updateLoadBar(p);
        } else if (st.phase === 'failed') {
          if (loadbarTimer) { clearInterval(loadbarTimer); loadbarTimer = null; }
          hideLoadBar();
        } else {
          updateLoadBar(8);
        }
      } catch (e) {}
    }, 250);
  }
  function hideLoadBar() {
    var wrap = document.getElementById('vcoach-loadbar-wrap');
    if (wrap) wrap.style.display = 'none';
    if (loadbarTimer) { clearInterval(loadbarTimer); loadbarTimer = null; }
  }
  function updateLoadBar(pct) {
    var fill = document.getElementById('vcoach-loadbar-fill');
    var pctEl = document.getElementById('vcoach-loadbar-pct');
    var txtEl = document.getElementById('vcoach-loadbar-text');
    var v = Math.max(0, Math.min(100, pct));
    if (fill) fill.style.width = v + '%';
    if (pctEl) pctEl.textContent = Math.round(v) + '%';
    if (txtEl) {
      try {
        var st = window.VoltaLocalLLM ? window.VoltaLocalLLM.status() : null;
        if (st && st.phase === 'ready') {
          txtEl.textContent = T('AI ready — ask anything!', 'الذكاء جاهز — اسأل أي شيء!');
        } else if (st && st.phase === 'downloading') {
          txtEl.textContent = T('Downloading AI model…', 'تنزيل نموذج الذكاء…');
        } else if (st && st.phase === 'loading') {
          txtEl.textContent = T('Initializing AI model…', 'تهيئة نموذج الذكاء…');
        } else if (st && st.phase === 'failed') {
          txtEl.textContent = T('AI load failed — using fallback', 'فشل تحميل الذكاء — استخدام البديل');
        } else {
          txtEl.textContent = T('Loading AI model…', 'جارٍ تحميل نموذج الذكاء…');
        }
      } catch (e) {}
    }
  }

  function bubble(text, who, badge) {
    var b = who === 'coach' ? BADGES[badge] : null;
    return '<div class="vcoach-msg ' + who + '">' +
      '<div class="vcoach-bubble">' + mdLite(text) +
        (b ? '<span class="vcoach-badge" title="' + esc(b.t) + '">' + b.g + '</span>' : '') +
      '</div></div>';
  }

   
   
   
  var BADGES = {
    fast:   { g: '⚡', t: T('Instant — answered from your data on-device', 'فوري — من بياناتك على جهازك') },
    matrix: { g: '🧠', t: T('Knowledge engine — answered from the on-device sports & training database (46 sports, 31 topics, injuries, exercises)', 'محرك المعرفة — إجابة من قاعدة معارف الرياضة والتدريب على جهازك (46 رياضة، 31 موضوعاً، الإصابات والتمارين)') },
    action: { g: '⚙', t: T('Action executed in the app', 'تم تنفيذ إجراء في التطبيق') },
    cloud:  { g: '☁', t: T('Cloud AI (OpenRouter)', 'ذكاء سحابي (OpenRouter)') },
    local:  { g: '📱', t: T('On-device AI model — a real language model running in your browser via transformers.js (offline, no API key)', 'نموذج ذكاء على الجهاز — نموذج لغوي حقيقي يعمل في متصفحك عبر transformers.js (دون إنترنت ودون مفتاح)') },
    err:    { g: '⚠', t: T('Cloud AI error — see the Cloud AI chip', 'خطأ الذكاء السحابي — انظر شارة الذكاء') }
  };

   
  function mdLite(t) {
    var s = esc(t);
    s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    s = s.replace(/\n/g, '<br>');
    return s;
  }

  function renderChips() {
    var box = document.getElementById('vcoach-chips');
    if (!box) return;
    var chips = [
      T("Today's workout", 'تمارين اليوم'),
      T('Calories left', 'السعرات المتبقية'),
      T('My progress', 'تقدمي'),
      T('Water', 'الماء'),
      T('Motivate me', 'حمّسني')
    ];
    box.innerHTML = chips.map(function (c) {
      return '<button type="button" class="vcoach-chip" data-q="' + esc(c) + '">' + esc(c) + '</button>';
    }).join('');
    box.querySelectorAll('.vcoach-chip').forEach(function (btn) {
      btn.addEventListener('click', function () { ask(btn.getAttribute('data-q')); });
    });
  }

  function renderHistory() {
    var body = document.getElementById('vcoach-body');
    if (!body) return;
    body.innerHTML = state.history.map(function (h) { return bubble(h.q, h.who, h.badge); }).join('');
    body.scrollTop = body.scrollHeight;
  }

  function appendTyping() {
    var body = document.getElementById('vcoach-body');
    var typing = document.createElement('div');
    typing.className = 'vcoach-msg coach';
    typing.innerHTML = '<div class="vcoach-bubble vcoach-typing"><span></span><span></span><span></span></div>';
    body.appendChild(typing);
    body.scrollTop = body.scrollHeight;
    return typing;
  }

  function setInputEnabled(on) {
    var input = document.getElementById('vcoach-input');
    var send = document.getElementById('vcoach-send');
    if (input) input.disabled = !on;
    if (send) send.disabled = !on;
  }

  function replySoon(text, badge) {
    var typing = appendTyping();
    setTimeout(function () {
      typing.remove();
      state.history.push({ who: 'coach', q: text, badge: badge });
      renderHistory();
    }, 480 + Math.random() * 420);
  }

   
  function badgeFor(out) {
    if (!out || !out.type) return 'fast';
    if (out.type === 'tool_result') return 'action';
    if (out.type === 'error') return 'err';
    if (out.type === 'chat') return 'cloud';
    if (out.type === 'local') return 'local';
    return 'fast';
  }

   
   
   
   
   
   
  function cloudTurn(q, tryLocal) {
    var typing = appendTyping();
    var live = null, liveText = '', done = false;
    state.busy = true;
    setInputEnabled(false);

    function finish(text, badge) {
      if (done) return;
      done = true;
      if (live) live.remove();
      typing.remove();
      state.history.push({ who: 'coach', q: text, badge: badge });
      state.busy = false;
      setInputEnabled(true);
      renderHistory();
    }

    window.VoltaCloudAI.handle(q, {
      onToken: function (tok) {
        if (done) return;
        if (!live) {
          typing.remove();
          live = document.createElement('div');
          live.className = 'vcoach-msg coach';
          live.innerHTML = '<div class="vcoach-bubble vcoach-live"></div>';
          var body = document.getElementById('vcoach-body');
          body.appendChild(live);
        }
        liveText += tok;
        var bub = live.querySelector('.vcoach-bubble');
        bub.innerHTML = mdLite(liveText) + '<span class="vcoach-cursor"></span>';
        var body2 = document.getElementById('vcoach-body');
        body2.scrollTop = body2.scrollHeight;
      }
    }).then(function (out) {
       
       
      if (out && out.type === 'error' && tryLocal && window.VoltaLocalLLM &&
          window.VoltaLocalLLM.couldTake && window.VoltaLocalLLM.couldTake(q)) {
        typing.remove(); if (live) live.remove();
        localTurn(q, false);
        return;
      }
      var text = (out && out.text) ? out.text : brain(q);
      finish(text, badgeFor(out));
    }).catch(function () {
      if (tryLocal && window.VoltaLocalLLM &&
          window.VoltaLocalLLM.couldTake && window.VoltaLocalLLM.couldTake(q)) {
        typing.remove(); if (live) live.remove();
        localTurn(q, false);
        return;
      }
      finish(brain(q), 'fast');
    });
  }

   
   
   
   
  function localTurn(q, tryCloud) {
    var typing = appendTyping();
    var live = null, liveText = '', done = false;
    var progressTimer = null;
    var progressWrap = null;
    state.busy = true;
    setInputEnabled(false);

    function finish(text, badge) {
      if (done) return;
      done = true;
      if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
      if (progressWrap) { progressWrap.remove(); progressWrap = null; }
      if (live) live.remove();
      typing.remove();
      state.history.push({ who: 'coach', q: text, badge: badge });
      state.busy = false;
      setInputEnabled(true);
      renderHistory();
    }
    function streamInto(tok) {
      if (done) return;
      if (!live) {
        typing.remove();
        if (progressWrap) { progressWrap.remove(); progressWrap = null; }
        if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
        live = document.createElement('div');
        live.className = 'vcoach-msg coach';
        live.innerHTML = '<div class="vcoach-bubble vcoach-live"></div>';
        var body = document.getElementById('vcoach-body');
        body.appendChild(live);
      }
      liveText += tok;
      var bub = live.querySelector('.vcoach-bubble');
      bub.innerHTML = mdLite(liveText) + '<span class="vcoach-cursor"></span>';
      var body2 = document.getElementById('vcoach-body');
      body2.scrollTop = body2.scrollHeight;
    }

    function showLoadProgress() {
      if (progressWrap) return;
      var body = document.getElementById('vcoach-body');
      if (!body) return;
      progressWrap = document.createElement('div');
      progressWrap.className = 'vcoach-msg coach';
      progressWrap.innerHTML =
        '<div class="vcoach-progress-wrap">' +
          '<div class="vcoach-progress-text">' + esc(T('Loading the on-device AI model…', 'جارٍ تحميل نموذج الذكاء على الجهاز…')) + '</div>' +
          '<div class="vcoach-progress-track"><div class="vcoach-progress-fill" id="vcoach-progress-fill"></div></div>' +
          '<div class="vcoach-progress-pct" id="vcoach-progress-pct">0%</div>' +
        '</div>';
      body.appendChild(progressWrap);
      body.scrollTop = body.scrollHeight;
    }
    function updateLoadProgress(pct) {
      var fill = document.getElementById('vcoach-progress-fill');
      var pctEl = document.getElementById('vcoach-progress-pct');
      var v = Math.max(0, Math.min(100, pct));
      if (fill) fill.style.width = v + '%';
      if (pctEl) pctEl.textContent = Math.round(v) + '%';
      var body = document.getElementById('vcoach-body');
      if (body) body.scrollTop = body.scrollHeight;
    }

    try {
      var st0 = window.VoltaLocalLLM.status();
      if (st0 && st0.phase !== 'ready') {
        showLoadProgress();
        updateLoadProgress(3);
        progressTimer = setInterval(function () {
          try {
            var st = window.VoltaLocalLLM.status();
            if (!st) return;
            if (st.phase === 'ready') {
              updateLoadProgress(100);
              if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
              setTimeout(function () {
                if (progressWrap) { progressWrap.remove(); progressWrap = null; }
              }, 400);
            } else if (st.phase === 'downloading' || st.phase === 'loading') {
              var p = Math.round((st.progress || 0) * 100);
              if (p < 5) p = 5;
              if (p > 99) p = 99;
              updateLoadProgress(p);
            } else if (st.phase === 'failed') {
              if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
              if (progressWrap) { progressWrap.remove(); progressWrap = null; }
            } else {
              updateLoadProgress(8);
            }
          } catch (e) {}
        }, 250);
      }
    } catch (e) {}

    var msgs;
    try {
      msgs = (window.VoltaLocalLLM && window.VoltaLocalLLM.messagesFor)
        ? window.VoltaLocalLLM.messagesFor(q)
        : [{ role: 'user', content: q }];
    } catch (e) { msgs = [{ role: 'user', content: q }]; }

    window.VoltaLocalLLM.generate(msgs, { onToken: function (tok) {
      streamInto(tok);
    }, maxNewTokens: 220 }).then(function (text) {
      finish(text || brain(q), 'local');
    }).catch(function (err) {
      try { console.warn('[CoachChat] on-device model failed:', err && err.message); } catch (e) {}
      if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
      if (progressWrap) { progressWrap.remove(); progressWrap = null; }
      if (tryCloud && window.VoltaCloudAI && navigator.onLine) {
        typing.remove(); if (live) live.remove();
        cloudTurn(q, false);
        return;
      }
      finish(brain(q), 'fast');
    });
  }

  function ask(q) {
    if (!q || !q.trim()) return;
    if (state.busy) return;              
    q = q.trim();
     
    _qArabic = /[\u0600-\u06FF\u0750-\u077F]/.test(q);
    state.history.push({ who: 'me', q: q });
    renderHistory();

     
     
     
    if (window.VoltaCloudAI && window.VoltaCloudAI.isCommand(q)) {
      cloudTurn(q);
      return;
    }
    continueAsk(q);
  }

  function continueAsk(q) {
     
     
    var quick = tryIntents(q);
    if (quick != null) { replySoon(quick, 'fast'); return; }

     
     
     
     
     
     
     
    if (window.VoltaCoachMatrix) {
      try {
        var mx = window.VoltaCoachMatrix.answer(q, snapshot());
        if (mx && mx.text) { replySoon(mx.text, 'matrix'); return; }
      } catch (e) {   }
    }

     
     
     
     
     
     
     
     
     
    var llm = window.VoltaLocalLLM;
    if (llm && llm.couldTake && llm.couldTake(q)) {
      localTurn(q, false);
      return;
    }

     
     
     
    if (window.VoltaCloudAI) {
      cloudTurn(q, false);
      return;
    }
    replySoon(brain(q), 'fast');
  }

  function sendCurrent() {
    var input = document.getElementById('vcoach-input');
    if (!input) return;
    var q = input.value;
    input.value = '';
    input.style.height = 'auto';
    ask(q);
    try { input.focus(); } catch (e) {}
  }

  function open() {
    ensureModal();
    renderChips();
    if (!state.welcomed) {
      state.welcomed = true;
      state.history.push({ who: 'coach', q: brain('hello') });
    }
    renderHistory();
    var m = document.getElementById('volta-ai-chat-modal');
    m.classList.add('active');
    state.open = true;
    document.body.style.overflow = 'hidden';
     
     
    try {
      if (window.VoltaLocalLLM && window.VoltaLocalLLM.preferLocal && window.VoltaLocalLLM.preferLocal()) {
        window.VoltaLocalLLM.warm();
      }
    } catch (e) {}
    try {
      var st0 = window.VoltaLocalLLM ? window.VoltaLocalLLM.status() : null;
      if (st0 && st0.phase !== 'ready' && st0.phase !== 'failed') {
        showLoadBar();
      } else if (st0 && st0.phase === 'failed') {
        hideLoadBar();
      } else {
        hideLoadBar();
      }
    } catch (e) {}
    setTimeout(function () { try { document.getElementById('vcoach-input').focus(); } catch (e) {} }, 60);
  }
  function close() {
    var m = document.getElementById('volta-ai-chat-modal');
    if (m) m.classList.remove('active');
    state.open = false;
    document.body.style.overflow = '';
  }
  function toggle() { state.open ? close() : open(); }

   
  function boot() {
    ensureButton();
    ensureModal();
    try {
      if (window.VoltaLocalLLM && window.VoltaLocalLLM.enabled && window.VoltaLocalLLM.enabled()) {
        window.VoltaLocalLLM.ensure();
      }
    } catch (e) {}
    setTimeout(function () {
      try {
        if (window.VoltaFoodModel && window.VoltaFoodModel.ready) {
          window.VoltaFoodModel.ready().catch(function () {});
        }
      } catch (e) {}
    }, 1500);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  return { open: open, close: close, toggle: toggle, ask: ask, brain: brain, tryIntents: tryIntents };
})();
