/**
 * URL parsing helpers for platform hosts. No substring matching.
 */

const PLATFORM_HOSTS = {
  instagram: ['instagram.com', 'instagr.am'],
  tiktok: ['tiktok.com'],
  youtube: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'],
  facebook: ['facebook.com', 'fb.com', 'fb.watch'],
};

/**
 * @param {unknown} value
 * @returns {URL|null}
 */
export function parseHttpUrl(value) {
  try {
    const url = new URL(String(value ?? '').trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * @param {string} hostname
 * @param {string[]} allowed
 */
export function hostAllowed(hostname, allowed) {
  const host = String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');
  return allowed.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

/**
 * @param {unknown} value
 * @param {string} [platform]
 */
export function validatePlatformUrl(value, platform) {
  const url = parseHttpUrl(value);
  if (!url) return { ok: false, error: 'Please enter a valid http(s) URL.' };
  const hosts = PLATFORM_HOSTS[platform];
  if (hosts && !hostAllowed(url.hostname, hosts)) {
    return { ok: false, error: `That URL must be a ${platform} link.` };
  }
  return { ok: true, href: url.href };
}
