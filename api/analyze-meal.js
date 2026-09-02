/**
 * Volta Vercel API — POST /api/analyze-meal
 * ==========================================
 * Backend for the AI Meal Scanner (Diet tab → "Take a photo of your meal").
 * The app POSTs { image: "data:image/jpeg;base64,…" } and gets back:
 *   { name, description, calories, protein, carbs, fat, ingredients[] }
 *
 * AI PROVIDERS (auto-detected from the project's environment variables —
 * set ONE of these in Vercel → Settings → Environment Variables, then
 * redeploy; no code change needed):
 *
 *   1. GEMINI_API_KEY (recommended — generous free tier, same Google
 *      account you already use for Firebase sign-in):
 *        aistudio.google.com → "Get API key" → copy → paste into Vercel.
 *      Model: gemini-2.0-flash (vision + JSON, fast).
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

const PROMPT = `You are a professional nutritionist and food recognition expert.
Analyze the food/meal shown in this photo.

Identify the dish and estimate its nutrition for the WHOLE plate/serving visible (per serving, not per 100g).

Respond with ONLY a valid JSON object (no markdown, no code fences, no extra text) using exactly this schema:
{
  "name": "short dish name in English (max 40 chars)",
  "description": "one short sentence describing the dish (max 120 chars)",
  "calories": number (kcal, integer),
  "protein": number (grams, integer),
  "carbs": number (grams, integer),
  "fat": number (grams, integer),
  "ingredients": ["main ingredient 1", "main ingredient 2", "main ingredient 3"]
}

Rules:
- If the image contains NO food, respond with: {"error":"no_food"}
- Use realistic estimates for an average portion of what is visible.
- Keep every value a number (no units inside the strings).`;

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

function normalizeMeal(parsed) {
  return {
    name: (typeof parsed.name === 'string' && parsed.name.trim()) ? parsed.name.trim() : 'Unknown meal',
    description: (typeof parsed.description === 'string') ? parsed.description.trim() : '',
    calories: num(parsed.calories),
    protein: num(parsed.protein),
    carbs: num(parsed.carbs),
    fat: num(parsed.fat),
    ingredients: Array.isArray(parsed.ingredients)
      ? parsed.ingredients.filter(function (i) { return typeof i === 'string' && i.trim(); }).slice(0, 8)
      : []
  };
}

// ─── Provider 1: Google Gemini ──────────────────────────────────────────
async function analyzeWithGemini(apiKey, dataUrl) {
  const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
  if (!m) throw new Error('bad image data url');
  const mime = m[1];
  const b64 = m[2];

  const body = {
    contents: [{
      parts: [
        { text: PROMPT },
        { inline_data: { mime_type: mime, data: b64 } }
      ]
    }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 600,
      responseMimeType: 'application/json'
    }
  };

  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + encodeURIComponent(apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const j = await r.json().catch(function () { return null; });
  if (!r.ok) {
    const msg = (j && j.error && j.error.message) || ('Gemini HTTP ' + r.status);
    throw new Error(msg);
  }
  const parts = (j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
  const text = parts.map(function (p) { return p.text || ''; }).join('');
  const parsed = extractJson(text);
  if (!parsed) throw new Error('Gemini returned no JSON');
  if (parsed.error === 'no_food') return { noFood: true };
  return normalizeMeal(parsed);
}

// ─── Provider 2: OpenAI vision ──────────────────────────────────────────
async function analyzeWithOpenAI(apiKey, dataUrl) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiKey
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: PROMPT },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }]
    })
  });
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

  if (!image || typeof image !== 'string' || image.length < 100) {
    return sendJson(res, 400, { ok: false, error: 'Missing image — send { image: "data:image/jpeg;base64,…" }' });
  }
  const dataUrl = image.startsWith('data:') ? image : 'data:image/jpeg;base64,' + image;
  if (dataUrl.length > 12 * 1024 * 1024) {
    return sendJson(res, 413, { ok: false, error: 'Image too large — please retake the photo' });
  }

  const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '';
  const OPENAI_KEY = process.env.OPENAI_API_KEY || '';

  try {
    if (GEMINI_KEY) {
      const meal = await analyzeWithGemini(GEMINI_KEY, dataUrl);
      if (meal.noFood) return sendJson(res, 422, { ok: false, error: 'No food detected in the photo — please retake it' });
      return sendJson(res, 200, meal);
    }
    if (OPENAI_KEY) {
      const meal = await analyzeWithOpenAI(OPENAI_KEY, dataUrl);
      if (meal.noFood) return sendJson(res, 422, { ok: false, error: 'No food detected in the photo — please retake it' });
      return sendJson(res, 200, meal);
    }
    return sendJson(res, 501, {
      ok: false,
      error: 'AI backend not configured yet — add GEMINI_API_KEY (free at aistudio.google.com) in your Vercel project environment variables, then redeploy.'
    });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: (err && err.message) ? err.message : 'Meal analysis failed' });
  }
};
