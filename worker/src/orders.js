import { orderKey, sessionKey } from './store.js';
import { mapInputsToSheetFields } from './mappers.js';
import { formatUsd } from './money.js';

/**
 * @param {string} rawId
 */
export function formatOrderId(rawId) {
  const short = String(rawId || '').replace(/-/g, '').slice(-6).toUpperCase();
  return short ? `LD-${short}` : '';
}

/**
 * @param {Record<string, string>} env
 * @param {Record<string, unknown>} data
 */
export async function appendSheetOrder(env, data) {
  const response = await fetch(`${env.ORDERS_API_URL}?sheet=Orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'append', data }),
  });
  if (!response.ok) throw new Error(`Orders API error: ${response.status}`);
  return response.json().catch(() => ({}));
}

/**
 * @param {Record<string, string>} env
 * @param {string} id
 * @param {Record<string, unknown>} data
 */
export async function updateSheetOrder(env, id, data) {
  try {
    const response = await fetch(`${env.ORDERS_API_URL}?sheet=Orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', id, data }),
    });
    if (!response.ok) return null;
    return response.json().catch(() => ({}));
  } catch {
    return null;
  }
}

/**
 * @param {any} store
 * @param {Record<string, string>} env
 * @param {object} draft
 */
export async function createPendingOrder(store, env, draft) {
  const id = crypto.randomUUID();
  const { url, notes } = mapInputsToSheetFields(draft.inputs);
  const order = {
    id,
    displayId: formatOrderId(id),
    status: 'pending',
    customerEmail: draft.customerEmail,
    serviceId: draft.serviceId,
    service: draft.service,
    platform: draft.platform,
    inputs: draft.inputs,
    quantity: draft.quantity,
    url,
    notes,
    socialPanelId: draft.socialPanelId,
    amountCents: draft.amountCents,
    stripeSessionId: '',
    stripePaymentIntentId: '',
    socialPanelOrderId: '',
    stripeEventId: '',
    fulfilmentAttempted: false,
    customerEmailStatus: 'pending',
    ownerEmailStatus: 'pending',
    createdAt: new Date().toISOString(),
  };

  await store.put(orderKey(id), order);
  try {
    const sheet = await appendSheetOrder(env, {
      CustomerEmail: order.customerEmail,
      Service: order.service,
      ServiceId: order.serviceId,
      URL: order.url,
      Notes: order.notes,
      Quantity: order.quantity,
      Status: order.status,
    });
    if (sheet?.data?._id) {
      order.sheetId = String(sheet.data._id);
      await store.put(orderKey(id), order);
    }
  } catch (err) {
    console.error('orders.append failed', err instanceof Error ? err.message : 'unknown');
  }
  return order;
}

/**
 * @param {any} store
 * @param {Record<string, string>} env
 * @param {object} order
 */
export async function saveOrder(store, env, order) {
  await store.put(orderKey(order.id), order);
  if (order.stripeSessionId) {
    await store.put(sessionKey(order.stripeSessionId), { orderId: order.id });
  }
  await updateSheetOrder(env, order.sheetId || order.id, {
    Status: order.status,
    StripeSessionId: order.stripeSessionId,
    StripePaymentIntentId: order.stripePaymentIntentId,
    SocialPanelOrderId: order.socialPanelOrderId,
    StripeEventId: order.stripeEventId,
    CustomerEmailStatus: order.customerEmailStatus,
    OwnerEmailStatus: order.ownerEmailStatus,
  });
}

/**
 * @param {any} store
 * @param {string} id
 */
export async function getOrder(store, id) {
  if (!id) return null;
  const direct = await store.get(orderKey(id));
  if (direct) return direct;
  const bySession = await store.get(sessionKey(id));
  if (bySession?.orderId) return store.get(orderKey(bySession.orderId));
  return null;
}

/**
 * Customer-safe projection.
 * @param {object} order
 */
export function toPublicOrder(order) {
  if (!order) return null;
  return {
    id: order.id,
    displayId: order.displayId || formatOrderId(order.id),
    customerEmail: order.customerEmail,
    service: order.service,
    platform: order.platform,
    quantity: order.quantity,
    status: order.status,
    target: order.url,
    amountPaidCents: order.amountCents ?? null,
    amountPaid: order.amountCents != null ? formatUsd(order.amountCents) : '',
  };
}
