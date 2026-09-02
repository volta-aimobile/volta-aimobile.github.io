/**
 * Volta Vercel API — /api/sync-diet
 * ==================================
 * Stores / returns ONE diet-log document (same shape as the app's own
 * textdb document: { log:[…], updatedAt }).
 *
 * GET /api/sync-diet?key=volta-d-v1-<emailHash>
 *   → { ok:true, found:true,  log:[…], updatedAt, storage:"…" }
 *   → { ok:true, found:false, log:[] }
 *
 * POST /api/sync-diet   body: { key:"volta-d-v1-<emailHash>", log:[…] }
 *   → { ok:true, storage:"…" }
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
    if (!doc) return store.sendJson(res, 200, { ok: true, found: false, log: [] });
    const d = doc.data;
    const log = (d && Array.isArray(d.log)) ? d.log : [];
    return store.sendJson(res, 200, {
      ok: true, found: true, log: log,
      updatedAt: d.updatedAt || 0, storage: doc.storage
    });
  }

  // ─── WRITE ────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = store.getBody(req);
    if (!body) return store.sendJson(res, 400, { ok: false, error: 'JSON body required' });
    const key = body.key || '';
    const log = body.log;
    if (!store.validKey(key)) {
      return store.sendJson(res, 400, { ok: false, error: 'bad key' });
    }
    if (!Array.isArray(log)) {
      return store.sendJson(res, 400, { ok: false, error: 'log must be an array' });
    }
    const r = await store.writeDoc(key, { log: log, updatedAt: Date.now() });
    if (!r.ok) return store.sendJson(res, 502, { ok: false, error: r.error || 'storage unavailable' });
    return store.sendJson(res, 200, { ok: true, storage: r.storage });
  }

  return store.sendJson(res, 405, { ok: false, error: 'GET or POST only' });
};
