import { canonicalInputName, parseInputList } from '../utils/inputs.js';

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
export function serviceInputTypesFrom(raw) {
  const names = Array.isArray(raw)
    ? raw.map((item) => canonicalInputName(item) || '').filter(Boolean)
    : parseInputList(raw);
  return [...new Set(names.filter((type) => type !== 'email' && type !== 'quantity'))];
}

/**
 * @param {{ quantityMode?: string, inputs?: unknown }} service
 */
export function quantityMode(service) {
  const declared = service?.quantityMode;
  if (declared === 'from_comments' || declared === 'package' || declared === 'omit') return declared;
  if (serviceInputTypesFrom(service?.inputs).includes('comments')) return 'from_comments';
  return declared || 'required';
}

/**
 * Checkout fields come from the product `inputs` column. Email is always added
 * for the paid-order confirmation and is never a provider input.
 * @param {{ inputs?: unknown, quantityMode?: string, purchasable?: boolean }} [service]
 */
export function checkoutFieldPlan(service = {}) {
  const serviceInputTypes = serviceInputTypesFrom(service.inputs);
  const mode = quantityMode({ ...service, inputs: serviceInputTypes });
  return {
    serviceInputTypes,
    mode,
    needsQuantity: mode === 'required',
    includeEmail: true,
    purchasable: service.purchasable === true,
  };
}
