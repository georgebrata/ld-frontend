import { ordersApi } from '../api/orders-api.js';
import { readCapability } from '../checkout/capability.js';
import { createEl, clearChildren } from '../utils/dom.js';
import { track } from '../analytics/adapter.js';
import { CONFIG } from '../config.js';

const BACKOFF_MS = [800, 1500, 2500, 4000, 7000, 10000, 15000];
const SUPPORT = CONFIG.SUPPORT_EMAIL || 'support@like-dealer.com';
const ACTIVE_UI = new Set(['awaiting_confirmation', 'payment_received', 'processing']);

function getSessionId() {
  return new URLSearchParams(window.location.search).get('session_id') || '';
}

function humanPayment(status) {
  if (status === 'paid') return 'Paid';
  if (status === 'pending') return 'Waiting for confirmation';
  if (status === 'failed') return 'Payment failed';
  if (status === 'expired' || status === 'cancelled') return 'Checkout closed';
  return 'Unknown';
}

function humanFulfillment(status) {
  const map = {
    not_started: 'Not started',
    deferred: 'Queued',
    skipped_test_mode: 'Test payment — not sent to the provider',
    dispatching: 'Sending to the provider',
    submitted: 'Received by the provider',
    in_progress: 'In progress',
    partial: 'Partially delivered — support will review',
    completed: 'Completed',
    failed: 'Needs review',
    cancelled: 'Cancelled by the provider',
    submission_unknown: 'Needs operator review',
    blocked_balance: 'Queued — operator notified',
    review: 'Needs review',
  };
  return map[status] || 'Unknown';
}

function humanEmail(state) {
  if (state === 'accepted' || state === 'sent') return 'Receipt accepted for sending';
  if (state === 'delivered') return 'Receipt delivered';
  if (state === 'failed') return 'Receipt not sent yet';
  if (state === 'bounced') return 'Receipt bounced';
  return 'Receipt not confirmed';
}

function supportHref(order) {
  const subject = encodeURIComponent(order?.displayId ? `LikeDealer order ${order.displayId}` : 'LikeDealer support');
  const body = encodeURIComponent(
    order?.displayId ? `Order reference: ${order.displayId}\n` : 'I need help with a LikeDealer order.\n'
  );
  return `mailto:${SUPPORT}?subject=${subject}&body=${body}`;
}

function renderCard(container, { title, message, modifier, order, retry }) {
  clearChildren(container);
  const card = createEl('div', { className: `confirmation-card confirmation-card--${modifier}` });
  const body = createEl('div');
  body.appendChild(createEl('h1', {}, title));
  body.appendChild(createEl('p', {}, message));
  if (order) {
    const dl = createEl('dl', { className: 'confirmation-details' });
    const add = (label, value) => {
      if (value == null || value === '') return;
      dl.appendChild(createEl('dt', {}, label));
      dl.appendChild(createEl('dd', {}, String(value)));
    };
    add('Order', order.displayId);
    add('Service', order.service);
    add('Quantity', order.quantity);
    add('Amount', order.amountLabel);
    add('Payment', humanPayment(order.paymentStatus));
    add('Fulfilment', humanFulfillment(order.fulfillmentStatus));
    add('Email', humanEmail(order.emailDelivery));
    body.appendChild(dl);
  }
  const actions = createEl('div', { className: 'confirmation-actions' });
  if (retry) {
    const again = createEl('button', { className: 'btn', type: 'button' }, 'Check again');
    again.addEventListener('click', retry);
    actions.appendChild(again);
  }
  actions.appendChild(createEl('a', { className: 'btn', href: '/' }, 'Back to home'));
  actions.appendChild(createEl('a', { className: 'why-page-link', href: supportHref(order) }, 'Contact support'));
  body.appendChild(actions);
  card.appendChild(body);
  container.appendChild(card);
}

function viewFor(order) {
  const ui = order?.uiState || 'unknown';
  if (ui === 'awaiting_confirmation') {
    return {
      title: 'Confirming payment',
      message: 'Stripe is still confirming this payment. This page is not proof of payment yet.',
      modifier: 'pending',
    };
  }
  if (ui === 'payment_received') {
    return {
      title: 'Payment received',
      message: 'Your payment has been received. Fulfilment is processed separately and is not complete yet.',
      modifier: 'success',
    };
  }
  if (ui === 'processing') {
    return {
      title: 'Order processing',
      message: 'Payment was received and the order is being processed. Completion is confirmed only when the provider reports it.',
      modifier: 'success',
    };
  }
  if (ui === 'completed') {
    return {
      title: 'Order completed',
      message: 'The provider reported this order as completed.',
      modifier: 'success',
    };
  }
  if (ui === 'failed') {
    const paid = order?.paymentStatus === 'paid';
    return {
      title: paid ? 'Fulfilment needs attention' : 'Something needs attention',
      message: paid
        ? 'Payment was received, but fulfilment did not complete as expected. Contact support with your order reference.'
        : 'Payment did not complete as expected. Contact support if you were charged.',
      modifier: 'fail',
    };
  }
  if (ui === 'expired') {
    return {
      title: 'Checkout expired',
      message: 'This checkout session expired or was cancelled. It was not successfully paid.',
      modifier: 'cancel',
    };
  }
  return {
    title: 'Order status unknown',
    message: 'We could not map this order to a known payment or fulfilment state. Unknown remains unknown — it is not treated as paid.',
    modifier: 'pending',
  };
}

export async function initSuccessPage() {
  const container = document.getElementById('success-root');
  if (!container) return;

  const sessionId = getSessionId();
  const cap = readCapability();
  if (!cap.token || !sessionId) {
    renderCard(container, {
      title: 'Order reference missing',
      message:
        'This page needs the checkout token from the browser that started payment. If you paid, check your email receipt or contact support. Arrival here is not proof of payment.',
      modifier: 'fail',
    });
    return;
  }

  let attempt = 0;
  const poll = async () => {
    const result = await ordersApi.getAuthorizedOrder({
      token: cap.token,
      sessionId,
      checkoutAttemptId: cap.attemptId,
    });
    if (result.error || !result.order) {
      const messages = {
        offline: 'You appear to be offline. Check your connection, then try again.',
        timeout: 'The status request timed out. Fulfilment does not require this page to stay open.',
        unauthorized: 'This browser is not authorized for that checkout. Use the original tab or your email receipt.',
        unavailable: 'Status is temporarily unavailable. Payment confirmation still comes from Stripe, not this page.',
      };
      const keepTrying = attempt < BACKOFF_MS.length;
      renderCard(container, {
        title: 'Still confirming',
        message: messages[result.error] || 'We have not received an authorized status yet.',
        modifier: 'pending',
        retry: keepTrying ? undefined : () => {
          attempt = 0;
          poll();
        },
      });
      if (keepTrying) {
        window.setTimeout(poll, BACKOFF_MS[attempt]);
        attempt += 1;
      }
      return;
    }

    const view = viewFor(result.order);
    const active = ACTIVE_UI.has(result.order.uiState);
    renderCard(container, {
      ...view,
      order: result.order,
      retry: active || attempt >= BACKOFF_MS.length ? () => poll() : undefined,
    });
    if (result.order.paymentStatus === 'paid') {
      track('purchase_confirmed', { uiState: result.order.uiState });
    }
    if (active && attempt < BACKOFF_MS.length && document.visibilityState !== 'hidden') {
      window.setTimeout(poll, BACKOFF_MS[attempt]);
      attempt += 1;
    }
  };

  await poll();
}
