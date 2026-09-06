import { applyMarkup, toCents, totalInCents } from './money.js';
import * as socialPanel from './socialPanel.js';

const CACHE_TTL = 600;

/**
 * @param {import('./store.js').createStore extends Function ? any : never} store
 * @param {Record<string, string>} env
 */
export async function getSp24Services(store, env) {
  const cached = await store.get('sp24:services');
  if (Array.isArray(cached) && cached.length) return cached;
  const services = await socialPanel.getServices(env);
  await store.put('sp24:services', services, CACHE_TTL);
  return services;
}

/**
 * @param {Array<Record<string, unknown>>} catalog
 * @param {string} socialpanelId
 */
export function findSp24Service(catalog, socialpanelId) {
  const id = String(socialpanelId ?? '').trim();
  if (!id) return null;
  return (
    catalog.find((row) => String(row.service ?? row.id ?? '') === id) ?? null
  );
}

/**
 * @param {Record<string, unknown>} sp24
 * @param {number} quantity
 * @param {number} markup
 */
export function quoteFromSp24(sp24, quantity, markup = 2) {
  if (!sp24) return { ok: false, error: 'This service cannot be priced right now.' };
  const min = Number(sp24.min);
  const max = Number(sp24.max);
  if (Number.isFinite(min) && quantity < min) {
    return { ok: false, error: `Quantity must be at least ${min}.` };
  }
  if (Number.isFinite(max) && quantity > max) {
    return { ok: false, error: `Quantity cannot exceed ${max}.` };
  }
  const rateCents = toCents(sp24.rate);
  if (rateCents == null) {
    return { ok: false, error: 'This service cannot be priced right now.' };
  }
  const unitPriceInCents = applyMarkup(rateCents, markup);
  return {
    ok: true,
    unitPriceInCents,
    totalInCents: totalInCents(unitPriceInCents, quantity),
    quantityMin: Number.isFinite(min) ? min : 1,
    quantityMax: Number.isFinite(max) ? max : 10000000,
  };
}
