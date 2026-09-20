// ─── Volta Premium — regional pricing table (Vercel mirror) ─────────────
// CommonJS port of src/lib/volta-pricing.ts — SAME table, SAME numbers.
// Used by api/premium/{price,checkout,verify,google-verify}.js so the
// Vercel deployment prices identically to the sandbox/Next.js backend.
//
// PRICING RULES (per product spec):
//   • Prices are shown with currency CODES only (EGP, USD, SAR…) —
//     NEVER currency symbols ($, £, €…).
//   • Every price ends in 9 ("deduct 1 coin": 100 → 99) — charm pricing.
//   • As cheap as possible per country (purchasing-power adjusted).
//   • `amount` values are MINOR UNITS (cents/kurush/fils…): 499 = 4.99.
//     Zero-decimal majors like EGP 29 are stored as 2900 minor (piasters).
//   • Country is resolved server-side from the Vercel geo header when
//     available, otherwise from the client's IANA timezone (fallback USD).

// Default (rest of world): USD 4.99 / month · 39.99 / year
const DEFAULT_PRICE = {
  country: 'US',
  currency: 'USD',
  monthly: 499,
  yearly: 3999,
};

// Stripe supports charging in the LOCAL currency of these markets.
// Every market outside this map gracefully falls back to USD.
const PRICES = {
  // ── North America ──
  US: { country: 'US', currency: 'USD', monthly: 499, yearly: 3999 },
  CA: { country: 'CA', currency: 'CAD', monthly: 499, yearly: 3999 },
  MX: { country: 'MX', currency: 'MXN', monthly: 4900, yearly: 39900 },
  // ── Europe (Stripe euro countries) ──
  DE: { country: 'DE', currency: 'EUR', monthly: 449, yearly: 3499 },
  FR: { country: 'FR', currency: 'EUR', monthly: 449, yearly: 3499 },
  IT: { country: 'IT', currency: 'EUR', monthly: 449, yearly: 3499 },
  ES: { country: 'ES', currency: 'EUR', monthly: 449, yearly: 3499 },
  NL: { country: 'NL', currency: 'EUR', monthly: 449, yearly: 3499 },
  BE: { country: 'BE', currency: 'EUR', monthly: 449, yearly: 3499 },
  AT: { country: 'AT', currency: 'EUR', monthly: 449, yearly: 3499 },
  IE: { country: 'IE', currency: 'EUR', monthly: 449, yearly: 3499 },
  PT: { country: 'PT', currency: 'EUR', monthly: 449, yearly: 3499 },
  GR: { country: 'GR', currency: 'EUR', monthly: 449, yearly: 3499 },
  FI: { country: 'FI', currency: 'EUR', monthly: 449, yearly: 3499 },
  SK: { country: 'SK', currency: 'EUR', monthly: 449, yearly: 3499 },
  SI: { country: 'SI', currency: 'EUR', monthly: 449, yearly: 3499 },
  LU: { country: 'LU', currency: 'EUR', monthly: 449, yearly: 3499 },
  LT: { country: 'LT', currency: 'EUR', monthly: 449, yearly: 3499 },
  LV: { country: 'LV', currency: 'EUR', monthly: 449, yearly: 3499 },
  EE: { country: 'EE', currency: 'EUR', monthly: 449, yearly: 3499 },
  GB: { country: 'GB', currency: 'GBP', monthly: 399, yearly: 2999 },
  CH: { country: 'CH', currency: 'CHF', monthly: 399, yearly: 2999 },
  SE: { country: 'SE', currency: 'SEK', monthly: 2900, yearly: 22900 },
  NO: { country: 'NO', currency: 'NOK', monthly: 2900, yearly: 22900 },
  DK: { country: 'DK', currency: 'DKK', monthly: 1900, yearly: 14900 },
  PL: { country: 'PL', currency: 'PLN', monthly: 999, yearly: 7999 },
  CZ: { country: 'CZ', currency: 'CZK', monthly: 4900, yearly: 39900 },
  HU: { country: 'HU', currency: 'HUF', monthly: 499, yearly: 3990 },
  RO: { country: 'RO', currency: 'RON', monthly: 999, yearly: 7999 },
  BG: { country: 'BG', currency: 'BGN', monthly: 499, yearly: 3999 },
  HR: { country: 'HR', currency: 'EUR', monthly: 449, yearly: 3499 },
  RS: { country: 'RS', currency: 'USD', monthly: 199, yearly: 1499 },
  UA: { country: 'UA', currency: 'USD', monthly: 199, yearly: 1499 },
  // ── Middle East ──
  EG: { country: 'EG', currency: 'EGP', monthly: 2900, yearly: 24900 }, // 29 EGP / 249 EGP
  SA: { country: 'SA', currency: 'SAR', monthly: 999, yearly: 7999 },
  AE: { country: 'AE', currency: 'AED', monthly: 999, yearly: 7999 },
  QA: { country: 'QA', currency: 'QAR', monthly: 999, yearly: 7999 },
  KW: { country: 'KW', currency: 'KWD', monthly: 99, yearly: 799 }, // 0.99 / 7.99 KWD
  BH: { country: 'BH', currency: 'BHD', monthly: 99, yearly: 799 },
  OM: { country: 'OM', currency: 'OMR', monthly: 99, yearly: 799 },
  JO: { country: 'JO', currency: 'JOD', monthly: 199, yearly: 1499 },
  LB: { country: 'LB', currency: 'USD', monthly: 199, yearly: 1499 },
  IQ: { country: 'IQ', currency: 'USD', monthly: 199, yearly: 1499 },
  PS: { country: 'PS', currency: 'USD', monthly: 199, yearly: 1499 },
  YE: { country: 'YE', currency: 'USD', monthly: 199, yearly: 1499 },
  SY: { country: 'SY', currency: 'USD', monthly: 199, yearly: 1499 },
  // ── North Africa ──
  MA: { country: 'MA', currency: 'MAD', monthly: 1900, yearly: 14900 },
  DZ: { country: 'DZ', currency: 'DZD', monthly: 9900, yearly: 79900 },
  TN: { country: 'TN', currency: 'USD', monthly: 199, yearly: 1499 },
  LY: { country: 'LY', currency: 'USD', monthly: 199, yearly: 1499 },
  SD: { country: 'SD', currency: 'USD', monthly: 199, yearly: 1499 },
  // ── Asia ──
  TR: { country: 'TR', currency: 'TRY', monthly: 2900, yearly: 24900 },
  IN: { country: 'IN', currency: 'INR', monthly: 4900, yearly: 39900 },
  PK: { country: 'PK', currency: 'PKR', monthly: 19900, yearly: 159900 },
  BD: { country: 'BD', currency: 'BDT', monthly: 9900, yearly: 79900 },
  LK: { country: 'LK', currency: 'LKR', monthly: 9900, yearly: 79900 },
  NP: { country: 'NP', currency: 'USD', monthly: 199, yearly: 1499 },
  ID: { country: 'ID', currency: 'IDR', monthly: 1990000, yearly: 15900000 },
  MY: { country: 'MY', currency: 'MYR', monthly: 999, yearly: 7999 },
  SG: { country: 'SG', currency: 'SGD', monthly: 499, yearly: 3999 },
  TH: { country: 'TH', currency: 'THB', monthly: 4900, yearly: 39900 },
  VN: { country: 'VN', currency: 'USD', monthly: 199, yearly: 1499 },
  PH: { country: 'PH', currency: 'PHP', monthly: 9900, yearly: 79900 },
  CN: { country: 'CN', currency: 'CNY', monthly: 1900, yearly: 14900 },
  JP: { country: 'JP', currency: 'JPY', monthly: 490, yearly: 3900 },
  KR: { country: 'KR', currency: 'KRW', monthly: 2900, yearly: 22900 },
  KZ: { country: 'KZ', currency: 'USD', monthly: 199, yearly: 1499 },
  IL: { country: 'IL', currency: 'ILS', monthly: 999, yearly: 7999 },
  // ── Africa (Sub-Saharan) ──
  NG: { country: 'NG', currency: 'USD', monthly: 199, yearly: 1499 },
  KE: { country: 'KE', currency: 'USD', monthly: 199, yearly: 1499 },
  GH: { country: 'GH', currency: 'USD', monthly: 199, yearly: 1499 },
  ET: { country: 'ET', currency: 'USD', monthly: 199, yearly: 1499 },
  TZ: { country: 'TZ', currency: 'USD', monthly: 199, yearly: 1499 },
  UG: { country: 'UG', currency: 'USD', monthly: 199, yearly: 1499 },
  ZA: { country: 'ZA', currency: 'ZAR', monthly: 2900, yearly: 22900 },
  // ── Oceania ──
  AU: { country: 'AU', currency: 'AUD', monthly: 499, yearly: 3999 },
  NZ: { country: 'NZ', currency: 'NZD', monthly: 499, yearly: 3999 },
  // ── Americas (South) ──
  BR: { country: 'BR', currency: 'BRL', monthly: 999, yearly: 7999 },
  AR: { country: 'AR', currency: 'USD', monthly: 199, yearly: 1499 },
  CL: { country: 'CL', currency: 'CLP', monthly: 199, yearly: 1499 }, // CLP is 0-decimal → 199 CLP
  CO: { country: 'CO', currency: 'COP', monthly: 199, yearly: 1499 }, // 0-decimal
  PE: { country: 'PE', currency: 'PEN', monthly: 499, yearly: 3999 },
};

