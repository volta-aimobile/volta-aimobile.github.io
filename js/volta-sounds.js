/**
 * Volta Sounds — snappy, satisfying UI sounds (100% synthesized, no files)
 * ══════════════════════════════════════════════════════════════════════
 * v30 (user): "put sounds in the app for buttons and other stuff, i want
 * snappy satisfying sounds".
 *
 * HOW: every sound is generated with the WebAudio API at play time —
 * oscillators + tiny envelopes (~30-90ms). Nothing is downloaded, nothing
 * is cached, it works offline and from file://, and the browser only
 * unlocks audio after the first user gesture (which is exactly when we
 * play, so it always works).
 *
 * THE PALETTE (short, dry, quiet — no long tails, nothing annoying):
 *   tap      — the default button click: glassy high tick with a fast
 *              pitch drop. The "snappy" one.
 *   toggle   — two micro-ticks (settings toggles, chips)
 *   pop      — bubbly short blip (positive actions: pick, select, check)
 *   success  — two-note up chime E5→A5 (logging, saving, goals)
 *   win      — little arpeggio C5-E5-G5 (day complete, plan complete)
 *   error    — soft low buzz (invalid action)
 *   whoosh   — filtered noise sweep (tab switches)
 *
 * WIRING:
 *   • ONE delegated document click listener plays tap/pop on every
 *     button-like element (buttons, .bottom-nav-item, chips, toggle-btn,
 *     side-btn…). No per-button code needed.
 *   • Feature moments call VoltaSounds.play('success' | 'win' | …)
 *     directly (workout complete, streak popup, meal logged…).
 *   • A Settings row (Sound Effects: On / Off) persists the choice in
 *     localStorage — OFF kills every sound instantly.
 * ══════════════════════════════════════════════════════════════════════ */
