import * as socialPanel from './socialPanel.js';
import { mapFulfilmentParams } from './mappers.js';

/**
 * Place a downstream order once. If a prior add may have succeeded, do not add again.
 *
 * @param {Record<string, string>} env
 * @param {object} order
 * @param {Record<string, unknown>} [sp24Service]
 */
export async function fulfilOrder(env, order, sp24Service = {}) {
  if (order.socialPanelOrderId) {
    return { order, skipped: true, reason: 'already_fulfilled' };
  }

  if (order.fulfilmentAttempted) {
    order.status = 'fulfilment_failed';
    order.fulfilmentError = 'Previous fulfilment attempt is unresolved. Manual reconciliation required.';
    return { order, skipped: true, reason: 'unknown_prior_add' };
  }

  if (!order.socialPanelId) {
    order.status = 'fulfilment_failed';
    order.fulfilmentError = 'Missing SocialPanel24 mapping.';
    return { order, skipped: false };
  }

  order.fulfilmentAttempted = true;
  const params = mapFulfilmentParams(order, sp24Service);

  try {
    const result = await socialPanel.addOrder(env, params);
    const downstreamId = result?.order ?? result?.id ?? '';
    if (!downstreamId) {
      order.status = 'fulfilment_failed';
      order.fulfilmentError = 'SocialPanel24 accepted the request but returned no order id.';
      return { order, skipped: false };
    }
    order.socialPanelOrderId = String(downstreamId);
    order.status = 'processing';
    order.fulfilmentError = '';
    return { order, skipped: false };
  } catch (err) {
    order.status = 'fulfilment_failed';
    order.fulfilmentError = err instanceof Error ? err.message : 'SocialPanel24 request failed';
    return { order, skipped: false };
  }
}
