/**
 * Join retail catalogue with SocialPanel24 services. Cache TTL is 5 minutes;
 * stale cache (up to 1 hour) is served if the provider is down.
 */

import { loadRetailCatalogue } from './retail-adapter.js';
import { fetchProviderServices, normalizeProviderService } from './socialpanel24.js';
import { findProviderService, quoteService, toPublicService } from './pricing.js';
import { getProviderType, isSupportedProviderType } from './provider-types.js';
import { parseInputList } from './inputs.js';

export const CATALOGUE_TTL_MS = 5 * 60 * 1000;
export const CATALOGUE_STALE_MS = 60 * 60 * 1000;
export const PROVIDER_TIMEOUT_MS = 8000;

const memory = {
  public: /** @type {{ expires: number, staleUntil: number, payload: object }|null} */ (null),
  provider: /** @type {{ expires: number, services: any[] }|null} */ (null),
};

/**
 * @param {object} env
 */
export function pricingEnv(env) {
  return {
    retailCurrency: String(env.RETAIL_CURRENCY || 'USD').toUpperCase(),
    providerCurrency: String(env.PROVIDER_CURRENCY || env.RETAIL_CURRENCY || 'USD').toUpperCase(),
    fxProviderToRetail: Number(env.FX_PROVIDER_TO_RETAIL || 1),
    defaultMarkup: Number(env.MARKUP_MULTIPLIER || 2),
  };
}

/**
 * @param {object} env
 * @param {object} deps
 */
export async function getProviderCatalog(env, deps = {}) {
  const now = deps.now ? deps.now() : Date.now();
  if (memory.provider && memory.provider.expires > now) return memory.provider.services;
  if (deps.cacheGet) {
    const cached = await deps.cacheGet('sp24:services');
    if (cached && Array.isArray(cached.services) && cached.expires > now) {
      memory.provider = { expires: cached.expires, services: cached.services };
      return cached.services;
    }
  }

  const services = await fetchProviderServices({
    apiKey: env.SOCIALPANEL24_API_KEY,
    fetchImpl: deps.fetchImpl,
    timeoutMs: Number(env.SOCIALPANEL24_TIMEOUT_MS || PROVIDER_TIMEOUT_MS),
  });
  const normalized = services.map((row) => normalizeProviderService(row));
  const expires = now + CATALOGUE_TTL_MS;
  memory.provider = { expires, services: normalized };
  if (deps.cacheSet && normalized.length) {
    await deps.cacheSet('sp24:services', { expires, services: normalized }, CATALOGUE_STALE_MS);
  }
  return normalized;
}

/**
 * @param {import('./retail-catalogue.js').RetailService} retail
 * @param {ReturnType<typeof normalizeProviderService>|null} provider
 * @param {ReturnType<typeof pricingEnv>} money
 */
export function joinService(retail, provider, money) {
  const label = `${retail.platformLabel} ${retail.service}`.trim();
  const typeHandler = provider ? getProviderType(provider.type) : null;
  const supported = Boolean(provider && typeHandler && typeHandler.enabled);
  const mapped = Boolean(retail.socialpanelId && provider);
  const enabled = Boolean(retail.visible && mapped && supported);

  const probeQty = retail.quantityDefault || provider?.min || 1;
  const quote = enabled
    ? quoteService({
        retail,
        provider,
        quantity: probeQty,
        inputs: {},
        retailCurrency: money.retailCurrency,
        providerCurrency: money.providerCurrency,
        fxProviderToRetail: money.fxProviderToRetail,
      })
    : { ok: false };

  const inputs = retail.inputs.length
    ? retail.inputs
    : typeHandler
      ? typeHandler.storefrontInputs
      : parseInputList('');

  return {
    id: retail.id,
    platform: retail.platform,
    platformLabel: retail.platformLabel,
    type: provider?.type || '',
    service: retail.service,
    label,
    description: retail.description,
    enabled,
    purchasable: Boolean(enabled && quote.ok),
    inputs,
    quantityMin: quote.ok ? quote.quantityMin : provider?.min ?? null,
    quantityMax: quote.ok ? quote.quantityMax : provider?.max ?? null,
    quantityStep: retail.quantityStep,
    quantityDefault: retail.quantityDefault,
    currency: money.retailCurrency,
    retailRateMinor: quote.ok ? quote.retailRateMinor : null,
    rateUnit: retail.rateUnit,
    quantityMode:
      typeHandler?.quantityMode ||
      (retail.inputs.includes('comments') ? 'from_comments' : 'required'),
    socialpanelId: retail.socialpanelId,
    providerServiceId: provider?.service || '',
    providerType: provider?.type || '',
    providerMin: provider?.min ?? null,
    providerMax: provider?.max ?? null,
    providerRate: provider?.rate || '',
    refill: Boolean(provider?.refill),
    cancel: Boolean(provider?.cancel),
    dripEnabled: retail.dripEnabled,
    markupMultiplier: retail.markupMultiplier,
    packagePriceMinor: retail.packagePriceMinor,
    disableReason: enabled
      ? ''
      : !retail.visible
        ? 'hidden'
        : !retail.socialpanelId
          ? 'unmapped'
          : !provider
            ? 'missing'
            : !isSupportedProviderType(provider.type)
              ? 'unsupported_type'
              : 'unavailable',
  };
}

