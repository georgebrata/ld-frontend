import { servicesApi } from '../api/services-api.js';
import { openCheckoutModal } from '../checkout/checkout-modal.js';

/**
 * Bind the prerendered service page Order CTA.
 */
export async function initServicePage() {
  const trigger = document.querySelector('[data-checkout-trigger]');
  const serviceId = document.body.dataset.serviceId;
  if (!trigger || !serviceId) return;

  const service = await servicesApi.getService(serviceId);
  if (!service) return;

  trigger.addEventListener('click', () => {
    openCheckoutModal(service, trigger instanceof HTMLElement ? trigger : undefined);
  });
}
