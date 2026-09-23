import { readCheckoutDraft, retryCheckoutHref } from '../checkout/capability.js';
import { ordersApi } from '../api/orders-api.js';
import { readCapability } from '../checkout/capability.js';
import { CONFIG } from '../config.js';

const SUPPORT = CONFIG.SUPPORT_EMAIL || 'support@like-dealer.com';

/**
 * Cancellation does not expire the Stripe session by itself.
 * Entered details stay in sessionStorage for retry.
 */
export function initCancelPage() {
  const root = document.getElementById('cancel-retry');
  if (!root) return;
  const draft = readCheckoutDraft();
  const link = root.querySelector('a');
  if (link instanceof HTMLAnchorElement) {
    link.href = retryCheckoutHref(draft);
    if (draft?.serviceId) {
      link.textContent = 'Return and retry with your details saved';
    }
  }

  const copy = document.getElementById('cancel-copy');
  if (copy) {
    copy.textContent =
      'Checkout was closed. We have not confirmed a successful payment yet. If you completed payment in another tab, wait for email or open the success page from that browser.';
  }

  const support = document.getElementById('cancel-support');
  if (support instanceof HTMLAnchorElement) {
    support.href = `mailto:${SUPPORT}`;
    support.hidden = false;
  }

  const cap = readCapability();
  const sessionId = new URLSearchParams(window.location.search).get('session_id') || '';
  if (cap.token && (sessionId || cap.attemptId)) {
    ordersApi
      .getAuthorizedOrder({
        token: cap.token,
        sessionId,
        checkoutAttemptId: cap.attemptId,
      })
      .then((result) => {
        if (result.order?.paymentStatus === 'paid' && copy) {
          copy.textContent =
            'This checkout was closed here, but payment is already recorded. Check your email receipt or the order status page.';
        }
      })
      .catch(() => {});
  }
}
