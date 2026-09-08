import { assetPath } from './dom.js';
import { toPlatformSlug } from './slugs.js';

export { toPlatformSlug };

/** @type {Set<string>} */
const knownIcons = new Set(['instagram', 'tiktok', 'youtube', 'facebook']);

/**
 * Get icon URL for a platform slug.
 * @param {string} slug
 * @returns {string|null}
 */
export function getPlatformIconUrl(slug) {
  const normalized = toPlatformSlug(slug);
  if (knownIcons.has(normalized)) {
    return assetPath(`assets/icons/${normalized}.svg?v=20260909a`);
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
