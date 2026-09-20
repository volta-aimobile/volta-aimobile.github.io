/**
 * Volta Vercel API — POST /api/create-premium-checkout
 * =====================================================
 * Backend for the Premium "Subscribe" flow (js/premium.js → tryStripeCheckout).
 *
 * Contract (identical to the Next.js sandbox route):
 *   POST { plan:"monthly"|"yearly", userEmail? }
 *     → 200 { ok:true, url, mode:"stripe"|"demo", message? }
 *       The frontend redirects to `url`. When Stripe is used, Stripe itself
 *       sends the user back to success_url — which is the app's own
 *       /?payment=success&type=premium&plan=… so handlePaymentRedirect()
 *       in js/volta.js activates Premium exactly as in demo mode.
 *     → 400 { ok:false, error:"JSON body required" | "Invalid plan …" }
 *     → 502 { ok:false, error:"Stripe error: …" }
 *     → 504 { ok:false, error:"Payment provider timeout …" }
 *
 * STRIPE (optional, zero-config otherwise)
 * ----------------------------------------
 * Set ONE env var in Vercel → Settings → Environment Variables:
 *     STRIPE_SECRET_KEY = sk_live_…  (or sk_test_… for testing)
 * then redeploy. The endpoint automatically switches from demo mode to a
 * REAL Stripe Checkout Session (mode=subscription, USD). Without the key
 * the endpoint stays in graceful demo mode: it returns the app's own
 * success redirect so the whole subscribe flow keeps working end-to-end.
 */

const store = require('./_store.js');

const PLANS = {
  monthly: { name: 'Volta Premium — Monthly',  unitAmount: 499  },  // $4.99 / month
  yearly:  { name: 'Volta Premium — Yearly',   unitAmount: 3999 }   // $39.99 / year
};

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

// Derive the public origin of THIS deployment from Vercel's proxy headers.
function requestOrigin(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || 'volta-aimobile-github-io.vercel.app').split(',')[0].trim();
  return proto + '://' + host;
}

// ─── Real Stripe Checkout Session (REST, no SDK dependency) ─────────────
async function createStripeSession(secretKey, plan, userEmail, origin) {
  const p = PLANS[plan];
  const successUrl = origin + '/?payment=success&type=premium&plan=' + plan + '&session_id={CHECKOUT_SESSION_ID}';
  const cancelUrl = origin + '/';

  const params = new URLSearchParams();
  params.set('mode', 'subscription');
  params.set('success_url', successUrl);
  params.set('cancel_url', cancelUrl);
  params.set('line_items[0][quantity]', '1');
  params.set('line_items[0][price_data][currency]', 'usd');
  params.set('line_items[0][price_data][unit_amount]', String(p.unitAmount));
  params.set('line_items[0][price_data][recurring][interval]', plan === 'yearly' ? 'year' : 'month');
  params.set('line_items[0][price_data][product_data][name]', p.name);
  if (userEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) {
    params.set('customer_email', userEmail);
  }

  const r = await fetchT('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + secretKey,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  }, STRIPE_MS);

  const j = await r.json().catch(function () { return null; });
  if (!r.ok) {
    if (r.status === 429 || r.status >= 500) throw new Error('Stripe busy — please try again in a moment');
    const msg = (j && j.error && j.error.message) || ('Stripe HTTP ' + r.status);
    throw new Error(msg);
  }
  if (!j || !j.url) throw new Error('Stripe returned no checkout URL');
  return j.url;
}

module.exports = async (req, res) => {
  if (store.preflight(req, res)) return;

  if (req.method !== 'POST') {
    return store.sendJson(res, 405, { ok: false, error: 'POST only' });
  }

  const body = store.getBody(req);
  const plan = ((body && body.plan) || '').toLowerCase();
  const userEmail = (body && typeof body.userEmail === 'string') ? body.userEmail : '';

  if (!PLANS[plan]) {
    return store.sendJson(res, 400, { ok: false, error: 'Invalid plan — must be "monthly" or "yearly"' });
  }

  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_KEY || '';

  if (STRIPE_KEY) {
    try {
      const url = await createStripeSession(STRIPE_KEY, plan, userEmail, requestOrigin(req));
      return store.sendJson(res, 200, { ok: true, url: url, mode: 'stripe', plan: plan });
    } catch (err) {
      const timedOut = err && err.name === 'AbortError';
      return store.sendJson(res, timedOut ? 504 : 502, {
        ok: false,
        error: timedOut
          ? 'Payment provider timeout — please try again'
          : 'Stripe error: ' + ((err && err.message) || 'unknown')
      });
    }
  }

  // ─── Demo mode (no STRIPE_SECRET_KEY) ─────────────────────────────────
  // Same response shape as the sandbox: return the app's own success
  // redirect so the subscribe flow works end-to-end without Stripe.
  const origin = requestOrigin(req);
  return store.sendJson(res, 200, {
    ok: true,
    url: origin + '/?payment=success&type=premium&plan=' + plan,
    mode: 'demo',
    demo: true,
    plan: plan,
    message: 'Demo checkout — STRIPE_SECRET_KEY is not set in your Vercel environment variables. ' +
             'Premium is activated by the redirect without a real charge. Add STRIPE_SECRET_KEY (sk_test_… or sk_live_…) and redeploy to enable real payments.'
  });
};

// Function execution ceiling (Stripe call capped at 10s)
module.exports.maxDuration = 30;