// IANA timezone → ISO country (used when the geo header is absent —
// covers the sandbox preview and any host without Vercel geolocation).
const TZ_COUNTRY = [
  [/Africa\/Cairo/, 'EG'],
  [/Africa\/(Lagos|Accra|Nairobi|Addis_Ababa|Dar_es_Salaam|Kampala|Algiers|Tunis|Tripoli|Casablanca|Johannesburg|Khartoum)/, 'XX'], // resolved below
  [/Africa\/Johannesburg/, 'ZA'],
  [/Africa\/Lagos/, 'NG'],
  [/Africa\/Accra/, 'GH'],
  [/Africa\/Nairobi/, 'KE'],
  [/Africa\/Algiers/, 'DZ'],
  [/Africa\/Tunis/, 'TN'],
  [/Africa\/Casablanca/, 'MA'],
  [/Africa\/Khartoum/, 'SD'],
  [/Asia\/(Dubai|Abu_Dhabi|Muscat)/, 'AE'],
  [/Asia\/(Riyadh|Aden)/, 'SA'],
  [/Asia\/Kuwait/, 'KW'],
  [/Asia\/Bahrain/, 'BH'],
  [/Asia\/Qatar/, 'QA'],
  [/Asia\/Amman/, 'JO'],
  [/Asia\/Beirut/, 'LB'],
  [/Asia\/Baghdad/, 'IQ'],
  [/Asia\/(Gaza|Hebron)/, 'PS'],
  [/Asia\/Damascus/, 'SY'],
  [/Asia\/Jerusalem/, 'IL'],
  [/Asia\/Tehran/, 'TR'],
  [/Europe\/Istanbul/, 'TR'],
  [/Asia\/Karachi/, 'PK'],
  [/Asia\/(Kolkata|Calcutta)/, 'IN'],
  [/Asia\/Dhaka/, 'BD'],
  [/Asia\/Colombo/, 'LK'],
  [/Asia\/Kathmandu/, 'NP'],
  [/Asia\/(Jakarta|Pontianak|Makassar|Jayapura)/, 'ID'],
  [/Asia\/(Kuala_Lumpur|Kuching)/, 'MY'],
  [/Asia\/Singapore/, 'SG'],
  [/Asia\/Bangkok/, 'TH'],
  [/Asia\/(Saigon|Ho_Chi_Minh)/, 'VN'],
  [/Asia\/Manila/, 'PH'],
  [/Asia\/(Shanghai|Chongqing|Urumqi)/, 'CN'],
  [/Asia\/(Tokyo|Osaka)/, 'JP'],
  [/Asia\/(Seoul|Pyongyang)/, 'KR'],
  [/Asia\/Almaty/, 'KZ'],
  [/Australia\/(Sydney|Melbourne|Brisbane|Perth|Adelaide)/, 'AU'],
  [/Pacific\/Auckland/, 'NZ'],
  [/America\/(Sao_Paulo|Bahia|Fortaleza|Recife)/, 'BR'],
  [/America\/(Argentina|Buenos_Aires)/, 'AR'],
  [/America\/(Santiago|Punta_Arenas)/, 'CL'],
  [/America\/(Bogota|Lima|Mexico_City|Cancun|New_York|Chicago|Denver|Los_Angeles|Toronto|Vancouver|Phoenix)/, 'XX'],
  [/America\/Bogota/, 'CO'],
  [/America\/Lima/, 'PE'],
  [/America\/Mexico_City/, 'MX'],
  [/America\/New_York/, 'US'],
  [/America\/Chicago/, 'US'],
  [/America\/Denver/, 'US'],
  [/America\/Los_Angeles/, 'US'],
  [/America\/Toronto/, 'CA'],
  [/America\/Vancouver/, 'CA'],
  [/Europe\/(London|Dublin|Lisbon)/, 'GB'],
  [/Europe\/Paris/, 'FR'],
  [/Europe\/Berlin/, 'DE'],
  [/Europe\/(Madrid|Canary)/, 'ES'],
  [/Europe\/Rome/, 'IT'],
  [/Europe\/Amsterdam/, 'NL'],
  [/Europe\/Brussels/, 'BE'],
  [/Europe\/Vienna/, 'AT'],
  [/Europe\/Zurich/, 'CH'],
  [/Europe\/Stockholm/, 'SE'],
  [/Europe\/Oslo/, 'NO'],
  [/Europe\/Copenhagen/, 'DK'],
  [/Europe\/(Warsaw|Krakow)/, 'PL'],
  [/Europe\/Prague/, 'CZ'],
  [/Europe\/Budapest/, 'HU'],
  [/Europe\/(Bucharest|Chisinau)/, 'RO'],
  [/Europe\/Sofia/, 'BG'],
  [/Europe\/Athens/, 'GR'],
  [/Europe\/Helsinki/, 'FI'],
  [/Europe\/Kyiv|Europe\/Kiev|Europe\/Moscow|Europe\/Minsk/, 'UA'],
  [/Europe\/Belgrade/, 'RS'],
];

