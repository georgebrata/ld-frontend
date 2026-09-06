import { CONFIG } from '../config.js';
import { isVisible } from '../utils/visibility.js';
import { toPlatformSlug } from '../utils/platform-icons.js';

/** @type {import('../types.js').Service[]|null} */
let cache = null;

/**
 * Parse comma-separated inputs string.
 * @param {string} raw
 * @returns {string[]}
 */
export function parseInputs(raw) {
  if (!raw || !String(raw).trim()) return [];
  return String(raw)
    .split(',')
    .map((s) => s.trim().toLowerCase())
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
 * Fetch and normalize all visible services.
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<import('../types.js').Service[]>}
 */
export async function getServices(options = {}) {
  if (cache && !options.force) return cache;

  const url = `${CONFIG.API_BASE}?sheet=Services`;
  const response = await fetchWithTimeout(url);

  if (!response.ok) {
    throw new Error(`Services API error: ${response.status}`);
  }

  const json = await response.json();
  if (!json.ok || !Array.isArray(json.data)) {
    throw new Error('Invalid services response');
  }

  cache = json.data.map(normalizeService).filter((s) => s.visible);
  return cache;
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
        url: `./${service.platform}/`,
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
};
