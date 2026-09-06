const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_INPUTS = new Set(['url', 'username', 'commentsList']);

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isVisible(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

/**
 * @param {unknown} email
 * @returns {string|null}
 */
export function normalizeEmail(email) {
  const value = String(email ?? '').trim();
  if (!value || value.length > 254 || !EMAIL_PATTERN.test(value)) return null;
  return value;
}

/**
 * @param {unknown} quantity
 * @returns {number|null}
 */
export function normalizeQuantity(quantity) {
  const num = Number(quantity);
  if (!Number.isInteger(num) || num < 1) return null;
  return num;
}

/**
 * @param {unknown} inputs
 * @returns {Record<string, string>}
 */
export function sanitizeInputs(inputs) {
  /** @type {Record<string, string>} */
  const clean = {};
  if (!inputs || typeof inputs !== 'object') return clean;
  Object.entries(inputs).forEach(([key, value]) => {
    if (!ALLOWED_INPUTS.has(key)) return;
    const text = String(value ?? '').trim();
    if (key === 'username') clean[key] = text.replace(/^@/, '');
    else clean[key] = text;
  });
  return clean;
}

/**
 * @param {Record<string, unknown>} body
 */
export function validateCheckoutBody(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Invalid JSON body.' };
  }
  const serviceId = String(body.serviceId ?? '').trim();
  const customerEmail = normalizeEmail(body.customerEmail);
  const quantity = normalizeQuantity(body.quantity);
  const inputs = sanitizeInputs(body.inputs);

  if (!serviceId) return { ok: false, error: 'A service is required.' };
  if (!customerEmail) return { ok: false, error: 'A valid email is required.' };
  if (quantity == null) return { ok: false, error: 'A valid quantity is required.' };

  return { ok: true, serviceId, customerEmail, quantity, inputs };
}
