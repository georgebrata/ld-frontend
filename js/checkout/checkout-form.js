import { ordersApi } from '../api/orders-api.js';
import { formatMoney, estimateTotalMinor } from '../utils/money.js';
import { createEl, clearChildren } from '../utils/dom.js';
import { normalizeNewlineList } from '../utils/inputs.js';
import { track } from '../analytics/adapter.js';
import { getOrCreateCapability, saveCheckoutDraft, readCheckoutDraft } from './capability.js';
import { renderInput, validateField, collectServiceInputValues } from './input-renderer.js';

/**
 * @param {import('../types.js').Service} service
 * @param {number} quantity
 */
function estimateLabel(service, quantity) {
  if (!Number.isInteger(service.retailRateMinor) || !service.rateUnit) {
    return 'Total confirmed before payment';
  }
  const total = estimateTotalMinor(service.retailRateMinor, quantity, service.rateUnit);
  if (total == null) return 'Total confirmed before payment';
  return `${formatMoney(total, service.currency)} estimated`;
}

function quantityMode(service) {
  const declared = service.quantityMode;
  if (declared === 'from_comments' || declared === 'package' || declared === 'omit') return declared;
  if ((service.inputs || []).includes('comments')) return 'from_comments';
  return declared || 'required';
}

/**
 * @param {HTMLElement} container
 * @param {import('../types.js').Service} service
 */
