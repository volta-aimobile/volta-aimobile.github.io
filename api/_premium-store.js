/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS Vercel serverless function (zero npm deps) */
/**
 * Volta Vercel API — Premium subscription storage (api/_premium-store.js)
 * =======================================================================
 * Storage layer for the premium + AI endpoints. Import-only module
 * (files starting with "_" are NOT exposed as endpoints by Vercel).
 *
 * DOCS (KV documents, same transport as api/_store.js):
 *   volta-p-v1-<hash32>  → ONE premium subscription document per email
 *   volta-s-v1-<hash32>  → AI session history (RepSense / FormSense)
 *   <hash32> = first 32 hex chars of SHA-256("volta_user:" + email) —
 *   the SAME one-way hash the app uses for its cloud keys (see
 *   cloudKeyForEmail in js/volta.js / _emailKey in js/cloudsync.js),
 *   truncated to 32 chars. The API never stores a bare email as a key.
 *
 * NOTE: api/_store.js' validKey() only accepts the "volta-u/d-v1-*"
 * namespaces, so this module carries its own copy of the transport
 * (identical resilience contract: bounded timeouts, 1 retry for textdb,
 * KV-first reads, all-write, StorageDownError → endpoints answer 502
 * fast instead of hanging). Keys follow the same key rules, extended
 * with the p/s namespaces.
 *
 * SUBSCRIPTION DOCUMENT SHAPE (JSON):
 * {
 *   email, status: "active"|"canceling"|"canceled", plan, currency,
 *   amount (minor units), country, provider: "stripe"|"google_play"|"demo",
 *   stripeCustomerId, stripeSubscriptionId, stripeSessionId,
 *   periodStart (ISO), periodEnd (ISO), cancelAtPeriodEnd (bool),
 *   canceledAt (ISO|null), createdAt (ISO), updatedAt (ISO)
 * }
 */

const crypto = require('crypto');

const TEXTDB_BASE = 'https://textdb.dev/api/data/';

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const KV_MS = 6000;      // max wait per KV op
const TEXT_MS = 8000;    // max wait per textdb op
const TEXT_RETRIES = 1;  // 1 retry with backoff for transient textdb failures
const RETRY_DELAY_MS = 500;

function hasKv() { return !!(KV_URL && KV_TOKEN); }
function storageMode() { return hasKv() ? 'kv+textdb' : 'textdb'; }

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// ─── Small fetch-with-timeout (no dependencies) ─────────────────────────
async function fetchT(url, opts, ms) {
  let ctrl = null;
  try { ctrl = new AbortController(); } catch (e) { ctrl = null; }
  const o = Object.assign({}, opts || {});
  let timer = null;
  if (ctrl) {
    o.signal = ctrl.signal;
    timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, ms);
  }
  try {
    return await fetch(url, o);
  } finally {
    if (ctrl && timer) clearTimeout(timer);
  }
}

// ─── StorageDown marker: backing store unreachable after retries ────────
function StorageDownError(message) {
  const e = new Error(message || 'storage unreachable');
  e.name = 'StorageDownError';
  return e;
}
function isStorageDown(err) {
  return !!(err && err.name === 'StorageDownError');
}

// ─── KV (Vercel KV / Upstash REST) ──────────────────────────────────────
async function kvGetRaw(key) {
  const r = await fetchT(KV_URL + '/get/' + encodeURIComponent(key), {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + KV_TOKEN }
  }, KV_MS);
  if (!r.ok) return null;
  const j = await r.json().catch(function () { return null; });
  return (j && typeof j.result === 'string') ? j.result : null;
}

async function kvSetRaw(key, value) {
  const r = await fetchT(KV_URL + '/set/' + encodeURIComponent(key), {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + KV_TOKEN, 'Content-Type': 'text/plain' },
    body: value
  }, KV_MS);
  return r.ok;
}

// ─── textdb.dev backing store (same doc store the browser writes) ───────
/**
 * GET one textdb document.
 *  - missing (4xx / empty)        → null
 *  - unreachable after retries    → throws StorageDownError (fail fast)
 */
