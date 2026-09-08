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
  if (!lookup.token) return null;
  try {
    const { response, json } = await invokeFunction('order-status', {
      body: {
        sessionId: lookup.sessionId,
        orderId: lookup.orderId,
        checkoutAttemptId: lookup.checkoutAttemptId,
      },
      headers: { 'X-Checkout-Token': lookup.token },
    });
    if (!response.ok) return null;
    return json.order && typeof json.order === 'object' ? json.order : null;
  } catch {
    return null;
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
