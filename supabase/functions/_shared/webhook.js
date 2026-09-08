/**
 * Stripe webhook: verify signature, persist atomically, enqueue jobs.
 * Provider and email HTTP calls do not run in this path.
 */

import { sessionIsPaid, verifyStripeSignature } from './stripe.js';
import { logError } from './log.js';

function asUuidOrNull(value) {
  const text = String(value || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text) ? text : null;
}

function asIntOrNull(value) {
  const num = Number(value);
  return Number.isInteger(num) ? num : null;
}

function desiredPaymentFromEvent(type, session) {
  if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded') {
    return sessionIsPaid(session) ? 'paid' : null;
  }
  if (type === 'checkout.session.async_payment_failed' || type === 'payment_intent.payment_failed') {
    return 'failed';
  }
  if (type === 'checkout.session.expired') return 'expired';
  return null;
}

/**
 * @param {object} env
 * @param {object} store
 * @param {string} rawBody
 * @param {string} signature
 * @param {object} [deps]
 */
export async function handleStripeWebhook(env, store, rawBody, signature, deps = {}) {
  const valid = await verifyStripeSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) return { status: 400, body: { error: 'Invalid signature.' } };

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: 'Invalid payload.' } };
  }

  const type = String(event.type || '');
  const livemode = Boolean(event.livemode);
  const object = event.data?.object || {};
  const desired = desiredPaymentFromEvent(type, object);

  if (!desired) {
    await store.insertStripeEvent(String(event.id || crypto.randomUUID()), type, livemode);
    return { status: 200, body: { ok: true, ignored: true } };
  }

  const orderId = asUuidOrNull(object.metadata?.internalOrderId || object.client_reference_id);
  const sessionId = String(object.id || object.checkout_session || '');

  try {
    const result = await store.applyPaymentEvent({
      eventId: String(event.id || ''),
      eventType: type,
      livemode,
      orderId,
      sessionId,
      amountMinor: asIntOrNull(object.amount_total ?? object.amount),
      currency: String(object.currency || ''),
      paymentIntentId: String(object.payment_intent || ''),
      desiredPayment: desired,
    });

    if (result?.missing) {
      return { status: 200, body: { ok: true, ignored: true, missing: true } };
    }

    if (result?.mismatch) {
      logError('webhook mismatch', { mismatch: result.mismatch });
      return { status: 409, body: { error: 'Session does not match the stored order.' } };
    }

    if (result?.enqueued && deps.kickWorker) {
      deps.kickWorker().catch(() => {});
    }

    return { status: 200, body: { ok: true, duplicate: Boolean(result?.duplicate), enqueued: Boolean(result?.enqueued) } };
  } catch (err) {
    logError('webhook persist failed', { name: err instanceof Error ? err.name : 'error' });
    return { status: 500, body: { error: 'Persist failed' } };
  }
}
