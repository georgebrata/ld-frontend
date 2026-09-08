import { ordersApi } from '../api/orders-api.js';
import { readCapability } from '../checkout/capability.js';
import { createEl, clearChildren } from '../utils/dom.js';
import { track } from '../analytics/adapter.js';

const BACKOFF_MS = [800, 1500, 2500, 4000, 7000, 10000];

function getSessionId() {
  return new URLSearchParams(window.location.search).get('session_id') || '';
}

function renderCard(container, { title, message, modifier, order }) {
  clearChildren(container);
  const card = createEl('div', { className: `confirmation-card confirmation-card--${modifier}` });
  card.appendChild(createEl('h1', {}, title));
  card.appendChild(createEl('p', {}, message));
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
    add('Payment', order.paymentStatus);
    add('Fulfilment', order.fulfillmentStatus);
    add('Email delivery', order.emailDelivery);
    card.appendChild(dl);
  }
  card.appendChild(createEl('a', { className: 'btn', href: '/' }, 'Back to home'));
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
      message: 'Your payment has been received. Fulfilment is processed separately and is not complete yet. Email delivery is tracked independently.',
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
    return {
      title: 'Something needs attention',
      message: 'Payment or fulfilment did not complete as expected. Contact support with your order reference. This page does not change the stored facts.',
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
    const order = await ordersApi.getAuthorizedOrder({
      token: cap.token,
      sessionId,
      checkoutAttemptId: cap.attemptId,
    });
    if (!order) {
      if (attempt < BACKOFF_MS.length) {
        renderCard(container, {
          title: 'Confirming payment',
          message: 'Waiting for Stripe to confirm this payment. Keep this tab open, or rely on your email receipt if you leave.',
          modifier: 'pending',
        });
        window.setTimeout(poll, BACKOFF_MS[attempt]);
        attempt += 1;
        return;
      }
      renderCard(container, {
        title: 'Still confirming',
        message: 'We have not received an authorized status yet. If you completed payment, wait for email — this page is not required for fulfilment.',
        modifier: 'pending',
      });
      return;
    }

    const view = viewFor(order);
    renderCard(container, { ...view, order });
    if (order.paymentStatus === 'paid') {
      track('purchase_confirmed', { uiState: order.uiState });
    }
    if (order.uiState === 'awaiting_confirmation' && attempt < BACKOFF_MS.length) {
      window.setTimeout(poll, BACKOFF_MS[attempt]);
      attempt += 1;
    }
  };

  await poll();
}
