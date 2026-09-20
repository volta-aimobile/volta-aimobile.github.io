/**
 * Volta Arabic Database — v44
 * =====================================================================
 * User request: "make a whole database for arabic and replace all the
 * english texts with the ones in the database so nothing lags at all".
 *
 * This file is a STATIC, OFFLINE, INSTANT Arabic translation database.
 * No network, no AI calls, no lag: every lookup is a plain object-hash
 * read. It is consulted by applyTranslations()' text-node walker (volta.js)
 * which replaces English text it recognizes with its Arabic entry the
 * moment a render finishes — and swaps it back when the app runs English.
 *
 * Sections:
 *   phrases  — dynamic UI strings that render functions emit in English
 *              (buttons, chips, section titles, unit words…).
 *   workouts — every workout name in js/data/workouts.js (100/100).
 *   meals    — meal NAMES. Auto-derived at load from the full language
 *              pack (js/lang/ar.js, 106 meals) so the two never drift;
 *              extra ad-hoc meal names can be added in `extraMeals`.
 *   regex    — number+unit patterns (e.g. "18 MIN", "≈34 KCAL") that
 *              cannot be enumerated as exact strings.
 *
 * Sports are NOT duplicated here: the walker also reads the runtime
 * SPORT_AR_NAMES / WORKOUT_AR_NAMES maps that volta.js already ships.
 *
 * Load order: js/data/meals.js → js/lang/ar.js → js/lang/ar-db.js → volta.js
 */
