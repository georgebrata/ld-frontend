import { invokeFunction } from '../lib/supabase-client.js';
import { functionsBaseUrl } from '../config.js';

function readError(json, status) {
  return typeof json.error === 'string' ? json.error : `Request failed (${status})`;
}

/**
 * @param {{
 *   serviceId: string,
 *   quantity: number,
 *   customerEmail: string,
 *   inputs: Record<string, string>,
 *   checkoutAttemptId: string,
 *   capabilityToken: string,
 *   expectedQuote?: object
 * }} payload
 */
export async function createCheckoutSession(payload) {
  const { response, json } = await invokeFunction('create-checkout', {
    body: payload,
    headers: { 'X-Checkout-Token': payload.capabilityToken },
  });
  if (response.status === 409 && json.code === 'quote_changed') {
    const err = new Error(json.error || 'The price changed.');
    err.code = 'quote_changed';
    err.quote = json.quote;
    throw err;
  }
  if (response.status === 409 && /start again/i.test(String(json.error || ''))) {
    const err = new Error(json.error);
    err.code = 'start_again';
    throw err;
  }
  if (!response.ok) throw new Error(readError(json, response.status));
  const url = String(json.checkoutUrl ?? json.url ?? '');
  if (!url) throw new Error('Checkout did not return a payment URL.');
  return { checkoutUrl: url, orderId: json.orderId, quote: json.quote, reused: json.reused };
}

/**
 * @param {{
 *   token: string,
 *   sessionId?: string,
 *   orderId?: string,
 *   checkoutAttemptId?: string
 * }} lookup
 */
export async function getAuthorizedOrder(lookup) {
  if (!lookup.token) return { error: 'unauthorized' };
  try {
    const { response, json } = await invokeFunction('order-status', {
      body: {
        sessionId: lookup.sessionId,
        orderId: lookup.orderId,
        checkoutAttemptId: lookup.checkoutAttemptId,
      },
      headers: { 'X-Checkout-Token': lookup.token },
    });
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      return { error: 'unauthorized', status: response.status };
    }
    if (!response.ok) return { error: 'unavailable', status: response.status };
    return { order: json.order && typeof json.order === 'object' ? json.order : null };
  } catch (err) {
    const aborted = Boolean(err && /** @type {{ name?: string }} */ (err).name === 'AbortError');
    return { error: aborted ? 'timeout' : 'offline' };
  }
}

export function isCheckoutConfigured() {
  return Boolean(functionsBaseUrl());
}

export const ordersApi = {
  createCheckoutSession,
  getAuthorizedOrder,
  isCheckoutConfigured,
};
