import { CONFIG } from '../config.js';
import { invokeFunction } from '../lib/supabase-client.js';
import { isVisible } from '../utils/visibility.js';
import { toPlatformSlug } from '../utils/platform-icons.js';
import { assignServiceSlugs } from '../utils/slugs.js';
import { parseInputList } from '../utils/inputs.js';

/** @type {import('../types.js').Service[]|null} */
let cache = null;

function readBootstrap() {
  if (typeof document === 'undefined') return null;
  const el = document.getElementById('services-data');
  if (!el) return null;
  try {
    const parsed = JSON.parse(el.textContent || '');
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.services)) return parsed.services;
  } catch {
    return null;
  }
  return null;
}

export function readBootstrapPhrases() {
  if (typeof document === 'undefined') return null;
  const el = document.getElementById('services-data');
  if (!el) return null;
  try {
    const parsed = JSON.parse(el.textContent || '');
    if (parsed && Array.isArray(parsed.phrases) && parsed.phrases.length) return parsed.phrases;
  } catch {
    return null;
  }
  return null;
}

/**
 * Normalize a public catalogue / sheet row.
 * @param {Record<string, unknown>} row
 */
export function normalizeService(row) {
  const platformLabel = String(row.platformLabel ?? row.Platform ?? row.platform ?? '').trim();
  const platform = toPlatformSlug(String(row.platform ?? platformLabel));
  const service = String(row.service ?? row.Service ?? '').trim();
  const id = String(row.id ?? row.ID ?? row.serviceId ?? '').trim();
  const listed = isVisible(row.Visible ?? row.visible ?? true);
  const enabled = row.enabled == null ? listed : Boolean(row.enabled);
  return {
    id,
    platform,
    platformLabel: platformLabel || platform,
    service,
    label: String(row.label ?? `${platformLabel} ${service}`.trim()),
    description: String(row.description ?? row.Description ?? '').trim(),
    type: String(row.type ?? ''),
    inputs: parseInputList(row.inputs ?? row.Inputs ?? ''),
    visible: listed,
    enabled,
    purchasable: enabled && row.purchasable === true,
    quantityMin: row.quantityMin == null ? null : Number(row.quantityMin),
    quantityMax: row.quantityMax == null ? null : Number(row.quantityMax),
    quantityStep: row.quantityStep == null ? 1 : Number(row.quantityStep),
    quantityDefault: row.quantityDefault == null ? null : Number(row.quantityDefault),
    currency: String(row.currency ?? 'USD'),
    retailRateMinor: row.retailRateMinor == null ? null : Number(row.retailRateMinor),
    rateUnit: String(row.rateUnit ?? ''),
    quantityMode:
      row.quantityMode != null && String(row.quantityMode)
        ? String(row.quantityMode)
        : parseInputList(row.inputs ?? row.Inputs ?? '').includes('comments')
          ? 'from_comments'
          : 'required',
    price: row.price == null ? null : Number(row.price),
    slug: row.slug ? String(row.slug) : undefined,
    url: row.url ? String(row.url) : undefined,
  };
}

export function toPublicService(service) {
  const { socialpanelId: _hidden, providerServiceId: _p, ...pub } = /** @type {any} */ (service);
  return pub;
}

export function parseInputs(raw) {
  return parseInputList(raw);
}

async function fetchLiveCatalogue() {
  const { response, json } = await invokeFunction('catalogue', { method: 'GET' });
  if (!response.ok || !json.ok || !Array.isArray(json.data)) {
    throw new Error('Invalid services response');
  }
  return assignServiceSlugs(json.data.map(normalizeService).filter((s) => s.visible)).map((service) =>
    toPublicService({
      ...service,
      url: service.url ?? `/${service.platform}/${service.slug}/`,
    })
  );
}

export async function getServices(options = {}) {
  if (cache && !options.force) return cache;

  if (!options.force) {
    try {
      if (CONFIG.SUPABASE_URL || CONFIG.SUPABASE_FUNCTIONS_URL) {
        cache = await fetchLiveCatalogue();
        return cache;
      }
    } catch {
      /* fall through to bootstrap */
    }
    const boot = readBootstrap();
    if (boot && boot.length) {
      cache = assignServiceSlugs(boot.map((service) => toPublicService(normalizeService(service))));
      return cache;
    }
  }

  if (CONFIG.SUPABASE_URL || CONFIG.SUPABASE_FUNCTIONS_URL) {
    cache = await fetchLiveCatalogue();
    return cache;
  }

  throw new Error('Catalogue is not configured.');
}

export async function getServiceById(id) {
  const services = await getServices();
  return services.find((s) => s.id === id);
}

/** @deprecated */
export const getService = getServiceById;

export function groupByPlatform(services) {
  /** @type {Record<string, import('../types.js').Service[]>} */
  const groups = {};
  services.forEach((service) => {
    if (!groups[service.platform]) groups[service.platform] = [];
    groups[service.platform].push(service);
  });
  return groups;
}

export function getUniquePlatforms(services) {
  /** @type {Map<string, import('../types.js').PlatformSummary>} */
  const map = new Map();
  services.forEach((service) => {
    if (!map.has(service.platform)) {
      map.set(service.platform, {
        platform: service.platform,
        platformLabel: service.platformLabel,
        url: `/${service.platform}/`,
      });
    }
  });
  return Array.from(map.values());
}

export const servicesApi = {
  parseInputs,
  normalizeService,
  getServices,
  getService,
  getServiceById,
  groupByPlatform,
  getUniquePlatforms,
  readBootstrapPhrases,
};
