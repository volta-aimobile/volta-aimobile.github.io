/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS Vercel serverless function (zero npm deps) */
/**
 * Volta Vercel API — POST /api/ai/weekly-report
 * =============================================
 * AI weekly training report (FREE — was premium-only, un-gated in Task 9-a;
 * bilingual EN/AR). `email` stays in the contract (client context) but is
 * OPTIONAL and never gated. CommonJS mirror of the sandbox route
 * src/app/api/ai/weekly-report/route.ts contract.
 *   POST { email?, lang: "en"|"ar",
 *          stats: { minutes, workouts, kcalBurned, kcalEaten, streakDays,
 *                   topExercises[], sessionsLogged, daysActive } }
 * → { ok:true, report: { headline(≤60), summary(2-3 sentences),
 *                        wins[3], improvements[3], focus[3 concrete actions],
 *                        note(1 motivating sentence) } }
 * STRICT JSON output, written in the requested language.
 */

const ai = require('./_ai.js');

function clampInt(v, min, max, fallback) {
  const n = Math.round(Number(v));
  if (!isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function strList(v, max, maxLen) {
  if (!Array.isArray(v)) return [];
  return v
    .filter(function (x) { return typeof x === 'string' && !!x.trim(); })
    .map(function (s) { return s.trim().slice(0, maxLen || 120); })
    .slice(0, max);
}

function normalizeStats(raw) {
  const s = (raw && typeof raw === 'object') ? raw : {};
  return {
    minutes: clampInt(s.minutes, 0, 100000, 0),
    workouts: clampInt(s.workouts, 0, 10000, 0),
    kcalBurned: clampInt(s.kcalBurned, 0, 1000000, 0),
    kcalEaten: clampInt(s.kcalEaten, 0, 1000000, 0),
    streakDays: clampInt(s.streakDays, 0, 3650, 0),
    topExercises: strList(s.topExercises, 5, 60),
    sessionsLogged: clampInt(s.sessionsLogged, 0, 10000, 0),
    daysActive: clampInt(s.daysActive, 0, 366, 0),
  };
}

function buildPrompt(stats, lang) {
  const langRule = lang === 'ar'
    ? '\nLANGUAGE (CRITICAL): Write EVERY string value in ARABIC (simple Modern Standard Arabic, motivating tone). JSON keys stay in English.'
    : '\nLANGUAGE: Write every string value in English.';
  return 'You are a world-class personal trainer writing a WEEKLY REPORT for one athlete inside the Volta fitness app.\n' +
    'Their last 7 days (JSON):\n' +
    JSON.stringify(stats) + '\n\n' +
    'Respond with ONLY a valid JSON object (no markdown, no code fences, no extra text) using exactly this schema:\n' +
    '{\n' +
    '  "headline": "punchy report title, max 60 chars",\n' +
    '  "summary": "2-3 sentences summing up the week",\n' +
    '  "wins": ["3 short wins the athlete should feel good about"],\n' +
    '  "improvements": ["3 short honest areas to improve"],\n' +
    '  "focus": ["3 CONCRETE actions for next week (specific, actionable)"],\n' +
    '  "note": "ONE motivating sentence"\n' +
    '}\n\n' +
    'Rules:\n' +
    '- Base EVERY claim on the real numbers — never invent workouts or calories.\n' +
    '- Be encouraging but honest; no medical diagnosis, no extreme dieting advice.\n' +
    '- headline ≤ 60 characters; each array has EXACTLY 3 short items.' + langRule;
}

module.exports = async (req, res) => {
  if (ai.preflight(req, res)) return;

  if (req.method !== 'POST') {
    return ai.sendJson(res, 405, { ok: false, error: 'POST only' });
  }

  const body = await ai.readJsonBody(req);
  if (!body) {
    return ai.sendJson(res, 400, { ok: false, error: 'Invalid JSON body' });
  }

  // FREE feature — no premium gate. Email is optional context only.
  const lang = body.lang === 'ar' ? 'ar' : 'en';
  const stats = normalizeStats(body.stats);

  try {
    const raw = await ai.geminiVision([{ text: buildPrompt(stats, lang) }], null, {
      jsonMode: true,
      maxTokens: 800,
      temperature: 0.6,
    });

    const parsed = ai.extractJson(raw);
    if (!parsed) {
      console.error('ai/weekly-report: no JSON in model response:', String(raw).slice(0, 400));
      return ai.sendJson(res, 502, { ok: false, error: 'Weekly report failed — please try again' });
    }

    const report = {
      headline: (typeof parsed.headline === 'string' && parsed.headline.trim())
        ? parsed.headline.trim().slice(0, 60)
        : 'Your week in review',
      summary: (typeof parsed.summary === 'string') ? parsed.summary.trim().slice(0, 600) : '',
      wins: strList(parsed.wins, 3, 140),
      improvements: strList(parsed.improvements, 3, 140),
      focus: strList(parsed.focus, 3, 140),
      note: (typeof parsed.note === 'string') ? parsed.note.trim().slice(0, 200) : '',
    };

    return ai.sendJson(res, 200, { ok: true, report: report });
  } catch (err) {
    console.error('ai/weekly-report error:', (err && err.message) || String(err));
    const isTimeout = err && err.code === 'ai-timeout';
    if (err && err.code === 'unconfigured') {
      return ai.sendJson(res, 501, { ok: false, error: err.message });
    }
    return ai.sendJson(res, isTimeout ? 504 : 500, {
      ok: false,
      error: isTimeout ? 'Weekly report timed out — try again' : 'Weekly report failed — please try again',
    });
  }
};

// Function execution ceiling (AI call capped at ~45s inside)
module.exports.maxDuration = 60;
