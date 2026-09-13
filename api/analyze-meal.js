/**
 * Volta Vercel API — POST /api/analyze-meal
 * ==========================================
 * Backend for the AI Meal Scanner (Diet tab → "Take a photo of your meal").
 * The app POSTs { image: "data:image/jpeg;base64,…", lang: "en" | "ar" } and
 * gets back:
 *   { name, nameEn, cuisine, description, calories, protein, carbs, fat,
 *     ingredients[] }
 *
 * GLOBAL + BILINGUAL: the model recognizes dishes from EVERY country and
 * cuisine (including local/national dish names) and estimates portions for
 * that cuisine's typical serving. "name", "description" and "ingredients"
 * are localized to the requested language (Arabic script when lang="ar");
 * "nameEn" and "cuisine" ALWAYS stay in English/Latin script.
 *
 * AI PROVIDERS (auto-detected from the project's environment variables —
 * set ONE of these in Vercel → Settings → Environment Variables, then
 * redeploy; no code change needed):
 *
 *   1. GEMINI_API_KEY (recommended — generous free tier, same Google
 *      account you already use for Firebase sign-in):
 *        aistudio.google.com → "Get API key" → copy → paste into Vercel.
 *      Model: current Gemini flash chain (see GEMINI_MODELS) — vision + JSON, fast.
 *
 *   2. OPENAI_API_KEY (alternative):
 *      Model: gpt-4o-mini (vision-capable).
 *
 * When neither key is present the endpoint answers with a clear, friendly
 * error so the app can show "AI backend not configured yet" instead of a
 * generic failure.
 */

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

// Build the vision prompt for the requested output language ("en" | "ar").
function buildPrompt(lang) {
  const outLang = lang === 'ar' ? 'Arabic' : 'English';
  return `You are an expert nutritionist and food recognition specialist with deep knowledge of dishes from EVERY country and cuisine: Egyptian, Levantine, Gulf, Maghrebi/Berber, African, Turkish, Indian, Pakistani, Chinese, Japanese, Korean, Thai, Vietnamese, Mexican, Brazilian, American, Italian, Greek, Spanish, French, German, Russian, Filipino, Indonesian — and any mixed or street food.

Analyze the food/meal shown in this photo.

1. Identify the dish — even if it goes by a local or national name (e.g. koshari, ful medames, molokhia, sambousek, kofta, shakshuka, biryani, pho, plov, jollof rice, arepa, ceviche, poutine, takoyaki).
2. Estimate its nutrition for a realistic typical serving of that cuisine (per serving, not per 100g) — e.g. a bowl of ful medames, a plate of koshari, 3 sambousek, one bowl of pho, 2 tacos, a plate of pasta.

Respond with ONLY a valid JSON object (no markdown, no code fences, no extra text) using exactly this schema:
{
  "name": "dish name in ${outLang} (max 40 chars)",
  "nameEn": "the dish name in English/Latin script (max 40 chars)",
  "description": "one short sentence describing the dish in ${outLang} (max 120 chars)",
  "cuisine": "the cuisine the dish belongs to, in English (e.g. Egyptian, Japanese, Mexican)",
  "calories": number (kcal, integer),
  "protein": number (grams, integer),
  "carbs": number (grams, integer),
  "fat": number (grams, integer),
  "ingredients": ["main ingredient 1 in ${outLang}", "main ingredient 2 in ${outLang}", "main ingredient 3 in ${outLang}"]
}

Rules:
- If the image contains NO food, respond with: {"error":"no_food"}
- "name", "description" and "ingredients" MUST be written in ${lang === 'ar' ? 'Arabic script (العربية)' : 'English'}; "nameEn" and "cuisine" ALWAYS stay in English/Latin script.
- Use realistic estimates for an average portion of what is visible.
- Keep every value a number (no units inside the strings).`;
}

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

function num(v, fallback) {
  const n = Number(v);
  return isFinite(n) && n >= 0 ? Math.round(n) : (fallback || 0);
}

function str(v) {
  return (typeof v === 'string') ? v.trim() : '';
}