export async function mountCheckoutForm(container, service) {
  clearChildren(container);
  let submitting = false;
  let reviewedQuote = null;
  const mode = quantityMode(service);
  const needsQuantity = mode === 'required';
  const draft = readCheckoutDraft();
  const sameService = draft?.serviceId === service.id;

  const heading = createEl('p', { className: 'checkout-form__service' }, service.label);
  const status = createEl('p', { className: 'checkout-status', role: 'status', 'aria-live': 'polite' });
  container.appendChild(heading);
  container.appendChild(status);

  if (!service.purchasable) {
    status.textContent = 'This service is not available to purchase right now.';
    return;
  }

  const form = createEl('form', { className: 'checkout-form', novalidate: 'true' });
  const errorBanner = createEl('p', {
    className: 'form-error checkout-form__banner',
    role: 'alert',
    'aria-live': 'assertive',
  });
  errorBanner.hidden = true;
  form.appendChild(errorBanner);

  const serviceInputTypes = (service.inputs ?? []).filter((type) => type !== 'email' && type !== 'quantity');
  serviceInputTypes.forEach((type) => {
    const rendered = renderInput(type, form, {
      value: sameService ? draft?.inputs?.[type] : undefined,
    });
    if (sameService && draft?.inputs?.[type]) rendered.input.value = draft.inputs[type];
  });

  const min = Number.isInteger(service.quantityMin) ? service.quantityMin : 1;
  const max = Number.isInteger(service.quantityMax) ? service.quantityMax : 10_000_000;
  const step = Number.isInteger(service.quantityStep) ? service.quantityStep : 1;
  const defaultQty = Number.isInteger(service.quantityDefault)
    ? Math.min(Math.max(service.quantityDefault, min), max)
    : min;

  if (needsQuantity) {
    renderInput('quantity', form, {
      min,
      max,
      step,
      value: sameService && draft?.quantity ? draft.quantity : defaultQty,
    });
  }
  renderInput('email', form, { value: sameService ? draft?.email : undefined });
  if (sameService && draft?.email) {
    const emailInput = form.querySelector('[name="email"]');
    if (emailInput) emailInput.value = draft.email;
  }

  const limits = createEl(
    'p',
    { className: 'checkout-limits' },
    needsQuantity
      ? `Quantity ${min.toLocaleString('en-US')}–${max.toLocaleString('en-US')}${step > 1 ? `, step ${step}` : ''}. ${
          service.rateUnit === 'per_1000' ? 'Priced per 1,000.' : service.rateUnit === 'per_comment' ? 'Priced per comment.' : ''
        }`
      : mode === 'from_comments'
        ? 'Quantity is the number of nonempty comment lines. Priced per comment.'
        : 'This is a package price for one order.'
  );
  form.appendChild(limits);

  const priceEl = createEl('p', { className: 'checkout-price', 'aria-live': 'polite' }, estimateLabel(service, defaultQty));
  form.appendChild(priceEl);

  const facts = createEl('div', { className: 'checkout-facts' });
  facts.appendChild(
    createEl(
      'p',
      {},
      'Once you pay, fulfilment starts automatically. Timing depends on the provider and is not guaranteed on this page. If you need a refund, LikeDealer support reviews the paid order — a provider cancellation does not refund Stripe by itself.'
    )
  );
  facts.appendChild(createEl('p', {}, 'We never ask for social-media passwords. Stripe processes the payment.'));
  form.appendChild(facts);

  const qtyInput = /** @type {HTMLInputElement|null} */ (form.querySelector('[name="quantity"]'));
  const commentsInput = /** @type {HTMLTextAreaElement|null} */ (form.querySelector('[name="comments"]'));

  function currentQuantity() {
    if (mode === 'from_comments') return normalizeNewlineList(commentsInput?.value || '').count || 1;
    if (mode === 'package') return 1;
    return Number(qtyInput?.value || defaultQty);
  }

  function refreshEstimate() {
    priceEl.textContent = estimateLabel(service, currentQuantity());
  }

  qtyInput?.addEventListener('input', refreshEstimate);
  commentsInput?.addEventListener('input', refreshEstimate);
  refreshEstimate();

  const submitBtn = createEl('button', { className: 'btn checkout-submit', type: 'submit' }, 'Continue to payment');
  form.appendChild(submitBtn);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;

    let valid = true;
    serviceInputTypes.forEach((type) => {
      const input = form.querySelector(`[name="${type}"]`);
      const field = form.querySelector(`[data-input-type="${type}"]`);
      const errorEl = field?.querySelector('.form-error');
      if (input && field && errorEl) {
        if (!validateField(type, input, field, errorEl, { platform: service.platform, min, max })) valid = false;
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
      if (qtyField && qtyError && !validateField('quantity', qtyInput, qtyField, qtyError, { min, max })) {
        valid = false;
      }
    }

    if (!valid) {
      track('validation_failure', { serviceId: service.id });
      const firstError = form.querySelector('.form-field--error input, .form-field--error textarea');
      if (firstError instanceof HTMLElement) firstError.focus();
      return;
    }

    if (!ordersApi.isCheckoutConfigured()) {
      errorBanner.textContent = 'Checkout is not configured yet. Please try again later.';
      errorBanner.hidden = false;
      return;
    }

    const inputs = collectServiceInputValues(form, serviceInputTypes);
    const quantity = currentQuantity();
    const expectedMinor = estimateTotalMinor(service.retailRateMinor, quantity, service.rateUnit);
    saveCheckoutDraft({
      serviceId: service.id,
      platform: service.platform,
      slug: service.slug,
      url: service.url,
      quantity,
      email: emailInput?.value.trim() ?? '',
      inputs,
    });

    const cap = getOrCreateCapability(service.id);
    const payload = {
      serviceId: service.id,
      quantity,
      customerEmail: emailInput?.value.trim() ?? '',
      inputs,
      checkoutAttemptId: cap.attemptId,
      capabilityToken: cap.token,
      expectedQuote: reviewedQuote
        ? {
            amountMinor: reviewedQuote.amountMinor,
            currency: reviewedQuote.currency,
            quantity: reviewedQuote.quantity ?? quantity,
            quoteVersion: reviewedQuote.quoteVersion,
          }
        : expectedMinor != null
          ? {
              amountMinor: expectedMinor,
              currency: service.currency,
              quantity,
            }
          : undefined,
    };

    submitting = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Opening payment…';
    errorBanner.hidden = true;
    status.textContent = 'Opening secure payment…';
    track('checkout_start', { serviceId: service.id });

    try {
      const result = await ordersApi.createCheckoutSession(payload);
      window.location.href = result.checkoutUrl;
    } catch (err) {
      submitting = false;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Continue to payment';
      status.textContent = '';
      if (err && err.code === 'quote_changed' && err.quote) {
        reviewedQuote = err.quote;
        priceEl.textContent = `${formatMoney(err.quote.amountMinor, err.quote.currency)} — review this total, then continue`;
        errorBanner.textContent = err.message;
        errorBanner.hidden = false;
        return;
      }
      errorBanner.textContent = err instanceof Error && err.message ? err.message : 'Something went wrong. Please try again.';
      errorBanner.hidden = false;
    }
  });

  container.appendChild(form);
  const firstField = form.querySelector('input, textarea');
  if (firstField instanceof HTMLElement) firstField.focus();
  track('service_selected', { serviceId: service.id });
}
