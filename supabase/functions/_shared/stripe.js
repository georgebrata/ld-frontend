/**
 * Stripe Checkout + webhook signature verification. Return URLs are never
 * treated as payment proof.
 */

import { timingSafeEqual } from './crypto-token.js';
import { checkoutReturnOrigin } from './http.js';

/**
 * @param {Record<string, string|number|undefined>} params
 */
function formBody(params) {
  const body = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== '') body.set(key, String(value));
  });
  return body;
}

/**
 * @param {object} env
 * @param {object} order
 * @param {{ amountMinor: number, currency: string, idempotencyKey: string }} quote
 * @param {typeof fetch} [fetchImpl]
 */
export async function createCheckoutSession(env, order, quote, fetchImpl = fetch) {
  const site = checkoutReturnOrigin(env, order.storefrontOrigin);
  const success = `${site}/success/?session_id={CHECKOUT_SESSION_ID}`;
  const cancel = `${site}/cancel/?attempt=${order.checkoutAttemptId}`;

  const response = await fetchImpl('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': quote.idempotencyKey,
    },
    body: formBody({
      mode: 'payment',
      customer_email: order.email,
      success_url: success,
      cancel_url: cancel,
      client_reference_id: order.id,
      integration_identifier: `likedeler_${[...crypto.getRandomValues(new Uint8Array(8))]
        .map((b) => 'abcdefghijklmnopqrstuvwxyz'[b % 26])
        .join('')}`,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': String(quote.currency).toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(quote.amountMinor),
      'line_items[0][price_data][product_data][name]': order.serviceLabel,
      'metadata[internalOrderId]': order.id,
      'metadata[checkoutAttemptId]': order.checkoutAttemptId,
      'metadata[serviceId]': order.serviceId,
      'payment_intent_data[metadata][internalOrderId]': order.id,
    }),
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.url || !json.id) {
    throw new Error('Could not start Stripe Checkout.');
  }
  return json;
}

/**
 * @param {object} env
 * @param {string} sessionId
 * @param {typeof fetch} [fetchImpl]
 */
export async function expireCheckoutSession(env, sessionId, fetchImpl = fetch) {
  if (!sessionId) return null;
  const response = await fetchImpl(`https://api.stripe.com/v1/checkout/sessions/${sessionId}/expire`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  return response.json().catch(() => null);
}

/**
 * @param {object} env
 * @param {string} sessionId
 * @param {typeof fetch} [fetchImpl]
 */
export async function retrieveCheckoutSession(env, sessionId, fetchImpl = fetch) {
  const response = await fetchImpl(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) return null;
  return json;
}

/**
 * Verify Stripe-Signature against the unmodified raw body.
 * @param {string} rawBody
 * @param {string} header
 * @param {string} secret
 */
export async function verifyStripeSignature(rawBody, header, secret) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(
    String(header)
      .split(',')
      .map((item) => {
        const [k, ...rest] = item.split('=');
        return [k.trim(), rest.join('=')];
      })
  );
  const timestamp = parts.t;
  const expected = parts.v1;
  if (!timestamp || !expected) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${rawBody}`));
  const digest = [...new Uint8Array(signed)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(digest, expected);
}

/**
 * Payment is verified only when Stripe reports paid.
 * @param {Record<string, unknown>} session
 */
export function sessionIsPaid(session) {
  return String(session?.payment_status || '') === 'paid';
}
