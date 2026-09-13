/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS Vercel serverless function (zero npm deps) */
/**
 * Volta Vercel API — GET/POST /api/premium/price
 * ==============================================
 * Returns the localized price table entry for the visitor.
 * CommonJS mirror of the sandbox route src/app/api/premium/price/route.ts
 * (identical contract, identical numbers — see api/_pricing.js).
 *
 * Geo resolution order (handled before resolvePrice — resolvePrice always
 * returns a row, so the explicit/tz fallback is pre-resolved into `country`):
 *   1. `x-vercel-ip-country` header (Vercel geolocation, production)
 *   2. explicit `country` (query param or JSON body)
 *   3. IANA `timezone` (sandbox / no-geo fallback)
 *
 * Contract:
 *   GET  /api/premium/price?timezone=Africa/Cairo
 *   POST { timezone?, country? }         (empty/invalid body is fine)
 *     → 200 {
 *         ok: true,
 *         country: "EG",
 *         currency: "EGP",
 *         monthlyMinor: 2900,
 *         yearlyMinor: 24900,
 *         monthly: "29 EGP",     // DISPLAY STRING — currency CODE, never a symbol
 *         yearly: "249 EGP",
 *         stripe: false          // can Stripe charge this currency?
 *       }
 *     → 500 { ok:false, error:"Could not resolve price" }  (unexpected)
 */

const store = require('../_store.js');
const pricing = require('../_pricing.js');

/** Vercel geo country header (Node header names are lowercase). */
function geoCountry(req) {
  const v = req.headers['x-vercel-ip-country'];
  return typeof v === 'string' && v ? v : null;
}

function priceResponse(res, geo, country, timezone) {
  try {
    // Geo order: Vercel header → explicit country → IANA timezone.
    // NOTE: composed via priceForCountry() directly — resolvePrice()'s
    // `||` chain can never fall through (priceForCountry always returns a
    // truthy DEFAULT row), so the fallback order is composed here
    // (identical to the sandbox route).
    const cc = geo || country || pricing.countryFromTimezone(timezone) || '';
    const price = pricing.priceForCountry(cc);
    return store.sendJson(res, 200, {
      ok: true,
      country: price.country,
      currency: price.currency,
      monthlyMinor: price.monthly,
      yearlyMinor: price.yearly,
      monthly: pricing.formatPrice(price.monthly, price.currency),
      yearly: pricing.formatPrice(price.yearly, price.currency),
      stripe: pricing.stripeSupportsCurrency(price.currency),
    });
  } catch (err) {
    return store.sendJson(res, 500, { ok: false, error: 'Could not resolve price' });
  }
}

module.exports = async (req, res) => {
  if (store.preflight(req, res)) return;

  const geo = geoCountry(req);

  if (req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    return priceResponse(res, geo, url.searchParams.get('country'), url.searchParams.get('timezone'));
  }

  if (req.method === 'POST') {
    let body = {};
    try {
      const b = store.getBody(req);
      if (b && typeof b === 'object') body = b; // empty/invalid body is fine
    } catch (err) {
      body = {};
    }
    return priceResponse(res, geo, body.country || null, body.timezone || null);
  }

  return store.sendJson(res, 405, { ok: false, error: 'GET or POST only' });
};

module.exports.maxDuration = 30;
