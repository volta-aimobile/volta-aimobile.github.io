/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS Vercel serverless function (zero npm deps) */
/**
 * Volta Vercel API — POST /api/premium/verify
 * ===========================================
 * Confirms a checkout and (up)serts the server-side source-of-truth
 * subscription document (KV). CommonJS mirror of the sandbox route
 * src/app/api/premium/verify/route.ts.
 *
 * Contract:
 *   POST { email, plan, sessionId?, timezone?, country? }
 *     → 200 { ok:true, email, premium, plan, status, currency, amount,
 *             country, provider, periodStart, periodEnd, cancelAtPeriodEnd,
 *             canceledAt, daysLeft, msLeft }            (subToJson shape)
 *     → 400 { ok:false, error }                          (bad input / missing sessionId)
 *     → 402 { ok:false, error:"Payment not completed" }  (session unpaid)
 *     → 502 { ok:false, error }                          (Stripe/storage failure)
 *   GET  → 405 { ok:false, error:"POST only" }
 *
 * Three paths:
 *   A. sessionId + STRIPE_SECRET_KEY  → GET the Stripe session; only
 *      payment_status==="paid" activates. Amount/currency come from Stripe.
 *   B. no STRIPE_SECRET_KEY (sandbox) → demo activation with resolved price.
 *   C. key set but no sessionId       → 400.
 */

const store = require('../_store.js');
const pricing = require('../_pricing.js');
const pstore = require('../_premium-store.js');

const STRIPE_MS = 10000; // hard ceiling for the Stripe API call

function isPremiumPlan(p) {
  return p === 'monthly' || p === 'yearly';
}

function strOrNull(v) {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

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

/** Vercel geo country header (Node header names are lowercase). */
function geoCountry(req) {
  const v = req.headers['x-vercel-ip-country'];
  return typeof v === 'string' && v ? v : null;
}

/** Write the (up)surted doc; storage failure → clean 502 JSON, never a hang. */
async function saveSub(email, sub) {
  const r = await pstore.writeSub(pstore.hashEmail(email), sub);
  if (!r.ok) throw new Error('storage unavailable');
  return sub;
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
  if (!email || !pstore.isValidEmail(email)) {
    return store.sendJson(res, 400, { ok: false, error: 'A valid email is required' });
  }

  const geo = geoCountry(req);
  // Geo order: Vercel header → explicit country → timezone. Composed via
  // priceForCountry directly (resolvePrice's || chain cannot fall through
  // — see price route).
  const price = pricing.priceForCountry(
    geo || body.country || pricing.countryFromTimezone(body.timezone) || ''
  );
  const stripeKey = process.env.STRIPE_SECRET_KEY || '';
  const sessionId = strOrNull(body.sessionId);

  // ── Path A: real Stripe verification ────────────────────────────────────
  if (sessionId && stripeKey) {
    if (!isPremiumPlan(body.plan)) {
      return store.sendJson(res, 400, { ok: false, error: 'Invalid plan — must be "monthly" or "yearly"' });
    }
    const plan = body.plan;
    try {
      const r = await fetchT(
        'https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(sessionId),
        { method: 'GET', headers: { Authorization: 'Bearer ' + stripeKey } },
        STRIPE_MS
      );
      const session = await r.json().catch(function () { return {}; });
      if (!r.ok) {
        console.error(
          '[premium/verify] Stripe session lookup failed:',
          r.status,
          (session && session.error && session.error.message) || 'unknown error'
        );
        return store.sendJson(res, 502, { ok: false, error: 'Could not verify the payment. Try again shortly.' });
      }
      if (session.payment_status !== 'paid') {
        return store.sendJson(res, 402, { ok: false, error: 'Payment not completed' });
      }
      const nowIso = new Date().toISOString();
      let sub = null;
      try { sub = await pstore.readSub(pstore.hashEmail(email)); } catch (err) { sub = null; }
      const doc = sub && typeof sub === 'object' ? sub : { email: email, createdAt: nowIso };
      doc.email = email;
      doc.plan = plan;
      doc.status = 'active';
      doc.provider = 'stripe';
      doc.currency = String(session.currency || price.currency || 'USD').toUpperCase();
      doc.amount = typeof session.amount_total === 'number'
        ? session.amount_total
        : (plan === 'monthly' ? price.monthly : price.yearly);
      doc.country = price.country || '';
      doc.stripeCustomerId = strOrNull(session.customer);
      doc.stripeSubscriptionId = strOrNull(session.subscription);
      doc.stripeSessionId = strOrNull(session.id) || sessionId;
      doc.periodStart = nowIso;
      doc.periodEnd = pstore.addPeriod(plan, nowIso);
      doc.cancelAtPeriodEnd = false;
      doc.canceledAt = null;
      try {
        await saveSub(email, doc);
      } catch (err) {
        return store.sendJson(res, 502, { ok: false, error: 'storage unavailable' });
      }
      return store.sendJson(res, 200, Object.assign({ ok: true }, pstore.subToJson(doc)));
    } catch (err) {
      console.error('[premium/verify] Stripe network failure:', (err && err.message) || String(err));
      return store.sendJson(res, 502, { ok: false, error: 'Could not reach the payment provider. Try again shortly.' });
    }
  }

  // ── Path B: sandbox demo verification (no Stripe key) ───────────────────
  if (!stripeKey) {
    if (!isPremiumPlan(body.plan)) {
      return store.sendJson(res, 400, { ok: false, error: 'Invalid plan — must be "monthly" or "yearly"' });
    }
    const plan = body.plan;
    console.warn('[premium/verify] DEMO verification ran for ' + email + ' (plan=' + plan + ') — no STRIPE_SECRET_KEY configured');
    const nowIso = new Date().toISOString();
    let sub = null;
    try { sub = await pstore.readSub(pstore.hashEmail(email)); } catch (err) { sub = null; }
    const doc = sub && typeof sub === 'object' ? sub : { email: email, createdAt: nowIso };
    doc.email = email;
    doc.plan = plan;
    doc.status = 'active';
    doc.provider = 'demo';
    doc.currency = price.currency;
    doc.amount = plan === 'monthly' ? price.monthly : price.yearly;
    doc.country = price.country || '';
    doc.stripeCustomerId = null;
    doc.stripeSubscriptionId = null;
    doc.stripeSessionId = null;
    doc.periodStart = nowIso;
    doc.periodEnd = pstore.addPeriod(plan, nowIso);
    doc.cancelAtPeriodEnd = false;
    doc.canceledAt = null;
    try {
      await saveSub(email, doc);
    } catch (err) {
      return store.sendJson(res, 502, { ok: false, error: 'storage unavailable' });
    }
    return store.sendJson(res, 200, Object.assign({ ok: true }, pstore.subToJson(doc)));
  }

  // ── Path C: Stripe configured but no session to verify ──────────────────
  return store.sendJson(res, 400, { ok: false, error: 'sessionId required' });
};

// Function execution ceiling (Stripe call capped at 10s)
module.exports.maxDuration = 30;
