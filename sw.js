/**
 * Volta Service Worker — Offline-First PWA (v25)
 * =============================================================
 *
 * The whole app works offline:
 *  • Every app-shell + vendor file is precached at install (fonts,
 *    FontAwesome, Chart.js, Leaflet, Firebase SDKs, banner images).
 *  • Same-origin requests: cache-first + background revalidate.
 *  • v35: ACCURACY PASS — meals.js kcal recomputed (4p+4c+9f) + allergen tags,
 *    workouts.js MET-clamped honest calories; db-admin gained live /api/db/verify panel.
 *  • Cross-origin GETs (CDN leftovers like the chat widget): runtime
 *    cached too, so once seen they keep working offline.
 *  • Navigations fall back to the cached index.html.
 *  • NEW (app-v35): Chatbase embedded AI chat is back — js/chatbase-embed.js
 *    added to the app shell; loads the official widget lazily (app-active +
 *    configured bot ID only). Settings → AI Chat (Chatbase) row to paste the
 *    bot ID. Offline/no-ID keeps the on-device coach as fallback.
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
 *  • NEW (v39): PREMIUM V3 — every premium feature now works EVERYWHERE:
    FormSense + RepSense share ONE camera inside the workout popup (chips
    on top of the exercise, run simultaneously); rep counting runs fully
    on-device (offline-proof); form check / ProgressIQ / RecoveryIQ fall
    back to identical on-device engines when the cloud is unreachable
    (no more "Failed to fetch"); every AI popup has a working × button
    (overlay click + Esc close too); RecoveryIQ is more advanced (sleep +
    energy inputs, ready-in hours, avoid list, 7-day trend) and entered
    the nav bar (phone) + sidebar (desktop); diet-plan meal chips are
    clickable and loggable; training days follow the survey schedule
    ('3-4 days' now = 4 days/week); dashboard/profile NEVER show the
    gmail handle; smaller gold PREMIUM tag + top-right pill on phones;
    js/volta-local-ai.js added to precache.
 *  • NEW (v42): Workout popup polish — ALL premium buttons (AI Form Check,
 *    AI Rep Counter, ProgressIQ "Suggest My Weight") aligned together in
 *    one row at the top; activating the assist (or pressing Start Workout
 *    as a premium user) AUTOMATICALLY starts the camera + rep counting +
 *    form checking together (rep count is automatic now); the X close
 *    button is a sticky top-right circle that NEVER disappears (works
 *    while the timer runs and over the camera panel); the offline banner
 *    auto-dismisses after 2 seconds instead of waiting for reconnect.
    • NEW (v29): Dashboard workout plan shows 2 days at a time (was 3);
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
 *  • NEW (v34): Backend hardening + new backends. Premium checkout now has a
 *    REAL backend: POST /api/create-premium-checkout (Stripe Checkout when
 *    STRIPE_SECRET_KEY is set on Vercel, graceful demo mode otherwise) —
 *    and js/premium.js targets the same-origin backend instead of a hardcoded
 *    port, so "Subscribe" works everywhere. Sync/health vault endpoints got
 *    ~8s timeouts + 1 retry with backoff (slow storage now fails fast with a
 *    clear error instead of hanging). New enormous-database console at
 *    db-admin.html (import/export/browse 1,100+ workouts & 1,111+ meals).
 *  • NEW (v32): Workout exercise popup fixed — it scrolls ITSELF now (the old
 *    Round-5 "non-scrollable" rule clipped steps/tips/button and let every
 *    swipe scroll the daily-exercise list BEHIND the popup). The page behind
 *    (html/body + the app's internal <main> scroller) is fully frozen while
 *    any popup is open and restored on close. Exercise photos are MUCH
 *    bigger (fills a clamp(240px,62vw,380px) hero box, object-fit:cover).
 *
 *  • NEW (v49): 100 Spotify playlists (music panel on the Sports tab + sport-
 *    matched live-session playlists + mood-matched MoodMorph + calm meditation);
 *    premium AI features (FormSense / RepSense / ProgressIQ / RecoveryIQ) now
 *    run 100% LOCALLY (offline, no cloud / no on-device dual-mode badges);
 *    RecoveryIQ gives multiple condition-aware answers; Coach AI + AI Diet
 *    Plan removed; meal scanner works offline (3-tier fallback); bigger ×
 *    close buttons on all popups.
 *  • v50: RepSense auto-counts reps with the on-device AI vision engine
 *    (beep + vibrate + counter pop on every rep); FormSense answers with
 *    SEVERAL per-exercise findings from the measured movement (+ optional
 *    Gemini vision deep check when online); RecoveryIQ's "Check my
 *    recovery" button is blue instead of gold.
 *  • v51: ProgressIQ keeps a persistent per-exercise database of every
 *    AI-counted set (works with the user's counted reps, shows history,
 *    prefills the coach); manual rep +/− buttons removed (counting is 100%
 *    AI); camera asks ONCE (Settings → AI Camera toggle, like location) and
 *    fully closes when form check / all assists close; AI form check + AI
 *    rep counter available on EVERY sport drill card; the Sports tab's
 *    workout list only appears when a sport is clicked (and is bigger);
 *    plan toolbar (View Current / New / Custom) only shows before a plan is
 *    started; meals database is 100% halal (bacon/pork/ham/alcohol/sushi
 *    removed — old IndexedDB stores sanitized on boot) and the AI meal
 *    generator now uses GEMINI + the user's LOCATION (popular, well-loved
 *    picks per country); ALL golden buttons are blue; AI Weekly Report
 *    button removed.
 *  • v52: Form Check and Rep Counter are now SEPARATE features (tapping one
 *    no longer auto-starts the other; no more auto-start when the workout
 *    timer begins); the camera asks for permission AT MOST ONCE per app
 *    session (one shared stream + a short linger that covers the 60s rest
 *    timer — no re-prompt when switching exercises/features); both camera
 *    features only run while the user is IN a workout (sports drill cards
 *    lost their AI buttons; the Premium hub modals point to today's workout
 *    when opened outside one); the Daily workout list has NO duplicate
 *    exercises anymore (legacy plans dedupe on load) and each block is
 *    bigger + easier to read; the DIET PLAN panels (dashboard + Diet tab)
 *    now show the same AI-GENERATED MEALS as the AI-Generated Meals panel
 *    and re-sync whenever the AI regenerates them; the AI meals section
 *    shows a clean source line + a "Regenerate Another Diet Plan" button;
 *    BOTH regenerate buttons (dashboard REGENERATE + AI meals) ask "Are you
 *    sure you want to regenerate your plan?" first; the third-party
 *    Chatbase chat widget + its floating circle button ("that extra shape"
 *    on phone dark mode) were removed entirely.
 *  • REDEPLOY REQUIRED: the Vercel backend must be redeployed with the full
 *    api/ folder of this build (the currently deployed backend only has
 *    /api/health + /api/sync-user — everything else 404s).
 *
 * v10 (10th round of user fixes):
 *  • SURVEY REDIRECT BUG FIXED: a brand-new account whose setup survey was
 *    not finished no longer gets dumped on the dashboard with FAKE data
 *    ("Athlete"/25/170/70 + an auto-generated default plan) on reload/app
 *    restart — it returns to the setup survey every time until the survey
 *    is completed (or deliberately skipped via the survey's "Back to Home"
 *    button, which now stamps surveySkipped).
 *  • Go Premium + Subscribe Now buttons: back to the classic GOLD gradient
 *    (v8 made them blue; the user asked for the old golden look back).
 *  • The X in every popup close button is now dead-center (FontAwesome
 *    xmark glyph instead of the font-dependent &times; text).
 *  • The workout plan lists display 10 workouts at a time with a "+X more"
 *    expander (X = remaining count) — on the dashboard WORKOUT PLAN card
 *    AND in the Daily tracker list (auto-expands when the active exercise
 *    moves past the first 10). Workout chips are as big as the diet-plan
 *    blocks in the dashboard.
 *  • "Train This Plan" opens a schedule setup step first: the user picks
 *    how many days they want to train (7–30) and the days of the week
 *    before the plan is loaded into the tracker.
 *  • Profile → Edit info opens a dedicated EDIT MY INFO screen (all 26
 *    answers in one grouped, prefilled form) instead of the whole survey.
 *  • The blue underline stripe is centered under every panel/modal title on
 *    phones (it used to hug the left edge).
 *  • "My Diet Plan" meal blocks now use the dashboard DIET PLAN design.
 *  • The squished-thin Buy buttons in the sport-equipment modal (and every
 *    other 4px-padding mini button) are full-height, comfortable tap
 *    targets now.
 *
 * v11 (11th round of user fixes):
 *  • The landing-page (homepage) "Go Premium" button is GOLD again — it was
 *    still blue while the dashboard CTAs had already been restored in v10.
 *  • LOGIN SECURITY FIX: an account can no longer be opened with ANY
 *    password. Wrong password → "Incorrect password" (with Forgot-password
 *    pointer); unknown email → "No account found with this email. Please
 *    sign up first." (no more auto-created mystery accounts); Google-only
 *    accounts → pointed to the Google button.
 *  • Daily tracker: "W1" is now written out as "Week 1" in the day labels
 *    (legacy saved "(W1)" labels are normalized on display too), the
 *    "Complete each exercise to unlock the next" hint is gone, and
 *    "Day 1 of 7" is now a BIG subtitle with the day number in blue.
 *
 * v12 (12th round of user fixes):
 *  • EQUIPMENT ACCURACY: "None"/"no"/"nothing" equipment answers now
 *    really filter every generator — the wizard pool, the dashboard-plan
 *    top-up AND the plan engine. Bodyweight-bar exercises (pull-ups,
 *    chin-ups, hanging raises, inverted rows) are excluded too, and two
 *    new no-equipment back exercises (Bird Dog, Reverse Snow Angels)
 *    joined the pool.
 *  • The AI-Generated Meals header no longer says "popular picks around".
 *  • AI meal cards don't inflate on hover anymore (border highlight only)
 *    and EVERY card — Gemini ones included — has a stable, always-visible
 *    info button.
 *  • Survey: the last 3 questions (push-ups / plank / 1-mile run) are
 *    gone; the goal modal's Save & Continue is a full-height button.
 *  • DIET ACCURACY: vegetarian / vegan / gluten-free / keto preferences
 *    now drive the Gemini meal prompt, the offline meal set, the diet
 *    plan suggestions AND the meal DB filters. Gluten-free excludes
 *    meals tagged with gluten allergens; the Gemini cache regenerates
 *    when the preference changes.
 *
 * v13 (13th round of user fixes):
 *  • "Forgot password?" is temporarily hidden from the login screen until
 *    Firebase handles email resets (the screen + reset code are kept —
 *    one button to re-enable). The login error message no longer points
 *    to it.
 *  • Rep counter: the on-video HUD now shows ONLY the big rep count,
 *    centered — the checkered "Finish Set" flag button, the UP/DOWN
 *    phase and the tempo words are gone (both the workout popup HUD and
 *    the RepSense modal). Counted sets AUTO-SAVE when the camera/engine
 *    stops, so ProgressIQ still receives every AI-counted set.
 *  • The blue title underline stripe is now centered under EVERY title on
 *    BOTH phones and desktop (v10 only fixed phones; on PC it still hugged
 *    the panel's left edge). Same fix everywhere: dashboard panels, all
 *    modals, tab h1s, the weather screen, RTL. The paywall keeps its
 *    centered GOLD line; the weather temperature stays centered too.
 *
 * v14 (14th round of user fixes):
 *  • Dark-mode trapezium behind the active bottom-nav item (Home) removed
 *    for ALL screens: the sport theme no longer skews the active item, and
 *    the glider's "transparent button background" rule now also wins in
 *    dark mode (no more double-painted skewed pill).
 *  • The top-right "Premium" pill is removed (premium stays reachable from
 *    the Profile tab + dashboard home card; one button to restore).
 *  • The blue title underline now covers the WHOLE title width (was a short
 *    stripe in the middle); the paywall's gold stripe keeps its short
 *    centered look.
 *  • The VERY FIRST time the app is ever opened it always lands on the
 *    homepage/landing screen (explicit fb_opened_once guard).
 *  • The "Regenerate Another Diet Plan" button now renders on EVERY device
 *    (phone included) — it no longer waits for the Gemini tier to succeed;
 *    it works offline too (local set regeneration fallback).
 *  • AI Meal Scanner on PHONES runs the LOCAL offline engine directly (same
 *    as the PC offline path): instant database-matched results, no more
 *    "servers offline" failures. Desktop keeps the 3-tier chain.
 *  • Rep counter no longer counts CAMERA movement as reps: a new 3-band
 *    global-motion discriminator freezes counting while the whole frame
 *    translates rigidly (camera bounce/pan); real body movement (partial,
 *    non-rigid motion) keeps counting as before.
 *
 * v16 (16th round of user fixes):
 *  • Wrong workout photos fixed: Reverse Snow Angels, Glute Bridges, Wide
 *    Push-ups and Staggered Push-ups no longer share a neighbor's picture
 *    (superman / hip-thrust / standard pushup) — each now has its own
 *    dedicated classic photo + two-panel START/END guide image.
 *  • "I get dinner only in diet plan": answering "1 meal" in the survey no
 *    longer collapses the whole day into a single Dinner row — the diet
 *    plan always covers the full day (breakfast/lunch/dinner). Already-
 *    saved dinner-only plans are upgraded in place the next time the Diet
 *    tab or dashboard renders.
 *  • Workout popup before starting: ONLY the Start Workout button is shown
 *    — the big mm:ss timer and the hint text appear only once the countdown
 *    is actually running (the timer hides again at 00:00 so the done state
 *    shows only the Complete Exercise button).
 *
 * v17 (17th round of user fixes):
 *  • The dashboard's WORKOUT PLAN card is synced with Daily Discipline: it
 *    renders the tracker's CURRENT day (same label, same exercises, done
 *    exercises shown as green-check "done" chips with a "2/23 done" header)
 *    and follows the tracker when the day advances. The tracker state
 *    hydrates lazily so the sync works from a fresh boot. Without a tracker
 *    plan the card keeps the old weekday-page behavior. Original sets/reps
 *    now survive adopt → mirror (no more generic 3×10-12 everywhere).
 *  • The dashboard's DIET PLAN card (and the Diet tab's "My Diet Plan") is
 *    synced with the AI-Generated Meals: chips come ONLY from today's AI
 *    meal set (Gemini or offline) — no more foreign meal-DB backfill beside
 *    the AI's picks; a missing meal type borrows within the same set.
 *  • The top-right "Premium" pill is back on phones as a PREMIUM-ONLY
 *    status tag (free users never see it; hidden on desktop + popups as
 *    before).
 *
 * v18 (18th round of user fixes):
 *  • Dashboard hero: the "FORM OFFICIAL — DAILY SNAPSHOT" chip and the
 *    "Here's your snapshot for today" subtitle are gone; the hero card is
 *    now a compact strip on phones (desktop size unchanged).
 *  • The three feature BANNER cards at the very bottom of the dashboard
 *    (Diet System / Sports & Activities / MoodMorph) are removed.
 *  • Weekly bar graph: when the week has zero activity an empty-state
 *    text ("log your workouts and results…") replaces the blank chart.
 *  • Tennis calorie MET recalibrated 7.3 → 8.0 (singles-level, mainstream
 *    tracker values: ~9.3–10.7 kcal/min at 70–80 kg).
 *  • The phone premium tag now wears the GOLD gradient.
 *  • ProgressIQ "Get my prescription" button is blue again.
 *  • PHONES: the AI meal scanner runs the SAME real-AI chain as PC again
 *    (backend → direct Gemini → local fallback); the local engine only
 *    answers instantly when the device is fully offline. Backend wait on
 *    phones capped at 12s.
 *  • NEW: native Android port — the whole app ships as ONE installable
 *    APK (com.volta.fitness) with the web app bundled as assets served
 *    over an https secure origin (WebViewAssetLoader): camera AI,
 *    geolocation, service worker and IndexedDB all work; cloud backend
 *    reached over the network exactly like desktop. See Volta.apk +
 *    PORT-README.txt in the delivery.
 *
 * The service worker is registered from js/volta.js (registerServiceWorker).
 * It only runs when the app is served over http:// or https:// (not file:// —
 * the local copy is already fully offline thanks to the vendored assets).
 *
 * v25 (cache volta-v65): user round on the 3am build — TRAIN legend
 * removed, calorie-strip outline removed + flat cream, all button
 * diagonal/skew effects removed, normal full-width bottom screen bar
 * restored, MoodMorph energy outline squared, WORKOUT/DIET PLAN heads
 * pure white + workout detail burn row (ACSM kcal + MET), integer-only
 * calories everywhere, ACSM/Compendium MET formula for every sport and
 * exercise, AI Weekly Report now generates on-device when offline.
 *
 * v26 (cache volta-v66): the block under the Daily-Discipline calorie
 * count is gone (plain inline text line, no peach box); the active
 * exercise card's highlight is white instead of blue; GAME ON eyebrow
 * is blue (was red); workout-music catalog swapped to 89 OFFICIAL
 * Spotify editorial playlists (user-made AI-slop-cover playlists
 * removed, all IDs re-verified via oEmbed); the see-password (eye)
 * button no longer bounces.
 *
 * v27 (cache volta-v67): dashboard picture round — the Daily-Discipline
 * kcal count is a BIG centered burning flame with the number inside
 * (.de-kcal-flame); the "Day X of Y" number X is always accent blue;
 * the DIET PLAN card now uses the exact same row/chip markup as the
 * WORKOUT PLAN card (MyFitnessPal budget strip removed, grey boxed
 * meals -> plan-day-row + plan-ex-chip) and all dumbbell icons are
 * gone from the workout card (title + chips); the '60+ minutes'
 * survey option is REMOVED (legacy answers re-labelled to 45 min) and
 * the workout count now follows the session length (15 min -> ~5
 * workouts, 30 -> ~9, 45 -> ~14) with 2 sets on every exercise
 * (one-time migration trims saved plans too); 48 start/end exercise
 * images with baked-in text, watermarks, arrows or off-style art
 * were regenerated in the clean flat-vector two-panel style.
 *
 * v28 (cache volta-v68): formula + chat + polish round — NEW full-body
 * workout formula (15-min -> 2 exercises per muscle group, 30 -> 4,
 * 45 -> 5; 2 sets each; a visible 60s REST after every 2 exercises in
 * the tracker AND rest chips on the dashboard card; one-time migration
 * re-shapes saved plans); the dumbbell icon is BACK on the WORKOUT
 * PLAN title and the DIET PLAN banner now matches its dark navy
 * gradient; a NEW always-visible local Coach AI chat (floating bolt
 * button + on-device brain, zero network — works offline and from
 * file://); weather screen: birds removed and the corner half-circle
 * wedge removed; swimwear shopping made family-friendly (Swim
 * Trunks); volta-onefile.html single-file mobile port added (iOS +
 * Android, everything inlined).
 * v28b (cache volta-v69): swimwear shopping hard-frozen to the family-friendly
 *   query "Men's Swim Trunks" (no sport suffix — the old "Swimsuit for
 *   Swimming" search surfaced bikinis/suggestive results); 19 classic
 *   exercise photos with baked-in text/watermarks (alamy watermarks,
 *   "SUPERMAN"/"CrossFit"/"ROMANIAN DEADLIFT" overlays, anatomy labels,
 *   step-by-step captions) were replaced with their clean two-panel SE
 *   counterparts so every image layer is text-free; the single-file mobile
 *   port now inlines the Firebase SDKs too (fully self-contained).
 * v29 (cache volta-v70): picture round 2 + AI unlock —
 *   1) the REST chips are REMOVED from the dashboard WORKOUT PLAN card
 *      (the Daily-Discipline tracker keeps its functional 60s rest timer);
 *   2) ONE water number everywhere: the dashboard diet card, the Diet
 *      System pill and the plan generator all compute LIVE from the same
 *      profile-weight formula as the top DAILY WATER TARGET stat (the old
 *      stale 1.3L vs 2.5L mismatch is impossible now — stored plans are
 *      healed on every dashboard render and after every weight edit);
 *   3) the AI chat button (and the chat modal avatar) show a CHAT icon
 *      (fa-comment-dots) instead of the thunder bolt;
 *   4) AI features now WORK on the html file: FormSense, RepSense,
 *      ProgressIQ and RecoveryIQ are no longer premium-gated (they run
 *      100% on-device — the paywall made them look broken); the AI Meal
 *      Scanner's local matcher no longer claims "You're offline" when the
 *      browser is online;
 *   5) the Daily-Discipline "Day N of M" headline is much BIGGER
 *      (2.05rem / weight 800, day number 1.45em blue);
 *   6) the sport-modal "Buy" equipment buttons render as real blue CTA
 *      pills (they were class="btn small" with no background at all);
 *   7) the single-file mobile port is optimized — 15.5MB → 10.4MB (TTF
 *      font fallbacks stripped, images recompressed 576px/q64) and the
 *      image payload no longer executes at parse time (lazy JSON) so the
 *      file opens without the split-second lag;
 *   8) the dashboard DIET PLAN meal chips use the exact same
 *      slightly-rounded-rectangle geometry as the workout chips (10px
 *      radius — the 999px full-pill override is gone).
 * v30 (cache volta-v71): polish round —
 *   1) RecoveryIQ now GENERATES a recovery workout (easy walk + targeted
 *      mobility + 4-7-8 breathing + injury-safe moves) with a one-tap
 *      “Log this recovery session” button.
 *   2) the Great Work flame is thicker (all 5 layers ~40% wider);
 *   3) Coach AI chat: the white banner strip above the header is gone —
 *      the X now floats ON the dark header top corner, and the
 *      “On-device · works offline” subtitle was removed;
 *   4) Streaks history: every DAY is one compact block (mini-rows),
 *      latest 3 blocks + “See more” expander;
 *   5) sport modals: safe-center overlay + sticky X + overflow-proof
 *      equipment rows (the football/basketball button problem);
 *   6) all numbers whole — minutes never show decimals;
 *   7) the workout calorie target is VISIBLE on the ring (kcal / target);
 *   8) homepage minimalist polish (aurora glow, dot grid, shine sweep);
 *   9) NEW js/volta-sounds.js — snappy WebAudio button sounds + a
 *      Settings → Sound Effects On/Off toggle (js/volta-sounds.js
 *      precached);
 *  10) volta-onefile.html single-file build REMOVED from the package.
 */

const CACHE_NAME = 'volta-v75';   // v35: Chatbase embedded AI chat (js/chatbase-embed.js + Settings row) — offline coach fallback
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/volta.css',
  './css/volta-animations.css',
  './css/volta-sport-theme.css',
  './js/db.js',
  './js/chat.js',
  './js/volta-chat-ai.js',
  './js/chatbase-embed.js',
  './js/data/meals.js',
  './js/data/workouts.js',
  './js/plan-engine.js',
  './js/premium.js',
  './js/notifications.js',
  './js/marketplace.js',
  './js/volta-features.js',
  './js/volta-sounds.js',
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
  './img/part1/banner-diet.jpg',
  './img/part1/banner-sports.jpg',
  './img/part1/banner-mood.jpg',
  './js/volta-imgmap.js',
  './css/volta-redesign.css',
  './css/volta-premium.css',
    './css/volta-fitness.css',
  './js/lang/ar.js',
  './js/pricing-fallback.js',
  './js/volta-local-ai.js',
  './js/volta-ai.js',
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