function normalizeMeal(parsed) {
  const name = str(parsed.name);
  const nameEn = str(parsed.nameEn) || name;
  return {
    name: name || 'Unknown meal',
    nameEn: nameEn || 'Unknown meal',
    cuisine: str(parsed.cuisine) || 'Unknown',
    description: str(parsed.description).slice(0, 120),
    calories: num(parsed.calories),
    protein: num(parsed.protein),
    carbs: num(parsed.carbs),
    fat: num(parsed.fat),
    ingredients: Array.isArray(parsed.ingredients)
      ? parsed.ingredients.filter(function (i) { return typeof i === 'string' && i.trim(); }).slice(0, 8)
      : []
  };
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

const PROVIDER_MS = 25000; // hard ceiling per AI provider call

// ─── Provider 1: Google Gemini ──────────────────────────────────────────
// Current model chain (Google retires old names → 404; fall to next model).
const GEMINI_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash-lite'];
async function analyzeWithGemini(apiKey, dataUrl, prompt) {
  const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
  if (!m) throw new Error('bad image data url');
  const mime = m[1];
  const b64 = m[2];

  const body = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mime, data: b64 } }
      ]
    }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 700,
      responseMimeType: 'application/json'
    }
  };

  const t0 = Date.now();
  let r = null, j = null, retiredErr = null;
  for (let i = 0; i < GEMINI_MODELS.length; i++) {
    const left = Math.max(3000, PROVIDER_MS - (Date.now() - t0));
    r = await fetchT('https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODELS[i] + ':generateContent?key=' + encodeURIComponent(apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }, left);
    j = await r.json().catch(function () { return null; });
    if (r.ok) break;
    if (r.status === 503 || r.status === 429) throw new Error('AI provider busy — please try again in a moment');
    const msg = (j && j.error && j.error.message) || ('Gemini HTTP ' + r.status);
    // Retired/unknown model → try the next one in the chain.
    if (r.status === 404 && i < GEMINI_MODELS.length - 1) { retiredErr = new Error(msg); continue; }
    throw new Error(msg);
  }
  if (!r || !r.ok) throw (retiredErr || new Error('Gemini models unavailable'));
  const parts = (j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
  const text = parts.map(function (p) { return p.text || ''; }).join('');
  const parsed = extractJson(text);
  if (!parsed) throw new Error('Gemini returned no JSON');
  if (parsed.error === 'no_food') return { noFood: true };
  return normalizeMeal(parsed);
}

// ─── Provider 2: OpenAI vision ──────────────────────────────────────────
async function analyzeWithOpenAI(apiKey, dataUrl, prompt) {
  const r = await fetchT('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiKey
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }]
    })
  }, PROVIDER_MS);
  const j = await r.json().catch(function () { return null; });
  if (!r.ok) {
    const msg = (j && j.error && j.error.message) || ('OpenAI HTTP ' + r.status);
    throw new Error(msg);
  }
  const text = (j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
  const parsed = extractJson(text);
  if (!parsed) throw new Error('OpenAI returned no JSON');
  if (parsed.error === 'no_food') return { noFood: true };
  return normalizeMeal(parsed);
}

module.exports = async (req, res) => {
  if (preflight(req, res)) return;

  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'POST only' });
  }

  // Defensive body parse (Vercel usually pre-parses JSON).
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
  const image = (b && typeof b === 'object') ? b.image : null;
  // Output language: "ar" → Arabic script, anything else → English.
  const lang = (b && typeof b === 'object' && b.lang === 'ar') ? 'ar' : 'en';

  if (!image || typeof image !== 'string' || image.length < 100) {
    return sendJson(res, 400, { ok: false, error: 'Missing image — send { image: "data:image/jpeg;base64,…" }' });
  }
  const dataUrl = image.startsWith('data:') ? image : 'data:image/jpeg;base64,' + image;
  if (dataUrl.length > 12 * 1024 * 1024) {
    return sendJson(res, 413, { ok: false, error: 'Image too large — please retake the photo' });
  }

  const prompt = buildPrompt(lang);

  // Embedded fallback (same as api/ai/_ai.js) so meal scanning works right
  // after deploy; the env var ALWAYS wins when present.
  const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    'AQ.Ab8RN6KPIi_YFfB-2pgAkEMKG_AEN6k_b0e9loWVByX1IyM-ZQ';
  const OPENAI_KEY = process.env.OPENAI_API_KEY || '';

  try {
    if (GEMINI_KEY) {
      const meal = await analyzeWithGemini(GEMINI_KEY, dataUrl, prompt);
      if (meal.noFood) return sendJson(res, 422, { ok: false, error: 'No food detected in the photo — please retake it' });
      return sendJson(res, 200, meal);
    }
    if (OPENAI_KEY) {
      const meal = await analyzeWithOpenAI(OPENAI_KEY, dataUrl, prompt);
      if (meal.noFood) return sendJson(res, 422, { ok: false, error: 'No food detected in the photo — please retake it' });
      return sendJson(res, 200, meal);
    }
    return sendJson(res, 501, {
      ok: false,
      error: 'AI backend not configured yet — add GEMINI_API_KEY (free at aistudio.google.com) in your Vercel project environment variables, then redeploy.'
    });
  } catch (err) {
    const timedOut = err && err.name === 'AbortError';
    return sendJson(res, timedOut ? 504 : 500, {
      ok: false,
      error: timedOut ? 'Meal analysis timed out — please try again' : ((err && err.message) ? err.message : 'Meal analysis failed')
    });
  }
};

// Function execution ceiling (provider fetches are capped at 25s below)
module.exports.maxDuration = 30;
