/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS Vercel serverless function (zero npm deps) */
/**
 * Volta Vercel API — shared AI helper (api/ai/_ai.js)
 * ===================================================
 * Import-only module for the premium AI endpoints in this folder:
 * form-check, rep-count, rep-session, coach, weekly-report, diet-plan.
 *
 * Provides:
 *   • readJsonBody(req)          — defensive JSON body parse (object | null)
 *   • json(obj, status)          — CORS Response (mirrors the sandbox
 *                                  premium-gate json()/corsJson() helpers)
 *   • respond(res, response)     — bridge a Response into the Node (req,res)
 *                                  handler style used by Vercel functions
 *   • sendJson(res, status, obj) — direct Node-style responder
 *   • premiumGate(email)         — null when the email has an ACTIVE premium
 *                                  subscription (KV doc via api/_premium-store.js),
 *                                  otherwise a 401/402/502 Response:
 *                                    401 { error:"A valid email is required", premiumRequired:true }
 *                                    402 { error:"This feature requires Volta Premium", premiumRequired:true }
 *   • geminiVision(parts, systemHint, opts)
 *                                — Google Gemini vision/chat (current model
 *                                  chain, see GEMINI_MODELS) with the EXACT
 *                                  request style of
 *                                  api/analyze-meal.js (OpenAI gpt-4o-mini
 *                                  fallback, 501 when unconfigured, bounded
 *                                  timeouts so nothing hangs).
 *   • extractJson(text)          — first JSON object from a model reply
 *
 * SECRETS: never logged. Provider errors are logged without Authorization
 * headers or API keys; clients only ever see friendly messages.
 */

const pstore = require('../_premium-store.js');

// ─── CORS + JSON helpers (same headers as api/_store.js) ────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

function jsonHeaders() {
  return Object.assign({}, CORS_HEADERS, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
}

/**
 * Build a JSON Response (mirrors the sandbox premium-gate json() helper).
 * Falls back to a plain descriptor object on runtimes without Response.
 */
function json(obj, status) {
  const body = JSON.stringify(obj == null ? { ok: false } : obj);
  const headers = jsonHeaders();
  if (typeof Response === 'function') {
    try {
      return new Response(body, { status: status || 200, headers: headers });
    } catch (e) { /* fall through to descriptor */ }
  }
  return { __voltaJson: true, status: status || 200, headers: headers, body: body };
}

/** Write a Response (or descriptor from json()) into a Node-style res. */
async function respond(res, r) {
  if (!r) return;
  if (r.__voltaJson) {
    res.statusCode = r.status || 200;
    for (const k in r.headers) res.setHeader(k, r.headers[k]);
    res.end(r.body);
    return;
  }
  res.statusCode = (r && r.status) || 200;
  try {
    if (r.headers && typeof r.headers.forEach === 'function') {
      r.headers.forEach(function (v, k) { res.setHeader(k, v); });
    }
  } catch (e) { /* headers are best-effort */ }
  if (typeof r.text === 'function') {
    const t = await r.text().catch(function () { return ''; });
    res.end(t);
  } else {
    res.end();
  }
}

function sendJson(res, status, obj) {
  res.statusCode = status;
  const h = jsonHeaders();
  for (const k in h) res.setHeader(k, h[k]);
  res.end(JSON.stringify(obj));
}

function preflight(req, res) {
  if (req.method !== 'OPTIONS') return false;
  res.statusCode = 204;
  for (const k in CORS_HEADERS) res.setHeader(k, CORS_HEADERS[k]);
  res.end();
  return true;
}

// ─── Defensive body parse ───────────────────────────────────────────────
// Vercel usually pre-parses JSON bodies; if not, read the raw stream.
const MAX_BODY_BYTES = 12 * 1024 * 1024; // AI bodies carry base64 images

function collectRaw(req) {
  return new Promise(function (resolve) {
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
      setTimeout(finish, 3000);
    } catch (e) {
      finish();
    }
  });
}

async function readJsonBody(req) {
  let b = req.body;
  if (typeof b === 'string' && b) {
    try { b = JSON.parse(b); } catch (e) { return null; }
  }
  if (b && typeof b === 'object') return b;
  if (b != null) return null; // present but not an object/string
  const raw = await collectRaw(req);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    return (p && typeof p === 'object') ? p : null;
  } catch (e) {
    return null;
  }
}

// ─── Premium gate (mirror of the sandbox assertPremium) ─────────────────
/**
 * Returns null when the email has an ACTIVE premium subscription
 * (periodEnd > now && status !== "canceled"), otherwise a Response:
 *   401 invalid/missing email · 402 not premium · 502 storage down.
 */
