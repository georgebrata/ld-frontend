import { CONFIG } from '../config.js';
import { ordersApi } from '../api/orders-api.js';
import { formatOrderId } from '../utils/validation.js';
import { createEl, clearChildren } from '../utils/dom.js';

/** @type {Record<string, { title: string, className: string }>} */
const STATUS_UI = {
  paid: { title: 'Payment successful', className: 'confirmation-card--success' },
  processing: { title: 'Payment successful', className: 'confirmation-card--success' },
  completed: { title: 'Payment successful', className: 'confirmation-card--success' },
  pending: { title: 'Payment cancelled', className: 'confirmation-card--cancel' },
  cancelled: { title: 'Payment cancelled', className: 'confirmation-card--cancel' },
  canceled: { title: 'Payment cancelled', className: 'confirmation-card--cancel' },
  failed: { title: 'Payment could not be completed', className: 'confirmation-card--fail' },
  payment_failed: { title: 'Payment could not be completed', className: 'confirmation-card--fail' },
};

/**
 * Get orderId from URL.
 * @returns {string|null}
 */
function getOrderIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('orderId');
}

/**
 * Render confirmation UI.
 * @param {HTMLElement} container
 * @param {import('../types.js').Order} order
 */
function renderOrderConfirmation(container, order) {
  const status = order.Status?.toLowerCase() ?? 'pending';
  const ui = STATUS_UI[status] ?? STATUS_UI.processing;
  const isSuccess = ['paid', 'processing', 'completed'].includes(status);
  const isFail = ['failed', 'payment_failed'].includes(status);
  const isCancel = ['pending', 'cancelled', 'canceled'].includes(status);

  clearChildren(container);

  const card = createEl('div', { className: `confirmation-card ${ui.className}` });
  card.appendChild(createEl('h1', {}, ui.title));

  if (isSuccess) {
    card.appendChild(createEl('p', {}, 'Thank you for your order.'));
    card.appendChild(
      createEl('p', { className: 'confirmation-order-id' }, formatOrderId(order._id ?? '', CONFIG.ORDER_ID_PREFIX))
    );

    const dl = createEl('dl', { className: 'confirmation-details' });
    const addRow = (label, value) => {
      dl.appendChild(createEl('dt', {}, label));
      dl.appendChild(createEl('dd', {}, value));
    };
    addRow('Service', order.Service);
    addRow('Quantity', String(order.Quantity));
    addRow('Status', status.charAt(0).toUpperCase() + status.slice(1));
    if (order.URL) addRow('Details', order.URL);
    card.appendChild(dl);

    card.appendChild(createEl('p', {}, 'A confirmation email has been sent to:'));
    card.appendChild(createEl('p', {}, order.CustomerEmail));
  } else if (isCancel) {
    card.appendChild(createEl('p', {}, 'Your order was not completed.'));
  } else if (isFail) {
    card.appendChild(createEl('p', {}, 'Please try again.'));
  }

  const actions = createEl('div', { className: 'confirmation-actions' });

  if (isSuccess) {
    const shopBtn = createEl('a', { className: 'btn', href: '/' }, 'Continue shopping');
    actions.appendChild(shopBtn);
  } else if (isCancel) {
    const returnBtn = createEl('a', { className: 'btn', href: '/' }, 'Return to services');
    actions.appendChild(returnBtn);
  } else if (isFail) {
    const retryBtn = createEl('a', { className: 'btn', href: '/' }, 'Try again');
    actions.appendChild(retryBtn);
  }

  card.appendChild(actions);
  container.appendChild(card);
}

/**
 * Render error state.
 * @param {HTMLElement} container
 * @param {string} message
 */
function renderErrorState(container, message) {
  clearChildren(container);
  const card = createEl('div', { className: 'confirmation-card confirmation-card--fail' });
  card.appendChild(createEl('h1', {}, 'Order not found'));
  card.appendChild(createEl('p', {}, message));
  const btn = createEl('a', { className: 'btn', href: '/' }, 'Return to home');
  card.appendChild(btn);
  container.appendChild(card);
}

/**
 * Init confirmation page.
 */
export async function initConfirmationPage() {
  const container = document.getElementById('confirmation-root');
  if (!container) return;

  const orderId = getOrderIdFromUrl();
  if (!orderId) {
    renderErrorState(container, 'No order reference was provided.');
    return;
  }

  container.appendChild(createEl('div', { className: 'lds-ripple' }));
  const ripple = container.querySelector('.lds-ripple');
  if (ripple) {
    ripple.appendChild(createEl('div'));
    ripple.appendChild(createEl('div'));
  }

  try {
    const order = await ordersApi.getOrder(orderId);
    if (!order) {
      renderErrorState(container, 'We could not find this order. Please check your link or contact support.');
      return;
    }
    renderOrderConfirmation(container, order);
  } catch {
    renderErrorState(container, 'We could not load your order details. Please try again later.');
  }
}
