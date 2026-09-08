/**
 * Checkout capability tokens. The raw token never belongs in logs or URLs.
 */

const encoder = new TextEncoder();

/**
 * Hash a capability token with SHA-256. Hex-encoded.
 * @param {string} token
 * @returns {Promise<string>}
 */
export async function hashCapabilityToken(token) {
  const value = String(token || '');
  if (!value) throw new Error('Missing capability token');
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Constant-time string compare.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function timingSafeEqual(a, b) {
  const left = String(a);
  const right = String(b);
  if (left.length !== right.length) return false;
  let out = 0;
  for (let i = 0; i < left.length; i += 1) {
    out |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return out === 0;
}

/**
 * SHA-256 hex digest of an arbitrary string.
 * @param {string} value
 * @returns {Promise<string>}
 */
export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(value)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
