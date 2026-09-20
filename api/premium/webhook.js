/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS Vercel serverless function (zero npm deps) */
/**
 * Volta Vercel API — POST /api/premium/webhook
 * ============================================
 * Stripe webhook receiver with MANUAL signature verification (no SDK).
 * CommonJS mirror of the sandbox route src/app/api/premium/webhook/route.ts.
 *
 *   header: stripe-signature: t=<timestamp>,v1=<hex hmac>
 *   expected sig: HMAC-SHA256 hex of `${t}.${rawBody}` keyed by
 *                 STRIPE_WEBHOOK_SECRET (node:crypto + timingSafeEqual).
 *
 * Handled events (everything else is acked 200 and ignored):
 *   checkout.session.completed     → activate / upsert subscription
 *   invoice.paid                   → renewal: extend periodEnd (defensive)
 *   customer.subscription.updated  → mirror cancel_at_period_end locally
 *   customer.subscription.deleted  → access ends NOW (status canceled)
 *
 * ALWAYS responds 200 { ok:true, received:<type> } for parsed events —
 * never throws raw errors back at Stripe (no retry storms).
 *
 * KV note: subscription documents are keyed by the hashed email, so events
 * are located via metadata.email (checkout sets metadata[email] and
 * subscription_data[metadata][email]) / subscription_details.metadata.email /
 * customer_email. Events with no resolvable email are acked and skipped.
 */

const crypto = require('crypto');
const store = require('../_store.js');
const pstore = require('../_premium-store.js');

const MAX_BODY_BYTES = 1024 * 1024; // webhook payloads are small; cap at 1MB

function isPremiumPlan(p) {
  return p === 'monthly' || p === 'yearly';
}

function strOrNull(v) {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Collect the raw request body (Vercel may pre-parse it as a string/object). */
function rawBody(req) {
  return new Promise(function (resolve) {
    if (typeof req.body === 'string' && req.body) return resolve(req.body);
    if (req.body && typeof req.body === 'object') {
      try { return resolve(JSON.stringify(req.body)); } catch (e) { /* fall through */ }
    }
    let data = '';
    let done = false;
    const finish = function () { if (!done) { done = true; resolve(data); } };
    try {
      req.on('data', function (c) {
        data += c.toString('utf8');
        if (data.length > MAX_BODY_BYTES) { try { req.destroy(); } catch (e) {} finish(); }
      });
      req.on('end', finish);
      req.on('error', finish);
      // Safety net: never wait forever for a stalled stream
      setTimeout(finish, 5000);
    } catch (e) {
      finish();
    }
  });
}

/** Constant-time check of Stripe's `stripe-signature` header. */
function verifyStripeSignature(sigHeader, rawBodyStr, secret) {
  try {
    let ts = '';
    const v1s = [];
    const parts = String(sigHeader).split(',');
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      const k = part.slice(0, eq).trim();
      const v = part.slice(eq + 1).trim();
      if (k === 't') ts = v;
      else if (k === 'v1') v1s.push(v);
    }
    if (!ts || v1s.length === 0) return false;
    const expected = crypto
      .createHmac('sha256', secret)
      .update(ts + '.' + rawBodyStr, 'utf8')
      .digest('hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    for (let j = 0; j < v1s.length; j++) {
      const sigBuf = Buffer.from(v1s[j], 'hex');
      if (sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf)) {
        return true;
      }
    }
    return false;
  } catch (err) {
    return false;
  }
}

/**
 * Locate the local subscription doc from whatever identifiers an event
 * carries. (KV docs are keyed by hashed email — no secondary indexes.)
 */
async function findSubscription(obj) {
  const meta = (obj.metadata && typeof obj.metadata === 'object') ? obj.metadata : null;
  const subDetailsMeta = (obj.subscription_details && typeof obj.subscription_details === 'object' && obj.subscription_details.metadata)
    ? obj.subscription_details.metadata
    : null;

  // 1) metadata email (checkout / subscription metadata), else customer_email
  const email = pstore.normalizeEmail(
    (meta && meta.email) || (subDetailsMeta && subDetailsMeta.email) || obj.customer_email
  );
  if (email) {
    try { return await pstore.readSub(pstore.hashEmail(email)); } catch (err) { return null; }
  }
  return null;
}

