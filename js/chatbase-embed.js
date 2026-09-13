/**
 * Volta × Chatbase — embedded AI chat (v35)
 * ══════════════════════════════════════════════════════════════════════
 * USER REQUEST (v35): "use the chatbase embedded for the ai chat" —
 * the floating Coach-AI button (#volta-ai-chat-btn) now opens the
 * embedded Chatbase widget (https://www.chatbase.co) as the AI chat.
 *
 * HOW IT WORKS
 *   • The official Chatbase embed script is loaded LAZILY: only when the
 *     user is inside the app (body.app-active) and a bot ID is set —
 *     the landing/login page never downloads it.
 *   • volta.js's existing hooks keep working: chatbase('show'/'hide')
 *     on app enter/leave, syncChatbaseUser() pushes the user's whole
 *     record (profile, survey, plan, sessions, diet, streak…) to the
 *     bot right before the chat opens.
 *   • The native Chatbase bubble button + greeting bubble stay hidden
 *     (CSS in volta.css, same as the original integration) — the
 *     branded #volta-ai-chat-btn is the single entry point.
 *   • OFFLINE / not-configured fallback (v28 requirement: "make it work
 *     offline"): if the widget can't load or boot, the button falls back
 *     to the on-device coach (js/volta-chat-ai.js) — the user always
 *     gets an answer, internet or not.
 *
 * WIRING CONTRACT WITH embed.min.js (verified against the CURRENT
 * chatbase.co script, deobfuscated):
 *   - chatbotId is read from (in order): the script tag's
 *     chatbotId ATTRIBUTE → window.embeddedChatbotConfig.chatbotId →
 *     the script tag's id → window.chatbaseConfig.chatbotId (lowercase
 *     "chatbaseConfig"!) → ?chatbotId= URL param. We set the attribute
 *     plus both config globals — the old "window.ChatbaseConfig"
 *     (capital C) is NOT read anymore, which is why the legacy
 *     assignment alone never worked.
 *   - A queue stub for window.chatbase may pre-exist: commands called
 *     before boot are queued and auto-executed when the widget is
 *     ready (a trailing queued "open" opens the chat window).
 *   - On successful boot the script sets window.chatbaseConfig.
 *     embedSuccess = true and replaces the stub with the real
 *     command proxy (open / close / resetChat / update / …). We poll
 *     for that marker to know the widget is really alive.
 *   - The widget renders plain iframes (no shadow DOM):
 *     #chatbase-bubble-button (launcher, hidden by our CSS) and
 *     #chatbase-bubble-window (the chat window we open).
 *
 * WHERE THE BOT ID COMES FROM (first match wins)
 *   1. Settings tab → "AI Chat (Chatbase)" row (saved in localStorage)
 *   2. DEFAULT_BOT_ID below (edit it to ship a fixed bot)
 * Get the ID from chatbase.co → your chatbot → "Embed" tab → copy the
 * chatbotId from the snippet.
 * ══════════════════════════════════════════════════════════════════════ */
