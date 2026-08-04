# Volta App — Full Backend

A real, runnable Node.js/Express + SQLite backend for the Volta fitness app.
The original front-end (`public/Volta App.html`) is **100% untouched** — it's
served by Express with a small `bridge.js` script injected in-flight (the file
on disk is byte-for-byte identical to the original).

## What you get

| Feature                              | Where                                                |
| ------------------------------------ | ---------------------------------------------------- |
| 2FA email auth (register/login/OTP)  | `server/routes/auth.js`, `server/routes/coachAuth.js`|
| Unlimited meal library               | `server/routes/meals.js`, `server/seeds/meals.js`    |
| Cross-device sync                    | `server/routes/sync.js`, `public/bridge.js`          |
| Exercise / workout / plan DB + images| `server/routes/workouts.js`, `server/seeds/*.js`     |
| Coach ↔ athlete account linking      | `server/routes/coachLinking.js`                      |
| SQLite database (auto-created)       | `data/volta.db`                                      |
| Front-end bridge (zero HTML edit)    | `public/bridge.js`, `server/middleware/injectBridge.js` |

## Quick start

```bash
cd volta-app
cp .env.example .env            # edit JWT_SECRET, SMTP_* if you want real emails
npm install
npm start
```

Then open **http://localhost:4000/** in your browser. The Volta app loads
exactly as before — but every auth, sync, and meal/exercise operation now
flows through the real backend.

### Email / 2FA setup

By default, the backend runs in **dev mode**: OTP codes are printed to the
server console AND returned in the API response (`devCode` field), so you can
complete 2FA without a real mailbox. The bridge.js `prompt()` will display
the code automatically.

To send real emails, edit `.env`:

```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=you@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=Volta App <you@gmail.com>
OTP_DEV_IN_RESPONSE=false
```