/** Resolve the pricing row for a country code (or null → default). */
function priceForCountry(country) {
  const cc = String(country || '').toUpperCase();
  const row = PRICES[cc];
  return row ? { country: row.country, currency: row.currency, monthly: row.monthly, yearly: row.yearly } : Object.assign({}, DEFAULT_PRICE);
}

/** Guess the country from an IANA timezone string. */
function countryFromTimezone(tz) {
  if (!tz) return null;
  for (let i = 0; i < TZ_COUNTRY.length; i++) {
    const re = TZ_COUNTRY[i][0];
    const cc = TZ_COUNTRY[i][1];
    if (re.test(tz)) {
      if (cc !== 'XX') return cc;
      // Generic rule matched — find the most specific one for this tz
      break;
    }
  }
  // Second pass: most specific matches first (they are listed later for
  // generic zones, so re-scan and prefer an entry whose regex matched and
  // is NOT the XX sentinel).
  for (let j = 0; j < TZ_COUNTRY.length; j++) {
    if (TZ_COUNTRY[j][0].test(tz) && TZ_COUNTRY[j][1] !== 'XX') return TZ_COUNTRY[j][1];
  }
  return null;
}

/**
 * Resolve pricing from geo header / explicit country / IANA timezone.
 * NOTE: composed manually (NOT a || chain) — priceForCountry() ALWAYS
 * returns a row (DEFAULT for unknown), so a naive chain would short-circuit
 * on the first call and pin USD. Identical to api/premium/price.js.
 */
