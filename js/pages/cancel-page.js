import { readCheckoutDraft, retryCheckoutHref } from '../checkout/capability.js';

/**
 * Cancellation does not expire the Stripe session by itself.
 * Entered details stay in sessionStorage for retry.
 */
export function initCancelPage() {
  const root = document.getElementById('cancel-retry');
  if (!root) return;
  const draft = readCheckoutDraft();
  const link = root.querySelector('a');
  if (!(link instanceof HTMLAnchorElement)) return;
  link.href = retryCheckoutHref(draft);
  if (draft?.serviceId) {
    link.textContent = 'Return and retry with your details saved';
  }
}