(Gmail users: use an [App Password](https://myaccount.google.com/apppasswords),
not your account password.)

## Project layout

```
volta-app/
├── package.json
├── .env.example
├── README.md
├── server/
│   ├── index.js                 # Express entry — boots server, mounts routes
│   ├── config.js                # Env-based config
│   ├── db.js                    # better-sqlite3 connection
│   ├── migrations.js            # CREATE TABLE IF NOT EXISTS + seed defaults
│   ├── middleware/
│   │   ├── auth.js              # JWT verification (athlete / coach)
│   │   └── injectBridge.js      # In-flight <script> injection (HTML untouched)
│   ├── routes/
│   │   ├── auth.js              # Athlete 2FA: /register /login /verify-otp /forgot /reset-password
│   │   ├── coachAuth.js         # Coach 2FA (mirrors athlete)
│   │   ├── coachLinking.js      # /coach/athletes, /coach/linked-by
│   │   ├── meals.js             # /meals (CRUD + assign + log)
│   │   ├── workouts.js          # /workouts + /exercises + /plans + /sessions/log + /upload
│   │   └── sync.js              # /sync/:key (PUT/GET/DELETE) + /sync/changes/since
│   ├── services/
│   │   ├── mail.js              # Nodemailer (with dev-mode fallback)
│   │   └── otp.js               # 6-digit code issue/verify
│   ├── seeds/
│   │   ├── meals.js             # 6 default meals (mirrors front-end)
│   │   ├── exercises.js         # ~15 default exercises
│   │   └── plans.js             # 3 default training plans
│   └── tests/
│       └── smoke.js             # End-to-end smoke test (no external deps)
├── public/
│   ├── Volta App.html           # ← original HTML, untouched
│   └── bridge.js                # ← wires front-end to backend
├── data/                        # auto-created; volta.db lives here
└── uploads/                     # auto-created; uploaded images live here
```

## How the bridge works (zero HTML modification)

1. The original `Volta App.html` lives in `public/` and is **never edited**.
2. `server/middleware/injectBridge.js` reads the file, inserts
   `<script src="/bridge.js" data-volta-bridge="1"></script>` right before
   `</head>`, and serves the result. You can verify the file on disk hasn't
   changed with `diff` against the original.
3. `public/bridge.js` runs after the front-end's scripts and **shadows** the
   following `window.*` functions with backend-aware versions:

   - `handleAuth` (athlete login/signup + OTP)
   - `handleCoachAuth` (coach login/signup + OTP)
   - `sendResetCode` / `confirmReset` (real email OTP)
   - `addAthlete` (persists to backend + syncs linked-coach binding)
   - `logout` (clears JWT + pushes final state to backend)

4. It also patches `localStorage.setItem` so any write to a syncable key
   (`fb_users`, `fb_theme`, `fb_lang`, `de_daily_plan`, `volta_coach_users`,
   `volta_coach_athletes`, `fb_coach_plans`) is mirrored to the backend's
   `/api/sync/:key` endpoint.
5. A 4-second polling loop calls `/api/sync/changes/since=<lastAt>` and applies
   any cross-device changes to localStorage, then re-renders the visible
   screen. That's the "auto sync" — same UX the original app had across
   browser tabs, but now across **devices**.

## API reference (short)

### Auth (athlete)
- `POST /api/auth/register` `{email, password}` → 202 `{status:'OTP_REQUIRED', devCode?}`
- `POST /api/auth/login` `{email, password}` → 202 `{status:'OTP_REQUIRED', devCode?}`
- `POST /api/auth/verify-otp` `{email, code, purpose}` → 200 `{token, user}`
- `POST /api/auth/resend-otp` `{email, purpose}`
- `POST /api/auth/forgot` `{email}` → 202 (always, for privacy)
- `POST /api/auth/reset-password` `{email, code, newPassword}`
- `GET  /api/auth/me` (Bearer token)

### Auth (coach)
Same shape, under `/api/coach/auth/*`.

### Coach ↔ Athlete linking
- `GET    /api/coach/athletes`
- `POST   /api/coach/athletes` `{name, sport, level, email, notes}`
- `PUT    /api/coach/athletes/:id`
- `DELETE /api/coach/athletes/:id`
- `GET    /api/coach/athletes/linked`
- `GET    /api/coach/linked-by/:email` (athlete token)
- `POST   /api/coach/linked-by` `{athleteEmail, coachEmail}` (athlete token)

### Meals (unlimited library)
- `GET    /api/meals?diet=&tag=&q=&limit=&offset=`
- `GET    /api/meals/:id`
- `POST   /api/meals` (coach; multipart with `image` file optional)
- `PUT    /api/meals/:id`
- `DELETE /api/meals/:id`
- `POST   /api/meals/:id/assign` `{athleteEmail}` (coach)
- `GET    /api/meals/athlete/:email` (athlete; assigned meals)
- `POST   /api/meals/log` `{name, kcal, p, c, f}` (athlete)
- `GET    /api/meals/log/list` (athlete)

### Workouts / Exercises / Plans
- `GET/POST/PUT/DELETE /api/workouts/exercises[/:id]`
- `GET/POST/PUT/DELETE /api/workouts[/:id]`
- `GET/POST/PUT/DELETE /api/workouts/plans[/:id]`
- `POST /api/workouts/sessions/log` `{sport, drill, date, durationMin, intensity, calories, sets, distanceKm, notes}`
- `GET  /api/workouts/sessions/log`
- `POST /api/workouts/upload` (multipart `image`) → `{url}`

### Sync (cross-device)
- `PUT    /api/sync/:key` `{value}` — write
- `GET    /api/sync/:key` — read one
- `GET    /api/sync` — read all keys for this account
- `GET    /api/sync/changes/since?since=<ISO>` — list changes since timestamp
- `DELETE /api/sync/:key`

Allowed keys: `profile, survey, sessions, reminders, inbody, goalPlan, dailyPlan, streak, lastDone, prefs, dailyExercisePlan, linkedCoach, coachProfile, coachPrefs, coachAthletes, coachPlans`.

## Testing

```bash
npm test
```

Runs `server/tests/smoke.js` — boots the server on an ephemeral port with a
temp DB, then exercises auth, meals, workouts, sync, and coach-athlete
linking end-to-end. No external dependencies required.

## Security notes

- Passwords are hashed with bcrypt (10 rounds).
- OTPs are 6-digit, single-use, expire after `OTP_TTL_MINUTES` (default 10).
- JWTs are signed with `JWT_SECRET` — change it in production.
- File uploads are restricted to images, max `MAX_UPLOAD_MB` per file.
- The `sync_state` table is scoped to the authenticated account — users
  cannot read or write another user's keys.

## Troubleshooting

**OTP not arriving** — Check the server console. In dev mode, the code is
printed there and also returned in the API response. The bridge.js `prompt()`
shows it inline. For real email, configure SMTP_* in `.env` and restart.

**"Unknown sync key" error** — The bridge only mirrors a whitelist of keys
(see `SYNCABLE_KEY_PATTERNS` in `bridge.js` and `SYNCABLE_KEYS` in
`routes/sync.js`). Add new keys to both lists if you extend the app.

**Port already in use** — Change `PORT` in `.env`.

**Database locked** — Make sure no other process is using `data/volta.db`.
The server uses WAL mode, so concurrent reads are fine but only one writer
at a time.
