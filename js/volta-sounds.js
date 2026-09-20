/**
 * Volta Sounds — ONE real click sound for every button (MP3 file)
 * ══════════════════════════════════════════════════════════════════════
 * v33 (user): "use this mp3 file for all button sounds" — the v30
 * WebAudio-synthesized palette is REPLACED by the user's supplied MP3
 * (sounds/ui-click.mp3 — "soft keyboard click / gentle computer input").
 * Every sound this engine ever plays (taps, toggles, pops, success chimes,
 * wins, errors, tab whooshes) is now that one file, exactly as requested.
 *
 * HOW IT WORKS:
 *   • The MP3 is loaded by small <audio> elements (no fetch, no WebAudio
 *     decode) so it works from file:// AND from any host with zero CORS
 *     setup. A small pool of preloaded elements is created on the first
 *     user gesture; overlapping clicks reuse a finished element (or add
 *     one, up to 8) so rapid tapping never clips or queues.
 *   • A subtle playbackRate variation (0.97–1.03) keeps repeat clicks
 *     from sounding machine-stamped. Volume is kept comfortable.
 *   • In the single-file mobile build (volta-onefile.html) the MP3 is
 *     inlined as a data URI — window.VOLTA_INLINE_SOUNDS provides it and
 *     this engine picks it up automatically.
 *
 * WIRING (unchanged from v30):
 *   • ONE delegated document click listener plays the click on every
 *     button-like element (buttons, .bottom-nav-item, chips, toggle-btn,
 *     side-btn…). No per-button code needed.
 *   • Feature moments call VoltaSounds.play('success' | 'win' | …)
 *     directly (workout complete, streak popup, meal logged…) — they all
 *     route to the same MP3 now.
 *   • A Settings row (Sound Effects: On / Off) persists the choice in
 *     localStorage — OFF kills every sound instantly.
 * ══════════════════════════════════════════════════════════════════════ */
window.VoltaSounds = (function () {
  'use strict';

  var PREF_KEY = 'volta_sounds_enabled';

  // The one click sound. In the onefile build the map below holds the
  // inlined data URI; everywhere else the real file is used as-is.
  var SOUND_SRC =
    (typeof window.VOLTA_INLINE_SOUNDS === 'object' && window.VOLTA_INLINE_SOUNDS &&
      window.VOLTA_INLINE_SOUNDS['sounds/ui-click.mp3']) ||
    'sounds/ui-click.mp3';

  var VOLUME = 0.5;          // comfortable, never jarring
  var POOL_MAX = 8;          // overlapping-click ceiling

  var pool = [];             // preloaded <audio> clones
  var primed = false;

  function enabled() {
    try { return localStorage.getItem(PREF_KEY) !== '0'; } catch (e) { return true; }
  }
  function setEnabled(on) {
    try { localStorage.setItem(PREF_KEY, on ? '1' : '0'); } catch (e) {}
    return enabled();
  }

  function makeAudio() {
    try {
      var a = document.createElement('audio');
      a.src = SOUND_SRC;
      a.preload = 'auto';
      a.volume = VOLUME;
      return a;
    } catch (e) { return null; }
  }

  // Warm the pool on the first gesture (pointerdown precedes click, so the
  // very first click already sounds instantly).
  function prime() {
    if (primed) return;
    primed = true;
    for (var i = 0; i < 3; i++) {
      var a = makeAudio();
      if (a) { try { a.load(); } catch (e) {} pool.push(a); }
    }
  }
  try {
    document.addEventListener('pointerdown', prime, { once: true, capture: true });
    document.addEventListener('touchstart', prime, { once: true, capture: true });
  } catch (e) {}

  function play(name) {
    // EVERY named sound routes to the same MP3 — the user asked for one
    // file for all button sounds. The name is kept so callers never break.
    try {
      if (!enabled()) return;
      prime();
      var a = null;
      for (var i = 0; i < pool.length; i++) {
        if (pool[i].paused || pool[i].ended) { a = pool[i]; break; }
      }
      if (!a) {
        if (pool.length < POOL_MAX) { a = makeAudio(); if (a) pool.push(a); }
        else { a = pool[0]; }
      }
      if (!a) return;
      // Subtle rate variation so rapid taps feel organic, not machine-stamped.
      try { a.playbackRate = 0.97 + Math.random() * 0.06; } catch (e) {}
      try { a.currentTime = 0; } catch (e) {}
      var p = a.play();
      if (p && p.catch) p.catch(function () { /* gesture/autoplay guards — never break the app */ });
    } catch (e) { /* sounds must never break the app */ }
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
      // Which sound? (All of them are the same MP3 now; the branches stay
      // so the per-moment semantics remain inspectable.)
      if (btn.classList.contains('bottom-nav-item') || btn.classList.contains('side-btn')) return; // showTab() plays whoosh
      if (btn.classList.contains('toggle-btn')) { play('toggle'); return; }
      if (btn.closest('#vcoach-chips')) { play('pop'); return; }
      if (btn.closest('.builder-lib-item') || btn.classList.contains('plan-ex-chip')) { play('pop'); return; }
      play('tap');
    } catch (err) { /* sounds must never break the app */ }
  }, true);

  return {
    play: play,
    enabled: enabled,
    setEnabled: setEnabled,
    // direct palette access for one-offs (all → the MP3)
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
  if (onNow && typeof VoltaSounds !== 'undefined') VoltaSounds.play('toggle');
}
function initSoundsToggle() {
  var onNow = (typeof VoltaSounds !== 'undefined') ? VoltaSounds.enabled() : true;
  var onBtn = document.getElementById('sound-on-btn');
  var offBtn = document.getElementById('sound-off-btn');
  if (onBtn) onBtn.classList.toggle('active', onNow);
  if (offBtn) offBtn.classList.toggle('active', !onNow);
}
