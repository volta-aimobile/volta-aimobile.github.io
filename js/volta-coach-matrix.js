 



























window.VoltaCoachMatrix = (function () {
  'use strict';

  var KB = window.VOLTA_COACH_KB || { sports: {}, topics: {}, muscles: {}, injuries: {} };

   
   
   
   
   
  var _qArabic = false;
  function ar() {
    try {
      if (typeof store !== 'undefined' && store.lang === 'ar') return true;
    } catch (e) {}
    return _qArabic;
  }
  function L(field) {
    if (!field) return '';
    return ar() ? (field.ar || field.en) : (field.en || field.ar);
  }
  function norm(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/[\u064B-\u065F\u0670\u0640]/g, '')    
      .replace(/[\u0622\u0623\u0625]/g, '\u0627')       
      .replace(/\u0624/g, '\u0648')                        
      .replace(/\u0626/g, '\u064A')                        
      .replace(/\u0649/g, '\u064A')                        
      .replace(/\u0629/g, '\u0647')                        
      .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
   
   
  function deArticle(s) {
    return String(s).split(' ').map(function (w) {
      return (w.length > 4 && w.indexOf('ال') === 0) ? w.slice(2) : w;
    }).join(' ');
  }
   
  function hasPhrase(qnRaw, phrase) {
    var qn = String(qnRaw || '');
    var p = norm(phrase);
    if (!p || !qn) return false;
    if (qn === p) return true;           
    if (p.indexOf(' ') === -1) {
       
      return qn.indexOf(p) !== -1 || deArticle(qn).indexOf(p) !== -1;
    }
     
     
     
    var tryIn = function (hay) {
      if (hay.indexOf(p + ' ') === 0) return true;
      if (hay.indexOf(' ' + p + ' ') !== -1) return true;
      var tail = hay.length - p.length;
      return tail >= 1 && hay.slice(tail) === p && hay.charAt(tail - 1) === ' ';
    };
    if (tryIn(qn)) return true;
    var dq = deArticle(qn);
    if (dq !== qn) return tryIn(dq);
    return false;
  }
  function bullets(list) {
    return (list || []).map(function (x) { return '• ' + x; }).join('\n');
  }
  function numbered(list) {
    return (list || []).map(function (x, i) { return (i + 1) + '. ' + x; }).join('\n');
  }

   
  var RX_NUTRITION = /(eat|food|meal|diet|nutrition|fuel|hydrat|drink|before|after|recover food|calor|سعرات|اكل|أكل|وجب|طعام|قبل|بعد|ماء|اشرب|ترطيب)/;
  var RX_INJURY = /(injur|pain|hurt|sprain|strain|tear|safe|prevent|rehab|اصاب|الم|تالم|تولم|مؤلم|وجع|موجع|التواء|التهاب|كدمة|وقاية|شاكي)/;
  var RX_GEAR = /(gear|equipment|shoes|kit|need to buy|what do i need|wear|معدات|عدة|أدوات|حذاء|ملابس|احتاج)/;
  var RX_DRILL = /(drill|exercise|workout|train|improve|better|practice|skill|how do i|how to|faster|stronger|كيف|تدريب|تمرين|تحسين|مهار|سرع|اقوى|أقوى|افضل|أفضل)/;

   
  var MUSCLE_SPORTS_AL = ['football', 'basketball', 'swimming'];
  function findMuscle(qn) {
    var best = null, bestLen = 0;
    Object.keys(KB.muscles || {}).forEach(function (k) {
      var m = KB.muscles[k];
      (m.al || []).forEach(function (a) {
        if (hasPhrase(qn, a) && a.length > bestLen) { best = m; bestLen = a.length; }
      });
    });
    if (best && /exercise|exercises|workout|workouts|build|grow|train|training|best|tone|تمرين|تمارين|بناء|تضخيم|افضل|أفضل|تدريب/.test(qn)) return best;
    return null;    
  }
  function muscleAnswer(m, snap) {
    var lines = [];
    lines.push('**' + L(m) + '** — ' + (ar()
      ? 'أفضل التمارين داخل فولتا:'
      : 'the best exercises inside Volta:'));
    lines.push(bullets(L(m.best)));
    lines.push('');
    lines.push(L(m.freq));
    lines.push(personalLine(snap));
    return { text: lines.join('\n'), kind: 'muscle' };
  }

   
  function exercisePool() {
    var pool = [];
    try {
      (window.VOLTA_WORKOUT_SEED || []).forEach(function (w) { pool.push(w); });
    } catch (e) {}
    return pool;
  }
  function findExercise(qn) {
    var best = null, bestLen = 0, bestHeadMode = false;
    var toks = qn.split(' ');
    exercisePool().forEach(function (w) {
      if (!w || !w.name) return;
      var nm = norm(w.name);
      if (nm.length >= 6 && hasPhrase(qn, nm) && (best === null || bestHeadMode === true || nm.length > bestLen)) { best = w; bestLen = nm.length; bestHeadMode = false; return; }
       
       
       
       
       
       
      var words = nm.split(' ');
      var head = words[words.length - 1];
      if (head && head.length >= 6 && toks.indexOf(head) !== -1) {
        var generic = (2 - words.length) * 10;    
        if (!best || bestHeadMode === false || (bestHeadMode === true && generic > bestLen)) {
          best = w; bestLen = generic; bestHeadMode = true;
        }
      }
    });
    return best;
  }
  function exerciseAnswer(w, snap) {
    var lines = [];
    var meta = [w.muscleGroup, w.difficulty, w.equipment].filter(Boolean).join(' · ');
    lines.push('**' + w.name + '** (' + meta + ')');
    if (w.description) lines.push(w.description);
    if (w.steps && w.steps.length) {
      lines.push('');
      lines.push(ar() ? '**خطوات الأداء:**' : '**How to perform it:**');
      lines.push(numbered(L({ en: w.steps, ar: w.steps })));
    }
    if (w.tips && w.tips.length) {
      lines.push('');
      lines.push(ar() ? '**تلميحات المدرب:**' : '**Coach tips:**');
      lines.push(bullets(L({ en: w.tips, ar: w.tips })));
    }
    if (w.calories) {
      lines.push('');
      lines.push(ar()
        ? 'يحرق حوالي **' + w.calories + ' سعرة للمجموعة** (لشخص وزنه 75 كغ) — افتح التمرين من تبويب التمرين اليومي لتتبع مجموعاتك.'
        : 'Burns about **' + w.calories + ' kcal per set** (75 kg athlete) — open it from the Daily Exercise tab to track your sets.');
    }
    lines.push(personalLine(snap));
    return { text: lines.join('\n'), kind: 'exercise' };
  }

   
  function findSport(qn) {
    var best = null, bestLen = 0;
    Object.keys(KB.sports || {}).forEach(function (k) {
      var sp = KB.sports[k];
      var cands = (sp.al || []).slice();
      cands.push(norm(sp.en));
      cands.forEach(function (a) {
        var an = norm(a);
         
         
        if (an.length < 3 && !/\d/.test(an)) return;
         
         
         
        if (an.length < 6 && !/\d/.test(an)) {
          var re = new RegExp('(^|\\s)' + an.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\s|$)');
          if ((re.test(qn) || re.test(deArticle(qn))) && an.length > bestLen) { best = sp; bestLen = an.length; }
          return;
        }
        if (hasPhrase(qn, an) && an.length > bestLen) { best = sp; bestLen = an.length; }
      });
    });
    return best;
  }
  function sportAnswer(sp, snap, qn) {
    var lines = [];
    var isMySport = snap && sp && norm(snap.sport || '') && norm(sp.en).indexOf(norm(snap.sport || '')) !== -1;
    lines.push('**' + L(sp) + '** — ' + (isMySport
      ? (ar() ? 'هذه رياضتك الأساسية في فولتا ⚡' : 'this is your main sport in Volta ⚡')
      : ''));
    if (RX_NUTRITION.test(qn)) {
      lines.push(L(sp.nutr));
      lines.push('');
      lines.push(ar() ? '**خطة الأسبوع:**' : '**The weekly plan:**');
      lines.push(L(sp.weekly));
    } else if (RX_INJURY.test(qn)) {
      lines.push(L(sp.inj));
      lines.push('');
      lines.push(L(sp.energy));
    } else if (RX_GEAR.test(qn)) {
      lines.push(L(sp.gear));
      lines.push('');
      lines.push(L(sp.weekly));
    } else {
       
      lines.push(L(sp.energy));
      lines.push('');
      lines.push(ar() ? '**خطة الأسبوع:**' : '**Weekly template:**');
      lines.push(L(sp.weekly));
      lines.push('');
      lines.push(ar() ? '**تدريبات البناء (' + L(sp) + '):**' : '**Skill drills (' + L(sp) + '):**');
      lines.push(bullets(L(sp.drills)));
      if (RX_DRILL.test(qn) && sp.inj) { lines.push(''); lines.push(L(sp.inj)); }
    }
    lines.push('');
    lines.push(metLine(sp, snap));
    lines.push(personalLine(snap));
    return { text: lines.join('\n'), kind: 'sport' };
  }
  function metLine(sp, snap) {
    var w = snap && snap.weight;
    var perMin = w ? (sp.met * 3.5 * w / 200) : null;
    if (perMin) {
      return ar()
        ? ('حرق تقديري بوزنك: **~' + Math.round(perMin) + ' سعرة/دقيقة** (MET ' + sp.met + ') — سجّل جلستك من تبويب الرياضة والتتبع.')
        : ('Estimated burn at your weight: **~' + Math.round(perMin) + ' kcal/min** (MET ' + sp.met + ') — log the session from the Sports & Tracker tab.');
    }
    return ar()
      ? ('حرق تقديري: **~' + Math.round(sp.met * 3.5 * 70 / 200) + ' سعرة/دقيقة** لوزن 70 كغ (MET ' + sp.met + ').')
      : ('Estimated burn: **~' + Math.round(sp.met * 3.5 * 70 / 200) + ' kcal/min** at 70 kg (MET ' + sp.met + ').');
  }

   
  function findInjury(qn) {
    var hasPain = RX_INJURY.test(qn);
    if (!hasPain) return null;
    var best = null, bestLen = 0;
    Object.keys(KB.injuries || {}).forEach(function (k) {
      var inj = KB.injuries[k];
      (inj.al || []).forEach(function (a) {
        if (hasPhrase(qn, a) && a.length > bestLen) { best = inj; bestLen = a.length; }
      });
    });
    return best;
  }
  function injuryAnswer(inj, snap) {
    var lines = [];
    var matchesMine = snap && snap.injury && snap.injury !== 'None' &&
      norm(snap.injury).indexOf(norm(inj.en.split(' ')[0])) !== -1;
    lines.push('**' + L(inj) + '** — ' + (ar() ? 'دليل التدريب الذكي حولها:' : 'the smart-training guide around it:'));
    lines.push('');
    lines.push((ar() ? '**تجنّب مؤقتاً:** ' : '**Temporarily avoid:** ') + L(inj.avoid));
    lines.push('');
    lines.push((ar() ? '**بدائل آمنة:** ' : '**Safer swaps:** ') + L(inj.swap));
    lines.push('');
    lines.push((ar() ? '**التقوية الآمنة:** ' : '**Safe strengthening:** ') + L(inj.build));
    if (matchesMine) {
      lines.push('');
      lines.push(ar()
        ? 'هذه نفس المنطقة المسجلة في ملفك — خطتك الحالية تراعيها، لكن راقب أي ألم حاد جديد.'
        : 'This matches the injury zone on your profile — your current plan respects it, but watch for any new sharp pain.');
    }
    lines.push('');
    lines.push(ar()
      ? '⚠️ هذا توجيه تدريبي عام وليس تشخيصاً طبياً — الألم الحاد أو المتفاقم يستحق فحصاً.'
      : '⚠️ This is training guidance, not a medical diagnosis — sharp or worsening pain deserves an assessment.');
    return { text: lines.join('\n'), kind: 'injury' };
  }

   
  function findTopic(qn) {
    var best = null, bestScore = 0;
    Object.keys(KB.topics || {}).forEach(function (k) {
      var tp = KB.topics[k];
      var score = 0;
      (tp.keys || []).forEach(function (kw) {
        if (hasPhrase(qn, kw)) {
           
           
           
           
          score += kw.length + (norm(kw).indexOf(' ') === -1 ? 8 : 0);
        }
      });
      if (score > bestScore) { best = tp; bestScore = score; }
    });
    return (best && bestScore >= 5) ? best : null;
  }
  function topicAnswer(tp, snap) {
    var lines = [];
    lines.push('**' + L(tp) + '**');
    lines.push('');
    lines.push(L(tp.body));
    lines.push('');
    lines.push(ar() ? '**خطة العمل:**' : '**Action plan:**');
    lines.push(bullets(L(tp.steps)));
    lines.push(personalLine(snap));
    return { text: lines.join('\n'), kind: 'topic' };
  }

   
   
  function personalLine(snap) {
    if (!snap) return '';
    var bits = [];
     
     
     
    try {
      if (snap.workoutPlan && snap.workoutPlan.schedule && snap.workoutPlan.schedule.length) {
        var wp = snap.workoutPlan;
        var td = (wp.todayIdx != null && wp.todayIdx >= 0) ? wp.schedule[wp.todayIdx] : null;
        if (td && td.focus) {
          bits.push(ar() ? ('يوم تدريبك هو ' + td.focus + ' (' + (td.count || 0) + ' تمارين)')
                         : ('your training day is ' + td.focus + ' (' + (td.count || 0) + ' exercises)'));
        } else if (wp.daysPerWeek) {
          bits.push(ar() ? ('خطة ' + wp.splitType + ' بـ ' + wp.daysPerWeek + ' أيام أسبوعيًا')
                         : ('a ' + wp.splitType + ' plan at ' + wp.daysPerWeek + ' days/week'));
        }
      }
      if (snap.dietPlan && snap.dietPlan.dailyCalories) {
        var dp = snap.dietPlan;
        var unlogged = 0;
        (dp.slots || []).forEach(function (sl) { if (!sl.loggedToday && sl.suggestions && sl.suggestions.length) unlogged++; });
        if (unlogged) bits.push(ar() ? (unlogged + ' من وجبات خطتك لم تُسجل اليوم')
                                     : (unlogged + ' of your planned meals are still unlogged today'));
        if (dp.macros && dp.macros.p) bits.push(ar() ? ('هدف البروتين ' + dp.macros.p + ' جرام')
                                                      : ('protein target ' + dp.macros.p + 'g'));
      }
    } catch (e) {}
    var goalMap = {
      'Lose weight': { en: 'fat-loss', ar: 'خسارة الدهون' },
      'Build muscle': { en: 'muscle building', ar: 'بناء العضلات' },
      'Improve endurance': { en: 'endurance', ar: 'تحسين التحمل' },
      'Stay healthy': { en: 'general health', ar: 'الصحة العامة' },
      'Improve flexibility': { en: 'flexibility', ar: 'المرونة' },
      'Sports performance': { en: 'sport performance', ar: 'أداء رياضي' }
    };
    try {
      if (snap.goal && goalMap[snap.goal]) bits.push(ar()
        ? ('هدفك المسجل: ' + goalMap[snap.goal].ar)
        : ('your logged goal: ' + goalMap[snap.goal].en));
      if (snap.level && /^(beginner|new|مبتد)/i.test(snap.level)) bits.push(ar()
        ? 'كمبتدئ: أتقن التقنية أول أسبوعين قبل أي حمل ثقيل'
        : 'as a beginner: groove technique for two weeks before adding real load');
      if (snap.injury && snap.injury !== 'None') bits.push(ar()
        ? ('راجع منطقة ' + snap.injury + ' في ملفك قبل التمارين التي تحملها')
        : ('respect your logged ' + snap.injury + ' issue before exercises that load it'));
      if (snap.equipment && /none|no equipment|bodyweight/i.test(snap.equipment)) bits.push(ar()
        ? 'أنت بلا معدات — كل التمارين المقترحة بوزن الجسم متاحة لك'
        : 'you train equipment-free — every bodyweight option above fits you');
    } catch (e) {}
    if (!bits.length) return '';
    return '\n' + (ar() ? '**بالنسبة لك:** ' : '**For you:** ') + bits.join(' · ') + '.';
  }

   
  function answer(q, snap) {
    try {
      var qn = norm(q);
      if (!qn || qn.length < 3) return null;
       
      _qArabic = /[\u0600-\u06FF\u0750-\u077F]/.test(String(q || ''));

       
       
       
       
       
      if (/(drill|plan|program|schedule|session|improve|better|skill|week|match|game|team|compete|قائمة|خطة|تحسين|مهارة|تدريب|اسبوع|أسبوع|بطولة|منافس)/.test(qn)) {
        var sp0 = findSport(qn);
        if (sp0) return sportAnswer(sp0, snap, qn);
      }

       
      var inj = findInjury(qn);
      if (inj) return injuryAnswer(inj, snap);

       
      var mus = findMuscle(qn);
      if (mus) return muscleAnswer(mus, snap);

       
       
       
      var ex = findExercise(qn);
      if (ex) {
        var spSame = findSport(qn);
        if (spSame && norm(spSame.en) === norm(ex.name)) return sportAnswer(spSame, snap, qn);
        return exerciseAnswer(ex, snap);
      }

       
      var sp = findSport(qn);
      if (sp) return sportAnswer(sp, snap, qn);

       
      var tp = findTopic(qn);
      if (tp) return topicAnswer(tp, snap);

      return null;    
    } catch (e) {
      try { console.warn('[CoachMatrix]', e && e.message); } catch (e2) {}
      return null;
    }
  }

  return {
    answer: answer,
    findSport: findSport,
    findTopic: findTopic,
    findExercise: findExercise,
    _internals: { norm: norm, hasPhrase: hasPhrase }
  };
})();
