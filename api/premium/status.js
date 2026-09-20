/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS Vercel serverless function (zero npm deps) */
/**
 * Volta Vercel API — GET/POST /api/premium/status
 * ===============================================
 * The single source of truth for "is this email premium right now?".
 * The browser caches the answer locally; this endpoint is what it caches.
 * CommonJS mirror of the sandbox route src/app/api/premium/status/route.ts.
 *
 * Contract:
 *   POST { email }   |   GET /api/premium/status?email=a@b.c
 *     → 200 { ok:true, found:false, premium:false }         (no row / no email)
 *     → 200 { ok:true, found:true, ...subToJson(sub) }
 *         ⇒ { found, email, premium, plan, status, currency, amount, country,
 *            provider, periodStart, periodEnd, cancelAtPeriodEnd, canceledAt,
 *            daysLeft, msLeft }
 *     → 500 { ok:false, error:"Could not load status" }     (storage failure)
 */

const store = require('../_store.js');
const pstore = require('../_premium-store.js');

async function statusResponse(res, emailRaw) {
  try {
    const email = pstore.normalizeEmail(emailRaw);
    if (!email) {
      // Consistent shape even for a missing email — frontend never crashes.
      return store.sendJson(res, 200, { ok: true, found: false, premium: false });
    }
    const sub = await pstore.readSub(pstore.hashEmail(email));
    if (!sub) return store.sendJson(res, 200, { ok: true, found: false, premium: false });
    return store.sendJson(res, 200, Object.assign({ ok: true, found: true }, pstore.subToJson(sub)));
  } catch (err) {
    return store.sendJson(res, 500, { ok: false, error: 'Could not load status' });
  }
}

module.exports = async (req, res) => {
  if (store.preflight(req, res)) return;

  if (req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    return statusResponse(res, url.searchParams.get('email'));
  }

  if (req.method === 'POST') {
    let body = {};
    try {
      const b = store.getBody(req);
      if (b && typeof b === 'object') body = b; // empty/invalid body is fine
    } catch (err) {
      body = {};
    }
    return statusResponse(res, body.email);
  }

  return store.sendJson(res, 405, { ok: false, error: 'GET or POST only' });
};

module.exports.maxDuration = 30;
