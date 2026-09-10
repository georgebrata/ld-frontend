/**
 * Stripe Checkout + webhook signature verification. Return URLs are never
 * treated as payment proof.
 */

import { timingSafeEqual, sha256Hex } from './crypto-token.js';
import { checkoutReturnOrigin, fetchWithTimeout } from './http.js';

export const STRIPE_API_VERSION = '2026-07-29.dahlia';
export const STRIPE_SIGNATURE_TOLERANCE_SEC = 300;
const STRIPE_TIMEOUT_MS = 15000;

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
 * Stable Dashboard label: likedeler_ + 8 letters derived from attempt + revision.
 * @param {string} attemptId
 * @param {number|string} revision
 */
export async function stripeIntegrationIdentifier(attemptId, revision) {
  const hex = await sha256Hex(`ld-checkout:${attemptId}:r${revision}`);
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  let out = '';
  for (let i = 0; i < 8; i += 1) {
    out += letters[parseInt(hex.slice(i * 2, i * 2 + 2), 16) % 26];
  }
  return `likedeler_${out}`;
}

export function isCheckoutSessionId(value) {
  return /^cs_[A-Za-z0-9_]+$/.test(String(value || ''));
}

export function isPaymentIntentId(value) {
  return /^pi_[A-Za-z0-9_]+$/.test(String(value || ''));
}

function stripeHeaders(env, extra = {}) {
  return {
    Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    'Stripe-Version': env.STRIPE_API_VERSION || STRIPE_API_VERSION,
    ...extra,
  };
}

/**
 * @param {object} env
 * @param {object} order
 * @param {{
 *   amountMinor: number,
 *   currency: string,
 *   idempotencyKey: string,
 *   integrationIdentifier: string
 * }} quote
 * @param {typeof fetch} [fetchImpl]
 */
export async function createCheckoutSession(env, order, quote, fetchImpl = fetch) {
  const site = checkoutReturnOrigin(env, order.storefrontOrigin);
  const success = `${site}/success/?session_id={CHECKOUT_SESSION_ID}`;
  const cancel = `${site}/cancel/?attempt=${order.checkoutAttemptId}`;
  const timeoutMs = Number(env.STRIPE_TIMEOUT_MS || STRIPE_TIMEOUT_MS);

  const response = await fetchWithTimeout(
    fetchImpl,
    'https://api.stripe.com/v1/checkout/sessions',
    {
      method: 'POST',
      headers: stripeHeaders(env, {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': quote.idempotencyKey,
      }),
      body: formBody({
        mode: 'payment',
        customer_email: order.email,
        success_url: success,
        cancel_url: cancel,
        client_reference_id: order.id,
        integration_identifier: quote.integrationIdentifier,
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': String(quote.currency).toLowerCase(),
        'line_items[0][price_data][unit_amount]': String(quote.amountMinor),
        'line_items[0][price_data][product_data][name]': order.serviceLabel,
        'metadata[internalOrderId]': order.id,
        'metadata[checkoutAttemptId]': order.checkoutAttemptId,
        'metadata[serviceId]': order.serviceId,
        'payment_intent_data[metadata][internalOrderId]': order.id,
        'payment_intent_data[metadata][checkoutAttemptId]': order.checkoutAttemptId,
      }),
    },
    timeoutMs
  );

  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.url || !isCheckoutSessionId(json.id)) {
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
  if (!sessionId || !isCheckoutSessionId(sessionId)) return { ok: false, missing: true };
  const timeoutMs = Number(env.STRIPE_TIMEOUT_MS || STRIPE_TIMEOUT_MS);
  const response = await fetchWithTimeout(
    fetchImpl,
    `https://api.stripe.com/v1/checkout/sessions/${sessionId}/expire`,
    {
      method: 'POST',
      headers: stripeHeaders(env),
    },
    timeoutMs
  );
  const json = await response.json().catch(() => null);
  return { ok: response.ok || response.status === 400, status: response.status, json };
}

/**
 * @param {object} env
 * @param {string} sessionId
 * @param {typeof fetch} [fetchImpl]
 */
export async function retrieveCheckoutSession(env, sessionId, fetchImpl = fetch) {
  const result = await retrieveCheckoutSessionResult(env, sessionId, fetchImpl);
  return result.session;
}

/**
 * @param {object} env
 * @param {string} sessionId
 * @param {typeof fetch} [fetchImpl]
 */
export async function retrieveCheckoutSessionResult(env, sessionId, fetchImpl = fetch) {
  if (!sessionId || !isCheckoutSessionId(sessionId)) {
    return { session: null, missing: true, error: false };
  }
  const timeoutMs = Number(env.STRIPE_TIMEOUT_MS || STRIPE_TIMEOUT_MS);
  let response;
  try {
    response = await fetchWithTimeout(
      fetchImpl,
      `https://api.stripe.com/v1/checkout/sessions/${sessionId}`,
      { headers: stripeHeaders(env) },
      timeoutMs
    );
  } catch {
    return { session: null, missing: false, error: true };
  }
  const json = await response.json().catch(() => null);
  if (response.status === 404) return { session: null, missing: true, error: false };
  if (!response.ok) return { session: null, missing: false, error: true };
  return { session: json, missing: false, error: false };
}

/**
 * Verify Stripe-Signature against the unmodified raw body.
 * Accepts multiple v1 signatures and rejects stale timestamps.
 * @param {string} rawBody
 * @param {string} header
 * @param {string} secret
 * @param {{ toleranceSec?: number, nowMs?: number }} [options]
 */
export async function verifyStripeSignature(rawBody, header, secret, options = {}) {
  if (!header || !secret) return false;
  const items = String(header)
    .split(',')
    .map((item) => {
      const [k, ...rest] = item.split('=');
      return [k.trim(), rest.join('=')];
    });
  const timestamp = items.find(([key]) => key === 't')?.[1];
  const signatures = items.filter(([key]) => key === 'v1').map(([, value]) => value);
  if (!timestamp || !signatures.length) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const nowMs = options.nowMs ?? Date.now();
  const toleranceSec = options.toleranceSec ?? STRIPE_SIGNATURE_TOLERANCE_SEC;
  if (Math.abs(nowMs / 1000 - ts) > toleranceSec) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${rawBody}`));
  const digest = [...new Uint8Array(signed)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return signatures.some((expected) => timingSafeEqual(digest, expected));
}

/**
 * Payment is verified only when Stripe reports paid.
 * @param {Record<string, unknown>} session
 */
export function sessionIsPaid(session) {
  return String(session?.payment_status || '') === 'paid';
}
