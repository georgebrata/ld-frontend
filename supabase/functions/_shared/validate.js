/**
 * Guest checkout validation. Server never trusts browser prices or provider ids.
 */

import { canonicalizeInputValues, normalizeNewlineList } from './inputs.js';
import { validatePlatformUrl } from './urls.js';
import { getProviderType } from './provider-types.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
 * @param {unknown} value
 */
export function isUuid(value) {
  return UUID_PATTERN.test(String(value || ''));
}

/**
 * Validate guest fields against a joined internal service.
 * @param {Record<string, unknown>} body
 * @param {object} [service]
 */
export function validateCheckoutBody(body, service) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Invalid JSON body.' };
  }

  const serviceId = String(body.serviceId ?? '').trim();
  const customerEmail = normalizeEmail(body.customerEmail ?? body.email);
  const checkoutAttemptId = String(body.checkoutAttemptId ?? '').trim();
  const capabilityToken = String(body.capabilityToken ?? '').trim();
  const inputs = canonicalizeInputValues(body.inputs);
  const expectedQuote =
    body.expectedQuote && typeof body.expectedQuote === 'object'
      ? {
          amountMinor: Number(body.expectedQuote.amountMinor ?? body.expectedQuote.totalInCents),
          currency: String(body.expectedQuote.currency || '').toUpperCase(),
          quantity: Number(body.expectedQuote.quantity),
          quoteVersion: String(body.expectedQuote.quoteVersion || ''),
        }
      : null;

  if (!serviceId) return { ok: false, error: 'A service is required.' };
  if (!customerEmail) return { ok: false, error: 'A valid email is required.' };
  if (!isUuid(checkoutAttemptId)) {
    return { ok: false, error: 'A checkout attempt id is required.' };
  }
  if (capabilityToken.length < 32) {
    return { ok: false, error: 'A checkout token is required.' };
  }

  const typeHandler = service ? getProviderType(service.providerType || service.type) : null;
  const quantityMode = typeHandler?.quantityMode || 'required';

  let quantity = normalizeQuantity(body.quantity);
  if (quantityMode === 'from_comments') {
    quantity = normalizeNewlineList(inputs.comments).count;
  }
  if (quantityMode === 'package') {
    quantity = 1;
  }
  if (quantity == null) return { ok: false, error: 'A valid quantity is required.' };

  if (service) {
    const allowed = new Set(service.inputs || typeHandler?.storefrontInputs || []);
    Object.keys(inputs).forEach((key) => {
      if (!allowed.has(key)) delete inputs[key];
    });
    for (const name of allowed) {
      if (name === 'url' && inputs.url) {
        const check = validatePlatformUrl(inputs.url, service.platform);
        if (!check.ok) return { ok: false, error: check.error };
        inputs.url = check.href;
      }
      if (name === 'username' && !inputs.username && !inputs.url) {
        return { ok: false, error: 'Please enter a username.' };
      }
      if (name === 'comments' && !normalizeNewlineList(inputs.comments).count) {
        return { ok: false, error: 'Please enter at least one comment.' };
      }
      if (name === 'url' && !inputs.url && !inputs.username) {
        return { ok: false, error: 'Please enter a URL.' };
      }
    }
    if (body.socialpanelId || body.providerServiceId || body.provider_service_id) {
      return { ok: false, error: 'Unexpected fields were sent.' };
    }
  }

  const dripRuns = body.runs != null ? Number(body.runs) : null;
  const dripInterval = body.interval != null ? Number(body.interval) : null;
  if (dripRuns != null && (!Number.isInteger(dripRuns) || dripRuns < 1)) {
    return { ok: false, error: 'Drip runs must be a whole number.' };
  }
  if (dripInterval != null && (!Number.isInteger(dripInterval) || dripInterval < 1)) {
    return { ok: false, error: 'Drip interval must be a whole number of minutes.' };
  }

  return {
    ok: true,
    serviceId,
    customerEmail,
    quantity,
    inputs,
    checkoutAttemptId,
    capabilityToken,
    expectedQuote,
    drip:
      dripRuns || dripInterval
        ? { runs: dripRuns || undefined, interval: dripInterval || undefined }
        : undefined,
  };
}
