/**
 * @param {unknown} amount
 * @returns {number|null}
 */
export function toCents(amount) {
  const num = Number(amount);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100);
}

/**
 * @param {number} rateCentsPer1000
 * @param {number} [markup=2]
 * @returns {number}
 */
export function applyMarkup(rateCentsPer1000, markup = 2) {
  const rate = Math.round(Number(rateCentsPer1000));
  const factor = Math.round(Number(markup));
  if (!Number.isInteger(rate) || rate < 0 || !Number.isInteger(factor) || factor < 1) {
    throw new Error('Invalid markup inputs');
  }
  return rate * factor;
}

/**
 * @param {number} unitCentsPer1000
 * @param {number} quantity
 * @returns {number}
 */
export function totalInCents(unitCentsPer1000, quantity) {
  const unit = Math.round(Number(unitCentsPer1000));
  const qty = Math.round(Number(quantity));
  if (!Number.isInteger(unit) || unit < 0 || !Number.isInteger(qty) || qty < 1) {
    throw new Error('Invalid total inputs');
  }
  return Math.round((unit * qty) / 1000);
}

/**
 * @param {number} cents
 * @returns {string}
 */
export function formatUsd(cents) {
  const value = Math.round(Number(cents));
  if (!Number.isInteger(value)) return '';
  return `$${(value / 100).toFixed(2)}`;
}
