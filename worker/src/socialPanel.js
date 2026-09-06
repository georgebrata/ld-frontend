const DEFAULT_URL = 'https://socialpanel24.com/api/v2';

/**
 * @param {Record<string, string>} env
 * @param {Record<string, string>} params
 */
async function post(env, params) {
  const body = new URLSearchParams({
    key: env.SOCIAL_PANEL_API_KEY,
    ...params,
  });

  const response = await fetch(env.SOCIAL_PANEL_API_URL || DEFAULT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`SocialPanel24 HTTP ${response.status}`);
  }
  if (json && json.error) {
    throw new Error(String(json.error));
  }
  return json;
}

/**
 * @param {Record<string, string>} env
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export async function getServices(env) {
  const data = await post(env, { action: 'services' });
  return Array.isArray(data) ? data : [];
}

/**
 * @param {Record<string, string>} env
 * @param {Record<string, string>} params
 */
export async function addOrder(env, params) {
  return post(env, params);
}

/**
 * @param {Record<string, string>} env
 * @param {string} orderId
 */
export async function getOrderStatus(env, orderId) {
  return post(env, { action: 'status', order: String(orderId) });
}

export async function getMultipleOrderStatuses(env, orderIds) {
  return post(env, { action: 'status', orders: orderIds.join(',') });
}

export async function refillOrder(env, orderId) {
  return post(env, { action: 'refill', order: String(orderId) });
}

export async function getRefillStatus(env, refillId) {
  return post(env, { action: 'refill_status', refill: String(refillId) });
}

export async function cancelOrders(env, orderIds) {
  return post(env, { action: 'cancel', orders: orderIds.join(',') });
}

export async function getBalance(env) {
  return post(env, { action: 'balance' });
}
