/**
 * VOLTA — full local backend + static server (zero dependencies)
 * ════════════════════════════════════════════════════════════════════
 * This file is IDENTICAL in the mobile and the PC folder — both come
 * with the full backend.
 *
 * Run:            node server.js        (then open http://localhost:8080)
 * Windows:        double-click START.bat
 * Mac / Linux:    bash START.sh
 *
 * WHAT THIS DOES
 * ──────────────
 *  1. Serves the whole VOLTA app (index.html, css/, js/, img/part1..3/,
 *     vendor/…) as static files.
 *  2. Mounts the COMPLETE backend — every file in api/ — at /api/*,
 *     exactly like the Vercel deployment:
 *        /api/sync-user       /api/sync-diet       /api/analyze-meal
 *        /api/health          /api/db-admin        /api/create-premium-checkout
 *        /api/ai/weekly-report
 *        /api/premium/{price,status,verify,checkout,cancel,webhook,google-verify}
 *     The functions are the SAME Vercel-style handlers (async (req,res)),
 *     so behaviour is identical locally and deployed.
 *  3. "/" opens the right entry page for whichever folder this is:
 *       • PC folder (has pc.html, no index.html) → the phone-frame preview
 *         (embedded below — a 412px phone viewport with the app inside,
 *         looking EXACTLY like the mobile app), so you can test on your PC.
 *         "/pc.html" (or the ⛶ button) opens the app full-window.
 *       • Mobile folder (has index.html) → the app itself.
 *     v34: the two shipped folders now carry exactly ONE html file each —
 *     pc.html only in the PC folder, index.html only in the mobile folder —
 *     so the phone-frame preview is generated right here by the server.
 *
 * OPTIONAL ENVIRONMENT VARIABLES (all have zero-config fallbacks):
 *   KV_REST_API_URL / KV_REST_API_TOKEN            — Vercel KV / Upstash
 *   UPSTASH_REDIS_REST_URL / …_TOKEN               — (same, marketplace names)
 *   GEMINI_API_KEY / OPENAI_API_KEY                — cloud AI endpoints
 *   PORT                                            — default 8080
 * Without them: storage falls back to textdb.dev and AI features fall
 * back to the on-device engines (same as the deployed app).
 * ════════════════════════════════════════════════════════════════════
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = process.env.PORT || 8080;

// Which html shell does THIS folder carry? (v34: exactly one)
const HAS_PC = fs.existsSync(path.join(ROOT, 'pc.html'));
const HAS_INDEX = fs.existsSync(path.join(ROOT, 'index.html'));

function sendHtml(req, res, body) {
  const buf = Buffer.from(body, 'utf8');
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': 'no-cache'
  });
  if (req.method === 'HEAD') { res.end(); return; }
  res.end(buf);
}

// ─── static file plumbing ───────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json'
};

function sendFile(req, res, filePath) {
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) { send404(req, res); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache'   // local dev: always fresh
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(filePath).pipe(res);
  });
}

function send404(req, res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 — Not Found: ' + req.url);
}

// Buffer a request body (POST/PUT/PATCH) into req.body as a RAW STRING —
// the form every api handler understands (see comment at the router).
const BODY_LIMIT = 4 * 1024 * 1024;   // 4MB — room for big diet/user docs
function withRawBody(req, next) {
  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > BODY_LIMIT) {
      req.destroy();
      next(new Error('too large'));
      return;
    }
    chunks.push(c);
  });
  req.on('end', () => {
    req.body = Buffer.concat(chunks).toString('utf8');
    next(null);
  });
  req.on('error', () => next(new Error('read error')));
}

// ─── v34: the phone-frame preview page (embedded, no file on disk) ───────
// Previously a separate pc.html; now the server generates it on the fly.
// It renders the app shell (pc.html) inside a 412px phone viewport, so every
// mobile media query, the bottom nav and the touch layout apply — the app
// looks exactly like it does on a real phone.
const PHONE_FRAME_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>VOLTA — PC preview (mobile view)</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --accent: #6495ED;
    --accent-dark: #4a7bd9;
    --ink: #1a2233;
    --muted: #55627e;
    --line: #dce5f2;
  }
  html, body { height: 100%; }
  body {
    font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    background:
      radial-gradient(1200px 600px at 85% -10%, rgba(100,149,237,.14), transparent 60%),
      radial-gradient(900px 500px at -10% 110%, rgba(100,149,237,.10), transparent 55%),
      #f5f8fd;
    color: var(--ink);
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  .bar {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 18px;
    background: #fff;
    border-bottom: 1px solid var(--line);
    flex-shrink: 0;
  }
  .bar .logo {
    width: 30px; height: 30px; border-radius: 9px;
    background: linear-gradient(135deg, var(--accent), var(--accent-dark));
    color: #fff; font-weight: 800; font-size: 17px;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 4px 10px rgba(74,123,217,.35);
  }
  .bar b { font-size: .95rem; letter-spacing: .02em; }
  .bar small { color: var(--muted); font-size: .74rem; margin-top: 1px; }
  .bar .grow { flex: 1; }
  .bar button {
    border: 1px solid var(--line); background: #fff; color: var(--ink);
    font: 600 .78rem/1 inherit; padding: 9px 14px; border-radius: 10px;
    cursor: pointer; display: inline-flex; align-items: center; gap: 7px;
    transition: background .15s, border-color .15s, color .15s;
  }
  .bar button:hover { background: #eaf1fd; border-color: var(--accent); color: var(--accent-dark); }
  .bar button.primary {
    background: linear-gradient(135deg, var(--accent), var(--accent-dark));
    border-color: transparent; color: #fff;
    box-shadow: 0 4px 12px rgba(74,123,217,.35);
  }
  .bar button.primary:hover { filter: brightness(1.05); }
  .stage {
    flex: 1; display: flex; align-items: center; justify-content: center;
    padding: 18px; min-height: 0;
  }
  .phone {
    position: relative;
    width: min(440px, 100%);
    height: min(920px, 100%);
    border-radius: 44px;
    background: linear-gradient(160deg, #1a2233, #2a3a55);
    padding: 13px;
    box-shadow:
      0 30px 70px rgba(26,34,51,.35),
      0 6px 18px rgba(26,34,51,.22),
      inset 0 0 0 2px rgba(255,255,255,.06);
  }
  .phone::before {
    content: '';
    position: absolute; top: 15px; left: 50%; transform: translateX(-50%);
    width: 86px; height: 6px; border-radius: 999px;
    background: rgba(0,0,0,.45);
    z-index: 2;
  }
  .screen {
    width: 100%; height: 100%;
    border-radius: 32px; overflow: hidden; background: #f5f8fd;
    display: flex; flex-direction: column;
  }
  .screen iframe {
    flex: 1; width: 100%; border: 0; background: #f5f8fd;
    display: block;
  }
  .hint {
    position: absolute; left: 0; right: 0; bottom: -34px;
    text-align: center; color: var(--muted); font-size: .74rem;
  }
  @media (max-height: 780px) {
    .phone { border-radius: 36px; padding: 10px; }
    .screen { border-radius: 27px; }
  }
  @media (max-width: 520px) {
    .bar small { display: none; }
    .stage { padding: 8px; }
    .phone { border-radius: 28px; padding: 7px; }
    .screen { border-radius: 22px; }
    .phone::before { display: none; }
    .hint { display: none; }
  }
</style>
</head>
<body>
  <div class="bar">
    <div class="logo">V</div>
    <div>
      <b>VOLTA — PC preview</b><br>
      <small>the exact mobile app, on your PC &middot; full backend at /api/*</small>
    </div>
    <div class="grow"></div>
    <button id="btn-full" title="Open the app in a full browser tab">\u26F6 Full window</button>
    <button id="btn-reload" title="Reload the app">\u27F3 Reload</button>
    <button class="primary" id="btn-reset" title="Clear this browser's VOLTA data (fresh first-run)">\u27F2 Reset app data</button>
  </div>

  <div class="stage">
    <div class="phone">
      <div class="screen">
        <iframe id="app" src="pc.html" title="VOLTA app"
                allow="camera; microphone; autoplay; fullscreen; clipboard-read; clipboard-write"></iframe>
      </div>
      <div class="hint">412px mobile viewport — every mobile layout rule applies</div>
    </div>
  </div>

<script>
(function () {
  var frame = document.getElementById('app');

  document.getElementById('btn-reload').onclick = function () {
    frame.src = 'pc.html';
  };

  document.getElementById('btn-full').onclick = function () {
    window.open('pc.html', '_blank');
  };

  document.getElementById('btn-reset').onclick = function () {
    if (!confirm('Clear all VOLTA data stored in THIS browser?\n(accounts, plans, streaks — the server/cloud copies are NOT touched)')) return;
    try {
      Object.keys(localStorage).forEach(function (k) {
        if (/^(fb_|volta|surveys_done|surveys_|ai_cam|sounds|preferred)/i.test(k) || k === 'session') {
          localStorage.removeItem(k);
        }
      });
      localStorage.clear(); // be thorough — this preview browser is dedicated
    } catch (e) {}
    frame.src = 'pc.html';
  };
})();
</script>
</body>
</html>
`;

// ─── /api/* → Vercel-style handlers in ./api/ ────────────────────────────
function resolveApiHandler(pathname) {
  // "/api/sync-user"        → ./api/sync-user.js
  // "/api/ai/weekly-report" → ./api/ai/weekly-report.js
  // underscore files (_store.js, _ai.js, _premium-store.js…) are private —
  // never routable. Path traversal is blocked by the prefix + normalize.
  if (pathname.slice(-1) === '/') pathname = pathname.slice(0, -1);
  const rel = pathname.replace(/^\/+/, '');                       // "api/sync-user"
  if (!/^api\/[a-z0-9\-\/]+$/i.test(rel)) return null;
  const base = path.normalize(path.join(ROOT, rel));
  if (!base.startsWith(path.join(ROOT, 'api'))) return null;
  const file = base + '.js';
  const leaf = path.basename(file, '.js');
  if (leaf.charAt(0) === '_') return null;                          // private module
  if (!fs.existsSync(file)) return null;
  // fresh require each request → edit an api file, no restart needed
  delete require.cache[require.resolve(file)];
  try {
    const h = require(file);
    if (typeof h === 'function') return h;
  } catch (e) {
    console.error('[api] failed to load', rel, e.message);
  }
  return null;
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(u.pathname);

  // ── API ──
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    const handler = resolveApiHandler(pathname);
    if (!handler) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'no such endpoint' }));
      return;
    }
    // Vercel pre-parses JSON bodies into req.body. Locally we emulate the
    // MOST compatible form: the RAW body string (every handler accepts it —
    // _store.getBody / readJsonBody JSON.parse it, webhook signs it).
    withRawBody(req, function (err) {
      if (err) {
        res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'body too large' }));
        return;
      }
      Promise.resolve()
        .then(() => handler(req, res))
        .catch((e) => {
          console.error('[api] handler error:', pathname, e);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: false, error: 'internal error' }));
          }
        });
    });
    return;
  }

  // ── routes ──
  // v34 layout: ONE html file per folder —
  //   • PC folder:     pc.html   (the app shell; preview frame is virtual)
  //   • Mobile folder: index.html (the app shell)
  // "/" serves the right one for whichever folder we're running from.
  if (pathname === '/' || pathname === '/pc' || pathname === '/pc.html' || pathname === '/index.html') {
    if (pathname === '/pc.html' && HAS_PC) {
      // the app shell itself — full-window mode (⛶ button / direct URL)
      sendFile(req, res, path.join(ROOT, 'pc.html'));
    } else if (HAS_PC) {
      // PC folder root: the embedded phone-frame preview
      sendHtml(req, res, PHONE_FRAME_HTML);
    } else if (HAS_INDEX) {
      // Mobile folder root: the app
      sendFile(req, res, path.join(ROOT, 'index.html'));
    } else {
      send404(req, res);
    }
    return;
  }

  // ── static (traversal-safe) ──
  const target = path.normalize(path.join(ROOT, pathname));
  if (!target.startsWith(ROOT)) { send404(req, res); return; }
  fs.stat(target, (err, st) => {
    if (err) { send404(req, res); return; }
    if (st.isDirectory()) {
      const idx = path.join(target, 'index.html');
      fs.exists(idx, (has) => has ? sendFile(req, res, idx) : send404(req, res));
      return;
    }
    sendFile(req, res, target);
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ⚡ VOLTA — full backend running');
  console.log('  ─────────────────────────────────────');
  if (HAS_PC) {
    console.log('  Phone-frame preview (looks like mobile):  http://localhost:' + PORT + '/');
    console.log('  Full-window app:                         http://localhost:' + PORT + '/pc.html');
  } else {
    console.log('  The app (mobile build):                  http://localhost:' + PORT + '/');
    console.log('  Full-window view:                        http://localhost:' + PORT + '/index.html');
  }
  console.log('  Backend health check:                    http://localhost:' + PORT + '/api/health');
  console.log('');
  console.log('  Press Ctrl+C to stop.');
});