function resolvePrice(opts) {
  const cc =
    (opts && opts.geoCountry) ||
    (opts && opts.country) ||
    countryFromTimezone(opts && opts.timezone) ||
    '';
  return priceForCountry(cc);
}

/** Format minor units as a display string — CURRENCY CODE, never a symbol. */
function formatPrice(minor, currency) {
  const zeroDecimal = ['JPY', 'KRW', 'VND', 'CLP', 'COP', 'IDR', 'HUF'].indexOf(String(currency)) !== -1;
  const value = zeroDecimal ? minor : minor / 100;
  const str = zeroDecimal
    ? String(Math.round(value))
    : value.toFixed(2).replace(/\.00$/, '');
  return str + ' ' + String(currency);
}

/** Does Stripe support charging in this currency? */
function stripeSupportsCurrency(currency) {
  const supported = [
    'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'CHF', 'SEK', 'NOK', 'DKK',
    'PLN', 'CZK', 'HUF', 'RON', 'BGN', 'SGD', 'HKD', 'JPY', 'MXN', 'BRL',
    'INR', 'MYR', 'THB', 'AED', 'SAR', 'ILS', 'ZAR', 'KRW', 'CNB', 'CNY',
  ];
  return supported.indexOf(String(currency)) !== -1;
}

module.exports = {
  priceForCountry,
  countryFromTimezone,
  resolvePrice,
  formatPrice,
  stripeSupportsCurrency,
  DEFAULT_PRICE,
};
