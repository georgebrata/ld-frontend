import { assetPath } from './dom.js';

/** @type {Set<string>} */
const knownIcons = new Set(['instagram', 'tiktok', 'youtube', 'facebook']);

/**
 * Convert platform label to URL slug.
 * @param {string} platform
 * @returns {string}
 */
export function toPlatformSlug(platform) {
  return String(platform ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

/**
 * Get icon URL for a platform slug.
 * @param {string} slug
 * @returns {string|null}
 */
export function getPlatformIconUrl(slug) {
  const normalized = toPlatformSlug(slug);
  if (knownIcons.has(normalized)) {
    return assetPath(`assets/cardLogos/${normalized}.svg`);
  }
  return null;
}

/**
 * Get display initials for platform badge fallback.
 * @param {string} label
 * @returns {string}
 */
export function getPlatformInitials(label) {
  return String(label ?? '')
    .trim()
    .slice(0, 2)
    .toUpperCase();
}
