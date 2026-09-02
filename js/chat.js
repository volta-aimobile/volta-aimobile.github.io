/**
 * Volta Chat — Coach ↔ Athlete Messaging (SERVER-ONLY)
 * Real-time-ish chat between athletes and their coaches.
 * All messages stored on the server. No localStorage fallback.
 */
window.VoltaChat = (function () {
  var API_URL = window.VOLTA_API_BASE || window.location.origin;
  var POLL_INTERVAL = 3000;

  var state = {
    open: false,
    otherEmail: null,
    otherName: null,
    myEmail: null,
    lastTs: 0,
    pollTimer: null,
    view: 'list'
  };

  function getMyEmail() {
    try {
      if (typeof store !== 'undefined' && store.session) return String(store.session).toLowerCase();
    } catch (e) {}
    try {
      var coachEmail = localStorage.getItem('volta_coach_session');
      if (coachEmail) return String(coachEmail).toLowerCase();
    } catch (e) {}
    return null;
  }

  function convIdFor(a, b) {
    return [String(a).toLowerCase(), String(b).toLowerCase()].sort().join('__');
  }

  function formatTime(ts) {
    var d = new Date(ts);
    var now = new Date();
    var sameDay = d.toDateString() === now.toDateString();
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    if (sameDay) return hh + ':' + mm;
    var dd = String(d.getDate()).padStart(2, '0');
    var mo = String(d.getMonth() + 1).padStart(2, '0');
    return mo + '/' + dd + ' ' + hh + ':' + mm;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/\n/g, '<br>');
  }

  function initials(name) {
    if (!name) return '?';
    var parts = String(name).split(/[\s@]+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  }

  function isArabic() {
    try { return (typeof store !== 'undefined' && store.lang === 'ar'); } catch (e) { return false; }
  }

  function tr(en, ar) { return isArabic() ? ar : en; }

  async function apiSend(from, to, text) {
    try {
      var resp = await fetch(API_URL + '/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: from, to: to, text: text })
      });
      if (!resp.ok) return null;
      var data = await resp.json();
      return data.message || null;
    } catch (e) { return null; }
  }

  async function apiFetchMessages(otherEmail, since) {
    var me = getMyEmail();
    if (!me) return [];
    try {
      var url = API_URL + '/api/chat/messages?user1=' + encodeURIComponent(me) + '&user2=' + encodeURIComponent(otherEmail);
      if (since) url += '&since=' + since;
      var resp = await fetch(url);
      if (!resp.ok) return [];
      var data = await resp.json();
      return data.messages || [];
    } catch (e) { return []; }
  }

  async function apiListConversations() {
    var me = getMyEmail();
    if (!me) return [];
    try {
      var resp = await fetch(API_URL + '/api/chat/conversations?user=' + encodeURIComponent(me));
      if (!resp.ok) return [];
      var data = await resp.json();
      return data.conversations || [];
    } catch (e) { return []; }
  }

  async function apiMarkRead(otherEmail) {
    var me = getMyEmail();
    if (!me) return;
    try {
      await fetch(API_URL + '/api/chat/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: me, otherEmail: otherEmail })
      });
    } catch (e) {}
  }

  function openWith(otherEmail, otherName) {
    if (!otherEmail) return;
    state.otherEmail = String(otherEmail).toLowerCase();
    state.otherName = otherName || otherEmail;
    state.myEmail = getMyEmail();
    state.lastTs = 0;
    state.view = 'thread';

    if (!state.myEmail) {
      alert(tr('Please log in to use chat.', 'الرجاء تسجيل الدخول لاستخدام المحادثة.'));
      return;
    }

    ensureModalExists();
    showModal();
    renderThread();
    startPolling();
    apiMarkRead(state.otherEmail);
  }

  function openList() {
    state.myEmail = getMyEmail();
    state.view = 'list';

    if (!state.myEmail) {
      alert(tr('Please log in to use chat.', 'الرجاء تسجيل الدخول لاستخدام المحادثة.'));
      return;
    }

    ensureModalExists();
    showModal();
    renderList();
    startPolling();
  }

  function close() {
    state.open = false;
    state.otherEmail = null;
    state.otherName = null;
    stopPolling();
    hideModal();
  }

  function backToList() {
    state.view = 'list';
    state.otherEmail = null;
    state.otherName = null;
    renderList();
    startPolling();
  }

  function startPolling() {
    stopPolling();
    state.pollTimer = setInterval(pollOnce, POLL_INTERVAL);
    pollOnce();
  }

  function stopPolling() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  async function pollOnce() {
    if (!state.open) return;
    if (state.view === 'thread' && state.otherEmail) {
      var newMsgs = await apiFetchMessages(state.otherEmail, state.lastTs);
      if (newMsgs.length > 0) {
        newMsgs.forEach(function (m) {
          if (m.ts > state.lastTs) state.lastTs = m.ts;
        });
        if (newMsgs.some(function (m) { return m.to === state.myEmail && !m.read; })) {
          apiMarkRead(state.otherEmail);
        }
        renderThread();
      }
    } else if (state.view === 'list') {
      await renderList();
    }
  }

  async function send(text) {
    if (!text || !text.trim()) return;
    if (!state.otherEmail || !state.myEmail) return;

    var msg = {
      id: Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      from: state.myEmail,
      to: state.otherEmail,
      text: text.trim().slice(0, 5000),
      ts: Date.now(),
      read: false
    };

    if (msg.ts > state.lastTs) state.lastTs = msg.ts;
    renderThread();
    await apiSend(state.myEmail, state.otherEmail, msg.text);
  }

  function ensureModalExists() {
    if (document.getElementById('volta-chat-modal')) return;
    var modal = document.createElement('div');
    modal.id = 'volta-chat-modal';
    modal.className = 'volta-chat-modal';
    modal.innerHTML = `
      <div class="volta-chat-window">
        <div class="volta-chat-header" id="volta-chat-header">
          <button class="volta-chat-back" id="volta-chat-back" style="display:none;">
            <i class="fa-solid fa-arrow-left"></i>
          </button>
          <div class="volta-chat-avatar" id="volta-chat-avatar">?</div>
          <div class="volta-chat-header-info">
            <div class="volta-chat-header-name" id="volta-chat-header-name">Chat</div>
            <div class="volta-chat-header-sub" id="volta-chat-header-sub"></div>
          </div>
          <button class="volta-chat-close" id="volta-chat-close">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div class="volta-chat-body" id="volta-chat-body"></div>
        <div class="volta-chat-input-wrap" id="volta-chat-input-wrap" style="display:none;">
          <textarea id="volta-chat-input" class="volta-chat-input" placeholder="Type a message..." rows="1"></textarea>
          <button id="volta-chat-send" class="volta-chat-send-btn">
            <i class="fa-solid fa-paper-plane"></i>
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('volta-chat-close').addEventListener('click', close);
    document.getElementById('volta-chat-back').addEventListener('click', backToList);
    document.getElementById('volta-chat-send').addEventListener('click', function () {
      var input = document.getElementById('volta-chat-input');
      var text = input.value;
      input.value = '';
      input.style.height = 'auto';
      send(text);
    });
    var input = document.getElementById('volta-chat-input');
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        var text = input.value;
        input.value = '';
        input.style.height = 'auto';
        send(text);
      }
    });
    input.addEventListener('input', function () {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 100) + 'px';
    });

    modal.addEventListener('click', function (e) {
      if (e.target === modal) close();
    });
  }

  function showModal() {
    state.open = true;
    var modal = document.getElementById('volta-chat-modal');
    if (modal) modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function hideModal() {
    var modal = document.getElementById('volta-chat-modal');
    if (modal) modal.classList.remove('open');
    document.body.style.overflow = '';
  }

  function renderThread() {
    var body = document.getElementById('volta-chat-body');
    if (!body) return;

    var back = document.getElementById('volta-chat-back');
    var avatar = document.getElementById('volta-chat-avatar');
    var name = document.getElementById('volta-chat-header-name');
    var sub = document.getElementById('volta-chat-header-sub');
    var inputWrap = document.getElementById('volta-chat-input-wrap');

    if (back) back.style.display = 'flex';
    if (inputWrap) inputWrap.style.display = 'flex';
    if (avatar) avatar.textContent = initials(state.otherName);
    if (name) name.textContent = state.otherName || state.otherEmail;
    if (sub) sub.textContent = state.otherEmail || '';

    body.innerHTML = '<div class="volta-chat-loading"><i class="fa-solid fa-spinner fa-spin"></i></div>';

    apiFetchMessages(state.otherEmail, 0).then(function (messages) {
      var me = state.myEmail;
      if (messages.length === 0) {
        body.innerHTML = '<div class="volta-chat-empty"><i class="fa-solid fa-comments"></i><p>' + tr('No messages yet. Say hello!', 'لا توجد رسائل بعد. ابدأ المحادثة!') + '</p></div>';
      } else {
        body.innerHTML = '<div class="volta-chat-messages">' + messages.map(function (m) {
          var mine = m.from === me;
          return '<div class="volta-chat-msg ' + (mine ? 'mine' : 'theirs') + '">' +
            '<div class="volta-chat-msg-bubble">' + escapeHtml(m.text) + '</div>' +
            '<div class="volta-chat-msg-time">' + formatTime(m.ts) + '</div>' +
          '</div>';
        }).join('') + '</div>';
      }
      var msgsEl = body.querySelector('.volta-chat-messages');
      if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;
      if (messages.length > 0) {
        var last = messages[messages.length - 1];
        if (last.ts > state.lastTs) state.lastTs = last.ts;
      }
      var input = document.getElementById('volta-chat-input');
      if (input) setTimeout(function () { input.focus(); }, 50);
    });
  }

  async function renderList() {
    var body = document.getElementById('volta-chat-body');
    if (!body) return;

    var back = document.getElementById('volta-chat-back');
    var avatar = document.getElementById('volta-chat-avatar');
    var name = document.getElementById('volta-chat-header-name');
    var sub = document.getElementById('volta-chat-header-sub');
    var inputWrap = document.getElementById('volta-chat-input-wrap');

    if (back) back.style.display = 'none';
    if (inputWrap) inputWrap.style.display = 'none';
    if (avatar) avatar.innerHTML = '<i class="fa-solid fa-comments"></i>';
    if (name) name.textContent = tr('Messages', 'الرسائل');
    if (sub) sub.textContent = state.myEmail || '';

    var convos = await apiListConversations();
    if (convos.length === 0) {
      body.innerHTML = '<div class="volta-chat-empty"><i class="fa-solid fa-comments"></i><p>' + tr('No conversations yet.', 'لا توجد محادثات بعد.') + '</p><p class="small">' + tr('Join a course to start chatting with your coach.', 'اشترك في دورة لبدء المحادثة مع مدربك.') + '</p></div>';
      return;
    }

    body.innerHTML = '<div class="volta-chat-conv-list">' + convos.map(function (c) {
      var preview = c.lastMessage ? escapeHtml(c.lastMessage.slice(0, 60)) + (c.lastMessage.length > 60 ? '…' : '') : '<em style="color:var(--muted);">' + tr('No messages', 'لا رسائل') + '</em>';
      var time = c.lastTs ? formatTime(c.lastTs) : '';
      var unreadBadge = c.unreadCount > 0 ? '<span class="volta-chat-unread">' + c.unreadCount + '</span>' : '';
      var avatarText = initials(c.otherName || c.otherEmail);
      return '<div class="volta-chat-conv-item" data-other-email="' + escapeHtml(c.otherEmail) + '">' +
        '<div class="volta-chat-conv-avatar">' + avatarText + '</div>' +
        '<div class="volta-chat-conv-body">' +
          '<div class="volta-chat-conv-top">' +
            '<span class="volta-chat-conv-name">' + escapeHtml(c.otherName || c.otherEmail) + '</span>' +
            '<span class="volta-chat-conv-time">' + time + '</span>' +
          '</div>' +
          '<div class="volta-chat-conv-preview">' + preview + '</div>' +
        '</div>' +
        unreadBadge +
      '</div>';
    }).join('') + '</div>';

    var items = body.querySelectorAll('.volta-chat-conv-item');
    items.forEach(function (item) {
      item.addEventListener('click', function () {
        var email = item.getAttribute('data-other-email');
        var nameEl = item.querySelector('.volta-chat-conv-name');
        var n = nameEl ? nameEl.textContent : email;
        openWith(email, n);
      });
    });
  }

  return {
    openWith: openWith,
    openList: openList,
    close: close,
    send: send,
    getMyEmail: getMyEmail
  };
})();
