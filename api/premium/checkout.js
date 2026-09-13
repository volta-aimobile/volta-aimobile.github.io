/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS Vercel serverless function (zero npm deps) */
/**
 * Volta Vercel API — POST /api/premium/checkout
 * =============================================
 * Creates a Stripe Checkout Session (mode=subscription) when STRIPE_SECRET_KEY
 * is configured AND the local currency is Stripe-supported; otherwise returns
 * the app's own demo success redirect so the sandbox/PWA flow still works.
 * CommonJS mirror of the sandbox route src/app/api/premium/checkout/route.ts.
 *
 * Contract:
 *   POST { plan: "monthly"|"yearly", email, timezone? }
 *     → 200 { ok:true, mode:"stripe", url: "<stripe checkout url>" }
 *     → 200 { ok:true, mode:"demo", url:"<origin>/?payment=success&…&demo=1",
 *             demo:true, message:"Demo checkout — set STRIPE_SECRET_KEY to enable real payments." }
 *     → 400 { ok:false, error }        (bad body / plan / email)
 *     → 502 { ok:false, error }        (Stripe call failed)
 *   GET  → 405 { ok:false, error:"POST only" }
 * The frontend redirects the browser to `url`, then calls /api/premium/verify.
 */

const store = require('../_store.js');
const pricing = require('../_pricing.js');
const pstore = require('../_premium-store.js');

const PLAN_NAMES = {
  monthly: 'Volta Premium — Monthly',
  yearly: 'Volta Premium — Yearly',
};

const STRIPE_MS = 10000; // hard ceiling for the Stripe API call

function isPremiumPlan(p) {
  return p === 'monthly' || p === 'yearly';
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

// Derive the public origin of THIS deployment from Vercel's proxy headers.
function requestOrigin(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim() || 'https';
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return proto + '://' + (host || 'volta-aimobile-github-io.vercel.app');
}

/** Vercel geo country header (Node header names are lowercase). */
function geoCountry(req) {
  const v = req.headers['x-vercel-ip-country'];
  return typeof v === 'string' && v ? v : null;
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

  const plan = body.plan;
  if (!isPremiumPlan(plan)) {
    return store.sendJson(res, 400, { ok: false, error: 'Invalid plan — must be "monthly" or "yearly"' });
  }
  const email = pstore.normalizeEmail(body.email);
  if (!email || !pstore.isValidEmail(email)) {
    return store.sendJson(res, 400, { ok: false, error: 'A valid email is required' });
  }

  const origin = requestOrigin(req);
  // Geo order: Vercel header → timezone. Composed via priceForCountry
  // directly (resolvePrice's || chain cannot fall through — see price route).
  const geo = geoCountry(req);
  const price = pricing.priceForCountry(
    geo || pricing.countryFromTimezone(body.timezone) || ''
  );
  const currency = price.currency;
  const unitAmount = plan === 'monthly' ? price.monthly : price.yearly;
  const interval = plan === 'monthly' ? 'month' : 'year';
  const stripeKey = process.env.STRIPE_SECRET_KEY || '';

  // ── Real Stripe Checkout ────────────────────────────────────────────────
  if (stripeKey && pricing.stripeSupportsCurrency(currency)) {
    try {
      const params = new URLSearchParams();
      params.set('mode', 'subscription');
      params.set('line_items[0][quantity]', '1');
      params.set('line_items[0][price_data][currency]', currency.toLowerCase());
      params.set('line_items[0][price_data][unit_amount]', String(unitAmount));
      params.set('line_items[0][price_data][recurring][interval]', interval);
      params.set('line_items[0][price_data][product_data][name]', PLAN_NAMES[plan]);
      params.set('client_reference_id', email);
      params.set('customer_email', email);
      params.set('success_url', origin + '/?payment=success&type=premium&plan=' + plan + '&session_id={CHECKOUT_SESSION_ID}');
      params.set('cancel_url', origin + '/?payment=cancel');
      params.set('metadata[plan]', plan);
      params.set('metadata[email]', email);
      params.set('subscription_data[metadata][plan]', plan);
      params.set('subscription_data[metadata][email]', email);

      const r = await fetchT('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + stripeKey,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      }, STRIPE_MS);

      const session = await r.json().catch(function () { return {}; });
      if (r.ok && session && session.url) {
        return store.sendJson(res, 200, { ok: true, mode: 'stripe', url: session.url });
      }
      // Stripe rejected the request — log details server-side (never the key)
      console.error(
        '[premium/checkout] Stripe error',
        r.status,
        (session && session.error && session.error.message) || JSON.stringify(session).slice(0, 500)
      );
      return store.sendJson(res, 502, {
        ok: false,
        error: 'Payment provider rejected the request. Please try again or use a different payment method.',
      });
    } catch (err) {
      console.error('[premium/checkout] Stripe network failure:', (err && err.message) || String(err));
      return store.sendJson(res, 502, {
        ok: false,
        error: 'Could not reach the payment provider. Try again shortly.',
      });
    }
  }

  // ── Sandbox / unsupported-currency demo flow ────────────────────────────
  return store.sendJson(res, 200, {
    ok: true,
    mode: 'demo',
    url: origin + '/?payment=success&type=premium&plan=' + plan + '&demo=1',
    demo: true,
    message: 'Demo checkout — set STRIPE_SECRET_KEY to enable real payments.',
  });
};

// Function execution ceiling (Stripe call capped at 10s)
module.exports.maxDuration = 30;
