/**
 * Authorized order summary. Order/attempt IDs or email alone grant no access.
 */

import { hashCapabilityToken, timingSafeEqual } from './crypto-token.js';
import { publicUiState } from './states.js';
import { formatMoney } from './money.js';

/**
 * @param {object} store
 * @param {{ token: string, orderId?: string, sessionId?: string, attemptId?: string }} lookup
 */
export async function getAuthorizedOrder(store, lookup) {
  if (!lookup.token || lookup.token.length < 32) return null;
  const hash = await hashCapabilityToken(lookup.token);
  const order = await store.getOrderByTokenHash(hash, {
    orderId: lookup.orderId,
    sessionId: lookup.sessionId,
    attemptId: lookup.attemptId,
  });
  if (!order) return null;
  if (!timingSafeEqual(order.capability_token_hash, hash)) return null;
  return order;
}

/**
 * Minimal public projection.
 * @param {object} order
 */
export function toPublicOrder(order) {
  const paymentStatus = order.payment_status;
  const fulfillmentStatus = order.fulfillment_status;
  const emailJobState = order.customer_email_state || 'unknown';
  return {
    id: order.id,
    displayId: order.display_id,
    service: order.service_snapshot?.label || order.service_snapshot?.service,
    platform: order.service_snapshot?.platform,
    quantity: order.quantity,
    amountMinor: order.amount_minor,
    currency: order.currency,
    amountLabel: formatMoney(order.amount_minor, order.currency),
    paymentStatus,
    fulfillmentStatus,
    uiState: publicUiState({ paymentStatus, fulfillmentStatus }),
    emailDelivery: emailJobState,
  };
}
