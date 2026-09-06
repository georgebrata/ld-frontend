import { CONFIG } from '../config.js';
import { isVisible } from '../utils/visibility.js';
import { toPlatformSlug } from '../utils/platform-icons.js';
import { assignServiceSlugs } from '../utils/slugs.js';

/** @type {import('../types.js').Service[]|null} */
let cache = null;

/**
 * Read prerendered services from #services-data.
 * @returns {import('../types.js').Service[]|null}
 */
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

/**
 * Read typed-intro phrases baked into the page.
 * @returns {string[]|null}
 */
export function readBootstrapPhrases() {
  if (typeof document === 'undefined') return null;
  const el = document.getElementById('services-data');
  if (!el) return null;
  try {
    const parsed = JSON.parse(el.textContent || '');
    if (parsed && Array.isArray(parsed.phrases) && parsed.phrases.length) {
      return parsed.phrases;
    }
    const services = Array.isArray(parsed) ? parsed : parsed?.services;
    if (Array.isArray(services) && services.length) {
      return ['Boost your socials', ...services.map((s) => s.label).filter(Boolean)];
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Parse comma-separated inputs string.
 * @param {string} raw
 * @returns {string[]}
 */
const INPUT_CANON = {
  commentslist: 'commentsList',
};

export function parseInputs(raw) {
  if (!raw || !String(raw).trim()) return [];
  return String(raw)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .map((s) => INPUT_CANON[s] ?? s)
    .filter(Boolean);
}

/**
 * Parse price from API value.
 * @param {unknown} value
 * @returns {number|null}
 */
function parsePrice(value) {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

/**
 * Normalize a raw API service row.
 * @param {Record<string, unknown>} row
 * @returns {import('../types.js').Service}
 */
export function normalizeService(row) {
  const platformLabel = String(row.Platform ?? row.platform ?? '').trim();
  const platform = toPlatformSlug(platformLabel);
  const service = String(row.Service ?? row.service ?? '').trim();
  const id = String(row.ID ?? row.id ?? row.serviceId ?? '').trim();

  return {
    id,
    platform,
    platformLabel: platformLabel || platform,
    service,
    label: `${platformLabel} ${service}`.trim(),
    description: String(row.Description ?? row.description ?? '').trim(),
    price: parsePrice(row.Price ?? row.price),
    inputs: parseInputs(row.Inputs ?? row.inputs ?? ''),
    socialpanelId: String(row.socialpanelId ?? '').trim(),
    visible: isVisible(row.Visible ?? row.visible),
  };
}

/**
 * Fetch with timeout.
 * @param {string} url
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch services from the live API.
 * @returns {Promise<import('../types.js').Service[]>}
 */
async function fetchServicesFromApi() {
  const url = `${CONFIG.API_BASE}?sheet=Services`;
  const response = await fetchWithTimeout(url);

  if (!response.ok) {
    throw new Error(`Services API error: ${response.status}`);
  }

  const json = await response.json();
  if (!json.ok || !Array.isArray(json.data)) {
    throw new Error('Invalid services response');
  }

  cache = assignServiceSlugs(json.data.map(normalizeService).filter((s) => s.visible)).map(
    (service) => ({
      ...service,
      url: service.url ?? `/${service.platform}/${service.slug}/`,
    })
  );
  return cache;
}

/**
 * Fetch and normalize all visible services.
 * Uses the prerendered snapshot when present.
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<import('../types.js').Service[]>}
 */
export async function getServices(options = {}) {
  if (cache && !options.force) return cache;

  if (!options.force) {
    const boot = readBootstrap();
    if (boot && boot.length) {
      cache = boot;
      return cache;
    }
  }

  return fetchServicesFromApi();
}

/**
 * Get a single service by ID.
 * @param {string} id
 * @returns {Promise<import('../types.js').Service|undefined>}
 */
export async function getService(id) {
  const services = await getServices();
  return services.find((s) => s.id === id);
}

/**
 * Group services by platform slug.
 * @param {import('../types.js').Service[]} services
 * @returns {Record<string, import('../types.js').Service[]>}
 */
export function groupByPlatform(services) {
  /** @type {Record<string, import('../types.js').Service[]>} */
  const groups = {};
  services.forEach((service) => {
    if (!groups[service.platform]) groups[service.platform] = [];
    groups[service.platform].push(service);
  });
  return groups;
}

/**
 * Get unique platforms from services.
 * @param {import('../types.js').Service[]} services
 * @returns {import('../types.js').PlatformSummary[]}
 */
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
  groupByPlatform,
  getUniquePlatforms,
  readBootstrapPhrases,
};