async function textGetRaw(key) {
  let lastErr = null;
  for (let attempt = 0; attempt <= TEXT_RETRIES; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS);
    try {
      const r = await fetchT(TEXTDB_BASE + key, { method: 'GET', cache: 'no-store' }, TEXT_MS);
      if (r.ok) {
        const t = await r.text();
        return (t && t.trim()) ? t : null;
      }
      if (r.status >= 500) {
        lastErr = StorageDownError('textdb HTTP ' + r.status);
        continue; // retry on server-side errors
      }
      return null; // 4xx → treat as missing document
    } catch (e) {
      lastErr = e; // network error / timeout → transient
    }
  }
  console.error('_premium-store: textdb GET failed after retry:', lastErr && lastErr.message);
  throw StorageDownError('textdb unreachable');
}

/**
 * POST one textdb document.
 *  - ok                       → true
 *  - permanent reject (4xx)   → false (no retry)
 *  - network / timeout / 5xx after retry → false
 */
async function textSetRaw(key, value) {
  for (let attempt = 0; attempt <= TEXT_RETRIES; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS);
    try {
      const r = await fetchT(TEXTDB_BASE + key, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: value
      }, TEXT_MS);
      if (r.ok) return true;
      if (r.status < 500) return false; // permanent reject (e.g. payload too large)
      // 5xx → fall through to retry
    } catch (e) {
      // network error / timeout → fall through to retry
    }
  }
  return false;
}

// ─── Key rules ──────────────────────────────────────────────────────────
// Same namespace discipline as _store.js, extended with p/s:
//   volta-p-v1-<hash>  → premium subscription document
//   volta-s-v1-<hash>  → AI session history document
function validKey(k) {
  return typeof k === 'string' && /^volta-[ps]-v1-[a-z0-9]{6,64}$/.test(k);
}

// ─── Public: read one document ──────────────────────────────────────────
// Returns { data, storage } or null (missing / invalid key).
// Throws StorageDownError when the backing store is unreachable.
async function readDoc(key) {
  if (!validKey(key)) return null;
  if (hasKv()) {
    try {
      const raw = await kvGetRaw(key);
      if (raw) {
        const p = JSON.parse(raw);
        if (p && typeof p === 'object') return { data: p, storage: 'kv' };
      }
    } catch (e) {
      if (isStorageDown(e)) throw e;
      /* fall through to backing store */
    }
  }
  const raw = await textGetRaw(key);
  if (raw) {
    try {
      const p = JSON.parse(raw);
      if (p && typeof p === 'object') return { data: p, storage: 'textdb' };
    } catch (e) { /* corrupt doc → treat as missing */ }
  }
  return null;
}

// ─── Public: write one document ─────────────────────────────────────────
// Backing store always + KV when available. Returns { ok, storage }.
async function writeDoc(key, obj) {
  if (!validKey(key)) return { ok: false, error: 'invalid key' };
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'data must be an object' };
  let raw;
  try {
    raw = JSON.stringify(obj);
  } catch (e) { return { ok: false, error: 'data not serializable' }; }
  if (raw.length > 1000000) return { ok: false, error: 'payload too large' };

  const results = await Promise.all([
    (async () => { try { return (await textSetRaw(key, raw)) ? 'textdb' : null; } catch (e) { return null; } })(),
    hasKv()
      ? (async () => { try { return (await kvSetRaw(key, raw)) ? 'kv' : null; } catch (e) { return null; } })()
      : Promise.resolve(null)
  ]);

  const okText = results[0] === 'textdb';
  const okKv = results[1] === 'kv';
  const storage = okKv ? (okText ? 'kv+textdb' : 'kv') : (okText ? 'textdb' : null);
  return { ok: okText || okKv, storage };
}

// ─── Email helpers (mirror the app's own cloud-key hashing) ─────────────
function normalizeEmail(email) {
  return String(email == null ? '' : email).trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email || ''));
}

/**
 * One-way email hash — SAME approach as the app (cloudKeyForEmail in
 * js/volta.js: SHA-256 of "volta_user:" + trimmed lowercase email, hex),
 * truncated to 32 hex chars for the premium/sessions namespace.
 */
function hashEmail(email) {
  const normalized = normalizeEmail(email);
  return crypto.createHash('sha256').update('volta_user:' + normalized, 'utf8').digest('hex').slice(0, 32);
}

/** Accepts an email OR an already-hashed id (defensive). */
function emailHashFrom(value) {
  const s = String(value == null ? '' : value);
  if (s.indexOf('@') !== -1) return hashEmail(s);
  return normalizeEmail(s);
}

function subKeyFor(emailHashed) {
  const hash = emailHashFrom(emailHashed);
  return hash ? 'volta-p-v1-' + hash : '';
}
function sessionsKeyFor(emailHashed) {
  const hash = emailHashFrom(emailHashed);
  return hash ? 'volta-s-v1-' + hash : '';
}

