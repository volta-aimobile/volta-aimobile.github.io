/**
 * Volta Coach AI — local, offline, always-available chat coach
 * ══════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS (v28, user):
 *   • "the ai chat button doesnt show up, make sure the user can see it"
 *     — the old third-party Chatbase widget was removed in v9 and NOTHING
 *     replaced it: there was simply no chat button at all. This module adds
 *     a branded floating button that is ALWAYS visible inside the app.
 *   • "ai doesnt work in the html file, or online, it tells me that i should
 *     be online for it to work, try to make it work offline" — the old chat
 *     was cloud-only. This coach is 100% ON-DEVICE: it reads the user's own
 *     data (profile, survey, plan, sessions, diet, streak — the same payload
 *     the old cloud chat received) and answers from it, with ZERO network
 *     calls. It works from file://, offline, and online alike.
 *
 * The floating button shows whenever body.app-active (the app or coach
 * screens are open), sits above the mobile bottom-nav, and hides while the
 * "more" popup / OCR overlay are open (same classes the old button used).
 * Everything is bilingual (EN / AR via store.lang).
 *
 * v35: when Chatbase is configured + online, the button routes to the
 * embedded Chatbase widget first (js/chatbase-embed.js); this local coach
 * remains the offline / no-ID fallback, so the AI chat ALWAYS answers.
 * ══════════════════════════════════════════════════════════════════════ */
