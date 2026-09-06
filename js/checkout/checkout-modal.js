import { CONFIG } from '../config.js';
import { ordersApi } from '../api/orders-api.js';
import { validateInput, formatOrderId } from '../utils/validation.js';
import { createEl, clearChildren } from '../utils/dom.js';
import {
  renderInput,
  validateField,
  collectServiceInputValues,
} from './input-renderer.js';

/** @type {HTMLElement|null} */
let root = null;

/** @type {HTMLElement|null} */
let modalEl = null;

/** @type {HTMLElement|null} */
let previousFocus = null;

/** @type {import('../types.js').Service|null} */
let currentService = null;

/**
 * Ensure modal mount exists.
 */
function ensureRoot() {
  if (!root) {
    root = document.getElementById('checkout-modal-root');
    if (!root) {
      root = createEl('div', { id: 'checkout-modal-root' });
      document.body.appendChild(root);
    }
  }
}

/**
 * Trap focus within modal.
 * @param {KeyboardEvent} e
 */
function handleKeyDown(e) {
  if (e.key === 'Escape') {
    closeCheckoutModal();
    return;
  }

  if (e.key !== 'Tab' || !modalEl) return;

  const focusable = modalEl.querySelectorAll(
    'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])'
  );
  const items = Array.from(focusable).filter((el) => !el.hasAttribute('disabled'));
  if (!items.length) return;

  const first = items[0];
  const last = items[items.length - 1];

  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * Close the checkout modal.
 */
export function closeCheckoutModal() {
  if (!root) return;
  clearChildren(root);
  root.hidden = true;
  document.body.style.overflow = '';
  document.removeEventListener('keydown', handleKeyDown);
  modalEl = null;
  currentService = null;
  if (previousFocus instanceof HTMLElement) {
    previousFocus.focus();
    previousFocus = null;
  }
}

/**
 * Build order payload from form values.
 * @param {Record<string, string>} serviceValues
 * @param {string} email
 * @param {number} quantity
 * @returns {{ url: string, notes: string }}
 */
function buildOrderFields(serviceValues) {
  let url = serviceValues.url ?? serviceValues.username ?? '';
  if (serviceValues.username && !serviceValues.url) {
    url = serviceValues.username;
  }

  const notes = serviceValues.commentsList ?? '';

  return { url, notes };
}

/**
 * Calculate display price.
 * @param {import('../types.js').Service} service
 * @param {number} quantity
 * @returns {string}
 */
function formatPrice(service, quantity) {
  if (service.price == null) return 'Price confirmed at checkout';
  const total = (service.price * quantity) / 1000;
  return `$${total.toFixed(2)}`;
}

/**
 * Show pending-order success inside modal.
 * @param {string} orderId
 */
function showPendingSuccess(orderId) {
  if (!modalEl) return;
  clearChildren(modalEl);

  const displayId = formatOrderId(orderId, CONFIG.ORDER_ID_PREFIX);

  modalEl.appendChild(createEl('div', { className: 'checkout-modal__pending' }));
  const pending = modalEl.querySelector('.checkout-modal__pending');
  if (!pending) return;

  pending.appendChild(createEl('h3', {}, 'Order received'));
  pending.appendChild(
    createEl('p', {}, 'Your order has been saved. Payment setup is in progress.')
  );
  pending.appendChild(createEl('p', { className: 'checkout-modal__order-ref' }, displayId));
  pending.appendChild(
    createEl('p', {}, 'Save this reference. You will receive a confirmation email once payment is complete.')
  );

  const closeBtn = createEl('button', { className: 'btn checkout-submit', type: 'button' }, 'Close');
  closeBtn.addEventListener('click', closeCheckoutModal);
  pending.appendChild(closeBtn);
  closeBtn.focus();
}

/**
 * Handle form submission.
 * @param {HTMLFormElement} form
 * @param {string[]} serviceInputTypes
 * @param {HTMLElement} submitBtn
 */
async function handleSubmit(form, serviceInputTypes, submitBtn) {
  if (!currentService) return;

  let valid = true;

  serviceInputTypes.forEach((type) => {
    const input = form.querySelector(`[name="${type}"]`);
    const field = form.querySelector(`[data-input-type="${type}"]`);
    const errorEl = field?.querySelector('.form-error');
    if (input && field && errorEl) {
      if (!validateField(type, input, field, errorEl)) valid = false;
    }
  });

  const emailInput = /** @type {HTMLInputElement|null} */ (form.querySelector('[name="email"]'));
  const emailField = form.querySelector('[data-input-type="email"]');
  const emailError = emailField?.querySelector('.form-error');
  if (emailInput && emailField && emailError) {
    if (!validateField('email', emailInput, emailField, emailError)) valid = false;
  }

  const qtyInput = /** @type {HTMLInputElement|null} */ (form.querySelector('[name="quantity"]'));
  const qtyField = form.querySelector('[data-input-type="quantity"]');
  const qtyError = qtyField?.querySelector('.form-error');
  if (qtyInput && qtyField && qtyError) {
    if (!validateField('quantity', qtyInput, qtyField, qtyError)) valid = false;
  }

  if (!valid) return;

  const serviceValues = collectServiceInputValues(form, serviceInputTypes);
  const email = emailInput?.value.trim() ?? '';
  const quantity = Number(qtyInput?.value ?? CONFIG.DEFAULT_QUANTITY);
  const { url, notes } = buildOrderFields(serviceValues);

  submitBtn.disabled = true;
  submitBtn.textContent = 'Processing…';

  try {
    const order = await ordersApi.createOrder({
      customerEmail: email,
      service: currentService.label,
      serviceId: currentService.id,
      url,
      notes,
      quantity,
      status: 'pending',
    });

    const orderId = order._id ?? '';

    if (CONFIG.N8N_CHECKOUT_URL) {
      const checkoutUrl = await ordersApi.requestCheckoutSession({
        orderId,
        serviceId: currentService.id,
        service: currentService.label,
        quantity,
        customerEmail: email,
        url,
        notes,
      });

      if (checkoutUrl) {
        window.location.href = checkoutUrl;
        return;
      }
    }

    showPendingSuccess(orderId);
  } catch (err) {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Continue to payment';
    const errBanner = createEl('p', { className: 'form-error', role: 'alert' }, 'Something went wrong. Please try again.');
    form.prepend(errBanner);
  }
}

/**
 * Open checkout modal for a service.
 * @param {import('../types.js').Service} service
 * @param {HTMLElement} [triggerEl]
 */
export function openCheckoutModal(service, triggerEl) {
  ensureRoot();
  if (!root) return;

  previousFocus = triggerEl ?? document.activeElement;
  currentService = service;

  clearChildren(root);
  root.hidden = false;
  document.body.style.overflow = 'hidden';

  const backdrop = createEl('div', {
    className: 'checkout-modal-backdrop',
    role: 'presentation',
  });
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeCheckoutModal();
  });

  modalEl = createEl('div', {
    className: 'checkout-modal',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'checkout-modal-title',
  });

  const closeBtn = createEl('button', {
    className: 'checkout-modal__close',
    type: 'button',
    'aria-label': 'Close checkout',
  });
  closeBtn.addEventListener('click', closeCheckoutModal);
  modalEl.appendChild(closeBtn);

  modalEl.appendChild(createEl('h2', { className: 'checkout-modal__title', id: 'checkout-modal-title' }, 'Checkout'));
  modalEl.appendChild(createEl('p', { className: 'checkout-modal__service' }, service.label));

  const form = createEl('form', { className: 'checkout-form' });
  form.addEventListener('submit', (e) => e.preventDefault());

  const serviceInputTypes = service.inputs.filter(
    (t) => t !== 'email' && t !== 'quantity'
  );

  serviceInputTypes.forEach((type) => renderInput(type, form));
  renderInput('quantity', form);
  renderInput('email', form);

  const priceEl = createEl('p', { className: 'checkout-price' }, formatPrice(service, CONFIG.DEFAULT_QUANTITY));
  form.appendChild(priceEl);

  const qtyInput = form.querySelector('[name="quantity"]');
  if (qtyInput) {
    qtyInput.addEventListener('input', () => {
      const qty = Number(qtyInput.value) || CONFIG.DEFAULT_QUANTITY;
      priceEl.textContent = formatPrice(service, qty);
    });
  }

  const submitBtn = createEl('button', {
    className: 'btn checkout-submit',
    type: 'submit',
  }, 'Continue to payment');
  submitBtn.addEventListener('click', () => handleSubmit(form, serviceInputTypes, submitBtn));
  form.appendChild(submitBtn);

  modalEl.appendChild(form);
  backdrop.appendChild(modalEl);
  root.appendChild(backdrop);

  document.addEventListener('keydown', handleKeyDown);

  const firstInput = modalEl.querySelector('input, textarea');
  if (firstInput instanceof HTMLElement) firstInput.focus();
}

export const checkoutModal = {
  open: openCheckoutModal,
  close: closeCheckoutModal,
};
