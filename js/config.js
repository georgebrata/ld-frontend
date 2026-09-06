/**
 * Application configuration.
 * @type {Readonly<{
 *   API_BASE: string,
 *   N8N_CHECKOUT_URL: string,
 *   ORDER_ID_PREFIX: string,
 *   DEFAULT_QUANTITY: number,
 *   QUANTITY_STEP: number,
 *   QUANTITY_MIN: number,
 *   FETCH_TIMEOUT_MS: number,
 *   SITE_URL: string
 * }>}
 */
export const CONFIG = Object.freeze({
  API_BASE:
    'https://script.google.com/macros/s/AKfycby3Yg1NEsipYEyQi6Oarl_h5C4-rr40dPQwP9LLttlN-EwTgyynojaHAR7CCjodgyZrvg/exec',
  /** n8n webhook — set when payment flow is live */
  N8N_CHECKOUT_URL: '',
  ORDER_ID_PREFIX: 'LD-',
  DEFAULT_QUANTITY: 1000,
  QUANTITY_STEP: 1000,
  QUANTITY_MIN: 1000,
  FETCH_TIMEOUT_MS: 15000,
  SITE_URL: 'https://like-dealer.com',
});