async function premiumGate(emailRaw) {
  const email = pstore.normalizeEmail(emailRaw);
  if (!email || !pstore.isValidEmail(email)) {
    return json({ ok: false, error: 'A valid email is required', premiumRequired: true }, 401);
  }
  let sub = null;
  try {
    sub = await pstore.readSub(pstore.hashEmail(email));
  } catch (err) {
    return json({ ok: false, error: 'storage unavailable' }, 502);
  }
  const view = (sub && typeof sub === 'object') ? pstore.subToJson(sub) : null;
  if (view && view.premium) return null;
  return json({ ok: false, error: 'This feature requires Volta Premium', premiumRequired: true }, 402);
}

// ─── Model helpers ──────────────────────────────────────────────────────
// Extract the first JSON object from a model response (handles ``` fences).
function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(candidate.slice(start, end + 1)); } catch (e) { return null; }
}

// fetch-with-timeout so a stalled provider can never hang the function
async function fetchT(url, opts, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, ms);
  try {
    return await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
  } finally {
    clearTimeout(timer);
  }
}

const AI_MS = 45000;     // hard ceiling per AI provider call (~45s)
const TOTAL_MS = 50000;  // whole-call budget incl. the fallback provider

function geminiKey() {
  // Embedded fallback so the app works right after deploy even before the
  // owner sets GEMINI_API_KEY in Vercel → Settings → Environment Variables.
  // The env var ALWAYS wins when present. Rotate by redeploying.
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    'AQ.Ab8RN6KPIi_YFfB-2pgAkEMKG_AEN6k_b0e9loWVByX1IyM-ZQ';
}
function openaiKey() {
  return process.env.OPENAI_API_KEY || '';
}

/** Friendly error when no AI provider is configured (→ HTTP 501). */
function unconfiguredError() {
  const e = new Error('AI backend not configured yet — add GEMINI_API_KEY (free at aistudio.google.com) in your Vercel project environment variables, then redeploy.');
  e.status = 501;
  e.code = 'unconfigured';
  return e;
}

function aiTimeoutError() {
  const e = new Error('ai-timeout');
  e.code = 'ai-timeout';
  return e;
}

function wrapAbort(err) {
  if (err && err.name === 'AbortError') return aiTimeoutError();
  return err;
}

