/**
 * Volta Service Worker — Offline-First PWA (v24)
 * =============================================================
 *
 * The whole app works offline:
 *  • Every app-shell + vendor file is precached at install (fonts,
 *    FontAwesome, Chart.js, Leaflet, Firebase SDKs, banner images).
 *  • Same-origin requests: cache-first + background revalidate.
 *  • Cross-origin GETs (CDN leftovers like the chat widget): runtime
 *    cached too, so once seen they keep working offline.
 *  • Navigations fall back to the cached index.html.
 *  • NEW (v19): grocery list removed, rings track Calories / Minutes /
 *    Workouts today.
 *  • NEW (v20): deploy guard added to index.html; cache bumped so every
 *    browser gets the complete build after fixing the incomplete upload.
 *  • NEW (v21): bottom-nav slider unstuck (CSS !important bug); nav is now
 *    Home / Sports&Tracker / Daily Discipline / Diet / More (Streaks moved
 *    into More, Marathon removed); first-run lands on Home; per-user seeded
 *    workout personalization; heatmap centered; weight trend removed.
 *  • NEW (v22): auto-generate the plan for accounts without one (first-run
 *    no longer goes through the survey, so plans were never created); the
 *    Daily tab now opens on a plan-choice hub (Train / View / New / Custom)
 *    instead of the muscle picker; wizard Back navigation; dashboard shows a
 *    "Generate My Plan" card when no plan exists; cloud refresh can no
 *    longer wipe a local plan the cloud copy lacks.
 *  • NEW (v25): "My Diet Plan" Breakfast/Lunch/Dinner rows now ALWAYS show
 *    real meals (were blank when the async IndexedDB suggestion fill raced
 *    or the plan predated it): synchronous per-user fallback picker +
 *    static-seed fallback + self-healing persist on render.
 *  • NEW (v27): Settings no longer shows any cloud-sync option (Cloud
 *    Backup card + Sync-now button removed; background sync engine stays
 *    100% automatic). Dashboard workout plan now shows 3 days at a time
 *    with a ‹ › pager that opens on today's page.
 *  • NEW (v28): Dashboard workout plan card gains a "See More" button
 *    opening the full-plan popup (every training day + Train This Plan);
 *    splash-screen thunder bolt slightly smaller (5.4rem → 4.9rem).
 *  • NEW (v29): Dashboard workout plan shows 2 days at a time (was 3);
 *    the See More popup is workout-only — diet section and the
 *    "Train This Plan" button removed from it (user request).
 *  • NEW (v30): The plan popup now shows the FULL Monday→Sunday week
 *    (rest days as muted cards, Today badge). Weight goal protected from
 *    automatic changes: goalUpdatedAt stamp + newer-wins cloud merge.
 *  • NEW (v31): Animation + responsiveness round. Calorie ring fills
 *    SLOWLY toward a real daily goal (300-kcal floor — was slamming full
 *    after one tiny session). Weekly bar graph fixed on every screen
 *    (fixed-height chart box + resize-on-show; was "too wide and short"
 *    on Honor X9d). Content column capped/centered on tablets. New:
 *    diagonal sliding bottom-nav glider, workout-complete confetti +
 *    checkmark, splash bolt flicker+glow, streak flame flicker, count-up
 *    ring numbers, springy goal-fill replay, gliding ring arcs.
 *  • NEW (v33): Round-18 changes — bottom-nav highlight is a PROPER SQUARE
 *    (no more diagonal slant) on every screen; MoodMorph energy bar rebuilt
 *    to the reference design (white thumb, amber→periwinkle fill, compact
 *    width on mobile); dashboard workout plan shows ONE day at a time with
 *    a "1 of 7" → "2 of 7" pager and compact rows; "MORPHOGEN" renamed to
 *    "MOODMORPH"; post-session logger asks for a NOTE only (saved to the
 *    workout history); clicking a weekly bar graph bar opens a full
 *    day-summary popup (calories burnt, minutes, workouts, meals eaten);
 *    NEW backend for the AI meal scanner (api/analyze-meal.js — set
 *    GEMINI_API_KEY in Vercel, see VERCEL-SETUP.txt).
 *  • NEW (v32): Workout exercise popup fixed — it scrolls ITSELF now (the old
 *    Round-5 "non-scrollable" rule clipped steps/tips/button and let every
 *    swipe scroll the daily-exercise list BEHIND the popup). The page behind
 *    (html/body + the app's internal <main> scroller) is fully frozen while
 *    any popup is open and restored on close. Exercise photos are MUCH
 *    bigger (fills a clamp(240px,62vw,380px) hero box, object-fit:cover).
 *
 * The service worker is registered from js/volta.js (registerServiceWorker).
 * It only runs when the app is served over http:// or https:// (not file:// —
 * the local copy is already fully offline thanks to the vendored assets).
 */

