/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS Vercel serverless function (zero npm deps) */
/**
 * Volta Vercel API — POST /api/premium/google-verify
 * ==================================================
 * Google Play Billing server-side verification (PWA packaged via PWABuilder
 * / Digital Goods API). Implements the full JWT (RS256) service-account
 * flow with node:crypto — no external SDK.
 * CommonJS mirror of the sandbox route src/app/api/premium/google-verify/route.ts.
 *
 * Contract:
 *   POST { email, purchaseToken, productId, orderId? }
 *     → 200 { ok:true, ...subToJson(sub) }   (purchase valid)
 *     → 400 { ok:false, error }              (bad input)
 *     → 402 { ok:false, error }              (cancelled/expired/unpaid)
 *     → 501 { ok:false, error, setup }       (env not configured)
 *     → 502 { ok:false, error }              (Google API failure)
 * Env:
 *   GOOGLE_PLAY_SERVICE_ACCOUNT_JSON  — service-account JSON (raw or base64)
 *   GOOGLE_PLAY_PACKAGE_NAME          — e.g. com.volta.fitness
 * Product IDs: volta_premium_monthly / volta_premium_yearly
 */

const crypto = require('crypto');
const store = require('../_store.js');
const pricing = require('../_pricing.js');
const pstore = require('../_premium-store.js');

const GOOGLE_MS = 15000; // hard ceiling per Google API call

const SETUP_STEPS =
  'Setup: (1) create a service account in Google Cloud Console and enable the ' +
  'Google Play Android Developer API; (2) in Play Console → Users & permissions, ' +
  'invite that service account with \'View financial data\' + \'Manage orders\'; ' +
  '(3) set GOOGLE_PLAY_SERVICE_ACCOUNT_JSON (the service-account JSON, raw or ' +
  'base64) and GOOGLE_PLAY_PACKAGE_NAME environment variables; (4) create ' +
  'subscription products in Play Console with the IDs volta_premium_monthly ' +
  'and volta_premium_yearly.';

// ── base64url helpers ──────────────────────────────────────────────────────
function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Parse the env value — accepts raw JSON or base64-encoded JSON. */
function loadServiceAccount() {
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const text = raw.trimStart().indexOf('{') === 0
      ? raw
      : Buffer.from(raw, 'base64').toString('utf8');
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.client_email === 'string' && typeof parsed.private_key === 'string') {
      return { client_email: parsed.client_email, private_key: parsed.private_key };
    }
    return null;
  } catch (err) {
    return null;
  }
}

/** Build + sign a JWT (RS256) for the Google token endpoint. */
function makeJwt(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(header + '.' + claims);
  const signature = b64url(signer.sign(sa.private_key));
  return header + '.' + claims + '.' + signature;
}

/** Exchange the JWT for a short-lived access token. */
async function getAccessToken(sa) {
  const r = await fetchT('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: makeJwt(sa),
    }).toString(),
  }, GOOGLE_MS);
  const data = await r.json().catch(function () { return {}; });
  if (!r.ok || !data.access_token) {
    throw new Error('token endpoint error ' + r.status + ': ' + (data.error_description || 'unknown'));
  }
  return data.access_token;
}

/** Map a Play product id to a Volta plan. */
function planFromProductId(productId) {
  const id = String(productId || '').toLowerCase();
  if (id.indexOf('year') !== -1 || id.indexOf('annual') !== -1) return 'yearly';
  return 'monthly';
}

// fetch-with-timeout so a stalled Google call can never hang the function
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

