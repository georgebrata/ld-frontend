/**
 * Application configuration. Secrets never belong here.
 * @type {Readonly<{
 *   API_BASE_URL: string,
 *   CHECKOUT_WORKER_URL: string,
 *   SITE_URL: string,
 *   ORDER_ID_PREFIX: string,
 *   DEFAULT_QUANTITY: number,
 *   QUANTITY_STEP: number,
 *   QUANTITY_MIN: number,
 *   QUANTITY_MAX: number,
 *   FETCH_TIMEOUT_MS: number,
 *   EMAIL_MAX_LENGTH: number
 * }>}
 */
export const CONFIG = Object.freeze({
  API_BASE_URL:
    'https://script.google.com/macros/s/AKfycby3Yg1NEsipYEyQi6Oarl_h5C4-rr40dPQwP9LLttlN-EwTgyynojaHAR7CCjodgyZrvg/exec',
  /** Cloudflare Worker origin, e.g. https://api.like-dealer.com */
  CHECKOUT_WORKER_URL: '',
  SITE_URL: 'https://like-dealer.com',
  ORDER_ID_PREFIX: 'LD-',
  DEFAULT_QUANTITY: 1000,
  QUANTITY_STEP: 100,
  QUANTITY_MIN: 1,
  QUANTITY_MAX: 10000000,
  FETCH_TIMEOUT_MS: 15000,
  EMAIL_MAX_LENGTH: 254,
});
