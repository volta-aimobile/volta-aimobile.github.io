/* ════════════════════════════════════════════════════════════════════
   VOLTA — ANIMATION ENHANCEMENT JS  (additive, fully defensive)
   Loads LAST so the whole app is already wired before we decorate it.
   Features:
     1. Tap/click ripple on every .btn (auto white/accent tint)
     2. Scroll-in reveals for panels & cards that enter the viewport
     3. Smooth count-up for dashboard stat numbers (+ pop tick)
   Guarantees:
     • Never modifies app data/DOM structure — classes only.
     • Skips everything under prefers-reduced-motion.
     • No behavior changes if this script fails: CSS stays inert.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (!document.documentElement || !document.body) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.documentElement.classList.add('v-js');

  /* ── 1. Button ripple (event delegation → works on future buttons) ── */
  document.addEventListener('pointerdown', function (e) {
    var btn = e.target.closest('.btn');
    if (!btn || btn.disabled) return;
    var r = btn.getBoundingClientRect();
    var d = Math.max(r.width, r.height) * 2;
    var s = document.createElement('span');
    s.className = 'v-ripple';
    try {
      var bg = getComputedStyle(btn).backgroundColor;
      var m = bg.match(/\d+/g);
      if (m && m.length >= 3) {
        var lum = (+m[0]) * 0.299 + (+m[1]) * 0.587 + (+m[2]) * 0.114;
        if (lum > 160) s.classList.add('tinted'); /* light button → accent ripple */
      }
    } catch (err) { /* cosmetic only */ }
    s.style.width = s.style.height = d + 'px';
    s.style.left = (e.clientX - r.left - d / 2) + 'px';
    s.style.top = (e.clientY - r.top - d / 2) + 'px';
    btn.appendChild(s);
    setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 650);
  }, { passive: true });


  /* ── 2. Scroll-in reveal (below-the-fold elements only) ───────────── */
  var REVEAL_SEL = [
    '.panel', '.stat-card', '.banner-card', '.sport-card',
    '.safety-item', '.mood-card', '.volta-course-card'
  ].join(',');

  function inTab(el) {
    // Direct children of an active tab already cascade via CSS — skip them.
    return el.parentElement && el.parentElement.classList &&
           el.parentElement.classList.contains('tab');
  }

  var vh = window.innerHeight || 800;
  window.addEventListener('resize', function () { vh = window.innerHeight || vh; }, { passive: true });

  var io = ('IntersectionObserver' in window)
    ? new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add('v-in'); io.unobserve(en.target); }
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 })
    : null;

  function scanReveals(root) {
    var nodes = (root || document).querySelectorAll(REVEAL_SEL.split(',').map(function (s) { return s + ':not(.v-reveal)'; }).join(','));
    Array.prototype.forEach.call(nodes, function (el) {
      if (inTab(el)) return;             /* let the tab cascade handle it */
      var rect = el.getBoundingClientRect();
      el.classList.add('v-reveal');
      if (rect.top < vh * 0.92 && rect.bottom > 0) {
        el.classList.add('v-in');        /* already visible → no flash */
      } else if (io) {
        io.observe(el);                  /* below fold → reveal on scroll */
      } else {
        el.classList.add('v-in');
      }
    });
  }

  scanReveals();
  var moT = null;
  var mo = new MutationObserver(function () {
    clearTimeout(moT);
    moT = setTimeout(scanReveals, 160);  /* debounce SPA re-renders */
  });
  mo.observe(document.body, { childList: true, subtree: true });


  /* ── 3. Stat-number count-up with pop ─────────────────────────────── */
  /* Poll-based diffing: zero interference with app logic, survives any
     of the app's own timers because WE keep the last-seen cache. */
  /* NOTE: stat-bmi / stat-streak / stat-week-mins are intentionally EXCLUDED —
     the app itself already count-animates them (volta.js renderHome). */
  var COUNT_IDS = [
    'today-kcal-burnt', 'mobile-kcal-num',
    'tr-total', 'tr-minutes', 'tr-week',
    /* Round 15 (animation #2): activity-ring numbers + streaks-tab streak.
       The poll-diff cache only animates when a value actually CHANGES, so
       re-renders with identical values never replay the count-up. */
    'rings-center-num', 'ring-kcal-val', 'ring-mins-val', 'ring-ex-val',
    'ring-kcal-consumed', 'ring-train-mins', 'sk-streak'
  ];
  var NUM_RE = /^\d+(\.\d+)?$/;

  function bindCounter(el) {
    if (!el || el.dataset.vCounterBound) return;
    el.dataset.vCounterBound = '1';
    var cache = NaN, target = 0, animating = false;

    function play(raw, target_) {
      var dec = (raw.split('.')[1] || '').length;
      var t0 = performance.now(), dur = 650;
      animating = true;
      el.classList.add('v-pop');
      (function step(t) {
        var p = Math.min(1, (t - t0) / dur);
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = (target_ * eased).toFixed(dec);
        if (p < 1) {
          requestAnimationFrame(step);
        } else {
          el.textContent = raw;               /* land on the exact value */
          cache = target_;
          setTimeout(function () {
            el.classList.remove('v-pop');
            animating = false;
          }, 140);
        }
      })(t0);
    }

    setInterval(function () {
      var raw = (el.textContent || '').trim().replace(/,/g, '');
      if (!NUM_RE.test(raw)) { cache = NaN; return; }          /* "--" etc. */
      var val = parseFloat(raw);
      if (val === 0 || val > 999999) { cache = val; return; }  /* nothing to show */
      if (animating) {
        target = val;                                          /* update mid-flight */
        return;
      }
      if (!(Math.abs(val - cache) < 1e-9)) {                   /* external change */
        cache = val;
        target = val;
        play(raw, val);
      }
    }, 450);
  }

  COUNT_IDS.forEach(function (id) { bindCounter(document.getElementById(id)); });


  /* ── 4. Bottom-nav GLIDER (Round 15 → Round 18 fix) ───────────────── */
  /* Per user request the highlight is now a PROPER SQUARE (rounded
     rectangle) — the old diagonal (skewed) slant is gone on every screen,
     both LTR and RTL. It still SLIDES under the active tab with a springy
     overshoot. Movement starts on pointerdown CAPTURE (the instant the
     finger lands — the Round-10 lag complaint can't recur), with a
     MutationObserver fallback for programmatic tab switches. */
  (function () {
    var nav = document.getElementById('bottom-nav');
    if (!nav) return;
    var navItems = nav.querySelector('.bottom-nav-items');
    if (!navItems || document.getElementById('v-nav-glider-el')) return;

    var glider = document.createElement('span');
    glider.id = 'v-nav-glider-el';
    glider.className = 'v-nav-glider';
    navItems.insertBefore(glider, navItems.firstChild);
    document.documentElement.classList.add('v-nav-glider-on');

    function place(instant) {
      var ir = navItems.getBoundingClientRect();
      if (!ir.width) { glider.style.opacity = '0'; return false; }   /* nav hidden (desktop) */
      var act = navItems.querySelector('.bottom-nav-item.active');
      if (!act) { glider.style.opacity = '0'; return false; }        /* e.g. More sheet open */
      var br = act.getBoundingClientRect();
      var w = Math.max(44, br.width - 6);
      var x = br.left - ir.left + (br.width - w) / 2;
      if (instant) glider.style.transition = 'none';
      glider.style.width = w + 'px';
      glider.style.transform = 'translateX(' + x + 'px)';
      glider.style.opacity = '1';
      if (instant) { void glider.offsetWidth; glider.style.transition = ''; }
      return true;
    }
    /* INSTANT start — capture phase runs before the button's own handler. */
    nav.addEventListener('pointerdown', function (e) {
      if (e.target && e.target.closest && e.target.closest('.bottom-nav-item')) place(false);
    }, { capture: true, passive: true });
    /* Fallback for programmatic switches (More sheet, showTab calls). */
    new MutationObserver(function () { place(false); })
      .observe(navItems, { subtree: true, attributes: true, attributeFilter: ['class'] });
    /* Language flips (RTL reorder) + resizes re-snap without transition. */
    new MutationObserver(function () { place(true); })
      .observe(document.body, { attributes: true, attributeFilter: ['class', 'dir'] });
    /* Resize (rotation, keyboard, viewport changes): re-snap instantly,
       then retry briefly — a resize event can land BEFORE the relayout
       finishes (nav still display:none for one frame → the guard would
       hide the pill until the next touch). 4 retries over ~0.5s covers it. */
    window.addEventListener('resize', function () {
      place(true);
      var n = 0;
      var iv = setInterval(function () { if (place(true) || ++n > 4) clearInterval(iv); }, 120);
    }, { passive: true });
    place(true);                 /* first paint — no fly-in */
    setTimeout(function () { place(true); }, 350);  /* after fonts/layout settle */
    /* Self-heal: the glider can initialize while the app is still on the
       splash/auth screens (nav hidden → place() bails). Retry a few times
       until the first successful placement, then stop the timer — from
       there on the pointerdown + observer hooks keep it glued. */
    var gAttempts = 0;
    var gIv = setInterval(function () {
      if (place(true) || ++gAttempts > 60) clearInterval(gIv);
    }, 250);
    /* The auth → app screen switch doesn't touch the nav's classes, so
       hook the global showScreen() and re-snap the moment the app screen
       becomes visible — this is what actually lands the pill on Home
       right after login. */
    try {
      if (typeof window.showScreen === 'function') {
        var __origShowScreen = window.showScreen;
        window.showScreen = function () {
          var r = __origShowScreen.apply(this, arguments);
          setTimeout(function () { place(true); }, 80);
          return r;
        };
      }
    } catch (e) {}
  })();


  /* ── 5. Workout-complete CELEBRATION (Round 15, animation #5) ─────── */
  /* Confetti burst (theme palette: blues / greens / white) + a popping
     checkmark. Called by volta.js on every completed workout block and on
     the great-work (day complete) popup. Web Animations API only — no
     libraries, no layout thrash, auto-cleanup. */
  var V_CONFETTI_COLORS = ['#4a7bd9', '#6495ED', '#1d9d6b', '#38bdf8', '#ffffff'];
  var vCelebrateBusy = false;
  window.voltaCelebrate = function () {
    if (vCelebrateBusy) return;
    var overlay = document.createElement('div');
    overlay.id = 'v-celebrate';
    document.body.appendChild(overlay);
    try {
      var check = document.createElement('div');
      check.className = 'v-check';
      check.innerHTML = '<i class="fa-solid fa-check"></i>';
      overlay.appendChild(check);
      var N = 26;
      for (var i = 0; i < N; i++) {
        var p = document.createElement('span');
        p.className = 'v-confetti';
        var size = 6 + Math.random() * 6;
        p.style.width = size + 'px';
        p.style.height = (Math.random() < 0.4 ? size : size * 0.45) + 'px';
        p.style.borderRadius = (Math.random() < 0.4 ? '50%' : '2px');
        p.style.background = V_CONFETTI_COLORS[i % V_CONFETTI_COLORS.length];
        p.style.left = (window.innerWidth / 2 + (Math.random() - 0.5) * 140) + 'px';
        overlay.appendChild(p);
        var dx = (Math.random() - 0.5) * 260;
        var dy = window.innerHeight * (0.45 + Math.random() * 0.4);
        var rot = (Math.random() - 0.5) * 720;
        p.animate([
          { transform: 'translate(0, 0) rotate(0deg)', opacity: 1 },
          { transform: 'translate(' + dx + 'px, ' + dy + 'px) rotate(' + rot + 'deg)', opacity: 0 }
        ], { duration: 950 + Math.random() * 550, easing: 'cubic-bezier(.15, .6, .4, 1)', fill: 'forwards' });
      }
    } catch (e) {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      return;
    }
    vCelebrateBusy = true;
    setTimeout(function () {
      try {
        var fade = overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: 'forwards' });
        fade.onfinish = function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };
        setTimeout(function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 400); /* safety */
      } catch (e) {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }
      vCelebrateBusy = false;
    }, 1250);
  };
})();
