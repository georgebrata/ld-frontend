import { CONFIG } from '../config.js';
import { ordersApi } from '../api/orders-api.js';
import { formatOrderId } from '../utils/validation.js';
import { formatUsd } from '../utils/money.js';
import { createEl, clearChildren } from '../utils/dom.js';

/**
 * @returns {string|null}
 */
function getLookupId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('session_id') || params.get('orderId') || params.get('id');
}

/**
 * @param {HTMLElement} container
 * @param {string} title
 * @param {string} message
 */
function renderMessage(container, title, message) {
  clearChildren(container);
  const card = createEl('div', { className: 'confirmation-card confirmation-card--fail' });
  card.appendChild(createEl('h1', {}, title));
  card.appendChild(createEl('p', {}, message));
  card.appendChild(createEl('a', { className: 'btn', href: '/' }, 'Return home'));
  container.appendChild(card);
}

/**
 * Load the success page from the Worker — never treat arrival as payment proof.
 */
export async function initSuccessPage() {
  const container = document.getElementById('success-root');
  if (!container) return;

  const lookupId = getLookupId();
  if (!lookupId) {
    renderMessage(
      container,
      'Order reference missing',
      'We could not find a checkout reference. If you completed payment, check your email or contact support.'
    );
    return;
  }

  try {
    const order = await ordersApi.getPublicOrder(lookupId);
    if (!order) {
      renderMessage(
        container,
        'Looking up your payment',
        'Your payment has been received by Stripe if you completed checkout. Order details will appear here once they are confirmed. Save any email receipt you receive.'
      );
      return;
    }

    clearChildren(container);
    const card = createEl('div', { className: 'confirmation-card confirmation-card--success' });
    card.appendChild(createEl('h1', {}, 'Payment received'));
    card.appendChild(
      createEl(
        'p',
        {},
        'Your payment has been received and your order is being processed. Fulfilment is not complete just because you reached this page.'
      )
    );

    const displayId =
      String(order.displayId ?? '') ||
      formatOrderId(String(order.id ?? ''), CONFIG.ORDER_ID_PREFIX);
    if (displayId) {
      card.appendChild(createEl('p', { className: 'confirmation-order-id' }, displayId));
    }

    const dl = createEl('dl', { className: 'confirmation-details' });
    const addRow = (label, value) => {
      if (value == null || value === '') return;
      dl.appendChild(createEl('dt', {}, label));
      dl.appendChild(createEl('dd', {}, String(value)));
    };
    addRow('Service', order.service);
    addRow('Platform', order.platform);
    addRow('Quantity', order.quantity);
    addRow('Email', order.customerEmail);
    addRow('Status', order.status);
    addRow('Target', order.target);
    if (Number.isInteger(order.amountPaidCents)) {
      addRow('Amount paid', formatUsd(order.amountPaidCents));
    }
    card.appendChild(dl);

    card.appendChild(
      createEl(
        'p',
        {},
        'We will email you when processing starts. Contact support if you do not hear from us.'
      )
    );
    card.appendChild(createEl('a', { className: 'btn', href: '/' }, 'Back to home'));
    container.appendChild(card);
  } catch {
    renderMessage(
      container,
      'We could not load this order',
      'If you paid, keep your Stripe receipt and contact support. This page is not proof of fulfilment.'
    );
  }
}