module.exports = async (req, res) => {
  if (store.preflight(req, res)) return;

  if (req.method !== 'POST') {
    return store.sendJson(res, 405, { ok: false, error: 'POST only' });
  }

  // ── 0. Configuration gate ────────────────────────────────────────────────
  const sa = loadServiceAccount();
  const packageName = process.env.GOOGLE_PLAY_PACKAGE_NAME || '';
  if (!sa || !packageName) {
    return store.sendJson(res, 501, {
      ok: false,
      error: 'Google Play verification not configured — set GOOGLE_PLAY_SERVICE_ACCOUNT_JSON and GOOGLE_PLAY_PACKAGE_NAME',
      setup: SETUP_STEPS,
    });
  }

  // ── 1. Input validation ──────────────────────────────────────────────────
  const body = store.getBody(req);
  if (!body) {
    return store.sendJson(res, 400, { ok: false, error: 'JSON body required' });
  }
  const email = pstore.normalizeEmail(body.email);
  const purchaseToken = String(body.purchaseToken || '').trim();
  const productId = String(body.productId || '').trim();
  if (!email || !pstore.isValidEmail(email)) {
    return store.sendJson(res, 400, { ok: false, error: 'A valid email is required' });
  }
  if (!purchaseToken || !productId) {
    return store.sendJson(res, 400, { ok: false, error: 'purchaseToken and productId are required' });
  }
  const plan = planFromProductId(productId);

  try {
    // ── 2. Auth → 3. Query the Play Developer API ────────────────────────
    const accessToken = await getAccessToken(sa);
    const url =
      'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/' +
      encodeURIComponent(packageName) +
      '/purchases/subscriptions/' +
      encodeURIComponent(productId) +
      '/tokens/' +
      encodeURIComponent(purchaseToken);
    const r = await fetchT(url, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + accessToken },
    }, GOOGLE_MS);
    const purchase = await r.json().catch(function () { return {}; });
    if (!r.ok) {
      console.error(
        '[premium/google-verify] Play API error:',
        r.status,
        (purchase && purchase.error && purchase.error.message) || 'unknown'
      );
      return store.sendJson(res, 502, { ok: false, error: 'Could not verify the purchase with Google Play.' });
    }

    // ── 4. Validate the purchase state ───────────────────────────────────
    // paymentState 1 = received. Absent/0/2/3 → not an active paid sub.
    const cancelled = purchase.cancelled === true;
    const expiryMs = Number(purchase.expiryTimeMillis || 0);
    if (Number(purchase.paymentState) !== 1 || cancelled) {
      return store.sendJson(res, 402, { ok: false, error: 'Purchase is cancelled, unpaid or not active' });
    }
    if (!expiryMs || expiryMs <= Date.now()) {
      return store.sendJson(res, 402, { ok: false, error: 'Purchase has expired' });
    }

    // ── 5. Upsert the source-of-truth doc ────────────────────────────────
    // Google's price (if present) wins; otherwise the resolved regional
    // default for this visitor is kept.
    const price = pricing.priceForCountry(
      geoCountry(req) || purchase.countryCode || ''
    );
    const micros = Number(purchase.priceAmountMicros || 0);
    const currency =
      typeof purchase.priceCurrencyCode === 'string' && purchase.priceCurrencyCode.length === 3
        ? purchase.priceCurrencyCode.toUpperCase()
        : price.currency;
    const amount = micros > 0
      ? Math.round(micros / 10000) // micros (1e-6) → minor units (1e-2)
      : (plan === 'monthly' ? price.monthly : price.yearly);
    const nowIso = new Date().toISOString();
    let existing = null;
    try { existing = await pstore.readSub(pstore.hashEmail(email)); } catch (err) { existing = null; }
    const doc = existing && typeof existing === 'object' ? existing : { email: email, createdAt: nowIso };
    doc.email = email;
    doc.plan = plan;
    doc.status = 'active';
    doc.provider = 'google_play';
    doc.currency = currency;
    doc.amount = amount;
    doc.country = price.country || '';
    doc.stripeCustomerId = null;
    doc.stripeSubscriptionId = null;
    doc.stripeSessionId = null;
    doc.periodStart = nowIso;
    doc.periodEnd = new Date(expiryMs).toISOString();
    doc.cancelAtPeriodEnd = false;
    doc.canceledAt = null;
    const saved = await pstore.writeSub(pstore.hashEmail(email), doc);
    if (!saved.ok) {
      return store.sendJson(res, 502, { ok: false, error: 'storage unavailable' });
    }
    return store.sendJson(res, 200, Object.assign({ ok: true }, pstore.subToJson(doc)));
  } catch (err) {
    // This endpoint must NEVER crash the server.
    console.error('[premium/google-verify] unexpected failure:', (err && err.message) || String(err));
    return store.sendJson(res, 502, { ok: false, error: 'Could not verify the purchase. Try again shortly.' });
  }
};

// Function execution ceiling (two Google calls capped at 15s each)
module.exports.maxDuration = 60;
