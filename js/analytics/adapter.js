import { CONFIG } from '../config.js';

const ALLOWED = new Set(['service_selected', 'checkout_start', 'validation_failure', 'purchase_confirmed']);

function consented() {
  if (!CONFIG.ANALYTICS_ENABLED) return false;
  try {
    return window.localStorage.getItem(CONFIG.ANALYTICS_CONSENT_KEY) === '1';
  } catch {
    return false;
  }
}

function scrub(props) {
  const clean = { ...(props || {}) };
  ['email', 'token', 'url', 'comments', 'inputs', 'capabilityToken'].forEach((key) => {
    delete clean[key];
  });
  return clean;
}

/**
 * Optional storefront analytics. Purchase counting from verified payment is
 * server-side (webhook jobs). This adapter never sends secrets or target URLs.
 * @param {string} event
 * @param {Record<string, unknown>} [props]
 */
export function track(event, props = {}) {
  if (!ALLOWED.has(event) || !consented()) return;
  const payload = { event, ...scrub(props) };
  if (Array.isArray(window.dataLayer)) {
    window.dataLayer.push(payload);
    return;
  }
  if (typeof window.gtag === 'function') {
    window.gtag('event', event, scrub(props));
  }
}