window.VoltaSounds = (function () {
  'use strict';

  var PREF_KEY = 'volta_sounds_enabled';
  var ctx = null;
  var master = null;
  // Comfortable, quiet listening level.
  var VOLUME = 0.16;

  function enabled() {
    try { return localStorage.getItem(PREF_KEY) !== '0'; } catch (e) { return true; }
  }
  function setEnabled(on) {
    try { localStorage.setItem(PREF_KEY, on ? '1' : '0'); } catch (e) {}
    return enabled();
  }

  // Lazily create + resume the AudioContext (needs a user gesture).
  function ac() {
    if (!enabled()) return null;
    try {
      if (!ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = VOLUME;
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    } catch (e) { return null; }
  }

  // ─── core synth helpers ────────────────────────────────────────────────
  // One oscillator note with a fast attack + exponential decay.
  function tone(freq, opts) {
    var c = ac(); if (!c) return;
    opts = opts || {};
    var t0 = c.currentTime + (opts.delay || 0);
    var dur = opts.dur || 0.05;
    var osc = c.createOscillator();
    var g = c.createGain();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(30, opts.slideTo), t0 + dur);
    var peak = opts.gain || 0.9;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + (opts.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }

  // Filtered noise burst (for the whoosh).
  function noise(opts) {
    var c = ac(); if (!c) return;
    opts = opts || {};
    var t0 = c.currentTime + (opts.delay || 0);
    var dur = opts.dur || 0.18;
    var len = Math.max(1, Math.floor(c.sampleRate * dur));
    var buf = c.createBuffer(1, len, c.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = c.createBufferSource();
    src.buffer = buf;
    var flt = c.createBiquadFilter();
    flt.type = 'bandpass';
    flt.frequency.setValueAtTime(opts.from || 700, t0);
    flt.frequency.exponentialRampToValueAtTime(opts.to || 2400, t0 + dur);
    flt.Q.value = opts.q || 1.1;
    var g = c.createGain();
    g.gain.setValueAtTime(opts.gain || 0.5, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(flt); flt.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur);
  }

  // ─── the palette ──────────────────────────────────────────────────────
  var SOUNDS = {
    // glassy tick: high partial + pitch drop = "snappy"
    tap: function () {
      tone(1700, { type: 'sine', dur: 0.035, slideTo: 1150, gain: 0.55 });
      tone(3400, { type: 'sine', dur: 0.02, gain: 0.12 });
    },
    // two micro ticks (switch flipped)
    toggle: function () {
      tone(1250, { type: 'square', dur: 0.022, gain: 0.25 });
      tone(1650, { type: 'square', dur: 0.03, gain: 0.25, delay: 0.045 });
    },
    // bubbly rising blip (pick / select / check)
    pop: function () {
      tone(480, { type: 'triangle', dur: 0.07, slideTo: 900, gain: 0.8 });
    },
    // two-note up chime (logged / saved / goal)
    success: function () {
      tone(659, { type: 'sine', dur: 0.09, gain: 0.6 });        // E5
      tone(880, { type: 'sine', dur: 0.16, gain: 0.6, delay: 0.085 }); // A5
    },
    // tiny arpeggio (day/plan complete)
    win: function () {
      tone(523, { type: 'sine', dur: 0.08, gain: 0.55 });        // C5
      tone(659, { type: 'sine', dur: 0.08, gain: 0.55, delay: 0.075 }); // E5
      tone(784, { type: 'sine', dur: 0.09, gain: 0.55, delay: 0.15 }); // G5
      tone(1047, { type: 'sine', dur: 0.22, gain: 0.5, delay: 0.225 }); // C6
    },
    // soft low buzz (invalid)
    error: function () {
      tone(200, { type: 'sawtooth', dur: 0.11, slideTo: 150, gain: 0.3 });
    },
    // airy sweep (tab change)
    whoosh: function () {
      noise({ from: 500, to: 2600, dur: 0.16, gain: 0.35 });
    }
  };

  function play(name) {
    try { if (SOUNDS[name]) SOUNDS[name](); } catch (e) {}
  }

  // ─── global delegation: buttons just WORK ────────────────────────────
  var BUTTON_SEL = 'button, .bottom-nav-item, .side-btn, .toggle-btn, .plan-ex-chip, .plan-food-chip-btn, .history-see-more, .vcoach-chip, input[type="submit"]';

  function isButtonish(el) {
    if (!el || !el.closest) return false;
    return !!el.closest(BUTTON_SEL);
  }

  document.addEventListener('click', function (e) {
    try {
      if (!enabled()) return;
      var t = e.target;
      if (!isButtonish(t)) return;
      var btn = t.closest(BUTTON_SEL);
      if (!btn || btn.disabled) return;
      // A disabled-looking finish button still counts visually — skip it.
      var cs = window.getComputedStyle ? getComputedStyle(btn) : null;
      if (cs && cs.pointerEvents === 'none') return;
      // v31 (user): "make all buttons sound like the exit popup or x button
      // sound" — every button-like element now plays ONE uniform sound: the
      // same glassy 'tap' the X (close) button makes. The old per-element
      // variations (toggle / pop / whoosh on nav) are gone.
      play('tap');
    } catch (err) { /* sounds must never break the app */ }
  }, true);

  return {
    play: play,
    enabled: enabled,
    setEnabled: setEnabled,
    // direct palette access for one-offs
    tap: function () { play('tap'); },
    pop: function () { play('pop'); },
    toggle: function () { play('toggle'); },
    success: function () { play('success'); },
    win: function () { play('win'); },
    error: function () { play('error'); },
    whoosh: function () { play('whoosh'); }
  };
})();

// ─── Settings integration ───────────────────────────────────────────────
// Same pattern as the other Settings toggles (setTheme / setLang / setUnits).
function setSounds(on) {
  var onNow = (typeof VoltaSounds !== 'undefined') ? VoltaSounds.setEnabled(!!on) : !!on;
  var onBtn = document.getElementById('sound-on-btn');
  var offBtn = document.getElementById('sound-off-btn');
  if (onBtn) onBtn.classList.toggle('active', onNow);
  if (offBtn) offBtn.classList.toggle('active', !onNow);
  // v31: no extra confirmation sound — the delegated listener already plays
  // the unified tap when these buttons are clicked.
}
function initSoundsToggle() {
  var onNow = (typeof VoltaSounds !== 'undefined') ? VoltaSounds.enabled() : true;
  var onBtn = document.getElementById('sound-on-btn');
  var offBtn = document.getElementById('sound-off-btn');
  if (onBtn) onBtn.classList.toggle('active', onNow);
  if (offBtn) offBtn.classList.toggle('active', !onNow);
}