/**
 * @param {object} env
 * @param {object} [deps]
 */
export async function buildCatalogue(env, deps = {}) {
  const money = pricingEnv(env);
  const retail = await loadRetailCatalogue({
    sheetUrl: env.RETAIL_CATALOGUE_URL,
    socialpanelIds: env.RETAIL_SOCIALPANEL_IDS,
    fetchImpl: deps.fetchImpl,
    timeoutMs: Number(env.CATALOGUE_TIMEOUT_MS || 8000),
    defaultCurrency: money.retailCurrency,
    defaultMarkup: money.defaultMarkup,
  });

  let providerRows = [];
  let providerError = '';
  try {
    providerRows = await getProviderCatalog(env, deps);
  } catch (err) {
    providerError = err instanceof Error ? err.message : 'provider_unavailable';
    if (deps.cacheGet) {
      const stale = await deps.cacheGet('sp24:services');
      if (stale && Array.isArray(stale.services)) providerRows = stale.services;
    } else if (memory.provider?.services) {
      providerRows = memory.provider.services;
    }
  }

  const internals = retail.map((row) => {
    const provider = findProviderService(providerRows, row.socialpanelId);
    return joinService(row, provider, money);
  });

  return {
    internals,
    publicServices: internals
      .filter((row) => row.disableReason !== 'hidden')
      .map(toPublicServiceFromInternal),
    providerError,
    money,
  };
}

/**
 * @param {ReturnType<typeof joinService>} internal
 */
function toPublicServiceFromInternal(internal) {
  return toPublicService({
    ...internal,
    enabled: internal.enabled,
    purchasable: internal.purchasable,
  });
}

/**
 * Cached public catalogue.
 * @param {object} env
 * @param {object} [deps]
 */
export async function getPublicCatalogue(env, deps = {}) {
  const now = deps.now ? deps.now() : Date.now();
  if (memory.public && memory.public.expires > now) {
    return { ...memory.public.payload, cache: 'memory' };
  }
  if (deps.cacheGet) {
    const cached = await deps.cacheGet('catalogue:public');
    if (cached && cached.expires > now) {
      memory.public = cached;
      return { ...cached.payload, cache: 'store' };
    }
  }

  try {
    const built = await buildCatalogue(env, deps);
    const payload = {
      ok: true,
      data: built.publicServices,
      generatedAt: new Date(now).toISOString(),
      ttlSeconds: Math.round(CATALOGUE_TTL_MS / 1000),
    };
    const providerOk = !built.providerError;
    const ttl = providerOk ? CATALOGUE_TTL_MS : 30 * 1000;
    const entry = {
      expires: now + ttl,
      staleUntil: providerOk ? now + CATALOGUE_STALE_MS : now + ttl,
      payload,
    };
    memory.public = entry;
    if (deps.cacheSet && providerOk) await deps.cacheSet('catalogue:public', entry, CATALOGUE_STALE_MS);
    return { ...payload, cache: 'fresh' };
  } catch (err) {
    if (memory.public && memory.public.staleUntil > now) {
      return { ...memory.public.payload, cache: 'stale', warning: 'refresh_failed' };
    }
    if (deps.cacheGet) {
      const stale = await deps.cacheGet('catalogue:public');
      if (stale && stale.staleUntil > now) {
        return { ...stale.payload, cache: 'stale', warning: 'refresh_failed' };
      }
    }
    throw err;
  }
}

/**
 * @param {object} env
 * @param {string} serviceId
 * @param {object} [deps]
 */
export async function getInternalService(env, serviceId, deps = {}) {
  const built = await buildCatalogue(env, deps);
  return built.internals.find((row) => row.id === serviceId) || null;
}

export function clearCatalogueMemory() {
  memory.public = null;
  memory.provider = null;
}
