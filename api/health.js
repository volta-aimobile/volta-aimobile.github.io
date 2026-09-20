/**
 * Volta Vercel API — GET /api/health
 * ===================================
 * Liveness + storage-mode probe. The app calls this once after login to
 * decide whether the Vercel vault transport is active (Settings → Cloud
 * Backup shows "Vercel vault: synced" only when this answers ok).
 *
 * 200 → { "ok": true, "storage": "textdb" | "kv+textdb", "time": "…",
 *         "version": "volta-api-1" }
 */
const store = require('./_store.js');

module.exports = async (req, res) => {
  if (store.preflight(req, res)) return;
  if (req.method !== 'GET') {
    return store.sendJson(res, 405, { ok: false, error: 'GET only' });
  }
  store.sendJson(res, 200, {
    ok: true,
    storage: store.storageMode(),
    kv: store.hasKv(),
    time: new Date().toISOString(),
    version: 'volta-api-1'
  });
};
