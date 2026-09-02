/**
 * Volta Vercel API — shared storage layer (api/_store.js)
 * ========================================================
 * Used by every endpoint in this folder. Files starting with "_" are
 * NOT exposed as endpoints by Vercel — this module is import-only.
 *
 * STORAGE STRATEGY
 * ----------------
 * 1. PRIMARY (optional): Vercel KV / Upstash Redis via REST env vars.
 *    Auto-detected — when the project has a KV database connected,
 *    Vercel injects:  KV_REST_API_URL + KV_REST_API_TOKEN
 *    (or the marketplace equivalent: UPSTASH_REDIS_REST_URL/TOKEN).
 *    No code change needed — the API upgrades itself automatically.
 *
 * 2. ALWAYS-ON BACKING STORE: textdb.dev — the exact same documents
 *    the app writes from the browser (volta-u-v1-<hash> / volta-d-v1-<hash>).
 *    This means the API works the moment it is deployed, with ZERO
 *    configuration, and stays wire-compatible with the app's own
 *    fallback transport.
 *
 * WRITE = backing store always + KV when available (best-effort each).
 * READ  = KV first (when present), then the backing store.
 *
 * KEYS
 * ----
 * Only the app's own document keys are accepted:
 *   volta-u-v1-<emailHash>  → user record (login details, profile, …)
 *   volta-d-v1-<emailHash>  → diet log
 * <emailHash> is a one-way hash of the email (sha256/fnv) computed in
 * the browser — the API never sees a bare email as a key.
 */

const TEXTDB_BASE = 'https://textdb.dev/api/data/';

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const KV_MS = 6000;   // max wait per KV op
const TEXT_MS = 6000; // max wait per textdb op

function hasKv() { return !!(KV_URL && KV_TOKEN); }
function storageMode() { return hasKv() ? 'kv+textdb' : 'textdb'; }

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

// ─── CORS + JSON helpers ────────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

function sendJson(res, status, obj) {
  res.statusCode = status;
  for (const k in CORS_HEADERS) res.setHeader(k, CORS_HEADERS[k]);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

function preflight(req, res) {
  if (req.method !== 'OPTIONS') return false;
  res.statusCode = 204;
  for (const k in CORS_HEADERS) res.setHeader(k, CORS_HEADERS[k]);
  res.end();
  return true;
}

// Defensive body parse: Vercel usually pre-parses JSON bodies, but be safe.
function getBody(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { return null; } }
  return (b && typeof b === 'object') ? b : null;
}

// ─── Key validation: only the app's own namespaced keys are allowed ─────
function validKey(k) {
  return typeof k === 'string' && /^volta-[ud]-v1-[a-z0-9]{6,64}$/.test(k);
}

// ─── KV (Vercel KV / Upstash REST) ──────────────────────────────────────
async function kvGetRaw(key) {
  const r = await fetchT(KV_URL + '/get/' + encodeURIComponent(key), {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + KV_TOKEN }
  }, KV_MS);
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
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

// ─── textdb.dev backing store (same docs the browser writes) ────────────
async function textGetRaw(key) {
  const r = await fetchT(TEXTDB_BASE + key, { method: 'GET', cache: 'no-store' }, TEXT_MS);
  if (!r.ok) return null;
  const t = await r.text();
  return (t && t.trim()) ? t : null;
}

async function textSetRaw(key, value) {
  const r = await fetchT(TEXTDB_BASE + key, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: value
  }, TEXT_MS);
  return r.ok;
}

// ─── Public: read one document ──────────────────────────────────────────
// Returns { data, storage } or null (missing / invalid key / all dead).
async function readDoc(key) {
  if (!validKey(key)) return null;
  if (hasKv()) {
    try {
      const raw = await kvGetRaw(key);
      if (raw) {
        const p = JSON.parse(raw);
        if (p && typeof p === 'object') return { data: p, storage: 'kv' };
      }
    } catch (e) { /* fall through to backing store */ }
  }
  try {
    const raw = await textGetRaw(key);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && typeof p === 'object') return { data: p, storage: 'textdb' };
    }
  } catch (e) { /* not found / dead */ }
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

module.exports = {
  hasKv, storageMode, sendJson, preflight, getBody, validKey,
  readDoc, writeDoc, CORS_HEADERS
};
