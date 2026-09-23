/**
 * Stripe webhook: verify signature, persist atomically, enqueue jobs.
 * Provider and email HTTP calls do not run in this path.
 */

import { isCheckoutSessionId, isPaymentIntentId, sessionIsPaid, verifyStripeSignature } from './stripe.js';
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
 * Resolve Checkout Session vs PaymentIntent objects. Never treat a pi_ id as a session.
 * @param {Record<string, unknown>} event
 */
export function stripeEventRefs(event) {
  const type = String(event?.type || '');
  const object = /** @type {Record<string, unknown>} */ (event?.data?.object || {});
  const objectType = String(object.object || '');
  let sessionId = '';
  let paymentIntentId = '';

  if (objectType === 'checkout.session' || type.startsWith('checkout.session.')) {
    sessionId = isCheckoutSessionId(object.id) ? String(object.id) : '';
    if (typeof object.payment_intent === 'string') paymentIntentId = object.payment_intent;
  } else if (objectType === 'payment_intent' || type.startsWith('payment_intent.')) {
    paymentIntentId = isPaymentIntentId(object.id) ? String(object.id) : '';
    if (isCheckoutSessionId(object.checkout_session)) sessionId = String(object.checkout_session);
    const meta = object.metadata && typeof object.metadata === 'object' ? object.metadata : {};
    if (!sessionId && isCheckoutSessionId(/** @type {any} */ (meta).checkoutSessionId)) {
      sessionId = String(/** @type {any} */ (meta).checkoutSessionId);
    }
  } else if (isCheckoutSessionId(object.id)) {
    sessionId = String(object.id);
  }

  const meta = object.metadata && typeof object.metadata === 'object' ? object.metadata : {};
  const orderId = asUuidOrNull(
    /** @type {any} */ (meta).internalOrderId || object.client_reference_id
  );
  return { type, sessionId, paymentIntentId, orderId, object };
}

/**
 * @param {object} env
 * @param {object} store
 * @param {string} rawBody
 * @param {string} signature
 * @param {object} [deps]
 */
export async function handleStripeWebhook(env, store, rawBody, signature, deps = {}) {
  const valid = await verifyStripeSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET, {
    nowMs: deps.nowMs,
    toleranceSec: deps.toleranceSec,
  });
  if (!valid) return { status: 400, body: { error: 'Invalid signature.' } };

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: 'Invalid payload.' } };
  }

  const refs = stripeEventRefs(event);
  const livemode = Boolean(event.livemode);
  const desired = desiredPaymentFromEvent(refs.type, refs.object);

  if (
    desired === 'paid' &&
    refs.object.mode != null &&
    String(refs.object.mode) !== 'payment'
  ) {
    if (typeof store.insertStripeEvent === 'function') {
      await store.insertStripeEvent(String(event.id || ''), refs.type, livemode, {
        outcome: 'rejected',
        mismatch: 'mode',
        objectId: String(refs.object.id || ''),
      });
    }
    logError('webhook mismatch', { mismatch: 'mode' });
    return { status: 409, body: { error: 'Session mode is not payment.', mismatch: 'mode' } };
  }

  if (!desired) {
    await store.applyPaymentEvent({
      eventId: String(event.id || crypto.randomUUID()),
      eventType: refs.type,
      livemode,
      orderId: refs.orderId,
      sessionId: refs.sessionId,
      amountMinor: null,
      currency: '',
      paymentIntentId: refs.paymentIntentId,
      desiredPayment: null,
      objectId: String(refs.object.id || ''),
    });
    return { status: 200, body: { ok: true, ignored: true } };
  }

  try {
    const result = await store.applyPaymentEvent({
      eventId: String(event.id || ''),
      eventType: refs.type,
      livemode,
      orderId: refs.orderId,
      sessionId: refs.sessionId,
      amountMinor: asIntOrNull(refs.object.amount_total ?? refs.object.amount),
      currency: String(refs.object.currency || ''),
      paymentIntentId: refs.paymentIntentId,
      desiredPayment: desired,
      objectId: String(refs.object.id || ''),
    });

    if (result?.missing) {
      return { status: 200, body: { ok: true, ignored: true, missing: true } };
    }

    if (result?.mismatch) {
      logError('webhook mismatch', { mismatch: result.mismatch });
      return { status: 409, body: { error: 'Session does not match the stored order.', mismatch: result.mismatch } };
    }

    if (result?.enqueued && deps.kickWorker) {
      deps.kickWorker().catch(() => {});
    }

    return {
      status: 200,
      body: {
        ok: true,
        duplicate: Boolean(result?.duplicate),
        enqueued: Boolean(result?.enqueued),
        outcome: result?.outcome || (result?.duplicate ? 'duplicate' : 'accepted'),
      },
    };
  } catch (err) {
    logError('webhook persist failed', { name: err instanceof Error ? err.name : 'error' });
    return { status: 500, body: { error: 'Persist failed' } };
  }
}
