import { CONFIG } from '../config.js';
import { ordersApi } from '../api/orders-api.js';
import { formatUsd } from '../utils/money.js';
import { createEl, clearChildren } from '../utils/dom.js';
import {
  renderInput,
  validateField,
  collectServiceInputValues,
} from './input-renderer.js';

/**
 * @param {import('../types.js').Service} service
 * @param {number|null} unitCents
 * @param {number} quantity
 * @returns {string}
 */
function displayTotal(service, unitCents, quantity) {
  if (Number.isInteger(unitCents) && unitCents >= 0) {
    const total = Math.round((unitCents * quantity) / 1000);
    return `${formatUsd(total)} estimated`;
  }
  if (service.price == null) return 'Price confirmed at checkout';
  return 'Display price only — final amount is confirmed at payment';
}

/**
 * Mount the inline checkout form for a service.
 *
 * @param {HTMLElement} container
 * @param {import('../types.js').Service} service
 * @returns {Promise<void>}
 */
export async function mountCheckoutForm(container, service) {
  clearChildren(container);
  let submitting = false;

  const status = createEl('p', {
    className: 'checkout-status',
    role: 'status',
    'aria-live': 'polite',
  });

  const heading = createEl('p', { className: 'checkout-form__service' }, service.label);
  container.appendChild(heading);
  container.appendChild(status);

  /** @type {{ quantityMin: number, quantityMax: number, unitPriceInCents: number|null, purchasable: boolean }} */
  let catalog = {
    quantityMin: CONFIG.QUANTITY_MIN,
    quantityMax: CONFIG.QUANTITY_MAX,
    unitPriceInCents: null,
    purchasable: true,
  };

  if (CONFIG.CHECKOUT_WORKER_URL) {
    status.textContent = 'Loading price…';
    try {
      catalog = await ordersApi.getCatalog(service.id);
    } catch {
      status.textContent = 'Live pricing is unavailable. You can still enter details.';
    }
  }

  if (catalog.purchasable === false) {
    status.textContent = 'This service is not available to purchase right now.';
    return;
  }

  const form = createEl('form', { className: 'checkout-form', novalidate: 'true' });

  const serviceInputTypes = (service.inputs ?? []).filter(
    (type) => type !== 'email' && type !== 'quantity'
  );
  serviceInputTypes.forEach((type) => renderInput(type, form));

  const qtyBounds = {
    min: catalog.quantityMin,
    max: catalog.quantityMax,
    step: CONFIG.QUANTITY_STEP,
    value: Math.min(
      Math.max(CONFIG.DEFAULT_QUANTITY, catalog.quantityMin),
      catalog.quantityMax
    ),
  };
  renderInput('quantity', form, qtyBounds);
  renderInput('email', form);

  const priceEl = createEl(
    'p',
    { className: 'checkout-price', 'aria-live': 'polite' },
    displayTotal(service, catalog.unitPriceInCents, qtyBounds.value)
  );
  form.appendChild(priceEl);

  const qtyInput = /** @type {HTMLInputElement|null} */ (form.querySelector('[name="quantity"]'));

  /**
   * @param {number} quantity
   */
  async function refreshQuote(quantity) {
    if (!CONFIG.CHECKOUT_WORKER_URL) {
      priceEl.textContent = displayTotal(service, catalog.unitPriceInCents, quantity);
      return;
    }
    try {
      const quote = await ordersApi.getQuote({ serviceId: service.id, quantity });
      catalog.unitPriceInCents = quote.unitPriceInCents;
      priceEl.textContent = `${formatUsd(quote.totalInCents)} estimated`;
    } catch {
      priceEl.textContent = displayTotal(service, catalog.unitPriceInCents, quantity);
    }
  }

  if (qtyInput) {
    qtyInput.addEventListener('input', () => {
      const qty = Number(qtyInput.value);
      if (Number.isInteger(qty)) {
        priceEl.textContent = displayTotal(service, catalog.unitPriceInCents, qty);
        refreshQuote(qty);
      }
    });
    refreshQuote(Number(qtyInput.value) || qtyBounds.value);
  }

  const submitBtn = createEl(
    'button',
    { className: 'btn checkout-submit', type: 'submit' },
    'Continue to payment'
  );
  form.appendChild(submitBtn);

  const errorBanner = createEl('p', {
    className: 'form-error checkout-form__banner',
    role: 'alert',
    'aria-live': 'assertive',
  });
  errorBanner.hidden = true;
  form.prepend(errorBanner);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;

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

    if (qtyInput) {
      const qtyField = form.querySelector('[data-input-type="quantity"]');
      const qtyError = qtyField?.querySelector('.form-error');
      if (qtyField && qtyError) {
        if (
          !validateField('quantity', qtyInput, qtyField, qtyError, {
            min: catalog.quantityMin,
            max: catalog.quantityMax,
          })
        ) {
          valid = false;
        }
      }
    }

    if (!valid) {
      errorBanner.hidden = true;
      const firstError = form.querySelector('.form-field--error input, .form-field--error textarea');
      if (firstError instanceof HTMLElement) firstError.focus();
      return;
    }

    if (!CONFIG.CHECKOUT_WORKER_URL) {
      errorBanner.textContent = 'Checkout is not configured yet. Please try again later.';
      errorBanner.hidden = false;
      return;
    }

    const inputs = collectServiceInputValues(form, serviceInputTypes);
    if (inputs.username) inputs.username = inputs.username.replace(/^@/, '');

    submitting = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Processing…';
    errorBanner.hidden = true;
    status.textContent = 'Opening secure payment…';

    try {
      const checkoutUrl = await ordersApi.createCheckoutSession({
        serviceId: service.id,
        quantity: Number(qtyInput?.value ?? qtyBounds.value),
        customerEmail: emailInput?.value.trim() ?? '',
        inputs,
      });
      window.location.href = checkoutUrl;
    } catch (err) {
      submitting = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Continue to payment';
      status.textContent = '';
      errorBanner.textContent =
        err instanceof Error && err.message
          ? err.message
          : 'Something went wrong. Please try again.';
      errorBanner.hidden = false;
    }
  });

  container.appendChild(form);
  const firstField = form.querySelector('input, textarea');
  if (firstField instanceof HTMLElement) firstField.focus();
}
