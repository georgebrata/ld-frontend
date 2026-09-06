import { CONFIG } from '../config.js';

/**
 * Normalize raw order row from API.
 * @param {Record<string, unknown>} row
 * @returns {import('../types.js').Order}
 */
function normalizeOrder(row) {
  return {
    _id: String(row._id ?? ''),
    CustomerEmail: String(row.CustomerEmail ?? ''),
    Service: String(row.Service ?? ''),
    ServiceId: String(row.ServiceId ?? ''),
    URL: String(row.URL ?? ''),
    Notes: String(row.Notes ?? ''),
    Quantity: row.Quantity ?? '',
    Status: String(row.Status ?? 'pending').toLowerCase(),
  };
}

/**
 * Create a pending order.
 * @param {import('../types.js').CreateOrderPayload & Record<string, string|number>} payload
 * @returns {Promise<import('../types.js').Order>}
 */
export async function createOrder(payload) {
  const data = {
    CustomerEmail: payload.customerEmail,
    Service: payload.service,
    ServiceId: payload.serviceId,
    URL: payload.url ?? '',
    Notes: payload.notes ?? '',
    Quantity: payload.quantity,
    Status: payload.status ?? 'pending',
  };

  const response = await fetch(`${CONFIG.API_BASE}?sheet=Orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'append', data }),
  });

  if (!response.ok) {
    throw new Error(`Orders API error: ${response.status}`);
  }

  const json = await response.json();

  if (json.data) {
    return normalizeOrder(json.data);
  }

  return {
    _id: String(json._id ?? json.id ?? ''),
    ...data,
    Status: data.Status,
  };
}

/**
 * Fetch order by ID (client-side filter).
 * @param {string} orderId
 * @returns {Promise<import('../types.js').Order|null>}
 */
export async function getOrder(orderId) {
  if (!orderId) return null;

  const response = await fetch(`${CONFIG.API_BASE}?sheet=Orders&id=${encodeURIComponent(orderId)}`);

  if (!response.ok) {
    throw new Error(`Orders API error: ${response.status}`);
  }

  const json = await response.json();
  if (!json.ok || !Array.isArray(json.data)) {
    throw new Error('Invalid orders response');
  }

  const match = json.data.find((row) => String(row._id) === orderId);
  return match ? normalizeOrder(match) : null;
}

/**
 * Request Stripe checkout URL from n8n.
 * @param {Record<string, unknown>} payload
 * @returns {Promise<string|null>}
 */
export async function requestCheckoutSession(payload) {
  if (!CONFIG.N8N_CHECKOUT_URL) return null;

  const response = await fetch(CONFIG.N8N_CHECKOUT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Checkout session error: ${response.status}`);
  }

  const json = await response.json();
  return json.checkoutUrl ?? json.url ?? null;
}

export const ordersApi = {
  createOrder,
  getOrder,
  requestCheckoutSession,
};
