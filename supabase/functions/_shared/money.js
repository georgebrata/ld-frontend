/**
 * Decimal-safe money helpers. Rounding is half-up via Math.round after
 * scaling to currency minor units. Rate units are explicit per service;
 * nothing here assumes USD or per-1,000 globally.
 */

/** @type {Readonly<Record<string, number>>} */
export const CURRENCY_EXPONENTS = Object.freeze({
  USD: 2,
  EUR: 2,
  GBP: 2,
  AUD: 2,
  CAD: 2,
  JPY: 0,
});

/** @typedef {'per_1000'|'per_unit'|'package'|'per_comment'} RateUnit */

/**
 * ISO-4217 exponent for a currency code.
 * @param {string} currency
 * @returns {number}
 */
export function currencyExponent(currency) {
  const code = String(currency || '').trim().toUpperCase();
  if (Object.prototype.hasOwnProperty.call(CURRENCY_EXPONENTS, code)) {
    return CURRENCY_EXPONENTS[code];
  }
  return 2;
}

/**
 * @param {string} currency
 * @returns {number}
 */
export function minorFactor(currency) {
  return 10 ** currencyExponent(currency);
}

/**
 * Parse a decimal amount into integer minor units.
 * @param {unknown} value
 * @param {string} currency
 * @returns {number|null}
 */
export function parseDecimalToMinor(value, currency) {
  if (value == null || value === '') return null;
  const num = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * minorFactor(currency));
}

/**
 * Convert integer minor units back to a major-unit number.
 * @param {number} minor
 * @param {string} currency
 * @returns {number}
 */
export function minorToMajor(minor, currency) {
  const value = Math.round(Number(minor));
  return value / minorFactor(currency);
}

/**
 * Apply a markup multiplier (≥ 1) to integer minor units.
 * @param {number} minor
 * @param {number} markup
 * @returns {number}
 */
export function applyMarkup(minor, markup) {
  const amount = Math.round(Number(minor));
  const factor = Number(markup);
  if (!Number.isInteger(amount) || amount < 0 || !Number.isFinite(factor) || factor < 1) {
    throw new Error('Invalid markup inputs');
  }
  return Math.round(amount * factor);
}

/**
 * Convert minor units between currencies using an explicit rate
 * (units of `to` per 1 unit of `from`). Same-currency rate is 1.
 * @param {number} minor
 * @param {string} fromCurrency
 * @param {string} toCurrency
 * @param {number} rateFromTo
 * @returns {number}
 */
export function convertMinor(minor, fromCurrency, toCurrency, rateFromTo) {
  const amount = Math.round(Number(minor));
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error('Invalid conversion amount');
  }
  const from = String(fromCurrency || '').toUpperCase();
  const to = String(toCurrency || '').toUpperCase();
  if (from === to) return amount;
  const rate = Number(rateFromTo);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('Currency conversion rate is not configured');
  }
  const major = minorToMajor(amount, from);
  return parseDecimalToMinor(major * rate, to) ?? 0;
}

/**
 * Billable total in retail minor units.
 * @param {{
 *   rateMinor: number,
 *   quantity: number,
 *   rateUnit: RateUnit,
 *   packageMinor?: number
 * }} params
 * @returns {number}
 */
export function quoteTotalMinor(params) {
  const rateMinor = Math.round(Number(params.rateMinor));
  const quantity = Math.round(Number(params.quantity));
  const unit = params.rateUnit;
  if (!Number.isInteger(rateMinor) || rateMinor < 0) {
    throw new Error('Invalid rate');
  }
  if (unit === 'package') {
    const pkg = params.packageMinor == null ? rateMinor : Math.round(Number(params.packageMinor));
    if (!Number.isInteger(pkg) || pkg < 0) throw new Error('Invalid package price');
    return pkg;
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error('Invalid quantity');
  }
  if (unit === 'per_1000') {
    return Math.round((rateMinor * quantity) / 1000);
  }
  if (unit === 'per_unit' || unit === 'per_comment') {
    return rateMinor * quantity;
  }
  throw new Error(`Unsupported rate unit: ${unit}`);
}

/**
 * Format minor units for display.
 * @param {number} minor
 * @param {string} currency
 * @param {string} [locale='en-US']
 * @returns {string}
 */
export function formatMoney(minor, currency, locale = 'en-US') {
  const value = Math.round(Number(minor));
  const code = String(currency || 'USD').toUpperCase();
  if (!Number.isInteger(value)) return '';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: code,
  }).format(minorToMajor(value, code));
}

/**
 * Stable quote identity for mismatch comparison.
 * @param {{ amountMinor: number, currency: string, quantity: number, rateUnit: string, serviceId: string }} quote
 * @returns {string}
 */
export function quoteVersion(quote) {
  return [
    quote.serviceId,
    quote.quantity,
    quote.amountMinor,
    String(quote.currency || '').toUpperCase(),
    quote.rateUnit,
  ].join(':');
}