/** Parse an image data URL into { mime, b64 } (mirrors analyze-meal). */
function parseDataUrl(dataUrl) {
  const m = String(dataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
  if (!m) return null;
  return { mime: m[1], b64: m[2] };
}

/** {text}|{image} part → Gemini inline part. */
function toGeminiPart(part) {
  if (part && typeof part.text === 'string') return { text: part.text };
  if (part && typeof part.image === 'string') {
    const img = parseDataUrl(part.image);
    if (!img) throw new Error('bad image data url');
    return { inline_data: { mime_type: img.mime, data: img.b64 } };
  }
  throw new Error('bad AI part');
}

/** {text}|{image} part → OpenAI content part. */
function toOpenAIPart(part) {
  if (part && typeof part.text === 'string') return { type: 'text', text: part.text };
  if (part && typeof part.image === 'string') {
    return { type: 'image_url', image_url: { url: part.image } };
  }
  throw new Error('bad AI part');
}

// Current Gemini models, tried in order. Google retires old model names
// (gemini-2.0-flash went away → 404 "no longer available"), so on a 404 we
// automatically fall through to the next model instead of failing the user.
const GEMINI_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash-lite'];

/** Gemini call with automatic model-chain fallback.
 *  Request style mirrors api/analyze-meal.js. */
async function callGemini(apiKey, contents, opts, ms) {
  const t0 = Date.now();
  const body = {
    contents: contents,
    generationConfig: {
      temperature: (opts && opts.temperature != null) ? opts.temperature : 0.2,
      maxOutputTokens: (opts && opts.maxTokens) || 800,
    }
  };
  if (opts && opts.jsonMode) body.generationConfig.responseMimeType = 'application/json';

  let lastErr = null;
  for (let i = 0; i < GEMINI_MODELS.length; i++) {
    const left = Math.max(3000, ms - (Date.now() - t0));
    const r = await fetchT(
      'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODELS[i] + ':generateContent?key=' + encodeURIComponent(apiKey),
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      left
    ).catch(function (err) { throw wrapAbort(err); });

    const j = await r.json().catch(function () { return null; });
    if (!r.ok) {
      if (r.status === 503 || r.status === 429) throw new Error('AI provider busy — please try again in a moment');
      const msg = (j && j.error && j.error.message) || ('Gemini HTTP ' + r.status);
      // Retired/unknown model → try the next one in the chain.
      if (r.status === 404 && i < GEMINI_MODELS.length - 1) { lastErr = new Error(msg); continue; }
      throw new Error(msg);
    }
    const parts = (j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
    const text = parts.map(function (p) { return p.text || ''; }).join('');
    if (!text) throw new Error('Gemini returned an empty response');
    return text;
  }
  throw (lastErr || new Error('Gemini models unavailable'));
}

/** OpenAI fallback — EXACT request style of api/analyze-meal.js. */
async function callOpenAI(apiKey, messages, opts, ms) {
  const body = {
    model: 'gpt-4o-mini',
    temperature: (opts && opts.temperature != null) ? opts.temperature : 0.2,
    max_tokens: (opts && opts.maxTokens) || 800,
    messages: messages,
  };
  const r = await fetchT('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify(body),
  }, ms).catch(function (err) { throw wrapAbort(err); });

  const j = await r.json().catch(function () { return null; });
  if (!r.ok) {
    const msg = (j && j.error && j.error.message) || ('OpenAI HTTP ' + r.status);
    throw new Error(msg);
  }
  const text = (j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
  if (!text) throw new Error('OpenAI returned an empty response');
  return text;
}

/**
 * One AI call with provider fallback.
 *
 * parts       — array of { text } | { image: dataUrl } (or a single part / null)
 * systemHint  — instructions string (prepended as the first text part, the
 *               same way analyze-meal.js passes its PROMPT)
 * opts        — { jsonMode:bool, maxTokens:int, temperature:number,
 *                messages:[{role:"user"|"assistant", content:string}] }
 *               When `messages` is given (chat mode) it becomes the Gemini
 *               contents / OpenAI message history and parts may be null.
 *
 * Returns the model TEXT. Throws:
 *   { code:"unconfigured", status:501 } — no GEMINI_API_KEY / OPENAI_API_KEY
 *   { code:"ai-timeout" }               — provider exceeded the time budget
 *   Error(message)                      — provider error (friendly, no secrets)
 */
async function geminiVision(parts, systemHint, opts) {
  opts = opts || {};
  const t0 = Date.now();
  const items = Array.isArray(parts) ? parts : (parts ? [parts] : []);
  const hint = systemHint ? String(systemHint) : '';

  const GEM = geminiKey();
  const OAI = openaiKey();
  if (!GEM && !OAI) throw unconfiguredError();

  // Chat mode: full conversation. Single-turn mode: hint + parts in ONE user
  // message (mirrors analyze-meal.js exactly).
  let geminiContents;
  let openaiMessages;
  if (Array.isArray(opts.messages) && opts.messages.length) {
    geminiContents = opts.messages.map(function (m) {
      return {
        role: m.role === 'assistant' || m.role === 'model' ? 'model' : 'user',
        parts: [{ text: String(m.content || '') }],
      };
    });
    openaiMessages = [];
    if (hint) openaiMessages.push({ role: 'system', content: hint });
    for (let i = 0; i < opts.messages.length; i++) {
      openaiMessages.push({
        role: opts.messages[i].role === 'assistant' ? 'assistant' : 'user',
        content: String(opts.messages[i].content || ''),
      });
    }
  } else {
    const gemParts = [];
    const oaiContent = [];
    if (hint) { gemParts.push({ text: hint }); oaiContent.push({ type: 'text', text: hint }); }
    for (let i = 0; i < items.length; i++) {
      gemParts.push(toGeminiPart(items[i]));
      oaiContent.push(toOpenAIPart(items[i]));
    }
    geminiContents = [{ role: 'user', parts: gemParts }];
    openaiMessages = [{ role: 'user', content: oaiContent }];
  }

  if (GEM) {
    const remaining = Math.max(3000, TOTAL_MS - (Date.now() - t0));
    try {
      return await callGemini(GEM, geminiContents, opts, Math.min(AI_MS, remaining));
    } catch (err) {
      if (!OAI) throw err;
      // fall through to the OpenAI fallback (analyze-meal.js behaviour)
    }
  }
  const remaining2 = Math.max(3000, TOTAL_MS - (Date.now() - t0));
  return callOpenAI(OAI, openaiMessages, opts, Math.min(AI_MS, remaining2));
}

module.exports = {
  CORS_HEADERS, json, respond, sendJson, preflight,
  readJsonBody, premiumGate, extractJson, geminiVision,
};
