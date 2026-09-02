/**
 * Volta Vercel API — /api/sync-user
 * ==================================
 * Stores / returns ONE user account document (the "login details" vault).
 *
 * GET /api/sync-user?key=volta-u-v1-<emailHash>
 *   → { ok:true, found:true,  data:{…}, storage:"kv"|"textdb" }
 *   → { ok:true, found:false }                     (no record yet)
 *
 * POST /api/sync-user   body: { key:"volta-u-v1-<emailHash>", data:{…} }
 *   → { ok:true, storage:"…" }
 *
 * The document is the full account record exactly as the app stores it:
 * email, password (as the app already keeps it locally), profile, survey,
 * sessions, streak, reminders, diet prefs, lastSyncedAt, … The key is the
 * app's standard one-way email hash — the API never stores bare emails
 * as keys, and only accepts the app's own "volta-u-v1-*" namespace.
 */
const store = require('./_store.js');

module.exports = async (req, res) => {
  if (store.preflight(req, res)) return;

  // ─── READ ─────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const key = url.searchParams.get('key') || '';
    if (!store.validKey(key)) {
      return store.sendJson(res, 400, { ok: false, error: 'bad key' });
    }
    const doc = await store.readDoc(key);
    if (!doc) return store.sendJson(res, 200, { ok: true, found: false });
    return store.sendJson(res, 200, { ok: true, found: true, data: doc.data, storage: doc.storage });
  }

  // ─── WRITE ────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = store.getBody(req);
    if (!body) return store.sendJson(res, 400, { ok: false, error: 'JSON body required' });
    const key = body.key || '';
    const data = body.data;
    if (!store.validKey(key)) {
      return store.sendJson(res, 400, { ok: false, error: 'bad key' });
    }
    if (!data || typeof data !== 'object') {
      return store.sendJson(res, 400, { ok: false, error: 'data must be an object' });
    }
    const r = await store.writeDoc(key, data);
    if (!r.ok) return store.sendJson(res, 502, { ok: false, error: r.error || 'storage unavailable' });
    return store.sendJson(res, 200, { ok: true, storage: r.storage });
  }

  return store.sendJson(res, 405, { ok: false, error: 'GET or POST only' });
};
