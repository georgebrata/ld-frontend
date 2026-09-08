const SECRET_KEYS = [
  'key',
  'authorization',
  'stripe-signature',
  'x-checkout-token',
  'capabilitytoken',
  'capability_token',
  'token',
  'secret',
  'apikey',
  'api_key',
  'socialpanel24_api_key',
  'resend_api_key',
  'stripe_secret_key',
  'service_role',
];

/**
 * Redact secrets, emails, tokens, and target URLs before logging.
 * @param {unknown} value
 * @returns {unknown}
 */
export function redact(value) {
  if (value == null) return value;
  if (typeof value === 'string') {
    if (value.includes('@') && value.includes('.')) return '[redacted-email]';
    if (/^https?:\/\//i.test(value)) return '[redacted-url]';
    if (value.length > 24 && /^[A-Za-z0-9_\-]+$/.test(value)) return '[redacted]';
    return value;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    Object.entries(/** @type {Record<string, unknown>} */ (value)).forEach(([key, nested]) => {
      const lower = key.toLowerCase();
      if (SECRET_KEYS.some((name) => lower.includes(name))) {
        out[key] = '[redacted]';
        return;
      }
      if (lower.includes('email') || lower.includes('comment') || lower.includes('payload')) {
        out[key] = '[redacted]';
        return;
      }
      out[key] = redact(nested);
    });
    return out;
  }
  return value;
}

/**
 * @param {string} message
 * @param {unknown} [meta]
 */
export function logInfo(message, meta) {
  if (meta === undefined) {
    console.log(message);
    return;
  }
  console.log(message, redact(meta));
}

/**
 * @param {string} message
 * @param {unknown} [meta]
 */
export function logError(message, meta) {
  if (meta === undefined) {
    console.error(message);
    return;
  }
  console.error(message, redact(meta));
}
