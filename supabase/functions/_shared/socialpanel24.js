/**
 * SocialPanel24 HTTP adapter. Server-only. Credentials never go in URLs or logs.
 *
 * Endpoint is fixed: POST https://socialpanel24.com/api/v2
 * Body: application/x-www-form-urlencoded via URLSearchParams.
 */

export const SOCIALPANEL24_URL = 'https://socialpanel24.com/api/v2';

const ALLOWED_ACTIONS = new Set(['services', 'add', 'status', 'balance']);

export class SocialPanelError extends Error {
  /**
   * @param {string} message
   * @param {{ code: string, retryable?: boolean, httpStatus?: number, providerError?: string }} info
   */
  constructor(message, info) {
    super(message);
    this.name = 'SocialPanelError';
    this.code = info.code;
    this.retryable = Boolean(info.retryable);
    this.httpStatus = info.httpStatus;
    this.providerError = info.providerError;
  }
}

/**
 * @param {string} raw
 * @returns {string}
 */
function classifyProviderError(raw) {
  const text = String(raw || '').toLowerCase();
  if (!text) return 'PROVIDER_REJECTED';
  if (text.includes('balance') || text.includes('funds') || text.includes('not enough')) {
    return 'INSUFFICIENT_BALANCE';
  }
  return 'PROVIDER_REJECTED';
}

/**
 * @param {unknown} value
 * @returns {string|null}
 */
export function parseProviderOrderId(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;
  return text;
}

/**
 * Parse SocialPanel numeric strings safely.
 * @param {unknown} value
 * @returns {number|null}
 */
export function parseProviderNumber(value) {
  if (value == null || value === '') return null;
  const num = Number(String(value).trim());
  return Number.isFinite(num) ? num : null;
}

/**
 * POST to SocialPanel24. TLS verification stays on. Redirects are rejected.
 *
 * @param {{
 *   apiKey: string,
 *   fetchImpl?: typeof fetch,
 *   timeoutMs?: number,
 *   now?: () => number
 * }} env
 * @param {string} action
 * @param {Record<string, string>} [fields]
 */
export async function socialPanelRequest(env, action, fields = {}) {
  if (!ALLOWED_ACTIONS.has(action)) {
    throw new SocialPanelError(`Action is not allowlisted: ${action}`, { code: 'INVALID_ACTION' });
  }
  const key = String(env.apiKey || '');
  if (!key) {
    throw new SocialPanelError('SocialPanel24 API key is not configured', { code: 'CONFIG' });
  }

  const body = new URLSearchParams();
  body.set('key', key);
  body.set('action', action);
  Object.entries(fields).forEach(([name, value]) => {
    if (name === 'key' || name === 'action') return;
    if (value == null || value === '') return;
    body.set(name, String(value));
  });

  const controller = new AbortController();
  const timeoutMs = Number(env.timeoutMs) > 0 ? Number(env.timeoutMs) : 15000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const fetchImpl = env.fetchImpl || fetch;

  /** @type {Response} */
  let response;
  try {
    response = await fetchImpl(SOCIALPANEL24_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      redirect: 'error',
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = Boolean(err && /** @type {{ name?: string }} */ (err).name === 'AbortError');
    throw new SocialPanelError(aborted ? 'SocialPanel24 request timed out' : 'SocialPanel24 transport failed', {
      code: aborted ? 'TIMEOUT' : 'TRANSPORT',
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
  }

  const raw = await response.text();
  let json;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    throw new SocialPanelError('SocialPanel24 returned malformed JSON', {
      code: 'MALFORMED',
      retryable: true,
      httpStatus: response.status,
    });
  }

  if (!response.ok) {
    throw new SocialPanelError(`SocialPanel24 HTTP ${response.status}`, {
      code: response.status >= 500 ? 'TRANSPORT' : 'HTTP_ERROR',
      retryable: response.status >= 500,
      httpStatus: response.status,
    });
  }

  if (json && typeof json === 'object' && json.error) {
    const providerError = String(json.error);
    const code = classifyProviderError(providerError);
    throw new SocialPanelError(providerError, {
      code,
      retryable: false,
      providerError,
    });
  }

  return json;
}

/**
 * @param {any} env
 */
export async function fetchProviderServices(env) {
  const data = await socialPanelRequest(env, 'services');
  return Array.isArray(data) ? data : [];
}

/**
 * @param {any} env
 * @param {Record<string, string>} addFields
 */
export async function addProviderOrder(env, addFields) {
  const json = await socialPanelRequest(env, 'add', addFields);
  const orderId = parseProviderOrderId(json?.order ?? json?.id);
  if (!orderId) {
    throw new SocialPanelError('SocialPanel24 accepted the HTTP request but returned no order id', {
      code: 'MALFORMED',
      retryable: false,
    });
  }
  return { orderId, raw: json };
}

/**
 * @param {any} env
 * @param {string[]} orderIds
 */
export async function fetchProviderStatuses(env, orderIds) {
  const ids = [...new Set(orderIds.map((id) => String(id).trim()).filter(Boolean))];
  if (!ids.length) return {};
  if (ids.length > 100) {
    throw new SocialPanelError('Status batch exceeds 100 ids', { code: 'INVALID_ACTION' });
  }
  if (ids.length === 1) {
    const json = await socialPanelRequest(env, 'status', { order: ids[0] });
    return { [ids[0]]: json };
  }
  const json = await socialPanelRequest(env, 'status', { orders: ids.join(',') });
  return json && typeof json === 'object' ? json : {};
}

/**
 * @param {any} env
 */
export async function fetchProviderBalance(env) {
  return socialPanelRequest(env, 'balance');
}

/**
 * Normalize a provider service row. Rates stay decimal; currency is not inferred.
 * @param {Record<string, unknown>} row
 */
export function normalizeProviderService(row) {
  const service = String(row.service ?? row.id ?? '').trim();
  return {
    service,
    name: String(row.name ?? '').trim(),
    type: String(row.type ?? '').trim(),
    category: String(row.category ?? '').trim(),
    rate: String(row.rate ?? '').trim(),
    min: parseProviderNumber(row.min),
    max: parseProviderNumber(row.max),
    refill: Boolean(row.refill),
    cancel: Boolean(row.cancel),
    raw: row,
  };
}
