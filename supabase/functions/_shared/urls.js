/**
 * Platform host allowlists. Validation uses URL parsing, not substring matching.
 */

/** @type {Readonly<Record<string, readonly string[]>>} */
export const PLATFORM_HOSTS = Object.freeze({
  instagram: Object.freeze(['instagram.com', 'instagr.am']),
  tiktok: Object.freeze(['tiktok.com']),
  youtube: Object.freeze(['youtube.com', 'youtu.be', 'youtube-nocookie.com']),
  facebook: Object.freeze(['facebook.com', 'fb.com', 'fb.watch']),
});

/**
 * @param {unknown} value
 * @returns {URL|null}
 */
export function parseHttpUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * Host match: exact registrable suffix, never a substring of an unrelated host.
 * @param {string} hostname
 * @param {readonly string[]} allowed
 * @returns {boolean}
 */
export function hostAllowed(hostname, allowed) {
  const host = String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');
  if (!host) return false;
  return allowed.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

/**
 * @param {unknown} value
 * @param {string} platform
 * @returns {{ ok: true, href: string }|{ ok: false, error: string }}
 */
export function validatePlatformUrl(value, platform) {
  const url = parseHttpUrl(value);
  if (!url) {
    return { ok: false, error: 'Please enter a valid http(s) URL.' };
  }
  const hosts = PLATFORM_HOSTS[platform];
  if (hosts && !hostAllowed(url.hostname, hosts)) {
    return {
      ok: false,
      error: `That URL must be a ${platform} link.`,
    };
  }
  return { ok: true, href: url.href };
}

/**
 * Build a profile URL from a username when the service has no post URL.
 * @param {string} platform
 * @param {string} username
 * @returns {string}
 */
export function profileUrl(platform, username) {
  const handle = String(username ?? '')
    .replace(/^@/, '')
    .trim();
  if (!handle) return '';
  switch (platform) {
    case 'instagram':
      return `https://instagram.com/${encodeURIComponent(handle)}`;
    case 'tiktok':
      return `https://www.tiktok.com/@${encodeURIComponent(handle)}`;
    case 'youtube':
      return `https://www.youtube.com/@${encodeURIComponent(handle)}`;
    case 'facebook':
      return `https://www.facebook.com/${encodeURIComponent(handle)}`;
    default:
      return '';
  }
}
