import { json } from './http.js';
import { eventKey } from './store.js';
import { getOrder, saveOrder } from './orders.js';
import { fulfilOrder } from './fulfil.js';
import { sendOrderEmails } from './email.js';
import { verifyStripeSignature } from './stripe.js';
import { findSp24Service, getSp24Services } from './pricing.js';

/**
 * @param {any} store
 * @param {Record<string, string>} env
 * @param {string} rawBody
 * @param {string} signature
 */
export async function handleStripeWebhook(store, env, rawBody, signature) {
  const valid = await verifyStripeSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) return json({ error: 'Invalid signature.' }, 400);

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: 'Invalid payload.' }, 400);
  }

  const eventId = String(event.id ?? '');
  if (eventId) {
    const seen = await store.get(eventKey(eventId));
    if (seen) return json({ ok: true, duplicate: true });
  }

  const type = String(event.type ?? '');
  const object = event.data?.object ?? {};

  if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded') {
    await processPaidSession(store, env, object, eventId);
  } else if (
    type === 'checkout.session.expired' ||
    type === 'checkout.session.async_payment_failed' ||
    type === 'payment_intent.payment_failed'
  ) {
    await markFailed(store, env, object, type);
  }

  if (eventId) {
    await store.put(eventKey(eventId), { receivedAt: new Date().toISOString() });
  }

  return json({ ok: true });
}

/**
 * @param {any} store
 * @param {Record<string, string>} env
 * @param {Record<string, unknown>} session
 * @param {string} eventId
 */
export async function processPaidSession(store, env, session, eventId) {
  const orderId = String(session.metadata?.internalOrderId ?? session.client_reference_id ?? '');
  const order = await getOrder(store, orderId || String(session.id ?? ''));
  if (!order) {
    console.error('webhook order missing');
    return;
  }

  order.stripeSessionId = String(session.id ?? order.stripeSessionId ?? '');
  order.stripePaymentIntentId = String(session.payment_intent ?? order.stripePaymentIntentId ?? '');
  order.stripeEventId = eventId || order.stripeEventId;
  if (session.amount_total != null) order.amountCents = Number(session.amount_total);

  if (order.status === 'pending' || order.status === 'payment_pending') {
    order.status = 'paid';
  }

  await saveOrder(store, env, order);

  if (!order.socialPanelOrderId) {
    const catalog = await getSp24Services(store, env).catch(() => []);
    const sp24 = findSp24Service(catalog, order.socialPanelId);
    await fulfilOrder(env, order, sp24 || {});
    await saveOrder(store, env, order);
  }

  await sendOrderEmails(env, order);
  await saveOrder(store, env, order);
}

/**
 * @param {any} store
 * @param {Record<string, string>} env
 * @param {Record<string, unknown>} object
 * @param {string} type
 */
async function markFailed(store, env, object, type) {
  const orderId = String(object.metadata?.internalOrderId ?? object.client_reference_id ?? '');
  const order = await getOrder(store, orderId || String(object.id ?? ''));
  if (!order) return;
  if (order.status === 'paid' || order.status === 'processing' || order.status === 'completed') {
    return;
  }
  order.status = type.includes('expired') ? 'cancelled' : 'payment_failed';
  await saveOrder(store, env, order);
}
