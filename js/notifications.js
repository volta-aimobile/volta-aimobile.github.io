 

















window.VoltaNotifications = (function () {

  let permissionRequested = false;
  let dailyTimerStarted = false;

   
  function user() {
    try {
      if (typeof currentUser === 'function') return currentUser();
      if (typeof store !== 'undefined' && store.session) return store.users[store.session];
      return null;
    } catch (e) { return null; }
  }

   
  function enabled() {
    try { return localStorage.getItem('fb_notif') === 'on'; } catch (e) { return false; }
  }
  function setEnabledFlag(v) {
    try { v ? localStorage.setItem('fb_notif', 'on') : localStorage.removeItem('fb_notif'); } catch (e) {}
  }
  function dailyTime() {
    try { return localStorage.getItem('fb_notif_time') || '18:00'; } catch (e) { return '18:00'; }
  }

   
  function isSupported() {
    return typeof Notification !== 'undefined';
  }

   
  function getPermission() {
    if (!isSupported()) return 'unsupported';
    return Notification.permission;  
  }

   
  async function requestPermission() {
    if (!isSupported()) return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') return 'denied';
    try {
      const result = await Notification.requestPermission();
      permissionRequested = true;
      return result;
    } catch (e) {
      return 'default';
    }
  }

   
  async function swReg() {
    try {
      if (!('serviceWorker' in navigator)) return null;
      return await navigator.serviceWorker.getRegistration() ||
             await navigator.serviceWorker.ready.catch(function () { return null; }) || null;
    } catch (e) { return null; }
  }

   
   



  async function send(title, body, opts) {
    opts = opts || {};
    var ar = (typeof store !== 'undefined' && store.lang === 'ar');

     
    try { if (typeof playReminderSound === 'function') playReminderSound(); } catch (e) {}

    var icon = opts.icon || 'icon-192.png';
    var payload = {
      body: body || '',
      icon: icon,
      badge: icon,
      tag: opts.tag || 'volta-notification',
      renotify: true,
      data: { url: opts.url || './' }
    };

     
     
    if (isSupported() && Notification.permission === 'granted' && enabled()) {
      try {
        var reg = await swReg();
        if (reg && reg.showNotification) {
          await reg.showNotification(title, payload);
          return;
        }
      } catch (e) {   }

       
      try {
        var n = new Notification(title, { body: body || '', icon: icon, tag: payload.tag });
        if (opts.onclick) n.onclick = opts.onclick;
        setTimeout(function () { try { n.close(); } catch (e) {} }, 10000);
        return;
      } catch (e) {   }
    }

     
    try {
      if (typeof showVoltaToast === 'function') {
        showVoltaToast('🔔 ' + title + ': ' + body, 'info', 8000);
      } else {
        console.log('[Volta Notification]', title, body);
      }
    } catch (e) {}
  }

   
  function sendReminder(title, note) {
    var ar = (typeof store !== 'undefined' && store.lang === 'ar');
    send(
      ar ? '⏰ تذكير: ' + title : '⏰ Reminder: ' + title,
      note || (ar ? 'حان وقت تمرينك!' : "It's time for your workout!"),
      { tag: 'reminder-' + title }
    );
  }

   
  function sendTest() {
    var ar = (typeof store !== 'undefined' && store.lang === 'ar');
    send(
      ar ? '⚡ فولتا تعمل!' : '⚡ Volta notifications work!',
      ar ? 'هذا إشعار تجريبي من إعدادات فولتا.' : 'This is a test notification from Volta Settings.',
      { tag: 'volta-test' }
    );
  }

   
  async function setEnabled(on) {
    if (on) {
      var perm = await requestPermission();
      if (perm !== 'granted') {
        refreshSettingsUI();
        try {
          var msg = (typeof store !== 'undefined' && store.lang === 'ar')
            ? 'لم يُسمح بالإشعارات — اسمح بها من إعدادات المتصفح.'
            : 'Notification permission was not granted — allow it in your browser settings.';
          if (typeof showVoltaToast === 'function') showVoltaToast(msg, 'error', 8000);
        } catch (e) {}
        return false;
      }
      setEnabledFlag(true);
      startDailyCheck();
    } else {
      setEnabledFlag(false);
    }
    syncNativeReminders(on);
    refreshSettingsUI();
    return true;
  }

  function setDailyTime(t) {
    try { localStorage.setItem('fb_notif_time', t || '18:00'); } catch (e) {}
    syncNativeReminders(enabled());
  }

   
   
   
   
   
   
  function syncNativeReminders(on) {
    try {
      var nat = window.VoltaNative;
      if (!nat) return;                                   
       
      try { if (nat.setReminderLang) nat.setReminderLang((typeof store !== 'undefined' && store.lang === 'ar') ? 'ar' : 'en'); } catch (e2) {}
      if (on && nat.enableReminders) nat.enableReminders(String(dailyTime()));
      else if (!on && nat.disableReminders) nat.disableReminders();
    } catch (e) {}
  }

   
  function refreshSettingsUI() {
    try {
      var onBtn = document.getElementById('notif-on-btn');
      var offBtn = document.getElementById('notif-off-btn');
      var isOn = enabled();
      if (onBtn && offBtn) {
        onBtn.classList.toggle('active', isOn);
        offBtn.classList.toggle('active', !isOn);
      }
      var line = document.getElementById('notif-status-line');
      if (line) {
        var perm = getPermission();
        var ar = (typeof store !== 'undefined' && store.lang === 'ar');
        var status;
        if (!isSupported()) status = ar ? 'الإشعارات غير مدعومة في هذا المتصفح.' : 'Notifications are not supported in this browser.';
        else if (perm === 'denied') status = ar ? 'الإشعارات محظورة من إعدادات المتصفح.' : 'Notifications are blocked in your browser settings.';
         
         
        else if (isOn) status = ar ? 'الإشعارات مفعّلة — ستصلك تذكيرات التمرين.' : 'Notifications on — workout reminders are active.';
        else status = ar ? 'الإشعارات موقّعة — فعّلها لتصلك تذكيرات التمرين.' : 'Notifications off — enable to receive workout reminders.';
        line.textContent = status;
        line.removeAttribute('data-ar');
      }
    } catch (e) {}
  }

   
  function startDailyCheck() {
    if (dailyTimerStarted) return;
    dailyTimerStarted = true;
    setInterval(dailyCheckTick, 30000);
    dailyCheckTick();
  }
  function dailyCheckTick() {
    try {
      if (!enabled()) return;
      if (!isSupported() || Notification.permission !== 'granted') return;
      var u = user();
      if (!u || !u.profile) return;  
      if (u.stopTraining) return;
       
       
       
      try {
        var nat0 = window.VoltaNative;
        if (nat0 && nat0.setTrainedToday && typeof getTodayMinutes === 'function' && getTodayMinutes() > 0) {
          var _now0 = new Date();
          nat0.setTrainedToday((typeof localDateStr === 'function') ? localDateStr() : _now0.toISOString().slice(0, 10));
        }
      } catch (e0) {}
      var now = new Date();
      var hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
      var target = dailyTime();
      var todayKey = 'fb_notif_fired_' + (typeof localDateStr === 'function' ? localDateStr() : now.toDateString());
      if (localStorage.getItem(todayKey)) return;
      if (hhmm >= target && hhmm < '23:59') {
         
        var mins = (typeof getTodayMinutes === 'function') ? getTodayMinutes() : 0;
        localStorage.setItem(todayKey, '1');
        var ar = (typeof store !== 'undefined' && store.lang === 'ar');
        if (mins === 0) {
          send(
            ar ? '💪 وقت التمرين!' : '💪 Workout time!',
            ar ? 'لم تسجل أي تمرين اليوم. جلسة قصيرة تكفي!' : "You haven't trained today. Even a short session counts!",
            { tag: 'volta-daily-reminder' }
          );
        }
      }
    } catch (e) {}
  }

   
  function init() {
     
     
    if (enabled()) { startDailyCheck(); syncNativeReminders(true); }
    refreshSettingsUI();
  }

  return {
    isSupported: isSupported,
    getPermission: getPermission,
    requestPermission: requestPermission,
    send: send,
    sendReminder: sendReminder,
    sendTestNotification: sendTest,
    setNotifications: setEnabled,
    setDailyNotifTime: setDailyTime,
    refreshSettingsUI: refreshSettingsUI,
    isEnabled: enabled,
    init: init
  };
})();

 
window.setNotifications = function (on) { window.VoltaNotifications.setNotifications(on); };
window.setDailyNotifTime = function (t) { window.VoltaNotifications.setDailyNotifTime(t); };
window.sendTestNotification = function () { window.VoltaNotifications.sendTestNotification(); };