window.VoltaCoachChat = (function () {
  'use strict';

  var state = { open: false, history: [], welcomed: false };

  // ─── helpers ───────────────────────────────────────────────────────────
  function ar() {
    try { return typeof store !== 'undefined' && store.lang === 'ar'; } catch (e) { return false; }
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

  // ─── the brain's snapshot of the user ─────────────────────────────────
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
      waterGoal: (x.plan && x.plan.diet && x.plan.diet.hydrationLiters) || ''
    };
  }

  // ─── intent helpers ───────────────────────────────────────────────────
  function listTodayWorkouts(s) {
    if (!s.todayWorkouts.length) {
      return T("You don't have a training day generated yet — open the Daily Discipline tab and start a plan, and I'll coach you through every exercise.",
              "لا يوجد يوم تدريب مُنشأ بعد — افتح تبويب الالتزام اليومي وابدأ خطة، وسأرشدك في كل تمرين.");
    }
    var names = s.todayWorkouts.map(function (w, i) {
      var nm = ar() ? ((typeof WORKOUT_AR_NAMES !== 'undefined' && WORKOUT_AR_NAMES[w.name]) || w.name) : w.name;
      return (i + 1) + '. ' + nm + ' — ' + (w.sets || 2) + '×' + (w.reps || '10-12') + (w.done ? ' ✓' : '');
    }).join('\n');
    return T('Today is day ', 'اليوم ') + s.planDay + T(' of ', ' من ') + s.planDays + T('. Your list (', '. قائمتك (') +
            s.doneToday + T(' done):\n', ' تم):\n') + names;
  }

  function fmtNum(n) { return (n == null || isNaN(n)) ? '--' : Math.round(Number(n)); }

  // ─── the local brain ──────────────────────────────────────────────────
  // Pure keyword intents over the user's own data. Order matters (first
  // match wins). Bilingual keywords cover EN + common Arabic phrasings.
  var INTENTS = [
    {
      id: 'greet', re: /^(hi|hey|hello|yo|salam|salaam|سلام|مرحبا|اهلا|أهلا|هلا|صباح|مساء)\b/i,
      fn: function (s) {
        return T('Hey' + (s.name ? ' ' + s.name : '') + '! ⚡ I\'m your Volta coach — I run fully on your device, so I work online AND offline. Ask me about your workout today, your calories, your plan, hydration, or anything fitness.',
                'أهلاً' + (s.name ? ' ' + s.name : '') + '! ⚡ أنا مدربك في فولتا — أعمل بالكامل على جهازك، متصلاً أو دون اتصال. اسألني عن تمرين اليوم أو سعراتك أو خطتك أو شرب الماء أو أي شيء عن اللياقة.');
      }
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
          return T('Nothing logged yet today. Your first exercise in Daily Discipline will start the counter — every MET-accurate calorie shows up in the flame.',
                  'لا يوجد تسجيل اليوم بعد. أول تمرين في الالتزام اليومي سيبدأ العداد — كل سعرة محسوبة بدقة MET ستظهر في اللهب.');
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
        // look the exercise up in WORKOUT_INFO by name inside the question
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
        return T('Tap any exercise in your Daily Discipline list — the popup shows the correct start and end poses, the exact muscles, the calorie burn, and Coach AI form cues.',
                 'اضغط أي تمرين في قائمة الالتزام اليومي — ستظهر لك صور وضعيتي البداية والنهاية والعضلات المستهدفة والسعرات وتلميحات الأداء.');
      }
    },
    {
      id: 'thanks', re: /(thanks|thank you|shukran|شكرا|متشكر|تمام كده|bye|goodbye)/i,
      fn: function (s) {
        return T('Anytime' + (s.name ? ', ' + s.name : '') + '. ⚡ Now go earn that flame.', 'في أي وقت' + (s.name ? ' يا ' + s.name : '') + '. ⚡ والآن اذهب واكسب لهبك.');
      }
    }
  ];

  function brain(q) {
    var s = snapshot();
    for (var i = 0; i < INTENTS.length; i++) {
      if (INTENTS[i].re.test(q)) {
        return ar() && INTENTS[i].arFn ? INTENTS[i].arFn(s, q) : INTENTS[i].fn(s, q);
      }
    }
    // fallback: still helpful, still personal
    return T('I\'m your on-device coach — I know your profile, plan, sessions and diet log, no internet needed. Try asking:\n• ' + (s.todayWorkouts.length ? '“What\'s my workout today?”' : '“How many calories are left?”') + '\n• “Am I drinking enough water?”\n• “How\'s my progress?”\n• “How do I do ' + (s.todayWorkouts[0] ? s.todayWorkouts[0].name : 'a squat') + '?”',
            'أنا مدربك على جهازك — أعرف ملفك وخطةتك وجلساتك وسجل غذائك دون إنترنت. جرّب أن تسأل:\n• ' + (s.todayWorkouts.length ? '«ما تمارين اليوم؟»' : '«كم سعرة متبقية؟»') + '\n• «هل أشرب ماءً كافياً؟»\n• «كيف تقدمي؟»\n• «كيف أؤدي ' + (s.todayWorkouts[0] ? s.todayWorkouts[0].name : 'السكوات') + '؟»');
  }

  // ─── UI: floating button ─────────────────────────────────────────────
  function ensureButton() {
    if (document.getElementById('volta-ai-chat-btn')) return;
    var b = document.createElement('button');
    b.id = 'volta-ai-chat-btn';
    b.type = 'button';
    b.setAttribute('aria-label', T('Coach AI chat', 'محادثة المدرب الذكي'));
    // v29 (user): "change the thunder icon with a chat icon" — the floating
    // button (and the modal avatar below) now show a chat bubble instead of
    // the Volta bolt, so it reads as a CHAT button at first glance.
    b.innerHTML = '<i class="fa-solid fa-comment-dots"></i>';
    b.addEventListener('click', function (e) { e.stopPropagation(); toggle(); });
    document.body.appendChild(b);
  }

  // ─── UI: chat modal ──────────────────────────────────────────────────
  function ensureModal() {
    if (document.getElementById('volta-ai-chat-modal')) return;
    var m = document.createElement('div');
    m.id = 'volta-ai-chat-modal';
    m.className = 'modal-overlay';
    m.style.zIndex = '10020';
    m.innerHTML =
      '<div class="modal-content vcoach-window">' +
        '<button class="modal-close" type="button" id="vcoach-close">&times;</button>' +
        '<div class="vcoach-head">' +
          '<span class="vcoach-ava"><i class="fa-solid fa-comment-dots"></i></span>' +
          '<div class="vcoach-head-txt">' +
            '<b>' + esc(T('Coach AI', 'المدرب الذكي')) + '</b>' +
          '</div>' +
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

  function bubble(text, who) {
    return '<div class="vcoach-msg ' + who + '"><div class="vcoach-bubble">' + mdLite(text) + '</div></div>';
  }

  // tiny formatter: **bold**, newlines
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
    body.innerHTML = state.history.map(function (h) { return bubble(h.q, h.who); }).join('');
    body.scrollTop = body.scrollHeight;
  }

  function ask(q) {
    if (!q || !q.trim()) return;
    state.history.push({ who: 'me', q: q.trim() });
    renderHistory();
    var body = document.getElementById('vcoach-body');
    var typing = document.createElement('div');
    typing.className = 'vcoach-msg coach';
    typing.innerHTML = '<div class="vcoach-bubble vcoach-typing"><span></span><span></span><span></span></div>';
    body.appendChild(typing);
    body.scrollTop = body.scrollHeight;
    setTimeout(function () {
      typing.remove();
      var a = '';
      try { a = brain(q.trim()); } catch (e) { a = T('Hmm, I hiccuped on that one — try rephrasing?', 'عذراً، تعثرت في هذه — أعد صياغتها؟'); }
      state.history.push({ who: 'coach', q: a });
      renderHistory();
    }, 480 + Math.random() * 420);
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
    setTimeout(function () { try { document.getElementById('vcoach-input').focus(); } catch (e) {} }, 60);
  }
  function close() {
    var m = document.getElementById('volta-ai-chat-modal');
    if (m) m.classList.remove('active');
    state.open = false;
    document.body.style.overflow = '';
  }
  function toggle() {
    if (state.open) { close(); return; }
    /* v35 (user: "use the chatbase embedded for the ai chat"): when online
       and a Chatbase bot ID is configured (Settings → AI Chat), the floating
       button opens the EMBEDDED Chatbase widget instead of this local chat.
     This module (open()) is the fallback — offline / unconfigured. */
    if (window.VoltaChatbase) { window.VoltaChatbase.toggle(open); return; }
    open();
  }

  // ─── boot ────────────────────────────────────────────────────────────
  function boot() {
    ensureButton();
    ensureModal();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  return { open: open, close: close, toggle: toggle, ask: ask, brain: brain };
})();