window.VOLTA_AR_DB = (function () {
  'use strict';

  /* ── 1. Dynamic UI phrases (exact trimmed text → Arabic) ─────────────── */
  var phrases = {
    // Diet / AI meals
    'AI-Generated Meals': 'وجبات مولّدة بالذكاء الاصطناعي',
    'Regenerate Another Diet Plan': 'إعادة توليد خطة غذائية أخرى',
    'Generating…': 'جارٍ التوليد…',
    'More info': 'معلومات أكثر',
    'Log this meal': 'سجّل هذه الوجبة',
    'Logged': 'تم التسجيل',
    'Add to Meal Log': 'إضافة إلى سجل الوجبات',
    'Log Meal': 'تسجيل وجبة',
    "Today's Meal Log": 'سجل الوجبات اليومي',
    'AI Meal Scanner': 'ماسح الوجبات بالذكاء الاصطناعي',
    'Ingredients': 'المكونات',
    'Ingredients:': 'المكونات:',
    'Unknown meal': 'وجبة غير معروفة',
    // Diet plan / dashboard banners
    'DIET PLAN': 'الخطة الغذائية',
    'WORKOUT PLAN': 'خطة التمرين',
    'KCAL / DAY': 'سعرة / يوم',
    'PROTEIN': 'بروتين',
    'CARBS': 'كارب',
    'FAT': 'دهون',
    'BREAKFAST': 'الفطور',
    'LUNCH': 'الغداء',
    'DINNER': 'العشاء',
    'SNACK': 'وجبة خفيفة',
    'WATER / DAY': 'لتر ماء / يوم',
    '2.5L WATER / DAY': 'الهدف اليومي من الماء: 2.5 لتر',
    // Sports & tracker
    'Top sport': 'الرياضة الأبرز',
    'Total sessions': 'إجمالي الجلسات',
    'Total minutes': 'إجمالي الدقائق',
    'Minutes this week': 'دقائق هذا الأسبوع',
    'Explore All Sports': 'استكشف جميع الرياضات',
    'Recommended': 'موصى به',
    'See More': 'عرض المزيد',
    'See more': 'عرض المزيد',
    'See Less': 'عرض أقل',
    'See less': 'عرض أقل',
    'more': 'المزيد',
    // Units / misc tokens that appear as standalone text nodes
    'kcal': 'سعرة',
    'kcal/day': 'سعرة/يوم',
    'min': 'د',
    'MIN': 'د',
    'KCAL': 'سعرة',
    'PROTEIN ': 'بروتين',
    // MoodMorph
    'Energy level': 'مستوى الطاقة',
    'Drag to set your energy': 'اسحب لضبط طاقتك',
    'Morph my workout': 'حوّل تمريني',
    'Need to relax instead?': 'بحاجة للاسترخاء بدلاً من ذلك؟',
    'Start Meditation Session': 'ابدأ جلسة تأمل',
    // Recovery IQ (kept in sync with volta-ai.js strings)
    'Check my recovery': 'افحص استشفائي',
    'Logged today — one session per day': 'تم التسجيل اليوم — جلسة واحدة يوميًا',
    // Settings rows already carry data-ar; these cover dynamic values
    'Light': 'فاتح',
    'Dark': 'داكن',
    'On': 'تشغيل',
    'Off': 'إيقاف',
    'Metric': 'متري',
    'Imperial': 'إمبراطوري',
    'English': 'الإنجليزية',
    // Coach recommendation
    "Coach's Recommendation": 'توصية المدرب',
    "COACH'S RECOMMENDATION": 'توصية المدرب',
    'Based on your goal': 'بناءً على هدفك',
    'we recommend these sports:': 'نوصي بهذه الرياضات:'
  };

  /* ── 2. Workouts — the full 100-name corpus of js/data/workouts.js ──── */
  var workouts = {
    'Push-Ups': 'تمرين الضغط',
    'Bench Press': 'ضغط الصدر بالبار',
    'Incline Dumbbell Press': 'ضغط مائل بالدمبل',
    'Dumbbell Fly': 'تفتيح بالدمبل',
    'Decline Push-Ups': 'ضغط هابط',
    'Cable Crossover': 'تفتيح بالكيبل',
    'Diamond Push-Ups': 'ضغط الماس',
    'Chest Dips': 'غطط الصدر',
    'Machine Chest Press': 'ضغط صدر بالجهاز',
    'Wide Push-Ups': 'ضغط واسع',
    'Incline Barbell Press': 'ضغط مائل بالبار',
    'Pec Deck Machine': 'جهاز تفتيح الصدر',
    'Explosive Push-Ups': 'ضغط انفجاري',
    'Dumbbell Pullover': 'بول أوفر بالدمبل',
    'Staggered Push-Ups': 'ضغط متدرج',
    'Pull-Ups': 'العقلة',
    'Bent-Over Barbell Rows': 'تجديف بالبار منحنيًا',
    'Dumbbell Rows': 'تجديف بالدمبل',
    'Lat Pulldown': 'سحب أمامي',
    'Seated Cable Row': 'تجديف جالس بالكيبل',
    'T-Bar Row': 'تجديف تي-بار',
    'Inverted Rows': 'تجديف مقلوب',
    'Deadlift': 'الرفعة المميتة',
    'Face Pulls': 'سحب الوجه',
    'Chin-Ups': 'العقلة بقبضة معاكسة',
    'Single-Arm Lat Pulldown': 'سحب أمامي بذراع واحدة',
    'Superman': 'تمرين سوبرمان',
    'Pendlay Row': 'تجديف بنديلاي',
    'TRX Rows': 'تجديف بالـ TRX',
    'Reverse Fly': 'تفتيح خلفي',
    'Bodyweight Squats': 'قرفصاء بوزن الجسم',
    'Barbell Squats': 'قرفصاء بالبار',
    'Lunges': 'الطعنات',
    'Romanian Deadlift': 'الرفعة الرومانية',
    'Leg Press': 'ضغط الأرجل',
    'Bulgarian Split Squats': 'قرفصاء بلغارية',
    'Goblet Squats': 'قرفصاء الكوب',
    'Calf Raises': 'رفع السمانة',
    'Leg Extensions': 'فرد الأرجل',
    'Hamstring Curls': 'ثني أوتار الركبة',
    'Jump Squats': 'قرفصاء بالقفز',
    'Step-Ups': 'صعود الصندوق',
    'Walking Lunges': 'طعنات متحركة',
    'Sumo Squats': 'قرفصاء السومو',
    'Wall Sits': 'جلوس على الحائط',
    'Dumbbell Shoulder Press': 'ضغط كتف بالدمبل',
    'Lateral Raises': 'رفرفة جانبية',
    'Front Raises': 'رفرفة أمامية',
    'Military Press': 'الضغط العسكري',
    'Arnold Press': 'ضغط أرنولد',
    'Pike Push-Ups': 'ضغط بايك',
    'Rear Delt Fly': 'تفتيح الكتف الخلفي',
    'Overhead Press': 'ضغط من فوق الرأس',
    'Cable Lateral Raises': 'رفرفة جانبية بالكيبل',
    'Upright Rows': 'تجديف عمودي',
    'Handstand Hold': 'ثبات الوقوف على اليدين',
    'Dumbbell Shrugs': 'هز الكتفين بالدمبل',
    'Face Pull to Press': 'سحب الوجه ثم الضغط',
    'Landmine Press': 'ضغط اللاندماين',
    'Wall Walks': 'مشي على الحائط',
    'Bicep Curls': 'تمرين البايسبس',
    'Tricep Dips': 'غطط الترايسبس',
    'Hammer Curls': 'تمرين المطرقة',
    'Tricep Pushdowns': 'دفع الترايسبس للأسفل',
    'Skull Crushers': 'سكال كراشر',
    'Preacher Curls': 'بايسبس على المنصة المائلة',
    'Concentration Curls': 'تمرين التركيز',
    'Close-Grip Bench Press': 'ضغط الصدر بقبضة ضيقة',
    'Cable Hammer Curls': 'مطرقة بالكيبل',
    'Overhead Tricep Extension': 'فرد الترايسبس فوق الرأس',
    '21s Bicep Curls': 'بايسبس 21',
    'Reverse Curls': 'تمرين بالقبضة المعاكسة',
    'Diamond Push-Ups Tricep Focus': 'ضغط الماس للترايسبس',
    'Rope Tricep Extensions': 'فرد الترايسبس بالحبل',
    'Spider Curls': 'تمرين سبايدر',
    'Plank': 'البلانك',
    'Crunches': 'تمرين البطن',
    'Russian Twists': 'الالتواء الروسي',
    'Leg Raises': 'رفع الأرجل',
    'Mountain Climbers': 'متسلق الجبال',
    'Bicycle Crunches': 'تمرين الدراجة',
    'Dead Bug': 'تمرين الحشرة الميتة',
    'Hanging Leg Raises': 'رفع الأرجل معلقًا',
    'Side Plank': 'البلانك الجانبي',
    'Bird Dog': 'تمرين الطائر والكلب',
    'Flutter Kicks': 'رفرفة الأرجل',
    'Hollow Body Hold': 'ثبات الجسم المجوف',
    'V-Ups': 'تمرين الخامس',
    'Cable Woodchoppers': 'قطع الحطب بالكيبل',
    'Ab Wheel Rollout': 'مدعلة البطن بالعجلة',
    'Running': 'الجري',
    'Cycling': 'ركوب الدراجات',
    'Jump Rope': 'نط الحبل',
    'Burpees': 'تمارين البيربي',
    'Rowing Machine': 'جهاز التجديف',
    'Swimming': 'السباحة',
    'Stair Climber': 'صعود الدرج',
    'High Knees': 'رفع الركبتين',
    'Box Jumps': 'القفز على الصندوق',
    'Sprint Intervals': 'جري السرعة المتقطع'
  };

  /* ── 3. Meals — derived from the full language pack (js/lang/ar.js) ─── */
  // Every entry {en: {name, desc, ingredients}} becomes en → Arabic name
  // for the walker, and the full record stays available for richer swaps.
  var meals = {};
  var mealRecords = {};
  try {
    var pack = window.VOLTA_LANG_PACKS && window.VOLTA_LANG_PACKS.ar;
    if (pack && pack.meals) {
      Object.keys(pack.meals).forEach(function (en) {
        var rec = pack.meals[en];
        if (rec && rec.name) { meals[en] = rec.name; mealRecords[en] = rec; }
      });
    }
  } catch (e) {}

  /* ── 4. Regex rules for number+unit text (cannot be enumerated) ─────── */
  var regex = [
    { re: /^(\d+)\s+MIN$/i, ar: '$1 د' },
    { re: /^(\d+)\s+MINS$/i, ar: '$1 د' },
    { re: /^(\d+)\s+MIN(UTES)?$/i, ar: '$1 دقيقة' },
    { re: /^(\d+)\s+KCAL$/i, ar: '$1 سعرة' },
    { re: /^≈\s*(\d+)\s+KCAL$/i, ar: '≈$1 سعرة' },
    { re: /^(\d+)\s+KCAL\s*\/\s*DAY$/i, ar: '$1 سعرة / يوم' },
    { re: /^(\d+(?:\.\d+)?)L\s+WATER\s*\/\s*DAY$/i, ar: 'الهدف اليومي من الماء: $1 لتر' },
    { re: /^\+(\d+)\s+more$/i, ar: '+$1 المزيد' },
    { re: /^P:\s*(\d+)g$/i, ar: 'ب: $1غ' },
    { re: /^C:\s*(\d+)g$/i, ar: 'ك: $1غ' },
    { re: /^F:\s*(\d+)g$/i, ar: 'د: $1غ' }
  ];

  /* ── 5. Merge + reverse maps + lookup API ───────────────────────────── */
  var all = {};
  function merge(obj) {
    try {
      Object.keys(obj).forEach(function (k) {
        if (!k) return;
        var v = obj[k];
        if (typeof v === 'string' && v) all[k] = v;
      });
    } catch (e) {}
  }
  merge(workouts);
  merge(meals);
  merge(phrases);           // phrases win on conflicts (most specific)

  var rev = {};
  Object.keys(all).forEach(function (en) {
    var ar = all[en];
    if (!rev[ar]) rev[ar] = en;   // first (most common) English wins
  });

  // Case-insensitive index for resilient matching ("stretching" etc.)
  var lower = {};
  Object.keys(all).forEach(function (en) {
    var k = en.toLowerCase();
    if (!lower[k]) lower[k] = en;
  });

  // Runtime merge: volta.js folds its own name maps (SPORT_AR_NAMES,
  // WORKOUT_AR_NAMES, MEAL_AR_NAMES) into the indexes exactly once so the
  // walker covers every corpus with one lookup path.
  function mergeInto(obj) {
    try {
      Object.keys(obj).forEach(function (k) {
        var v = obj[k];
        if (typeof v === 'string' && v && k) {
          all[k] = v;
          if (!rev[v]) rev[v] = k;
          var lk = k.toLowerCase();
          if (!lower[lk]) lower[lk] = k;
        }
      });
    } catch (e) {}
  }

  return {
    version: 1,
    _mergeInto: mergeInto,
    phrases: phrases,
    workouts: workouts,
    meals: meals,
    mealRecords: mealRecords,
    regex: regex,
    all: all,
    rev: rev,
    lower: lower,
    // Exact lookup (trims + collapses whitespace first, then falls back to
    // the case-insensitive index — "stretching" finds "Stretching")
    lookup: function (text) {
      if (!text) return null;
      var key = String(text).replace(/\s+/g, ' ').trim();
      if (!key) return null;
      if (all[key]) return all[key];
      var lk = key.toLowerCase();
      return (lower[lk] && all[lower[lk]]) || null;
    },
    // Reverse lookup: Arabic text → original English
    reverse: function (text) {
      if (!text) return null;
      var key = String(text).replace(/\s+/g, ' ').trim();
      if (!key) return null;
      return rev[key] || null;
    }
  };
})();
