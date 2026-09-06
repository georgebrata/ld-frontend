import { CONFIG } from '../config.js';

/**
 * @param {string} path
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
async function workerFetch(path, init = {}) {
  if (!CONFIG.CHECKOUT_WORKER_URL) {
    throw new Error('Checkout is not configured.');
  }

  const url = `${CONFIG.CHECKOUT_WORKER_URL.replace(/\/$/, '')}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {Response} response
 * @returns {Promise<Record<string, unknown>>}
 */
async function readJson(response) {
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof json.error === 'string' ? json.error : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return json;
}

/**
 * Public catalog extras for a service (qty bounds + display unit price).
 * @param {string} serviceId
 * @returns {Promise<{
 *   serviceId: string,
 *   quantityMin: number,
 *   quantityMax: number,
 *   unitPriceInCents: number|null,
 *   purchasable: boolean
 * }>}
 */
export async function getCatalog(serviceId) {
  const json = await readJson(await workerFetch(`/api/catalog/${encodeURIComponent(serviceId)}`));
  return {
    serviceId: String(json.serviceId ?? serviceId),
    quantityMin: Number(json.quantityMin) || CONFIG.QUANTITY_MIN,
    quantityMax: Number(json.quantityMax) || CONFIG.QUANTITY_MAX,
    unitPriceInCents:
      json.unitPriceInCents == null ? null : Number(json.unitPriceInCents),
    purchasable: json.purchasable !== false,
  };
}

/**
 * Live quote for a quantity. Never used as the charge source of truth.
 * @param {{ serviceId: string, quantity: number }} payload
 * @returns {Promise<{ totalInCents: number, unitPriceInCents: number, quantity: number }>}
 */
export async function getQuote(payload) {
  const json = await readJson(
    await workerFetch('/api/checkout/quote', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  );
  return {
    totalInCents: Number(json.totalInCents),
    unitPriceInCents: Number(json.unitPriceInCents),
    quantity: Number(json.quantity),
  };
}

/**
 * Create a Stripe Checkout Session via the Worker.
 * @param {{
 *   serviceId: string,
 *   quantity: number,
 *   customerEmail: string,
 *   inputs: Record<string, string>
 * }} payload
 * @returns {Promise<string>}
 */
export async function createCheckoutSession(payload) {
  const json = await readJson(
    await workerFetch('/api/checkout/session', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  );
  const url = String(json.checkoutUrl ?? json.url ?? '');
  if (!url) throw new Error('Checkout did not return a payment URL.');
  return url;
}

/**
 * Customer-safe order lookup (internal id or Stripe session id).
 * @param {string} id
 * @returns {Promise<Record<string, unknown>|null>}
 */
export async function getPublicOrder(id) {
  if (!id) return null;
  try {
    const json = await readJson(await workerFetch(`/api/orders/${encodeURIComponent(id)}`));
    return json.order && typeof json.order === 'object' ? json.order : json;
  } catch {
    return null;
  }
}

export const ordersApi = {
  getCatalog,
  getQuote,
  createCheckoutSession,
  getPublicOrder,
};
