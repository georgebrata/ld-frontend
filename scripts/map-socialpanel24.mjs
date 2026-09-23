/**
 * Fetch SocialPanel24 services and print suggested retail mappings.
 * Usage: SOCIALPANEL24_API_KEY=… node scripts/map-socialpanel24.mjs
 * Does not write retail-catalogue.js; copy ids after you confirm type/rate unit.
 */
import { fetchProviderServices, normalizeProviderService } from '../supabase/functions/_shared/socialpanel24.js';
import { RETAIL_CATALOGUE } from '../supabase/functions/_shared/retail-catalogue.js';
import { getProviderType } from '../supabase/functions/_shared/provider-types.js';

const key = String(process.env.SOCIALPANEL24_API_KEY || '').trim();
if (!key) {
  console.error('Set SOCIALPANEL24_API_KEY in the environment.');
  process.exit(1);
}

const GEO = /brazil|turkey|nigeria|france|afro|usa\b|europe|\buk\b|🇮🇳|🇺🇸|🇧🇷|🇹🇷|🇳🇬|🇫🇷|🇩🇪/i;

function expectedType(retail) {
  return retail.inputs.includes('comments') ? 'Custom Comments' : 'Default';
}

function haystack(provider) {
  return `${provider.category} ${provider.name} ${provider.type}`.toLowerCase();
}

function nameMatchesService(retail, provider) {
  const name = String(provider.name || '').toLowerCase();
  switch (retail.service.toLowerCase()) {
    case 'likes':
      return (
        /\blikes?\b/.test(name) &&
        !/\bsaves?\b/.test(name) &&
        !/live stream/.test(name) &&
        !/comment like/.test(name) &&
        !/\bbot\b/.test(name)
      );
    case 'followers':
      return /\bfollowers?\b/.test(name) && !/\bnft\b/.test(name);
    case 'comments':
      return /custom comment/.test(name) || /\bcomments?\b/.test(name);
    case 'subscribers':
      return /subscribers?/.test(name);
    case 'saves':
      return /\bsaves?\b/.test(name) && !/\blikes?\b/.test(name);
    default:
      return name.includes(retail.service.toLowerCase());
  }
}

function isWrongProduct(retail, provider) {
  return !nameMatchesService(retail, provider);
}

function score(retail, provider) {
  const hay = haystack(provider);
  const platform = retail.platform.toLowerCase();
  const service = retail.service.toLowerCase();
  let n = 0;
  if (hay.includes(platform)) n += 3;
  if (hay.includes(service) || (service === 'subscribers' && hay.includes('subscriber'))) n += 3;
  if (service === 'comments' && hay.includes('comment')) n += 2;
  const handler = getProviderType(provider.type);
  if (handler?.enabled) n += 1;
  if (retail.inputs.includes('comments') && String(provider.type).toLowerCase().includes('comment')) n += 4;
  if (provider.type === expectedType(retail)) n += 4;
  if (!GEO.test(provider.name)) n += 2;
  if (provider.refill) n += 2;
  if (isWrongProduct(retail, provider)) n -= 20;
  return n;
}

function probeQuantity(retail, provider) {
  return retail.quantityDefault || provider.min || 1;
}

function eligible(retail, provider) {
  if (provider.type !== expectedType(retail)) return false;
  if (isWrongProduct(retail, provider)) return false;
  const handler = getProviderType(provider.type);
  if (!handler?.enabled) return false;
  const hay = haystack(provider);
  if (!hay.includes(retail.platform.toLowerCase())) return false;
  const probe = probeQuantity(retail, provider);
  if (probe < provider.min || probe > provider.max) return false;
  return score(retail, provider) >= 6;
}

function retailTotalAtProbe(retail, provider, markup = 2) {
  const qty = probeQuantity(retail, provider);
  const perThousand = retail.rateUnit !== 'per_comment';
  const base = Number(provider.rate) * markup * qty;
  return perThousand ? base / 1000 : base;
}

function pickPreferred(retail, rows) {
  return (
    rows
      .filter((provider) => eligible(retail, provider))
      .sort((a, b) => {
        const geo = Number(GEO.test(a.name)) - Number(GEO.test(b.name));
        if (geo) return geo;
        const refill = Number(!a.refill) - Number(!b.refill);
        if (refill) return refill;
        const stripe = Number(retailTotalAtProbe(retail, a) < 0.5) - Number(retailTotalAtProbe(retail, b) < 0.5);
        if (stripe) return stripe;
        return Number(a.rate) - Number(b.rate);
      })[0] || null
  );
}

const rows = (await fetchProviderServices({ apiKey: key, fetchImpl: fetch })).map(normalizeProviderService);
if (!rows.length) {
  console.error('Provider returned no services.');
  process.exit(1);
}

console.log(`Fetched ${rows.length} provider services.\n`);
for (const retail of RETAIL_CATALOGUE) {
  const ranked = rows
    .map((provider) => ({ provider, score: score(retail, provider) }))
    .filter((row) => row.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  console.log(`${retail.id} ${retail.platformLabel} ${retail.service} (want ${retail.rateUnit}, inputs ${retail.inputs.join(',')})`);
  const preferred = pickPreferred(retail, rows);
  if (preferred) {
    console.log(
      `  PICK ${preferred.service}\t${preferred.type}\t${preferred.rate}\tmin ${preferred.min} max ${preferred.max}${
        preferred.refill ? '\tREFILL' : ''
      }  ${preferred.name}`
    );
  }
  if (!ranked.length) {
    console.log('  (no name match — search the full list manually)\n');
    continue;
  }
  ranked.forEach(({ provider, score: n }) => {
    const handler = getProviderType(provider.type);
    console.log(
      `  ${provider.service}\t${provider.type}\t${provider.rate}\tmin ${provider.min} max ${provider.max}\tscore ${n}${
        handler?.enabled ? '' : '\tUNSUPPORTED'
      }  ${provider.name}`
    );
  });
  console.log('');
}

const suggested = {};
for (const retail of RETAIL_CATALOGUE) {
  const preferred = pickPreferred(retail, rows);
  if (preferred) suggested[retail.id] = String(preferred.service);
}
console.log('Suggested RETAIL_SOCIALPANEL_IDS (confirm types/rates before saving):');
console.log(JSON.stringify(suggested));