const CACHE_NAME = 'volta-v33';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/volta.css',
  './css/volta-animations.css',
  './css/volta-sport-theme.css',
  './js/db.js',
  './js/chat.js',
  './js/data/meals.js',
  './js/data/workouts.js',
  './js/plan-engine.js',
  './js/premium.js',
  './js/notifications.js',
  './js/marketplace.js',
  './js/volta-features.js',
  './js/volta.js',
  './js/cloudsync.js',
  './js/volta-animations.js',
  './js/volta-clouds.js',
  './js/volta-google.js',
  // ── Vendored third-party assets (offline-first) ──
  './vendor/fonts/fonts.css',
  './vendor/fontawesome/css/all.min.css',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/leaflet.js',
  './vendor/chart.umd.js',
  './vendor/tesseract/tesseract.min.js',
  './js/vendor/firebasejs/10.12.2/firebase-app-compat.js',
  './js/vendor/firebasejs/10.12.2/firebase-auth-compat.js',
  './js/vendor/firebasejs/10.12.2/firebase-firestore-compat.js',
  './img/banner-diet.jpg',
  './img/banner-sports.jpg',
  './img/banner-mood.jpg',
  './css/volta-redesign.css',
  './icon-192.png',
  // Font binaries are runtime-cached on first use (fetch handler below) —
  // they start downloading the moment fonts.css is parsed anyway.
];

// ─── Install: cache the app shell ─────────────────────────────────────────
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // Cache entries one-by-one: one failing URL must not nuke the install
      return Promise.all(
        APP_SHELL.map(function (url) {
          return cache.add(url).catch(function (err) {
            console.warn('[Volta SW] Missed precache:', url, err);
          });
        })
      );
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

// ─── Activate: clean up old caches ────────────────────────────────────────
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (cacheNames) {
      return Promise.all(
        cacheNames.map(function (cacheName) {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// ─── Local notifications (NEW in v17) ─────────────────────────────────
// Clicking a Volta notification focuses (or opens) the app.
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});

// Pages ask the SW to show a notification (most reliable path on all PWA platforms).
self.addEventListener('message', function (event) {
  var data = event.data || {};
  if (data.type === 'show-notification') {
    self.registration.showNotification(data.title || 'Volta', {
      body: data.body || '',
      icon: data.icon || 'icon-192.png',
      badge: data.icon || 'icon-192.png',
      tag: data.tag || 'volta-notification',
      renotify: true,
      data: { url: data.url || './' }
    });
  }
});

// Push handler (kept for future server push; harmless locally).
self.addEventListener('push', function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(data.title || 'Volta', {
      body: data.body || '',
      icon: data.icon || 'icon-192.png',
      badge: data.icon || 'icon-192.png',
      tag: data.tag || 'volta-push'
    })
  );
});

// ─── Fetch: offline-first for everything ──────────────────────────────────
self.addEventListener('fetch', function (event) {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  var url = new URL(event.request.url);

  // Skip non-http(s) protocols
  if (!url.protocol.startsWith('http')) return;

  // Skip uploading/streaming requests
  if (event.request.headers.get('range')) return;

  var sameOrigin = url.origin === self.location.origin;

  // Sync/API calls must always hit the network (fresh data, auth).
  if (!sameOrigin && (url.pathname.indexOf('/api/') !== -1 || url.hostname.indexOf('textdb.dev') !== -1)) {
    return;
  }

  event.respondWith(
    caches.match(event.request, { ignoreVary: true }).then(function (cachedResponse) {
      // Cache-first + stale-while-revalidate: serve instantly, refresh quietly
      if (cachedResponse) {
        fetch(event.request).then(function (networkResponse) {
          if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(event.request, networkResponse.clone());
            });
          }
        }).catch(function () { /* offline — cached version is fine */ });
        return cachedResponse;
      }

      // Not in cache — try network, then cache the result for next time
      return fetch(event.request).then(function (networkResponse) {
        if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
          var responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(function () {
        // Offline and not cached — navigations fall back to the app shell
        if (event.request.mode === 'navigate' ||
            (event.request.headers.get('accept') || '').indexOf('text/html') !== -1) {
          return caches.match('./index.html');
        }
        return undefined;
      });
    })
  );
});
