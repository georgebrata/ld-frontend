/**
 * Display helpers. Charge amounts come from the server; this only formats them.
 */

/**
 * @param {number} minor
 * @param {string} [currency='USD']
 * @returns {string}
 */
export function formatMoney(minor, currency = 'USD') {
  const value = Math.round(Number(minor));
  const code = String(currency || 'USD').toUpperCase();
  if (!Number.isInteger(value)) return '';
  const exponent = code === 'JPY' ? 0 : 2;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: code,
  }).format(value / 10 ** exponent);
}

/** @deprecated Use formatMoney */
export function formatUsd(cents) {
  return formatMoney(cents, 'USD');
}

export function toCents(amount) {
  const num = Number(amount);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100);
}

export function applyMarkup(rateMinor, markup = 2) {
  const rate = Math.round(Number(rateMinor));
  const factor = Number(markup);
  if (!Number.isInteger(rate) || rate < 0 || !Number.isFinite(factor) || factor < 1) {
    throw new Error('Invalid markup inputs');
  }
  return Math.round(rate * factor);
}

export function totalInCents(unitCentsPer1000, quantity) {
  const unit = Math.round(Number(unitCentsPer1000));
  const qty = Math.round(Number(quantity));
  if (!Number.isInteger(unit) || unit < 0 || !Number.isInteger(qty) || qty < 1) {
    throw new Error('Invalid total inputs');
  }
  return Math.round((unit * qty) / 1000);
}

/**
 * Display total from an explicit rate unit. Not the charge source of truth.
 * @param {number} rateMinor
 * @param {number} quantity
 * @param {string} rateUnit
 */
export function estimateTotalMinor(rateMinor, quantity, rateUnit) {
  const rate = Math.round(Number(rateMinor));
  const qty = Math.round(Number(quantity));
  if (!Number.isInteger(rate) || rate < 0 || !Number.isInteger(qty) || qty < 1) return null;
  if (rateUnit === 'per_1000') return Math.round((rate * qty) / 1000);
  if (rateUnit === 'per_unit' || rateUnit === 'per_comment') return rate * qty;
  if (rateUnit === 'package') return rate;
  return null;
}