// ─── Subscription document helpers ──────────────────────────────────────
/**
 * Adds ONE FULL billing period to a date (calendar-accurate):
 *   monthly → +1 calendar month, yearly → +1 calendar year.
 * Month-end safe (Jan 31 + 1 month → Feb 28; Feb 29 + 1 year → Feb 28).
 * Returns an ISO string.
 */
function addPeriod(plan, from) {
  let base = from;
  if (!(base instanceof Date)) base = new Date(base || Date.now());
  if (isNaN(base.getTime())) base = new Date();
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth();
  const d = base.getUTCDate();
  let ny = y;
  let nm = m;
  if (plan === 'yearly') { ny += 1; } else { nm += 1; }
  const daysInTarget = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const nd = Math.min(d, daysInTarget);
  return new Date(Date.UTC(ny, nm, nd, base.getUTCHours(), base.getUTCMinutes(), base.getUTCSeconds(), base.getUTCMilliseconds())).toISOString();
}

/** ISO string for anything date-ish, or fallback when invalid. */
function toIso(v, fallback) {
  if (v instanceof Date) return isNaN(v.getTime()) ? fallback : v.toISOString();
  const d = new Date(v);
  return isNaN(d.getTime()) ? fallback : d.toISOString();
}

/**
 * Serialized subscription for API responses (mirrors the sandbox
 * subscriptionJson — never leaks Stripe internals):
 *   { email, premium, plan, status, currency, amount, country, provider,
 *     periodStart, periodEnd, cancelAtPeriodEnd, canceledAt, daysLeft, msLeft }
 * premium bool = periodEnd > now && status !== "canceled"
 * daysLeft     = ceil(msLeft / 86400000), floored at 0
 */
function subToJson(sub) {
  const now = Date.now();
  const end = sub && sub.periodEnd ? new Date(sub.periodEnd).getTime() : 0;
  const msLeft = Number.isFinite(end) ? Math.max(0, end - now) : 0;
  const active = Number.isFinite(end) && end > now && sub.status !== 'canceled';
  return {
    email: (sub && sub.email) || '',
    premium: !!active,
    plan: (sub && sub.plan) || 'monthly',
    status: (sub && sub.status) || 'active',
    currency: (sub && sub.currency) || 'USD',
    amount: (sub && typeof sub.amount === 'number') ? sub.amount : 499,
    country: (sub && sub.country) || '',
    provider: (sub && sub.provider) || 'stripe',
    periodStart: toIso(sub && sub.periodStart, toIso(now, '')),
    periodEnd: toIso(sub && sub.periodEnd, toIso(now, '')),
    cancelAtPeriodEnd: !!(sub && sub.cancelAtPeriodEnd === true),
    canceledAt: (sub && sub.canceledAt) ? toIso(sub.canceledAt, null) : null,
    daysLeft: Math.ceil(msLeft / 86400000),
    msLeft: msLeft,
  };
}

/**
 * Read ONE subscription document by email (or email hash).
 * Returns the stored sub object or null (missing).
 * Throws StorageDownError when the backing store is unreachable.
 */
async function readSub(emailHashed) {
  const key = subKeyFor(emailHashed);
  if (!key) return null;
  const doc = await readDoc(key);
  if (!doc || !doc.data || typeof doc.data !== 'object') return null;
  return doc.data;
}

/**
 * Write (upsert) ONE subscription document by email (or email hash).
 * Sets updatedAt automatically; preserves createdAt on updates.
 * Returns { ok, storage } or { ok:false, error }.
 */
async function writeSub(emailHashed, sub) {
  const key = subKeyFor(emailHashed);
  if (!key) return { ok: false, error: 'invalid email hash' };
  if (!sub || typeof sub !== 'object') return { ok: false, error: 'subscription must be an object' };
  const nowIso = new Date().toISOString();
  if (!sub.createdAt) sub.createdAt = nowIso;
  sub.updatedAt = nowIso;
  return writeDoc(key, sub);
}

module.exports = {
  hasKv, storageMode, StorageDownError, isStorageDown,
  validKey, readDoc, writeDoc,
  normalizeEmail, isValidEmail, hashEmail, emailHashFrom,
  subKeyFor, sessionsKeyFor,
  addPeriod, subToJson, readSub, writeSub,
};
