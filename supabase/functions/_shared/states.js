/**
 * Payment and fulfilment state machines. Unknown remains unknown.
 */

export const PAYMENT_STATES = Object.freeze(['pending', 'paid', 'failed', 'expired', 'cancelled']);
export const FULFILLMENT_STATES = Object.freeze([
  'not_started',
  'dispatching',
  'submitted',
  'in_progress',
  'completed',
  'partial',
  'failed',
  'cancelled',
  'submission_unknown',
  'blocked_balance',
  'skipped_test_mode',
  'review',
]);

const PAID_LOCK = new Set(['paid']);

/**
 * Late events must not downgrade a paid order.
 * @param {string} current
 * @param {string} next
 * @returns {string}
 */
export function transitionPayment(current, next) {
  if (PAID_LOCK.has(current)) return current;
  if (next === 'paid') return 'paid';
  if (PAYMENT_STATES.includes(next)) return next;
  return current || 'pending';
}

/**
 * Map SocialPanel24 status strings. Unfamiliar values stay in review.
 * @param {string} raw
 */
export function mapProviderStatus(raw) {
  const value = String(raw || '').trim();
  const lower = value.toLowerCase();
  if (lower === 'completed' || lower === 'complete') return 'completed';
  if (lower === 'in progress' || lower === 'processing' || lower === 'pending') return 'in_progress';
  if (lower === 'partial') return 'partial';
  if (lower === 'canceled' || lower === 'cancelled') return 'cancelled';
  if (lower === 'refunded') return 'cancelled';
  if (lower === 'error' || lower === 'failed' || lower === 'rejected') return 'failed';
  return 'review';
}

/**
 * UI projection from stored facts. Payment success does not imply fulfilment
 * or email delivery.
 * @param {{ paymentStatus: string, fulfillmentStatus: string }} order
 */
export function publicUiState(order) {
  const payment = order.paymentStatus;
  const fulfillment = order.fulfillmentStatus;
  if (payment === 'pending') return 'awaiting_confirmation';
  if (payment === 'failed') return 'failed';
  if (payment === 'expired' || payment === 'cancelled') return 'expired';
  if (payment !== 'paid') return 'unknown';
  if (fulfillment === 'completed') return 'completed';
  if (fulfillment === 'failed' || fulfillment === 'blocked_balance') return 'failed';
  if (fulfillment === 'cancelled' || fulfillment === 'partial') return 'failed';
  if (fulfillment === 'in_progress' || fulfillment === 'submitted' || fulfillment === 'dispatching') {
    return 'processing';
  }
  if (fulfillment === 'not_started' || fulfillment === 'skipped_test_mode') return 'payment_received';
  if (fulfillment === 'submission_unknown' || fulfillment === 'review') return 'processing';
  return 'unknown';
}

/**
 * @param {string} rawId
 * @param {string} [prefix='LD-']
 */
export function formatDisplayId(rawId, prefix = 'LD-') {
  const short = String(rawId || '')
    .replace(/-/g, '')
    .slice(-6)
    .toUpperCase();
  return short ? `${prefix}${short}` : '';
}
