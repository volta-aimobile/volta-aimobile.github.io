 

























window.VoltaPoseEngine = (function () {
  'use strict';

   
  var LM = {
    NOSE: 0,
    L_SHOULDER: 11, R_SHOULDER: 12,
    L_ELBOW: 13, R_ELBOW: 14,
    L_WRIST: 15, R_WRIST: 16,
    L_HIP: 23, R_HIP: 24,
    L_KNEE: 25, R_KNEE: 26,
    L_ANKLE: 27, R_ANKLE: 28,
    L_HEEL: 29, R_HEEL: 30,
    L_FOOT: 31, R_FOOT: 32
  };
  var CORE = [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP];

   
   
   
   
  function P(lm, i, aspect) {
    const p = lm[i];
    return { x: p.x * (aspect || 1), y: p.y, v: (p.visibility === undefined) ? 1 : p.visibility };
  }
  function angDeg(a, b, c) {
    const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
    const dot = v1x * v2x + v1y * v2y;
    const m = Math.sqrt((v1x * v1x + v1y * v1y) * (v2x * v2x + v2y * v2y));
    if (m <= 1e-9) return 180;
    return Math.acos(Math.max(-1, Math.min(1, dot / m))) * 180 / Math.PI;
  }
  function dist(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }
   
  function visOK(lm, idxs, min) {
    for (let i = 0; i < idxs.length; i++) {
      const p = lm[idxs[i]];
      if (!p || ((p.visibility === undefined ? 1 : p.visibility) < min)) return false;
    }
    return true;
  }
  function visAvg(lm, idxs) {
    let s = 0, n = 0;
    for (let i = 0; i < idxs.length; i++) { const p = lm[idxs[i]]; if (p) { s += (p.visibility === undefined ? 1 : p.visibility); n++; } }
    return n ? s / n : 0;
  }
   
  function bestSide(lm, aspect, lIdx, rIdx) {
    const L = lIdx.map(function (i) { return P(lm, i, aspect); });
    const R = rIdx.map(function (i) { return P(lm, i, aspect); });
    const vL = L.reduce(function (a, p) { return a + p.v; }, 0) / L.length;
    const vR = R.reduce(function (a, p) { return a + p.v; }, 0) / R.length;
    return (vR >= vL) ? { pts: R, v: vR, side: 'R' } : { pts: L, v: vL, side: 'L' };
  }
  function shoulderWidth(lm, aspect) { return dist(P(lm, LM.L_SHOULDER, aspect), P(lm, LM.R_SHOULDER, aspect)) || 0.12; }
   
  function torsoLean(lm, aspect) {
    const s = { x: (P(lm, LM.L_SHOULDER, aspect).x + P(lm, LM.R_SHOULDER, aspect).x) / 2, y: (P(lm, LM.L_SHOULDER, aspect).y + P(lm, LM.R_SHOULDER, aspect).y) / 2 };
    const h = { x: (P(lm, LM.L_HIP, aspect).x + P(lm, LM.R_HIP, aspect).x) / 2, y: (P(lm, LM.L_HIP, aspect).y + P(lm, LM.R_HIP, aspect).y) / 2 };
    return Math.abs(Math.atan2(h.x - s.x, s.y - h.y)) * 180 / Math.PI;
  }

   
   
   
   
   
   
   
   
   
   
  function personGate(lm, A, need) {
    const v = visAvg(lm, CORE);
    if (v < (need || 0.55)) return { ok: false, why: 'no_person' };
    return { ok: true, why: '' };
  }
  function bodyLine(lm, A) {
     
    const s = bestSide(lm, A, [LM.L_SHOULDER, LM.L_HIP, LM.L_KNEE], [LM.R_SHOULDER, LM.R_HIP, LM.R_KNEE]);
    return angDeg(s.pts[0], s.pts[1], s.pts[2]);
  }

  var FAMILIES = {
     
    squat: {
      label: 'Squat', labelAr: 'سكوات', mode: 'angle', down: 118, up: 158,
      gate: function (lm, A) {
        const base = personGate(lm, A, 0.5);
        if (!base.ok) return base;
        if (!visOK(lm, [LM.L_KNEE, LM.R_KNEE, LM.L_ANKLE, LM.R_ANKLE], 0.35)) return { ok: false, why: 'legs_out_of_frame' };
        return { ok: true };
      },
      sig: function (lm, A) {
        const k = bestSide(lm, A, [LM.L_HIP, LM.L_KNEE, LM.L_ANKLE], [LM.R_HIP, LM.R_KNEE, LM.R_ANKLE]);
        return angDeg(k.pts[0], k.pts[1], k.pts[2]);
      },
      findings: function (lm, A, st) {
        const out = [];
        const knee = bestSide(lm, A, [LM.L_HIP, LM.L_KNEE, LM.L_ANKLE], [LM.R_HIP, LM.R_KNEE, LM.R_ANKLE]);
        const kneeNow = angDeg(knee.pts[0], knee.pts[1], knee.pts[2]);
        if (st.angleMin != null && st.angleMin > 100) out.push({ verdict: 'warn', icon: 'fa-arrows-up-down', title: 'Depth is shallow', titleAr: 'النزول غير كافٍ', text: 'Your deepest knee angle this set was ' + Math.round(st.angleMin) + '° — aim for thighs at least parallel (≈90°).', textAr: 'أضيق زاوية ركبة في هذه المجموعة ' + Math.round(st.angleMin) + '° — انزل حتى يصبح الفخذ موازياً للأرض (≈90°).' });
        else if (st.angleMin != null) out.push({ verdict: 'good', icon: 'fa-circle-check', title: 'Depth looks right', titleAr: 'النزول صحيح', text: 'Deepest knee angle ' + Math.round(st.angleMin) + '° — solid squat depth.', textAr: 'أضيق زاوية ركبة ' + Math.round(st.angleMin) + '° — عمق ممتاز.' });
        const lean = torsoLean(lm, A);
        if (lean > 45 && kneeNow < 140) out.push({ verdict: 'warn', icon: 'fa-person-falling', title: 'Chest is dropping', titleAr: 'الصدر ينخفض كثيراً', text: 'Torso lean hit ' + Math.round(lean) + '° — keep your chest up and neutral spine.', textAr: 'ميل الجذع ' + Math.round(lean) + '° — ارفع صدرك وحافظ على استقامة الظهر.' });
        return out;
      }
    },

     
    lunge: {
      label: 'Lunge', labelAr: 'طعن (لانج)', mode: 'angle', down: 112, up: 155,
      gate: function (lm, A) {
        const base = personGate(lm, A, 0.5);
        if (!base.ok) return base;
        if (!visOK(lm, [LM.L_KNEE, LM.R_KNEE], 0.35)) return { ok: false, why: 'legs_out_of_frame' };
        return { ok: true };
      },
      sig: function (lm, A) {
        const kL = angDeg(P(lm, LM.L_HIP, A), P(lm, LM.L_KNEE, A), P(lm, LM.L_ANKLE, A));
        const kR = angDeg(P(lm, LM.R_HIP, A), P(lm, LM.R_KNEE, A), P(lm, LM.R_ANKLE, A));
        return Math.min(kL, kR);    
      },
      findings: function (lm, A, st) {
        const out = [];
        if (st.angleMin != null && st.angleMin > 100) out.push({ verdict: 'warn', icon: 'fa-arrows-up-down', title: 'Go deeper', titleAr: 'انزل أكثر', text: 'Front knee only reached ' + Math.round(st.angleMin) + '° — drive down until both knees are ≈90°.', textAr: 'الركبة الأمامية وصلت ' + Math.round(st.angleMin) + '° — انزل حتى تصبح الركبتان ≈90°.' });
        else if (st.angleMin != null) out.push({ verdict: 'good', icon: 'fa-circle-check', title: 'Good lunge depth', titleAr: 'عمق جيد للطعن', text: 'Front knee reached ' + Math.round(st.angleMin) + '° at the bottom.', textAr: 'الركبة الأمامية وصلت ' + Math.round(st.angleMin) + '° في أسفل الحركة.' });
        const lean = torsoLean(lm, A);
        if (lean > 40) out.push({ verdict: 'warn', icon: 'fa-person-falling', title: 'Torso is leaning', titleAr: 'الجذع مائل', text: 'Torso lean ' + Math.round(lean) + '° — stay tall, shoulders over hips.', textAr: 'ميل الجذع ' + Math.round(lean) + '° — انتصب مع الكتفين فوق الورك.' });
        return out;
      }
    },

     
    pushup: {
      label: 'Push-up', labelAr: 'تمارين ضغط', mode: 'angle', down: 122, up: 155,
      gate: function (lm, A) {
        const base = personGate(lm, A, 0.5);
        if (!base.ok) return base;
        if (!visOK(lm, [LM.L_ELBOW, LM.R_ELBOW, LM.L_WRIST, LM.R_WRIST], 0.35)) return { ok: false, why: 'arms_out_of_frame' };
        const line = bodyLine(lm, A);
        if (line < 125) return { ok: false, why: 'not_pushup' };    
        return { ok: true };
      },
      sig: function (lm, A) {
        const e = bestSide(lm, A, [LM.L_SHOULDER, LM.L_ELBOW, LM.L_WRIST], [LM.R_SHOULDER, LM.R_ELBOW, LM.R_WRIST]);
        return angDeg(e.pts[0], e.pts[1], e.pts[2]);
      },
      findings: function (lm, A, st) {
        const out = [];
        const line = bodyLine(lm, A);
        if (line < 150) out.push({ verdict: 'warn', icon: 'fa-horizontal-rule', title: 'Hips are sagging', titleAr: 'الورك ينخفض', text: 'Body line measured ' + Math.round(line) + '° — squeeze glutes and keep one straight line.', textAr: 'خط الجسم ' + Math.round(line) + '° — اشدّ المؤخرة وحافظ على خط مستقيم واحد.' });
        else out.push({ verdict: 'good', icon: 'fa-circle-check', title: 'Straight body line', titleAr: 'خط جسم مستقيم', text: 'Body line ' + Math.round(line) + '° — plank position holds.', textAr: 'خط الجسم ' + Math.round(line) + '° — وضعية البلانك ثابتة.' });
        if (st.angleMin != null && st.angleMin > 105) out.push({ verdict: 'warn', icon: 'fa-arrows-up-down', title: 'Half reps', titleAr: 'تكرارات نصفية', text: 'Elbows only reached ' + Math.round(st.angleMin) + '° — lower until ~90°.', textAr: 'المرفقان وصلنا ' + Math.round(st.angleMin) + '° — انزل حتى ≈90°.' });
        return out;
      }
    },

     
    press_chest: {
      label: 'Chest press', labelAr: 'ضغط صدر', mode: 'angle', down: 108, up: 150,
      gate: function (lm, A) {
        const base = personGate(lm, A, 0.5);
        if (!base.ok) return base;
        if (!visOK(lm, [LM.L_ELBOW, LM.R_ELBOW], 0.35)) return { ok: false, why: 'arms_out_of_frame' };
        return { ok: true };
      },
      sig: function (lm, A) {
        const e = bestSide(lm, A, [LM.L_SHOULDER, LM.L_ELBOW, LM.L_WRIST], [LM.R_SHOULDER, LM.R_ELBOW, LM.R_WRIST]);
        return angDeg(e.pts[0], e.pts[1], e.pts[2]);
      },
      findings: function (lm, A, st) {
        const out = [];
        if (st.angleMin != null && st.angleMin > 95) out.push({ verdict: 'warn', icon: 'fa-arrows-up-down', title: 'Bar/dumbbells too high', titleAr: 'النزول غير كافٍ', text: 'Elbows only reached ' + Math.round(st.angleMin) + '° — touch chest level before pressing.', textAr: 'المرفقان وصل ' + Math.round(st.angleMin) + '° — انزل حتى مستوى الصدر قبل الدفع.' });
        else out.push({ verdict: 'good', icon: 'fa-circle-check', title: 'Good press depth', titleAr: 'عمق جيد للضغط', text: 'Elbows reached ' + (st.angleMin != null ? Math.round(st.angleMin) + '°' : 'chest level') + ' at the bottom.', textAr: 'المرفقان وصل ' + (st.angleMin != null ? Math.round(st.angleMin) + '°' : 'مستوى الصدر') + ' في أسفل الحركة.' });
        if (st.symmetry != null && st.symmetry < 0.7) out.push({ verdict: 'warn', icon: 'fa-scale-unbalanced', title: 'Uneven press', titleAr: 'دفع غير متوازن', text: 'Left/right pressing differs — both arms should extend together.', textAr: 'اختلاف بين اليمين واليسار — يُفترض أن يدفع الذراعان معاً.' });
        return out;
      }
    },

     
    press_shoulder: {
      label: 'Shoulder press', labelAr: 'ضغط كتف', mode: 'angle', down: 105, up: 150,
      gate: function (lm, A) {
        const base = personGate(lm, A, 0.5);
        if (!base.ok) return base;
        if (!visOK(lm, [LM.L_ELBOW, LM.R_ELBOW, LM.L_WRIST, LM.R_WRIST], 0.35)) return { ok: false, why: 'arms_out_of_frame' };
        return { ok: true };
      },
      sig: function (lm, A) {
        const e = bestSide(lm, A, [LM.L_SHOULDER, LM.L_ELBOW, LM.L_WRIST], [LM.R_SHOULDER, LM.R_ELBOW, LM.R_WRIST]);
        return angDeg(e.pts[0], e.pts[1], e.pts[2]);
      },
      findings: function (lm, A, st) {
        const out = [];
        const wL = P(lm, LM.L_WRIST, A), wR = P(lm, LM.R_WRIST, A);
        const sL = P(lm, LM.L_SHOULDER, A), sR = P(lm, LM.R_SHOULDER, A);
        const overhead = (wL.y < sL.y && wR.y < sR.y);
        if (overhead) out.push({ verdict: 'good', icon: 'fa-circle-check', title: 'Full lockout overhead', titleAr: 'تمام الفتح فوق الرأس', text: 'Wrists finish above the shoulders — full range achieved.', textAr: 'الرسغان فوق الكتفين — مدى كامل.' });
        else if (st.reps >= 2) out.push({ verdict: 'warn', icon: 'fa-arrows-up-down', title: 'Incomplete lockout', titleAr: 'الفتح غير مكتمل', text: 'Wrists are not clearing the shoulders at the top — press fully overhead.', textAr: 'الرسغان لا تعلو الكتفين في الأعلى — اكمل الدفع فوق الرأس.' });
        return out;
      }
    },

     
    hinge: {
      label: 'Deadlift / hinge', labelAr: 'رفعة ميتة / مفصلة الورك', mode: 'angle', down: 105, up: 160,
      gate: function (lm, A) {
        const base = personGate(lm, A, 0.5);
        if (!base.ok) return base;
        if (!visOK(lm, [LM.L_KNEE, LM.R_KNEE], 0.35)) return { ok: false, why: 'legs_out_of_frame' };
        return { ok: true };
      },
      sig: function (lm, A) {
        const h = bestSide(lm, A, [LM.L_SHOULDER, LM.L_HIP, LM.L_KNEE], [LM.R_SHOULDER, LM.R_HIP, LM.R_KNEE]);
        return angDeg(h.pts[0], h.pts[1], h.pts[2]);
      },
      findings: function (lm, A, st) {
        const out = [];
        const s = bestSide(lm, A, [LM.L_SHOULDER, LM.L_HIP, LM.L_KNEE], [LM.R_SHOULDER, LM.R_HIP, LM.R_KNEE]);
        const hip = angDeg(s.pts[0], s.pts[1], s.pts[2]);
        if (st.angleMin != null && st.angleMin < 70) out.push({ verdict: 'warn', icon: 'fa-person-falling-bolt', title: 'Hinging too low', titleAr: 'المفصلة عميقة جداً', text: 'Hip angle reached ' + Math.round(st.angleMin) + '° — stop the bar around mid-shin and keep tension.', textAr: 'زاوية الورك وصلت ' + Math.round(st.angleMin) + '° — توقف عند منتصف الساق وحافظ على الشد.' });
        if (st.angleMax != null && st.angleMax < 160 && st.reps >= 2) out.push({ verdict: 'warn', icon: 'fa-circle-up', title: 'Lockout incomplete', titleAr: 'الوقوف غير مكتمل', text: 'Stand fully tall between reps (hip angle ' + Math.round(st.angleMax) + '° now).', textAr: 'قف منتصباً تماماً بين التكرارات (زاوية الورك ' + Math.round(st.angleMax) + '°).' });
        else if (st.angleMax != null && st.angleMax >= 160) out.push({ verdict: 'good', icon: 'fa-circle-check', title: 'Clean lockout', titleAr: 'وقوف مكتمل', text: 'Full stand between reps with hip angle ' + Math.round(st.angleMax) + '°.', textAr: 'وقوف كامل بين التكرارات بزاوية ورك ' + Math.round(st.angleMax) + '°.' });
        return out;
      }
    },

     
    pull_v: {
      label: 'Vertical pull', labelAr: 'سحب عمودي', mode: 'angle', down: 95, up: 152,
      gate: function (lm, A) {
        const base = personGate(lm, A, 0.5);
        if (!base.ok) return base;
        if (!visOK(lm, [LM.L_ELBOW, LM.R_ELBOW, LM.L_WRIST, LM.R_WRIST], 0.35)) return { ok: false, why: 'arms_out_of_frame' };
        return { ok: true };
      },
      sig: function (lm, A) {
        const e = bestSide(lm, A, [LM.L_SHOULDER, LM.L_ELBOW, LM.L_WRIST], [LM.R_SHOULDER, LM.R_ELBOW, LM.R_WRIST]);
        return angDeg(e.pts[0], e.pts[1], e.pts[2]);
      },
      findings: function (lm, A, st) {
        const out = [];
        if (st.angleMax != null && st.angleMax < 150 && st.reps >= 2) out.push({ verdict: 'warn', icon: 'fa-arrows-down-to-line', title: 'Arms not fully extended', titleAr: 'الذراعان غير مفتوحتين تماماً', text: 'Stretch fully at the bottom of every pull (elbows ' + Math.round(st.angleMax) + '° now).', textAr: 'افتح الذراعين تماماً في أسفل كل سحبة (المرفقان ' + Math.round(st.angleMax) + '°).' });
        else if (st.angleMax != null) out.push({ verdict: 'good', icon: 'fa-circle-check', title: 'Full stretch at the bottom', titleAr: 'مدى كامل في الأسفل', text: 'Arms extend to ' + Math.round(st.angleMax) + '° each rep.', textAr: 'الذراعان تفتح إلى ' + Math.round(st.angleMax) + '° في كل تكرار.' });
        return out;
      }
    },

     
    pull_h: {
      label: 'Row', labelAr: 'سحب أفقي (تجديف)', mode: 'angle', down: 98, up: 150,
      gate: function (lm, A) {
        const base = personGate(lm, A, 0.5);
        if (!base.ok) return base;
        if (!visOK(lm, [LM.L_ELBOW, LM.R_ELBOW], 0.35)) return { ok: false, why: 'arms_out_of_frame' };
        return { ok: true };
      },
      sig: function (lm, A) {
        const e = bestSide(lm, A, [LM.L_SHOULDER, LM.L_ELBOW, LM.L_WRIST], [LM.R_SHOULDER, LM.R_ELBOW, LM.R_WRIST]);
        return angDeg(e.pts[0], e.pts[1], e.pts[2]);
      },
      findings: function (lm, A, st) {
        const out = [];
        const lean = torsoLean(lm, A);
        if (st.angleMax != null && st.angleMax < 148 && st.reps >= 2) out.push({ verdict: 'warn', icon: 'fa-arrows-down-to-line', title: 'Short stretch', titleAr: 'المدى قصير', text: 'Let the arms extend fully each rep (elbows ' + Math.round(st.angleMax) + '° now).', textAr: 'افتح الذراعين بالكامل في كل تكرار (المرفقان ' + Math.round(st.angleMax) + '°).' });
        if (lean > 30 && lean < 80) out.push({ verdict: 'good', icon: 'fa-circle-check', title: 'Rowing position set', titleAr: 'وضعية التجديف ثابتة', text: 'Torso hinge at ' + Math.round(lean) + '° — stable rowing angle.', textAr: 'ميل الجذع ' + Math.round(lean) + '° — زاوية تجديف ثابتة.' });
        return out;
      }
    },

     
    curl: {
      label: 'Bicep curl', labelAr: 'مرجحة بايسبس', mode: 'angle', down: 68, up: 148,
      gate: function (lm, A) {
        const base = personGate(lm, A, 0.5);
        if (!base.ok) return base;
        if (!visOK(lm, [LM.L_ELBOW, LM.R_ELBOW], 0.35)) return { ok: false, why: 'arms_out_of_frame' };
        return { ok: true };
      },
      sig: function (lm, A) {
        const e = bestSide(lm, A, [LM.L_SHOULDER, LM.L_ELBOW, LM.L_WRIST], [LM.R_SHOULDER, LM.R_ELBOW, LM.R_WRIST]);
        return angDeg(e.pts[0], e.pts[1], e.pts[2]);
      },
      findings: function (lm, A, st) {
        const out = [];
        if (st.elbowDrift != null && st.elbowDrift > 0.38) out.push({ verdict: 'warn', icon: 'fa-people-arrows', title: 'Elbows are swinging', titleAr: 'المرفقان يتأرجحان', text: 'Upper-arm position moved ' + Math.round(st.elbowDrift * 100) + '% during the set — pin elbows to your sides.', textAr: 'تحرك موضع العضد ' + Math.round(st.elbowDrift * 100) + '% — ثبّت المرفقين بجانب الجسم.' });
        else out.push({ verdict: 'good', icon: 'fa-circle-check', title: 'Elbows stay pinned', titleAr: 'المرفقان ثابتان', text: 'Upper arm stayed stable — strict curling.', textAr: 'العضد بقي ثابتاً — أداء نظيف.' });
        if (st.angleMax != null && st.angleMax < 145 && st.reps >= 2) out.push({ verdict: 'warn', icon: 'fa-arrows-down-to-line', title: 'Curls are partial', titleAr: 'المرجحة نصفية', text: 'Extend arms nearly straight at the bottom of each rep.', textAr: 'افتح الذراعين شبه كامل في أسفل كل تكرار.' });
        return out;
      }
    },

     
    tri_ext: {
      label: 'Tricep extension', labelAr: 'تمديد ترايسبس', mode: 'angle', down: 88, up: 152,
      gate: function (lm, A) {
        const base = personGate(lm, A, 0.5);
        if (!base.ok) return base;
        if (!visOK(lm, [LM.L_ELBOW, LM.R_ELBOW], 0.35)) return { ok: false, why: 'arms_out_of_frame' };
        return { ok: true };
      },
      sig: function (lm, A) {
        const e = bestSide(lm, A, [LM.L_SHOULDER, LM.L_ELBOW, LM.L_WRIST], [LM.R_SHOULDER, LM.R_ELBOW, LM.R_WRIST]);
        return angDeg(e.pts[0], e.pts[1], e.pts[2]);
      },
      findings: function (lm, A, st) {
        const out = [];
        if (st.angleMax != null && st.angleMax >= 150) out.push({ verdict: 'good', icon: 'fa-circle-check', title: 'Full lockout each rep', titleAr: 'فتح كامل في كل تكرار', text: 'Elbows reach ' + Math.round(st.angleMax) + '° — triceps fully contract.', textAr: 'المرفقان يصلان ' + Math.round(st.angleMax) + '° — انقباض كامل للترايسبس.' });
        if (st.angleMin != null && st.angleMin > 95) out.push({ verdict: 'warn', icon: 'fa-arrows-up-down', title: 'Range too short', titleAr: 'المدى قصير', text: 'Bend the elbows past 90° before extending.', textAr: 'اثنِ المرفقين بعد 90° قبل التمديد.' });
        return out;
      }
    },

     
    dips: {
      label: 'Dips', labelAr: 'غطسات (دبس)', mode: 'angle', down: 108, up: 152,
      gate: function (lm, A) {
        const base = personGate(lm, A, 0.5);
        if (!base.ok) return base;
        if (!visOK(lm, [LM.L_ELBOW, LM.R_ELBOW, LM.L_SHOULDER, LM.R_SHOULDER], 0.35)) return { ok: false, why: 'arms_out_of_frame' };
        return { ok: true };
      },
      sig: function (lm, A) {
        const e = bestSide(lm, A, [LM.L_SHOULDER, LM.L_ELBOW, LM.L_WRIST], [LM.R_SHOULDER, LM.R_ELBOW, LM.R_WRIST]);
        return angDeg(e.pts[0], e.pts[1], e.pts[2]);
      },
      findings: function (lm, A, st) {
        const out = [];
        if (st.angleMin != null && st.angleMin > 100) out.push({ verdict: 'warn', icon: 'fa-arrows-up-down', title: 'Half dips', titleAr: 'غطسات نصفية', text: 'Lower until shoulders reach elbow height (~90°).', textAr: 'انزل حتى يبلغ الكتفان مستوى المرفقين (~90°).' });
        else if (st.angleMin != null) out.push({ verdict: 'good', icon: 'fa-circle-check', title: 'Good depth', titleAr: 'عمق جيد', text: 'Shoulders drop to elbow level — proper depth.', textAr: 'الكتفان ينزلان لمستوى المرفقين — عمق صحيح.' });
        return out;
      }
    },

     
    raise: {
      label: 'Raise', labelAr: 'رفرفة', mode: 'angle', down: 28, up: 68,
      gate: function (lm, A) {
        const base = personGate(lm, A, 0.5);
        if (!base.ok) return base;
        if (!visOK(lm, [LM.L_ELBOW, LM.R_ELBOW, LM.L_WRIST, LM.R_WRIST], 0.3)) return { ok: false, why: 'arms_out_of_frame' };
        return { ok: true };
      },
      sig: function (lm, A) {
         
        const L = angDeg(P(lm, LM.L_HIP, A), P(lm, LM.L_SHOULDER, A), P(lm, LM.L_ELBOW, A));
        const R = angDeg(P(lm, LM.R_HIP, A), P(lm, LM.R_SHOULDER, A), P(lm, LM.R_ELBOW, A));
        return Math.max(L, R);
      },
      findings: function (lm, A, st) {
        const out = [];
        if (st.symmetry != null && st.symmetry < 0.65) out.push({ verdict: 'warn', icon: 'fa-scale-unbalanced', title: 'Uneven arms', titleAr: 'ذراعان غير متوازيتين', text: 'One arm leads the raise — move both to the same height.', textAr: 'ذراع تسبق الأخرى — ارفعهما لنفس الارتفاع.' });
        else out.push({ verdict: 'good', icon: 'fa-circle-check', title: 'Balanced raise', titleAr: 'رفرفة متوازنة', text: 'Both arms travel evenly.', textAr: 'الذراعان تتحركان بتوازن.' });
        return out;
      }
    },

     
    shrug: {
      label: 'Shrug', labelAr: 'هزّة كتف', mode: 'bounce', amp: 0.014,
      gate: function (lm, A) {
        const base = personGate(lm, A, 0.5);
        if (!base.ok) return base;
        const wL = P(lm, LM.L_WRIST, A), hL = P(lm, LM.L_HIP, A);
        if (!(wL.y > hL.y - 0.05)) return { ok: false, why: 'not_shrug' };    
        return { ok: true };
      },
      sigY: function (lm, A) { return (P(lm, LM.L_SHOULDER, A).y + P(lm, LM.R_SHOULDER, A).y) / 2; },
      findings: function (lm, A, st) { return []; }
    },

     
    leg_ext: {
      label: 'Leg extension', labelAr: 'تمديد الرجل', mode: 'angle', down: 95, up: 158,
      gate: function (lm, A) {
        const base = personGate(lm, A, 0.5);
        if (!base.ok) return base;
        if (!visOK(lm, [LM.L_KNEE, LM.R_KNEE], 0.35)) return { ok: false, why: 'legs_out_of_frame' };
        return { ok: true };
      },
      sig: function (lm, A) {
        const k = bestSide(lm, A, [LM.L_HIP, LM.L_KNEE, LM.L_ANKLE], [LM.R_HIP, LM.R_KNEE, LM.R_ANKLE]);
        return angDeg(k.pts[0], k.pts[1], k.pts[2]);
      },
      findings: function (lm, A, st) {
        const out = [];
        if (st.angleMax != null && st.angleMax < 155) out.push({ verdict: 'warn', icon: 'fa-arrows-up-down', title: 'Lock off short', titleAr: 'التمديد ناقص', text: 'Extend fully and squeeze at the top of each rep.', textAr: 'مدّ الرجل بالكامل واعصر العضلة في أعلى كل تكرار.' });
        else out.push({ verdict: 'good', icon: 'fa-circle-check', title: 'Full extension', titleAr: 'تمديد كامل', text: 'Knees reach full extension each rep.', textAr: 'الركبة تصل للتمديد الكامل في كل تكرار.' });
        return out;
      }
    },
    leg_curl: {
      label: 'Hamstring curl', labelAr: 'ثني أوتار الركبة', mode: 'angle', down: 95, up: 152,
      gate: function (lm, A) {
        const base = personGate(lm, A, 0.5);
        if (!base.ok) return base;
        if (!visOK(lm, [LM.L_KNEE, LM.R_KNEE], 0.35)) return { ok: false, why: 'legs_out_of_frame' };
        return { ok: true };
      },
      sig: function (lm, A) {
        const k = bestSide(lm, A, [LM.L_HIP, LM.L_KNEE, LM.L_ANKLE], [LM.R_HIP, LM.R_KNEE, LM.R_ANKLE]);
        return angDeg(k.pts[0], k.pts[1], k.pts[2]);
      },
      findings: function (lm, A, st) {
        const out = [];
        if (st.angleMin != null && st.angleMin > 100) out.push({ verdict: 'warn', icon: 'fa-arrows-up-down', title: 'Squeeze harder', titleAr: 'الثني غير كافٍ', text: 'Curl the heels fully toward the glutes each rep.', textAr: 'قرّب الكعبين للمؤخرة بالكامل في كل تكرار.' });
        else out.push({ verdict: 'good', icon: 'fa-circle-check', title: 'Strong contraction', titleAr: 'انقباض قوي', text: 'Heels reach the glutes — full hamstring curl.', textAr: 'الكعبان يصلان للمؤخرة — ثني كامل.' });
        return out;
      }
    },

     
    calf: {
      label: 'Calf raise', labelAr: 'رفعة السمانة', mode: 'bounce', amp: 0.012,
      gate: function (lm, A) {
        const base = personGate(lm, A, 0.5);
        if (!base.ok) return base;
        if (!visOK(lm, [LM.L_ANKLE, LM.R_ANKLE], 0.3)) return { ok: false, why: 'legs_out_of_frame' };
        return { ok: true };
      },
      sigY: function (lm, A) { return (P(lm, LM.L_HIP, A).y + P(lm, LM.R_HIP, A).y) / 2; },
      findings: function (lm, A, st) { return []; }
    },

     
    crunch: {
      label: 'Crunch', labelAr: 'عضلات بطن (كرانش)', mode: 'angle', rev: true, down: 122, up: 160,
      gate: function (lm, A) {
        const base = personGate(lm, A, 0.5);
        if (!base.ok) return base;
        return { ok: true };
      },
      sig: function (lm, A) {
        const s = bestSide(lm, A, [LM.L_SHOULDER, LM.L_HIP, LM.L_KNEE], [LM.R_SHOULDER, LM.R_HIP, LM.R_KNEE]);
        return angDeg(s.pts[0], s.pts[1], s.pts[2]);
      },
      findings: function (lm, A, st) {
        const out = [];
        if (st.reps >= 3 && st.angleMax != null && st.angleMax < 125) out.push({ verdict: 'warn', icon: 'fa-arrows-up-down', title: 'Crunch is shallow', titleAr: 'الرفعة قصيرة', text: 'Shoulders are barely leaving the floor — curl up until the shoulder blades clear.', textAr: 'الكتفان يرتفعان قليلاً — ارفع الجذع حتى تفارق لوحا الكتف الأرض.' });
        else out.push({ verdict: 'good', icon: 'fa-circle-check', title: 'Good crunch range', titleAr: 'مدى جيد للكرانش', text: 'Torso curls through a full range each rep.', textAr: 'الجذع يمر بمدى كامل في كل تكرار.' });
        return out;
      }
    },

     
    leg_raise: {
      label: 'Leg raise', labelAr: 'رفعة الأرجل', mode: 'angle', rev: true, down: 120, up: 160,
      gate: function (lm, A) {
        const base = personGate(lm, A, 0.5);
        if (!base.ok) return base;
        if (!visOK(lm, [LM.L_KNEE, LM.R_KNEE], 0.3)) return { ok: false, why: 'legs_out_of_frame' };
        return { ok: true };
      },
      sig: function (lm, A) {
        const s = bestSide(lm, A, [LM.L_SHOULDER, LM.L_HIP, LM.L_KNEE], [LM.R_SHOULDER, LM.R_HIP, LM.R_KNEE]);
        return angDeg(s.pts[0], s.pts[1], s.pts[2]);
      },
      findings: function (lm, A, st) { return []; }
    },

     
    twist: {
      label: 'Russian twist', labelAr: 'لفتات روسية', mode: 'alternate',
      gate: function (lm, A) {
        const base = personGate(lm, A, 0.5);
        if (!base.ok) return base;
        return { ok: true };
      },
      threshold: 0.32,
       
      sigLR: function (lm, A) {
        const sL = P(lm, LM.L_SHOULDER, A), sR = P(lm, LM.R_SHOULDER, A);
        const mid = { x: (sL.x + sR.x) / 2 };
        const nose = P(lm, LM.NOSE, A);
        const w = shoulderWidth(lm, A) || 0.12;
        return (nose.x - mid.x) / w;        
      },
      findings: function (lm, A, st) { return []; }
    },

     
    alternate_knee: {
      label: 'Alternating knee drive', labelAr: 'قيادة ركبة متبادلة', mode: 'alternate',
      kneeBias: 0.35,
      gate: function (lm, A) {
        const base = personGate(lm, A, 0.5);
        if (!base.ok) return base;
        if (!visOK(lm, [LM.L_KNEE, LM.R_KNEE], 0.3)) return { ok: false, why: 'legs_out_of_frame' };
        return { ok: true };
      },
       
       
      sigLR: function (lm, A, ctx) {
        const hY = (P(lm, LM.L_HIP, A).y + P(lm, LM.R_HIP, A).y) / 2;
        const kL = P(lm, LM.L_KNEE, A).y, kR = P(lm, LM.R_KNEE, A).y;
        const w = shoulderWidth(lm, A) || 0.12;
        const liftL = hY - kL, liftR = hY - kR;    
        const TH = w * ((ctx && ctx.kneeBias) || 0.35);
        if (liftL > TH && liftL > liftR * 1.25) return 1;
        if (liftR > TH && liftR > liftL * 1.25) return -1;
        return 0;
      },
      findings: function (lm, A, st) { return []; }
    },

     
    alternate_limb: {
      label: 'Alternating limbs', labelAr: 'تبديل الأطراف', mode: 'alternate',
      gate: function (lm, A) {
        const base = personGate(lm, A, 0.5);
        if (!base.ok) return base;
        return { ok: true };
      },
       
      sigLR: function (lm, A) {
        const w = shoulderWidth(lm, A) || 0.12;
        const dL = dist(P(lm, LM.L_WRIST, A), P(lm, LM.L_SHOULDER, A)) / w;
        const dR = dist(P(lm, LM.R_WRIST, A), P(lm, LM.R_SHOULDER, A)) / w;
        if (dL > 1.6 && dL > dR * 1.3) return 1;
        if (dR > 1.6 && dR > dL * 1.3) return -1;
        return 0;
      },
      findings: function (lm, A, st) { return []; }
    },

     
    bounce_big: {
      label: 'Jump', labelAr: 'قفز', mode: 'bounce', amp: 0.05,
      gate: function (lm, A) {
        const base = personGate(lm, A, 0.5);
        if (!base.ok) return base;
        return { ok: true };
      },
      sigY: function (lm, A) { return (P(lm, LM.L_HIP, A).y + P(lm, LM.R_HIP, A).y) / 2; },
      findings: function (lm, A, st) { return []; }
    },

     
    plank: {
      label: 'Plank', labelAr: 'بلانك', mode: 'static',
      gate: function (lm, A) {
        const base = personGate(lm, A, 0.5);
        if (!base.ok) return base;
        const line = bodyLine(lm, A);
        if (line < 140) return { ok: false, why: 'not_plank' };
        return { ok: true };
      },
      findings: function (lm, A, st) {
        const out = [];
        const line = bodyLine(lm, A);
        if (line >= 158) out.push({ verdict: 'good', icon: 'fa-circle-check', title: 'Rock-solid plank', titleAr: 'بلانك ثابت', text: 'Body line ' + Math.round(line) + '° — hold this position.', textAr: 'خط الجسم ' + Math.round(line) + '° — استمر على هذه الوضعية.' });
        else out.push({ verdict: 'warn', icon: 'fa-horizontal-rule', title: 'Hips too low', titleAr: 'الورك منخفض', text: 'Body line ' + Math.round(line) + '° — lift the hips into one straight line.', textAr: 'خط الجسم ' + Math.round(line) + '° — ارفع الورك ليصبح الجسم خطاً مستقيماً.' });
        return out;
      }
    },

     
    wall_sit: {
      label: 'Wall sit', labelAr: 'جلسة الحائط', mode: 'static',
      gate: function (lm, A) {
        const base = personGate(lm, A, 0.5);
        if (!base.ok) return base;
        const k = bestSide(lm, A, [LM.L_HIP, LM.L_KNEE, LM.L_ANKLE], [LM.R_HIP, LM.R_KNEE, LM.R_ANKLE]);
        const knee = angDeg(k.pts[0], k.pts[1], k.pts[2]);
        if (knee > 125) return { ok: false, why: 'not_wallsit' };    
        return { ok: true };
      },
      findings: function (lm, A, st) {
        const out = [];
        const k = bestSide(lm, A, [LM.L_HIP, LM.L_KNEE, LM.L_ANKLE], [LM.R_HIP, LM.R_KNEE, LM.R_ANKLE]);
        const knee = angDeg(k.pts[0], k.pts[1], k.pts[2]);
        if (knee <= 105) out.push({ verdict: 'good', icon: 'fa-circle-check', title: 'Proper 90° wall sit', titleAr: 'جلسة 90° صحيحة', text: 'Knee angle ' + Math.round(knee) + '° — thighs parallel to the floor.', textAr: 'زاوية الركبة ' + Math.round(knee) + '° — الفخذ موازٍ للأرض.' });
        else out.push({ verdict: 'warn', icon: 'fa-arrows-up-down', title: 'Sit lower', titleAr: 'انزل أكثر', text: 'Knee angle ' + Math.round(knee) + '° — slide down to ≈90°.', textAr: 'زاوية الركبة ' + Math.round(knee) + '° — انزلق حتى ≈90°.' });
        return out;
      }
    },

     
    hold: {
      label: 'Hold', labelAr: 'ثبات', mode: 'static',
      gate: function (lm, A) { return personGate(lm, A, 0.5); },
      findings: function (lm, A, st) { return []; }
    },

     
    row_machine: {
      label: 'Rowing', labelAr: 'تجديف', mode: 'angle', down: 108, up: 158,
      gate: function (lm, A) {
        const base = personGate(lm, A, 0.5);
        if (!base.ok) return base;
        return { ok: true };
      },
      sig: function (lm, A) {
        const s = bestSide(lm, A, [LM.L_SHOULDER, LM.L_HIP, LM.L_KNEE], [LM.R_SHOULDER, LM.R_HIP, LM.R_KNEE]);
        return angDeg(s.pts[0], s.pts[1], s.pts[2]);
      },
      findings: function (lm, A, st) { return []; }
    },

     
    burpee: {
      label: 'Burpee', labelAr: 'بيربي', mode: 'bounce', amp: 0.12,
      gate: function (lm, A) { return personGate(lm, A, 0.5); },
      sigY: function (lm, A) { return (P(lm, LM.L_HIP, A).y + P(lm, LM.R_HIP, A).y) / 2; },
      findings: function (lm, A, st) { return []; }
    },

     
    cycling: {
      label: 'Cycling', labelAr: 'دراجة', mode: 'angle', down: 95, up: 148,
      gate: function (lm, A) {
        const base = personGate(lm, A, 0.5);
        if (!base.ok) return base;
        if (!visOK(lm, [LM.L_KNEE, LM.R_KNEE], 0.3)) return { ok: false, why: 'legs_out_of_frame' };
        return { ok: true };
      },
      sig: function (lm, A) {
        const k = bestSide(lm, A, [LM.L_HIP, LM.L_KNEE, LM.L_ANKLE], [LM.R_HIP, LM.R_KNEE, LM.R_ANKLE]);
        return angDeg(k.pts[0], k.pts[1], k.pts[2]);
      },
      findings: function (lm, A, st) { return []; }
    },

     
    woodchop: {
      label: 'Woodchop', labelAr: 'قطع الخشب', mode: 'angle', down: 30, up: 66,
      gate: function (lm, A) {
        const base = personGate(lm, A, 0.5);
        if (!base.ok) return base;
        if (!visOK(lm, [LM.L_WRIST, LM.R_WRIST], 0.3)) return { ok: false, why: 'arms_out_of_frame' };
        return { ok: true };
      },
      sig: function (lm, A) {
         
        const w = P(lm, LM.L_WRIST, A), h = P(lm, LM.R_HIP, A);
        const w2 = P(lm, LM.R_WRIST, A), h2 = P(lm, LM.L_HIP, A);
        const d1 = h.y - w.y, d2 = h2.y - w2.y;
        const wNorm = shoulderWidth(lm, A) || 0.12;
        return Math.max(d1, d2) / wNorm * 45;    
      },
      findings: function (lm, A, st) { return []; }
    },

     
    superman: {
      label: 'Superman', labelAr: 'سوبرمان', mode: 'bounce', amp: 0.016,
      gate: function (lm, A) { return personGate(lm, A, 0.5); },
      sigY: function (lm, A) { return (P(lm, LM.L_SHOULDER, A).y + P(lm, LM.R_SHOULDER, A).y) / 2; },
      findings: function (lm, A, st) { return []; }
    },

     
    fly: {
      label: 'Chest fly', labelAr: 'تفتيح صدر', mode: 'angle', down: 22, up: 52,
      gate: function (lm, A) {
        const base = personGate(lm, A, 0.5);
        if (!base.ok) return base;
        if (!visOK(lm, [LM.L_WRIST, LM.R_WRIST], 0.3)) return { ok: false, why: 'arms_out_of_frame' };
        return { ok: true };
      },
      sig: function (lm, A) {
        const w = shoulderWidth(lm, A) || 0.12;
        const spread = dist(P(lm, LM.L_WRIST, A), P(lm, LM.R_WRIST, A)) / w;
        return Math.min(90, spread * 34);       
      },
      findings: function (lm, A, st) { return []; }
    },

     
    generic: {
      label: 'Exercise', labelAr: 'تمرين', mode: 'angle', down: 100, up: 150,
      gate: function (lm, A) { return personGate(lm, A, 0.6); },
      sig: function (lm, A) {
         
        const e = bestSide(lm, A, [LM.L_SHOULDER, LM.L_ELBOW, LM.L_WRIST], [LM.R_SHOULDER, LM.R_ELBOW, LM.R_WRIST]);
        if (e.v >= 0.5) return angDeg(e.pts[0], e.pts[1], e.pts[2]);
        const k = bestSide(lm, A, [LM.L_HIP, LM.L_KNEE, LM.L_ANKLE], [LM.R_HIP, LM.R_KNEE, LM.R_ANKLE]);
        if (k.v >= 0.5) return angDeg(k.pts[0], k.pts[1], k.pts[2]);
        const h = bestSide(lm, A, [LM.L_SHOULDER, LM.L_HIP, LM.L_KNEE], [LM.R_SHOULDER, LM.R_HIP, LM.R_KNEE]);
        return angDeg(h.pts[0], h.pts[1], h.pts[2]);
      },
      findings: function (lm, A, st) { return []; }
    }
  };

   
   
   
   
   
   
   
  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]+/g, ' ').trim(); }

  var EXERCISES = {
     
    'push ups':              { f: 'pushup', down: 118, up: 155 },
    'decline push ups':      { f: 'pushup', down: 120, up: 155 },
    'diamond push ups':      { f: 'pushup', down: 112, up: 155 },    
    'wide push ups':         { f: 'pushup', down: 122, up: 155 },
    'explosive push ups':    { f: 'pushup', down: 125, up: 160 },
    'staggered push ups':    { f: 'pushup', down: 122, up: 155 },
    'diamond push ups tricep focus': { f: 'pushup', down: 112, up: 155 },
    'pike push ups':         { f: 'press_shoulder', down: 100, up: 155 },  
    'bench press':           { f: 'press_chest', down: 105, up: 152 },
    'incline barbell press': { f: 'press_chest', down: 108, up: 152 },
    'incline dumbbell press':{ f: 'press_chest', down: 108, up: 152 },
    'machine chest press':   { f: 'press_chest', down: 105, up: 152 },
    'close grip bench press':{ f: 'press_chest', down: 100, up: 152 },
    'dumbbell fly':          { f: 'fly' },
    'cable crossover':       { f: 'fly' },
    'pec deck machine':      { f: 'fly' },
    'chest dips':            { f: 'dips', down: 105, up: 155 },
    'dumbbell pullover':     { f: 'raise', down: 24, up: 66 },
     
    'pull ups':              { f: 'pull_v', down: 95, up: 150 },
    'chin ups':              { f: 'pull_v', down: 95, up: 150 },
    'lat pulldown':          { f: 'pull_v', down: 98, up: 152 },
    'single arm lat pulldown': { f: 'pull_v', down: 98, up: 152 },
    'bent over barbell rows':{ f: 'pull_h', down: 98, up: 150 },
    'dumbbell rows':         { f: 'pull_h', down: 95, up: 150 },
    'seated cable row':      { f: 'pull_h', down: 98, up: 150 },
    't bar row':             { f: 'pull_h', down: 100, up: 150 },
    'inverted rows':         { f: 'pull_h', down: 100, up: 152 },
    'pendlay row':           { f: 'pull_h', down: 95, up: 150 },
    'trx rows':              { f: 'pull_h', down: 100, up: 152 },
    'face pulls':            { f: 'pull_h', down: 95, up: 148 },
    'deadlift':              { f: 'hinge' },
    'romanian deadlift':     { f: 'hinge', down: 98, up: 162 },
    'superman':              { f: 'superman' },
     
    'bodyweight squats':     { f: 'squat' },
    'barbell squats':        { f: 'squat', down: 105, up: 160 },
    'goblet squats':         { f: 'squat' },
    'sumo squats':           { f: 'squat', down: 112, up: 160 },
    'jump squats':           { f: 'squat', down: 118, up: 162 },
    'lunges':                { f: 'lunge' },
    'walking lunges':        { f: 'lunge' },
    'bulgarian split squats':{ f: 'lunge', down: 105, up: 158 },
    'step ups':              { f: 'lunge', down: 100, up: 160 },
    'calf raises':           { f: 'calf' },
    'leg extensions':        { f: 'leg_ext' },
    'hamstring curls':       { f: 'leg_curl' },
    'leg press':             { f: 'leg_ext', down: 88, up: 155 },     
    'wall sits':             { f: 'wall_sit' },
     
    'dumbbell shoulder press': { f: 'press_shoulder' },
    'military press':        { f: 'press_shoulder', down: 100, up: 152 },
    'overhead press':        { f: 'press_shoulder', down: 100, up: 152 },
    'arnold press':          { f: 'press_shoulder' },
    'landmine press':        { f: 'press_shoulder', down: 105, up: 152 },
    'lateral raises':        { f: 'raise', down: 22, up: 72 },
    'cable lateral raises':  { f: 'raise', down: 22, up: 72 },
    'front raises':          { f: 'raise', down: 22, up: 70 },
    'rear delt fly':         { f: 'raise', down: 22, up: 68 },
    'reverse fly':           { f: 'raise', down: 22, up: 68 },
    'upright rows':          { f: 'pull_h', down: 92, up: 148 },
    'face pull to press':    { f: 'press_shoulder', down: 100, up: 152 },
    'dumbbell shrugs':       { f: 'shrug' },
    'handstand hold':        { f: 'hold' },
    'wall walks':            { f: 'bounce_big', amp: 0.14 },
     
    'bicep curls':           { f: 'curl' },
    'hammer curls':          { f: 'curl' },
    'preacher curls':        { f: 'curl', down: 60, up: 150 },
    'concentration curls':   { f: 'curl', down: 55, up: 148 },
    'cable hammer curls':    { f: 'curl' },
    '21s bicep curls':       { f: 'curl', down: 70, up: 145 },
    'reverse curls':         { f: 'curl' },
    'spider curls':          { f: 'curl', down: 58, up: 148 },
    'tricep dips':           { f: 'dips', down: 100, up: 155 },
    'tricep pushdowns':      { f: 'tri_ext', down: 85, up: 155 },
    'rope tricep extensions':{ f: 'tri_ext', down: 85, up: 155 },
    'skull crushers':        { f: 'tri_ext', down: 80, up: 152 },
    'overhead tricep extension': { f: 'tri_ext', down: 85, up: 155 },
     
    'plank':                 { f: 'plank' },
    'side plank':            { f: 'plank' },
    'crunches':              { f: 'crunch' },
    'bicycle crunches':      { f: 'crunch', down: 122, up: 158 },
    'russian twists':        { f: 'twist' },
    'leg raises':            { f: 'leg_raise' },
    'hanging leg raises':    { f: 'leg_raise', down: 118 },
    'flutter kicks':         { f: 'leg_raise', down: 138, up: 162 },
    'v ups':                 { f: 'crunch', down: 112, up: 158 },
    'mountain climbers':     { f: 'alternate_knee' },
    'high knees':            { f: 'alternate_knee' },
    'dead bug':              { f: 'alternate_limb' },
    'bird dog':              { f: 'alternate_limb' },
    'hollow body hold':      { f: 'hold' },
    'cable woodchoppers':    { f: 'woodchop' },
    'ab wheel rollout':      { f: 'hinge', down: 92, up: 162 },
     
    'running':               { f: 'alternate_knee', kneeBias: 0.22 },
    'sprint intervals':      { f: 'alternate_knee', kneeBias: 0.3 },
    'stair climber':         { f: 'alternate_knee', kneeBias: 0.28 },
    'cycling':               { f: 'cycling' },
    'jump rope':             { f: 'bounce_big', amp: 0.028 },
    'box jumps':             { f: 'bounce_big', amp: 0.09 },
    'burpees':               { f: 'burpee' },
    'rowing machine':        { f: 'row_machine' },
    'swimming':              { f: 'generic' }
  };

   
   
  var ALIASES = {
    'pushup': 'push ups', 'push up': 'push ups', 'squats': 'bodyweight squats', 'squat': 'bodyweight squats',
    'scrunch': 'crunches', 'crunch': 'crunches', 'دفع': 'push ups', 'سكوات': 'bodyweight squats',
    'ضغط': 'push ups', 'بلانك': 'plank', 'سكوات بار': 'barbell squats', 'plank hold': 'plank',
    'benchpress': 'bench press', 'deadlifts': 'deadlift', 'lunge': 'lunges', 'planks': 'plank',
    'hip thrusts': 'hinge', 'hip thrust': 'hinge', 'jumping jacks': 'bounce_big',
    'dumbbell curl': 'bicep curls', 'hammer curl': 'hammer curls', 'db curls': 'bicep curls'
  };

   
   
   
  function resolveRule(name) {
    const key = norm(name);
    if (!key) return { rule: FAMILIES.generic, family: 'generic', key: '', matched: false, thr: {} };
    if (EXERCISES[key]) return mk(key, EXERCISES[key]);
    if (ALIASES[key] && EXERCISES[ALIASES[key]]) return mk(ALIASES[key], EXERCISES[ALIASES[key]]);
     
    const tokens = key.split(' ').filter(function (t) { return t.length > 2 && t !== 'the' && t !== 'with'; });
    let bestKey = null, bestScore = 0;
    Object.keys(EXERCISES).forEach(function (k) {
      const kt = k.split(' ');
      let score = 0;
      tokens.forEach(function (t) { if (kt.indexOf(t) !== -1) score++; });
      if (score > bestScore) { bestScore = score; bestKey = k; }
    });
    if (bestKey && bestScore >= Math.max(1, Math.ceil(tokens.length * 0.6))) return mk(bestKey, EXERCISES[bestKey]);
    return { rule: FAMILIES.generic, family: 'generic', key: key, matched: false, thr: {} };
  }
  function mk(key, entry) {
    const fam = FAMILIES[entry.f] || FAMILIES.generic;
    const thr = {};
    if (entry.down != null) thr.down = entry.down;
    if (entry.up != null) thr.up = entry.up;
    if (entry.amp != null) thr.amp = entry.amp;
    if (entry.kneeBias != null) thr.kneeBias = entry.kneeBias;
    return { rule: fam, family: entry.f, key: key, matched: true, thr: thr };
  }

   
   
   
  var API = null;               
  var _status = 'idle';         
   
   
   
   
  var BASE = (function () {
    try { return new URL('.', document.baseURI || location.href).href; }
    catch (e) { return './'; }
  })();
  var _landmarker = null;
  var _loadingPromise = null;
  var _lastTs = 0;
  var _failReason = '';

  function ensure() {
    if (_loadingPromise) return _loadingPromise;
    _status = 'loading';
    _loadingPromise = (async function () {
      try {
        if (!window.VoltaPoseEngine._skipImport) {
          const vision = await import(BASE + 'vendor/mediapipe/vision_bundle.mjs');
          const files = await vision.FilesetResolver.forVisionTasks(BASE + 'vendor/mediapipe/wasm');
          const opts = {
            baseOptions: { modelAssetPath: BASE + 'vendor/mediapipe/pose_landmarker_lite.task', delegate: 'GPU' },
            runningMode: 'VIDEO', numPoses: 1,
            minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5
          };
          try { _landmarker = await vision.PoseLandmarker.createFromOptions(files, opts); }
          catch (gpuErr) {
            opts.baseOptions.delegate = 'CPU';
            _landmarker = await vision.PoseLandmarker.createFromOptions(files, opts);
          }
        }
        _status = 'ready';
        return true;
      } catch (e) {
        _status = 'failed';
        _failReason = (e && (e.message || e.name)) || 'load error';
        try { console.warn('[PoseEngine] model load failed:', e); } catch (e2) {}
        return false;
      }
    })();
    return _loadingPromise;
  }

  function detect(video) {
    if (_status !== 'ready' || !_landmarker || !video || !video.videoWidth) return null;
    let ts = performance.now();
    if (ts <= _lastTs) ts = _lastTs + 1;
    _lastTs = ts;
    try {
      const res = _landmarker.detectForVideo(video, ts);
      const arr = res && res.landmarks && res.landmarks[0];
      return arr && arr.length ? arr : null;
    } catch (e) { return null; }
  }

   
   
   
   
   
   
  function PoseRepCounter(exerciseName, lang) {
    const r = resolveRule(exerciseName);
    this.lang = (lang === 'ar') ? 'ar' : 'en';
    this.ruleKey = r.key; this.family = r.family; this.matched = r.matched;
    this.rule = r.rule; this.thr = r.thr || {};
    this.mode = this.rule.mode || 'angle';
    this.rev = !!this.rule.rev;         
    this.kneeBias = this.thr.kneeBias;
    this.down = (this.thr.down != null) ? this.thr.down : (this.rule.down || 100);
    this.up = (this.thr.up != null) ? this.thr.up : (this.rule.up || 150);
    this.amp = (this.thr.amp != null) ? this.thr.amp : (this.rule.amp || 0.03);
    this.reset();
  }
  PoseRepCounter.prototype.reset = function () {
    this.reps = 0; this.phase = '—';
    this.repIntervals = []; this.lastRepAt = 0;
    this.poseStatus = 'none';            
    this.poseDetail = ''; this.gateScore = 0;
    this._armed = false; this._downAt = 0; this._dir = 0;
    this._yMin = null; this._yMax = null; this._yBase = null;
    this._lastSide = 0; this._sideSwitch = 0; this._switchAt = 0;
    this.angleMin = null; this.angleMax = null;
    this._lastDownHit = 0;               
    this._cycleMin = null; this._cycleMax = null;    
    this._hipXs = [];                    
    this._elbowSpan = [];                
    this._wrongFrames = 0; this._okFrames = 0; this._personFrames = 0;
    this._feedback = ''; this._feedbackUntil = 0;
    this._lastGateWhy = '';
    this.repLog = [];
    this.onRep = null;
  };
  PoseRepCounter.prototype.avgTempoSec = function () {
    if (!this.repIntervals.length) return 0;
    let s = 0; this.repIntervals.forEach(function (v) { s += v; });
    return Math.round((s / this.repIntervals.length) / 100) / 10;
  };
  PoseRepCounter.prototype._countRep = function (now, extra) {
    this.reps++;
    const durMs = this.lastRepAt ? (now - this.lastRepAt) : 0;
    if (this.lastRepAt) { this.repIntervals.push(durMs); if (this.repIntervals.length > 8) this.repIntervals.shift(); }
    this.repLog.push(Object.assign({ t: now, durMs: durMs }, extra || {}));
    if (this.repLog.length > 80) this.repLog.shift();
    this.lastRepAt = now;
    if (typeof this.onRep === 'function') { try { this.onRep(this.reps); } catch (e) {} }
  };
  PoseRepCounter.prototype._feedback_ = function (msg, now) {
    this._feedback = msg; this._feedbackUntil = now + 2600;
  };
   
   
  PoseRepCounter.prototype.metrics = function () {
    let tempoCV = 0;
    if (this.repIntervals.length >= 3) {
      const arr = this.repIntervals;
      let mean = 0; arr.forEach(function (v) { mean += v; }); mean /= arr.length;
      let vari = 0; arr.forEach(function (v) { vari += (v - mean) * (v - mean); }); vari /= arr.length;
      tempoCV = mean ? Math.sqrt(vari) / mean : 0;
    }
    let sym = null;
    const syms = (this.repLog || []).map(function (r) { return r.sym; }).filter(function (x) { return x != null; });
    if (syms.length >= 2) { let s = 0; syms.forEach(function (v) { s += v; }); sym = s / syms.length; }
    let elbowDrift = null;
    if (this._elbowSpan.length >= 8) {
      let mn = Infinity, mx = -Infinity;
      this._elbowSpan.forEach(function (v) { if (v < mn) mn = v; if (v > mx) mx = v; });
      if (mx > 0) elbowDrift = Math.max(0, (mx - mn) / mx);
    }
     
     
    let romCV = null;
    const amps = (this.repLog || []).map(function (r) { return r.amp; }).filter(function (a) { return a > 0; });
    if (amps.length >= 3) {
      let mean = 0; amps.forEach(function (v) { mean += v; }); mean /= amps.length;
      let vari = 0; amps.forEach(function (v) { vari += (v - mean) * (v - mean); }); vari /= amps.length;
      romCV = mean ? Math.sqrt(vari) / mean : 0;
    }
     
    let sway = 0;
    if (this._hipXs.length > 20) {
      let mean = 0; this._hipXs.forEach(function (v) { mean += v; }); mean /= this._hipXs.length;
      let vari = 0; this._hipXs.forEach(function (v) { vari += (v - mean) * (v - mean); }); vari /= this._hipXs.length;
      sway = Math.max(0, Math.min(1, Math.sqrt(vari) * 10));
    }
    return {
      reps: this.reps, tempoSec: this.avgTempoSec(), tempoCV: tempoCV, frames: this._okFrames + this._wrongFrames,
      poseStatus: this.poseStatus, poseDetail: this.poseDetail, poseLabel: this.rule.label, poseLabelAr: this.rule.labelAr,
      poseFamily: this.family, matched: this.matched,
      angleMin: this.angleMin != null ? Math.round(this.angleMin) : null,
      angleMax: this.angleMax != null ? Math.round(this.angleMax) : null,
      symmetry: sym, elbowDrift: elbowDrift, romCV: romCV, sway: sway,
      poseFindings: this.findings()
    };
  };
  PoseRepCounter.prototype.findings = function () {
    try {
      if (this._lastLm && this.rule && typeof this.rule.findings === 'function') {
        const ar = (this.lang === 'ar');
        const raw = this.rule.findings(this._lastLm, this._lastAspect, this) || [];
        return raw.map(function (f) {
          return { verdict: f.verdict, icon: f.icon, title: ar ? (f.titleAr || f.title) : f.title, text: ar ? (f.textAr || f.text) : f.text };
        });
      }
    } catch (e) {}
    return [];
  };

   
   
  PoseRepCounter.prototype.process = function (video, now) {
    const out = { reps: this.reps, phase: this.phase, tempoSec: this.avgTempoSec(), counted: false, feedback: '', pose: { status: this.poseStatus, label: this.rule.label, labelAr: this.rule.labelAr, why: this._lastGateWhy } };
    const lm = (API && API.detect) ? API.detect(video) : detect(video);
    if (!lm) {
       
      if (_status === 'ready') {
        this.poseStatus = 'no_person'; this._lastGateWhy = 'no_person';
        if (now > this._feedbackUntil) this._feedback_('no_person');
        this._armed = false; this.phase = '—';
      } else {
        out.poseLoading = true;               
      }
      out.reps = this.reps; out.phase = this.phase; out.feedback = (now < this._feedbackUntil) ? this._feedback : '';
      return out;
    }
    this._personFrames++;
    const A = video.videoWidth / Math.max(1, video.videoHeight);
    this._lastLm = lm; this._lastAspect = A;
    const g = this.rule.gate(lm, A);
    if (!g || !g.ok) {
      this._wrongFrames++;
      this.poseStatus = (g && g.why === 'no_person') ? 'no_person' : 'wrong';
      this._lastGateWhy = (g && g.why) || 'wrong';
      this._armed = false; this._dir = 0;
      if (this.phase !== '—') this.phase = '—';
      if (now > this._feedbackUntil) this._feedback_(this.poseStatus === 'no_person' ? 'no_person' : 'wrong');
      out.reps = this.reps; out.phase = this.phase; out.feedback = (now < this._feedbackUntil) ? this._feedback : '';
      out.pose = { status: this.poseStatus, label: this.rule.label, labelAr: this.rule.labelAr, why: this._lastGateWhy };
      return out;
    }
     
    this._okFrames++;
    this.poseStatus = 'ok'; this._lastGateWhy = '';
    const self = this;
     
    try {
      const hL = P(lm, LM.L_HIP, A), hR = P(lm, LM.R_HIP, A);
      const w = shoulderWidth(lm, A) || 0.12;
      const hx = (hL.x + hR.x) / 2 / Math.max(0.05, w);
      this._hipXs.push(hx); if (this._hipXs.length > 60) this._hipXs.shift();
    } catch (eS) {}

    if (this.mode === 'static') {
      this.phase = 'hold';
      out.reps = this.reps; out.phase = this.phase; out.pose = { status: 'ok', label: this.rule.label, labelAr: this.rule.labelAr, why: '' };
      return out;
    }

    if (this.mode === 'alternate') {
      const v = this.rule.sigLR(lm, A, this);
      const TH = this.rule.threshold || 0.1;
      let side = 0;
      if (v > TH) side = 1; else if (v < -TH) side = -1;
      if (side !== 0 && side !== this._lastSide) {
        this._lastSide = side;
        this._sideSwitch++;
        this._switchAt = now;
         
        if (this._sideSwitch % 2 === 0) {
          if (!this.lastRepAt || (now - this.lastRepAt) > 260) {
            this.phase = (side === 1) ? 'left' : 'right';
            this._countRep(now, { sym: 0.5 });
            out.counted = true;
          }
        }
      }
      out.reps = this.reps; out.phase = this.phase; out.feedback = (now < this._feedbackUntil) ? this._feedback : '';
      out.pose = { status: 'ok', label: this.rule.label, labelAr: this.rule.labelAr, why: '' };
      return out;
    }

    if (this.mode === 'bounce') {
      const y = this.rule.sigY(lm, A);
       
      if (this._yMin == null) { this._yMin = y; this._yMax = y; this._yBase = y; }
      if (y < this._yMin) this._yMin = y;
      if (y > this._yMax) this._yMax = y;
      const range = Math.max(this.amp * 1.6, this._yMax - this._yMin);
       
      if (this._dir !== -1 && y < this._yBase - range * 0.55) { this._dir = -1; this.phase = 'up'; }         
      else if (this._dir !== 1 && y > this._yBase + range * 0.55) { this._dir = 1; this.phase = 'down'; }    
      if (this._dir === 1 && y < this._yBase - range * 0.2) {
         
        this._dir = 0; this._yBase = (this._yMin + this._yMax) / 2;
        this._yMin = y; this._yMax = y;
        if (!this.lastRepAt || (now - this.lastRepAt) > 260) {
          this._countRep(now, {});
          out.counted = true;
          this.phase = 'up';
        }
      }
      out.reps = this.reps; out.phase = this.phase; out.feedback = (now < this._feedbackUntil) ? this._feedback : '';
      out.pose = { status: 'ok', label: this.rule.label, labelAr: this.rule.labelAr, why: '' };
      return out;
    }

     
     
     
     
    const a = this.rule.sig(lm, A);
    if (this.angleMin == null || a < this.angleMin) this.angleMin = a;
    if (this.angleMax == null || a > this.angleMax) this.angleMax = a;
    if (!this.rev && a <= this.down) this._lastDownHit = now;
    if (this.rev && a >= this.up) this._lastDownHit = now;
     
     
     
     
    if (!this._lastDownHit && this._personFrames > 15) {
      this.poseStatus = 'wrong'; this._lastGateWhy = 'no_rep_band';
      if (now > this._feedbackUntil) this._feedback_('wrong');
      out.reps = this.reps; out.phase = this.phase; out.feedback = (now < this._feedbackUntil) ? this._feedback : '';
      out.pose = { status: 'wrong', label: this.rule.label, labelAr: this.rule.labelAr, why: 'no_rep_band' };
      return out;
    }
     
    try {
      const e = bestSide(lm, A, [LM.L_SHOULDER, LM.L_ELBOW], [LM.R_SHOULDER, LM.R_ELBOW]);
      const hip = bestSide(lm, A, [LM.L_HIP], [LM.R_HIP]);
      const span = dist(e.pts[1], hip.pts[0]);
      this._elbowSpan.push(span); if (this._elbowSpan.length > 40) this._elbowSpan.shift();
    } catch (e2) {}
    if (!this.rev) {
      if (this.phase !== 'down' && a <= this.down) {
        this.phase = 'down'; this._armed = true; this._downAt = now;
        this._cycleMin = a; this._cycleMax = a;
      } else if (this.phase === 'down' && a >= this.up) {
        if (now - this._downAt >= 200 && (!this.lastRepAt || (now - this.lastRepAt) > 260)) {
          this.phase = 'up';
          const amp = Math.abs(this.up - (this._cycleMin != null ? Math.min(this._cycleMin, this.down) : this.down));
          this._countRep(now, { depth: Math.round(amp), amp: amp });
          this._cycleMin = null; this._cycleMax = null;
          out.counted = true;
        }
      } else if (this.phase === 'down') {
        if (this._cycleMin == null || a < this._cycleMin) this._cycleMin = a;    
      }
    } else {
      if (this.phase !== 'up' && a >= this.up) {
        this.phase = 'up'; this._armed = true; this._downAt = now;
        this._cycleMin = a; this._cycleMax = a;
      } else if (this.phase === 'up' && a <= this.down) {
        if (now - this._downAt >= 200 && (!this.lastRepAt || (now - this.lastRepAt) > 260)) {
          this.phase = 'down';
          const amp = Math.abs((this._cycleMax != null ? Math.max(this._cycleMax, this.up) : this.up) - this.down);
          this._countRep(now, { depth: Math.round(amp), amp: amp });
          this._cycleMin = null; this._cycleMax = null;
          out.counted = true;
        }
      } else if (this.phase === 'up') {
        if (this._cycleMax == null || a > this._cycleMax) this._cycleMax = a;    
      }
    }
    out.reps = this.reps; out.phase = this.phase; out.feedback = (now < this._feedbackUntil) ? this._feedback : '';
    out.pose = { status: 'ok', label: this.rule.label, labelAr: this.rule.labelAr, why: '' };
    return out;
  };

   
   
   
   
   
  API = {
    LM: LM,
    FAMILIES: FAMILIES,
    EXERCISES: EXERCISES,
    ALIASES: ALIASES,
    ensure: ensure,
    detect: detect,
    status: function () { return _status; },
    failReason: function () { return _failReason; },
    resolveRule: resolveRule,
    norm: norm,
    _internals: { P: P, angDeg: angDeg, dist: dist, visOK: visOK, visAvg: visAvg, bestSide: bestSide, shoulderWidth: shoulderWidth, torsoLean: torsoLean, personGate: personGate, bodyLine: bodyLine },
    PoseRepCounter: PoseRepCounter,
     
    TOTAL_RULES: Object.keys(EXERCISES).length,
    _skipImport: false         
  };
  return API;
})();
