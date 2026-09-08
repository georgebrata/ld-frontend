/**
 * Server-side quoting. Provider cost stays private. Retail currency, rate unit,
 * markup, and FX are explicit configuration — never inferred from PHP samples.
 */

import { applyMarkup, convertMinor, parseDecimalToMinor, quoteTotalMinor, quoteVersion } from './money.js';
import { billableQuantityForType, getProviderType } from './provider-types.js';
import { normalizeProviderService } from './socialpanel24.js';

/**
 * @param {Array<Record<string, unknown>>} catalog
 * @param {string} socialpanelId
 */
export function findProviderService(catalog, socialpanelId) {
  const id = String(socialpanelId ?? '').trim();
  if (!id) return null;
  const row = catalog.find((entry) => String(entry.service ?? entry.id ?? '') === id);
  return row ? normalizeProviderService(row) : null;
}

/**
 * @param {{
 *   retail: import('./retail-catalogue.js').RetailService,
 *   provider: ReturnType<typeof normalizeProviderService>,
 *   quantity: number,
 *   inputs?: Record<string, string>,
 *   retailCurrency: string,
 *   providerCurrency: string,
 *   fxProviderToRetail: number,
 *   dripRuns?: number
 * }} args
 */
export function quoteService(args) {
  const { retail, provider } = args;
  if (!retail?.visible) {
    return { ok: false, error: 'That service is not available.', code: 'unavailable' };
  }
  if (!retail.socialpanelId) {
    return { ok: false, error: 'That service cannot be purchased right now.', code: 'unmapped' };
  }
  if (!provider) {
    return { ok: false, error: 'That service cannot be purchased right now.', code: 'unmapped' };
  }

  const typeHandler = getProviderType(provider.type);
  if (!typeHandler || !typeHandler.enabled) {
    return { ok: false, error: 'That service type is not supported.', code: 'unsupported_type' };
  }

  const min = Number.isFinite(provider.min) ? provider.min : 1;
  const max = Number.isFinite(provider.max) ? provider.max : 10_000_000;

  let billable;
  try {
    if (typeHandler.quantityMode === 'from_comments' && !String(args.inputs?.comments || '').trim()) {
      billable = args.quantity || 1;
    } else {
      billable = billableQuantityForType(provider.type, {
        platform: retail.platform,
        quantity: args.quantity,
        inputs: args.inputs || {},
      });
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Invalid quantity.', code: 'quantity' };
  }

  if (typeHandler.quantityMode !== 'package' && typeHandler.quantityMode !== 'omit') {
    if (billable < min) {
      return { ok: false, error: `Quantity must be at least ${min}.`, code: 'quantity' };
    }
    if (billable > max) {
      return { ok: false, error: `Quantity cannot exceed ${max}.`, code: 'quantity' };
    }
  }

  const runs = args.dripRuns && args.dripRuns > 1 ? args.dripRuns : 1;
  const pricedQuantity = typeHandler.quantityMode === 'package' ? 1 : billable * runs;

  const providerMinor = parseDecimalToMinor(provider.rate, args.providerCurrency);
  if (providerMinor == null) {
    return { ok: false, error: 'This service cannot be priced right now.', code: 'unpriced' };
  }

  let converted;
  try {
    converted = convertMinor(providerMinor, args.providerCurrency, args.retailCurrency, args.fxProviderToRetail);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Currency conversion is not configured.', code: 'fx' };
  }

  const markup = Number(retail.markupMultiplier);
  let retailRateMinor;
  try {
    retailRateMinor = applyMarkup(converted, markup);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Invalid markup.', code: 'markup' };
  }

  const rateUnit = retail.rateUnit;
  let amountMinor;
  try {
    amountMinor = quoteTotalMinor({
      rateMinor: retailRateMinor,
      quantity: pricedQuantity,
      rateUnit,
      packageMinor: retail.packagePriceMinor ?? retailRateMinor,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not calculate the total.', code: 'quote' };
  }

  if (amountMinor < 1) {
    return { ok: false, error: 'This service cannot be priced right now.', code: 'unpriced' };
  }

  const quote = {
    ok: true,
    serviceId: retail.id,
    quantity: args.quantity,
    billableQuantity: billable,
    dripRuns: runs,
    pricedQuantity,
    amountMinor,
    currency: args.retailCurrency,
    rateUnit,
    retailRateMinor,
    quantityMin: min,
    quantityMax: max,
    quantityStep: retail.quantityStep,
    quantityDefault: retail.quantityDefault,
    markup,
    providerType: provider.type,
    providerServiceId: provider.service,
  };
  quote.quoteVersion = quoteVersion(quote);
  return quote;
}

/**
 * Public catalogue fields only — no provider ids, rates, or costs.
 * @param {object} internal
 */
export function toPublicService(internal) {
  return {
    id: internal.id,
    platform: internal.platform,
    platformLabel: internal.platformLabel,
    type: internal.type,
    service: internal.service,
    label: internal.label,
    description: internal.description,
    enabled: internal.enabled,
    purchasable: internal.purchasable,
    inputs: internal.inputs,
    quantityMin: internal.quantityMin,
    quantityMax: internal.quantityMax,
    quantityStep: internal.quantityStep,
    quantityDefault: internal.quantityDefault,
    currency: internal.currency,
    retailRateMinor: internal.retailRateMinor,
    rateUnit: internal.rateUnit,
    quantityMode: internal.quantityMode,
  };
}
