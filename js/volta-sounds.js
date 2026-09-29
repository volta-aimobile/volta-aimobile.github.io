 






























window.VoltaSounds = (function () {
  'use strict';

  var PREF_KEY = 'volta_sounds_enabled';

   
   
  var SOUND_SRC =
    (typeof window.VOLTA_INLINE_SOUNDS === 'object' && window.VOLTA_INLINE_SOUNDS &&
      window.VOLTA_INLINE_SOUNDS['sounds/ui-click.mp3']) ||
    'sounds/ui-click.mp3';

  var VOLUME = 0.5;           
  var POOL_MAX = 8;           

  var pool = [];              
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
       
      try { a.playbackRate = 0.97 + Math.random() * 0.06; } catch (e) {}
      try { a.currentTime = 0; } catch (e) {}
      var p = a.play();
      if (p && p.catch) p.catch(function () {   });
    } catch (e) {   }
  }

   
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
       
      var cs = window.getComputedStyle ? getComputedStyle(btn) : null;
      if (cs && cs.pointerEvents === 'none') return;
       
       
      if (btn.classList.contains('bottom-nav-item') || btn.classList.contains('side-btn')) return;  
      if (btn.classList.contains('toggle-btn')) { play('toggle'); return; }
      if (btn.closest('#vcoach-chips')) { play('pop'); return; }
      if (btn.closest('.builder-lib-item') || btn.classList.contains('plan-ex-chip')) { play('pop'); return; }
      play('tap');
    } catch (err) {   }
  }, true);

  return {
    play: play,
    enabled: enabled,
    setEnabled: setEnabled,
     
    tap: function () { play('tap'); },
    pop: function () { play('pop'); },
    toggle: function () { play('toggle'); },
    success: function () { play('success'); },
    win: function () { play('win'); },
    error: function () { play('error'); },
    whoosh: function () { play('whoosh'); }
  };
})();

 
 
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