window.VoltaChatbase = (function () {
  'use strict';

  /* ── EDIT ME: your Chatbase chatbot ID ────────────────────────────────
     chatbase.co → your bot → Embed → chatbotId. This is the default that
     ships with the app; users can override it in Settings at runtime. */
  var DEFAULT_BOT_ID = 'PASTE-YOUR-CHATBOT-ID';

  var LS_KEY = 'volta_chatbase_id';
  var SCRIPT_SRC = 'https://www.chatbase.co/embed.min.js';
  var DOMAIN = 'www.chatbase.co';

  var state = { loaded: false, loading: false, queued: null, hinted: false, failMode: null };

  // ─── i18n (EN / AR via store.lang, same pattern as the rest of Volta) ──
  function ar() {
    try { return typeof store !== 'undefined' && store.lang === 'ar'; } catch (e) { return false; }
  }
  function T(en, arTxt) { return ar() ? arTxt : en; }

  // ─── bot id helpers ───────────────────────────────────────────────────
  function currentId() {
    var saved = '';
    try { saved = (localStorage.getItem(LS_KEY) || '').trim(); } catch (e) {}
    return saved || DEFAULT_BOT_ID.trim();
  }
  /* A real Chatbase id is an opaque token; anything that is still the
     obvious placeholder — or doesn't look like a token at all — counts
     as "not configured" so the offline coach takes over gracefully. */
  function idLooksReal(id) {
    return !!id && id !== DEFAULT_BOT_ID && /^[A-Za-z0-9_-]{10,64}$/.test(id);
  }
  function configured() { return idLooksReal(currentId()); }

  // ─── tiny self-contained toast (used nowhere else) ────────────────────
  function toast(msg, ms) {
    try {
      var old = document.getElementById('volta-chatbase-toast');
      if (old) old.remove();
      var t = document.createElement('div');
      t.id = 'volta-chatbase-toast';
      t.textContent = msg;
      t.style.cssText = 'position:fixed;left:50%;bottom:110px;transform:translateX(-50%);' +
        'z-index:2147483646;max-width:86vw;background:var(--text,#1a2233);color:var(--white,#fff);' +
        'padding:10px 16px;border-radius:12px;font-size:.85rem;line-height:1.35;text-align:center;' +
        'box-shadow:0 8px 24px rgba(0,0,0,.35);opacity:0;transition:opacity .25s;pointer-events:none;';
      document.body.appendChild(t);
      requestAnimationFrame(function () { t.style.opacity = '1'; });
      setTimeout(function () {
        t.style.opacity = '0';
        setTimeout(function () { t.remove(); }, 300);
      }, ms || 4200);
    } catch (e) {}
  }

  // ─── widget readiness ─────────────────────────────────────────────────
  /* embed.min.js sets chatbaseConfig.embedSuccess = true once the widget
     has booted (styles fetched, iframes mounted, proxy installed). */
  function isReady() {
    try {
      return !!(window.chatbaseConfig && window.chatbaseConfig.embedSuccess === true &&
                typeof window.chatbase === 'function');
    } catch (e) { return false; }
  }

  // ─── script loading ───────────────────────────────────────────────────
  function chain(cb) {
    var prev = state.queued;
    state.queued = function (ok) { try { prev && prev(ok); } catch (e) {} cb && cb(ok); };
  }

  function load(cb) {
    if (state.loaded) { cb && cb(true); return; }
    if (!configured()) { cb && cb(false); return; }
    if (state.loading) { chain(cb); return; }

    state.loading = true;
    var id = currentId();

    /* 1. Official queue stub — commands called before boot (update/open)
       queue up and auto-execute when the widget finishes initializing. */
    if (!window.chatbase) {
      window.chatbase = function () {
        (window.chatbase.q = window.chatbase.q || []).push(arguments);
      };
    }

    /* 2. Config in every format the current embed reads (attribute →
       embeddedChatbotConfig → script.id → chatbaseConfig → URL param). */
    try {
      window.chatbaseConfig = { chatbotId: id, domain: DOMAIN };
      window.embeddedChatbotConfig = window.embeddedChatbotConfig || {};
      window.embeddedChatbotConfig.chatbotId = id;
      window.embeddedChatbotConfig.domain = DOMAIN;
    } catch (e) {}

    /* 3. The script tag itself — the chatbotId attribute is the primary
       channel (verified live against chatbase.co's current script). */
    var s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.setAttribute('chatbotId', id);
    s.async = true;
    s.onload = function () { waitForReady(0); };
    s.onerror = function () {
      state.loading = false;
      state.failMode = 'offline';
      s.remove();
      resolve(false);
    };
    document.head.appendChild(s);
    if (cb) chain(cb);
  }

  function waitForReady(n) {
    if (isReady()) { resolve(true); return; }
    if (n >= 32) { state.failMode = 'boot'; resolve(false); return; }   // ~8s give-up
    setTimeout(function () { waitForReady(n + 1); }, 250);
  }

  function resolve(ok) {
    if (ok) {
      state.loaded = true;
      /* native launcher stays hidden — our branded button is the only
         entry point (CSS in volta.css + the API call for good measure) */
      try { window.chatbase('hideMessageBubble'); } catch (e) {}
    }
    state.loading = false;
    var q = state.queued; state.queued = null;
    if (q) { try { q(ok); } catch (e) {} }
  }

  // ─── data sync (defined in volta.js — pushes the full user record) ───
  function syncUser() {
    try { if (typeof syncChatbaseUser === 'function') syncChatbaseUser(); } catch (e) {}
  }

  // ─── widget presence checks (plain iframes, no shadow DOM) ─────────────
  function anyChatbaseFrame() {
    return !!document.querySelector('iframe[src*="chatbase.co"], iframe[id^="chatbase"]');
  }
  function chatWindowVisible() {
    try {
      var w = document.getElementById('chatbase-bubble-window');
      return !!(w && w.offsetWidth > 50 && w.offsetHeight > 50);
    } catch (e) { return false; }
  }

  /* Polls for the chat window after an open attempt. A bad/fake bot id
     makes Chatbase fail silently — in that case we fall back to the
     on-device coach and tell the user why. */
  function verifyMounted(fallbackFn) {
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      if (anyChatbaseFrame()) { clearInterval(iv); return; }   // mounted — done
      if (tries >= 10) {                                        // ~2.5s, nothing
        clearInterval(iv);
        toast(T('Chatbase didn\u2019t respond — check the bot ID in Settings \u2192 AI Chat.',
                 '\u0644\u0645 \u064a\u0633\u062a\u062c\u0628 Chatbase \u2014 \u062a\u062d\u0642\u0642 \u0645\u0646 \u0645\u0639\u0631\u0651\u0641 \u0627\u0644\u0631\u0648\u0628\u0648\u062a \u0641\u064a \u0627\u0644\u0625\u0639\u062f\u0627\u062f\u0627\u062a \u2192 AI Chat.'));
        fallbackFn && fallbackFn();
      }
    }, 250);
  }

  // ─── public actions ───────────────────────────────────────────────────
  /* Called from the floating button's click handler
     (js/volta-chat-ai.js toggle()). fallbackFn = the on-device coach. */
  function toggle(fallbackFn) {
    if (state.loaded && typeof window.chatbase === 'function') {
      if (chatWindowVisible()) { try { window.chatbase('close'); } catch (e) {} return; }
      syncUser();
      try { window.chatbase('open'); } catch (e) {}
      verifyMounted(fallbackFn);
      return;
    }
    if (!configured()) {
      /* No bot id yet — one gentle hint per session, then the offline
         coach answers (v28: the AI chat must always work). */
      if (!state.hinted) {
        state.hinted = true;
        toast(T('Tip: connect your Chatbase bot in Settings \u2192 AI Chat (Chatbase) to enable the online coach.',
                '\u0646\u0635\u064a\u062d\u0629: \u0627\u0631\u0628\u0637 \u0631\u0648\u0628\u0648\u062a Chatbase \u0645\u0646 \u0627\u0644\u0625\u0639\u062f\u0627\u062f\u0627\u062a \u2192 AI Chat (Chatbase) \u0644\u062a\u0634\u063a\u064a\u0644 \u0627\u0644\u0645\u062f\u0631\u0628 \u0627\u0644\u0630\u0643\u064a \u0623\u0648\u0646\u0644\u0627\u064a\u0646.'), 5200);
      }
      fallbackFn && fallbackFn();
      return;
    }
    /* A previous boot already failed with this bot ID (bad/invalid id) —
       don't re-download and wait 8s again: fail fast with the hint. */
    if (state.failMode === 'boot' && !state.loading) {
      toast(T('Chatbase didn\u2019t respond — check the bot ID in Settings \u2192 AI Chat.',
              '\u0644\u0645 \u064a\u0633\u062a\u062c\u0628 Chatbase \u2014 \u062a\u062d\u0642\u0642 \u0645\u0646 \u0645\u0639\u0631\u0651\u0641 \u0627\u0644\u0631\u0648\u0628\u0648\u062a \u0641\u064a \u0627\u0644\u0625\u0639\u062f\u0627\u062f\u0627\u062a \u2192 AI Chat.'));
      fallbackFn && fallbackFn();
      return;
    }
    /* loading or not-yet-started: kick off / await the load, then open */
    load(function (ok) {
      if (ok && typeof window.chatbase === 'function') {
        syncUser();
        try { window.chatbase('open'); } catch (e) {}
        verifyMounted(fallbackFn);
      } else {
        if (state.failMode === 'boot') {
          toast(T('Chatbase didn\u2019t respond — check the bot ID in Settings \u2192 AI Chat.',
                  '\u0644\u0645 \u064a\u0633\u062a\u062c\u0628 Chatbase \u2014 \u062a\u062d\u0642\u0642 \u0645\u0646 \u0645\u0639\u0631\u0651\u0641 \u0627\u0644\u0631\u0648\u0628\u0648\u062a \u0641\u064a \u0627\u0644\u0625\u0639\u062f\u0627\u062f\u0627\u062a \u2192 AI Chat.'));
        } else {
          toast(T('Chatbase needs an internet connection — the on-device coach is answering instead.',
                  'Chatbase \u064a\u062d\u062a\u0627\u062c \u0625\u0646\u062a\u0631\u0646\u062a \u2014 \u0633\u064a\u062c\u064a\u0628 \u0627\u0644\u0645\u062f\u0631\u0628 \u0639\u0644\u0649 \u0627\u0644\u062c\u0647\u0627\u0632 \u0628\u062f\u0644\u0627\u064b \u0645\u0646\u0647.'));
        }
        fallbackFn && fallbackFn();
      }
    });
  }

  /* volta.js updateChatbaseVisibility() calls this whenever an app screen
     becomes active — preload the widget so the first click opens instantly. */
  function onAppActive() {
    if (state.loaded || state.loading || !configured()) return;
    try { if (navigator.onLine === false) return; } catch (e) {}
    load();
  }

  // ─── Settings row wiring ──────────────────────────────────────────────
  function renderSettingsRow() {
    var input = document.getElementById('chatbase-id-input');
    if (!input) return;
    var cur = '';
    try { cur = (localStorage.getItem(LS_KEY) || '').trim(); } catch (e) {}
    if (cur && idLooksReal(cur)) input.value = cur;
    updateStatus(!!(cur && idLooksReal(cur)) || idLooksReal(DEFAULT_BOT_ID.trim()));
  }
  function updateStatus(ok) {
    var el = document.getElementById('chatbase-id-status');
    if (!el) return;
    if (ok) {
      el.className = 'chatbase-id-status ok';
      el.textContent = T('Connected \u2713 — the floating button opens your Chatbase coach.',
                         '\u0645\u062a\u0635\u0644 \u2713 \u2014 \u0627\u0644\u0632\u0631 \u0627\u0644\u0639\u0627\u0626\u0645 \u064a\u0641\u062a\u062d \u0645\u062f\u0631\u0628\u064a Chatbase.');
    } else {
      el.className = 'chatbase-id-status';
      el.textContent = T('Not connected — the on-device coach answers offline. Paste a bot ID to enable the online coach.',
                         '\u063a\u064a\u0631 \u0645\u062a\u0635\u0644 \u2014 \u064a\u062c\u064a\u0628 \u0627\u0644\u0645\u062f\u0631\u0628 \u0639\u0644\u0649 \u0627\u0644\u062c\u0647\u0627\u0632 \u0628\u062f\u0648\u0646 \u0625\u0646\u062a\u0631\u0646\u062a. \u0627\u0644\u0635\u0642 \u0645\u0639\u0631\u0651\u0641 \u0627\u0644\u0631\u0648\u0628\u0648\u062a \u0644\u062a\u0634\u063a\u064a\u0644 \u0627\u0644\u0645\u062f\u0631\u0628 \u0623\u0648\u0646\u0644\u0627\u064a\u0646.');
    }
  }

  /* Save button in Settings → AI Chat (Chatbase). Empty input = clear the
     override (falls back to the DEFAULT_BOT_ID constant in this file). */
  function saveIdFromInput() {
    var input = document.getElementById('chatbase-id-input');
    if (!input) return;
    var v = (input.value || '').trim();
    if (v && !idLooksReal(v)) {
      toast(T('That doesn\u2019t look like a Chatbase bot ID — copy it from chatbase.co \u2192 Embed.',
              '\u0647\u0630\u0627 \u0644\u0627 \u064a\u0628\u062f\u0648 \u0643\u0645\u0639\u0631\u0651\u0641 \u0631\u0648\u0628\u0648\u062a Chatbase \u2014 \u0627\u0646\u0633\u062e\u0647 \u0645\u0646 chatbase.co \u2192 Embed.'), 5200);
      return;
    }
    try {
      if (v) localStorage.setItem(LS_KEY, v);
      else localStorage.removeItem(LS_KEY);
    } catch (e) {}
    toast(T('Saved \u2713 reloading\u2026', '\u062a\u0645 \u0627\u0644\u062d\u0641\u0638 \u2713 \u062c\u0627\u0631\u064d \u0625\u0639\u0627\u062f\u0629 \u0627\u0644\u062a\u062d\u0645\u064a\u0644\u2026'), 1600);
    setTimeout(function () { location.reload(); }, 850);
  }

  // ─── boot ─────────────────────────────────────────────────────────────
  function boot() { renderSettingsRow(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  return {
    toggle: toggle,
    open: function (fallbackFn) { toggle(fallbackFn); },
    onAppActive: onAppActive,
    saveIdFromInput: saveIdFromInput,
    configured: configured
  };
})();