module.exports = async (req, res) => {
  if (store.preflight(req, res)) return;

  if (req.method !== 'POST') {
    return store.sendJson(res, 405, { ok: false, error: 'POST only' });
  }

  const raw = await rawBody(req);
  if (!raw) {
    return store.sendJson(res, 400, { ok: false, error: 'Could not read body' });
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET || '';
  if (!secret) {
    return store.sendJson(res, 200, {
      ok: true,
      ignored: true,
      reason: 'webhook secret not configured',
    });
  }

  const sigHeader = req.headers['stripe-signature'] || '';
  if (!sigHeader || !verifyStripeSignature(sigHeader, raw, secret)) {
    return store.sendJson(res, 400, { ok: false, error: 'Invalid signature' });
  }

  let event = null;
  try {
    event = JSON.parse(raw);
  } catch (err) {
    return store.sendJson(res, 400, { ok: false, error: 'Invalid payload' });
  }
  const type = (event && event.type) || 'unknown';
  const obj = (event && event.data && event.data.object) || {};

  try {
    switch (type) {
      // ── Completed checkout → activate ────────────────────────────────────
      case 'checkout.session.completed': {
        const meta = (obj.metadata && typeof obj.metadata === 'object') ? obj.metadata : {};
        const email = pstore.normalizeEmail(meta.email || obj.customer_email);
        const plan = isPremiumPlan(meta.plan) ? meta.plan : null;
        if (email && plan) {
          const nowIso = new Date().toISOString();
          const amount = typeof obj.amount_total === 'number' ? obj.amount_total : null;
          const currency = typeof obj.currency === 'string' ? obj.currency.toUpperCase() : null;
          let existing = null;
          try { existing = await pstore.readSub(pstore.hashEmail(email)); } catch (err) { existing = null; }
          const doc = existing && typeof existing === 'object' ? existing : { email: email, createdAt: nowIso };
          doc.email = email;
          doc.plan = plan;
          doc.status = 'active';
          doc.provider = 'stripe';
          if (currency) doc.currency = currency; else if (!doc.currency) doc.currency = 'USD';
          if (amount !== null) doc.amount = amount; else if (typeof doc.amount !== 'number') doc.amount = 0;
          doc.country = strOrNull(meta.country) || doc.country || '';
          doc.stripeCustomerId = strOrNull(obj.customer);
          doc.stripeSubscriptionId = strOrNull(obj.subscription);
          doc.stripeSessionId = strOrNull(obj.id);
          doc.periodStart = nowIso;
          doc.periodEnd = pstore.addPeriod(plan, nowIso);
          doc.cancelAtPeriodEnd = false;
          doc.canceledAt = null;
          try { await pstore.writeSub(pstore.hashEmail(email), doc); } catch (err) { /* ack anyway */ }
        }
        break;
      }

      // ── Renewal invoice → extend the paid period ─────────────────────────
      case 'invoice.paid': {
        const sub = await findSubscription(obj);
        if (!sub) break;
        // If both sides know the Stripe subscription id and they disagree,
        // this invoice belongs to a different subscription — skip safely.
        const invoiceSubId = strOrNull(obj.subscription);
        if (sub.stripeSubscriptionId && invoiceSubId && invoiceSubId !== sub.stripeSubscriptionId) {
          break;
        }
        const plan = isPremiumPlan(sub.plan) ? sub.plan : 'monthly';
        // Defensive extension: renew on top of whichever is LATER — the
        // current periodEnd (if still in the future, e.g. catch-up events)
        // or now. This never shortens access and never double-adds.
        const currentEnd = new Date(sub.periodEnd).getTime();
        const base = Math.max(Number.isFinite(currentEnd) ? currentEnd : 0, Date.now());
        sub.status = sub.status === 'canceled' ? sub.status : 'active';
        sub.periodEnd = pstore.addPeriod(plan, new Date(base));
        try { await pstore.writeSub(pstore.hashEmail(sub.email), sub); } catch (err) { /* ack anyway */ }
        break;
      }

      // ── Mirror Stripe's cancel_at_period_end flag ────────────────────────
      case 'customer.subscription.updated': {
        const sub = await findSubscription(obj);
        if (!sub) break;
        const cancelAtPeriodEnd = obj.cancel_at_period_end === true;
        sub.cancelAtPeriodEnd = cancelAtPeriodEnd;
        sub.status = cancelAtPeriodEnd ? 'canceling' : 'active';
        if (cancelAtPeriodEnd) {
          sub.canceledAt = sub.canceledAt || new Date().toISOString();
        } else {
          sub.canceledAt = null;
        }
        try { await pstore.writeSub(pstore.hashEmail(sub.email), sub); } catch (err) { /* ack anyway */ }
        break;
      }

      // ── Subscription fully deleted → access ends now ─────────────────────
      case 'customer.subscription.deleted': {
        const sub = await findSubscription(obj);
        if (!sub) break;
        sub.status = 'canceled';
        sub.cancelAtPeriodEnd = true;
        sub.canceledAt = sub.canceledAt || new Date().toISOString();
        sub.periodEnd = new Date().toISOString(); // access ends NOW
        try { await pstore.writeSub(pstore.hashEmail(sub.email), sub); } catch (err) { /* ack anyway */ }
        break;
      }

      default:
        // Unhandled event types are acked but ignored.
        break;
    }
  } catch (err) {
    // Never leak errors to Stripe — log locally, still ack 200.
    console.error('[premium/webhook] handler error for ' + type + ':', (err && err.message) || String(err));
  }

  return store.sendJson(res, 200, { ok: true, received: type });
};

// Function execution ceiling (storage ops bounded ~17s worst case)
module.exports.maxDuration = 30;
