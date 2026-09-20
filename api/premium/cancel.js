/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS Vercel serverless function (zero npm deps) */
/**
 * Volta Vercel API — POST /api/premium/cancel
 * ===========================================
 * Cancel (or resume) a subscription. HARD PRODUCT RULE: the paid period is
 * NEVER shortened — cancelling only sets cancelAtPeriodEnd and flips status
 * to "canceling"; the user keeps FULL access until the existing periodEnd.
 * Resuming flips back to "active" and clears the cancellation timestamp.
 * CommonJS mirror of the sandbox route src/app/api/premium/cancel/route.ts.
 *
 * Contract:
 *   POST { email, resume?: boolean }
 *     → 200 { ok:true, ...subToJson(sub) }   (+ warning?: string)
 *     → 400 { ok:false, error }              (bad/missing email)
 *     → 404 { ok:false, error:"No subscription found for this email" }
 *
 * When the doc is a Stripe subscription and STRIPE_SECRET_KEY is set, the
 * same cancel_at_period_end flag is pushed to Stripe (best-effort — a Stripe
 * failure still updates the local doc and adds a `warning` field).
 */

const store = require('../_store.js');
const pstore = require('../_premium-store.js');

const STRIPE_MS = 10000; // hard ceiling for the Stripe API call

// fetch-with-timeout so a stalled Stripe call can never hang the function
async function fetchT(url, opts, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, ms);
  try {
    return await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async (req, res) => {
  if (store.preflight(req, res)) return;

  if (req.method !== 'POST') {
    return store.sendJson(res, 405, { ok: false, error: 'POST only' });
  }

  const body = store.getBody(req);
  if (!body) {
    return store.sendJson(res, 400, { ok: false, error: 'JSON body required' });
  }

  const email = pstore.normalizeEmail(body.email);
  if (!email) {
    return store.sendJson(res, 400, { ok: false, error: 'A valid email is required' });
  }

  let sub = null;
  try {
    sub = await pstore.readSub(pstore.hashEmail(email));
  } catch (err) {
    if (pstore.isStorageDown(err)) {
      return store.sendJson(res, 502, { ok: false, error: 'storage unavailable' });
    }
    throw err;
  }
  if (!sub) {
    return store.sendJson(res, 404, { ok: false, error: 'No subscription found for this email' });
  }

  const resume = body.resume === true;
  const nowIso = new Date().toISOString();

  // Best-effort sync with Stripe (never blocks the local state change).
  let warning = null;
  if (sub.provider === 'stripe' && sub.stripeSubscriptionId && process.env.STRIPE_SECRET_KEY) {
    try {
      const r = await fetchT(
        'https://api.stripe.com/v1/subscriptions/' + encodeURIComponent(sub.stripeSubscriptionId),
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ cancel_at_period_end: resume ? 'false' : 'true' }).toString(),
        },
        STRIPE_MS
      );
      if (!r.ok) {
        // Log without ever echoing the Authorization header or key
        console.error('[premium/cancel] Stripe cancel_at_period_end sync failed:', r.status);
        warning = 'Local state updated, but the payment provider could not be synced — it may correct itself on the next webhook.';
      }
    } catch (err) {
      console.error('[premium/cancel] Stripe network failure:', (err && err.message) || String(err));
      warning = 'Local state updated, but the payment provider could not be reached — it may correct itself on the next webhook.';
    }
  }

  // periodEnd is intentionally NOT touched here (product rule).
  sub.cancelAtPeriodEnd = resume ? false : true;
  sub.status = resume ? 'active' : 'canceling';
  sub.canceledAt = resume ? null : nowIso;

  let saved;
  try {
    saved = await pstore.writeSub(pstore.hashEmail(email), sub);
  } catch (err) {
    return store.sendJson(res, 502, { ok: false, error: 'storage unavailable' });
  }
  if (!saved.ok) {
    return store.sendJson(res, 502, { ok: false, error: saved.error || 'storage unavailable' });
  }

  const out = { ok: true };
  if (warning) out.warning = warning;
  Object.assign(out, pstore.subToJson(sub));
  return store.sendJson(res, 200, out);
};

// Function execution ceiling (Stripe call capped at 10s)
module.exports.maxDuration = 30;
