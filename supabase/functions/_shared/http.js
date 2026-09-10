/**
 * CORS, JSON, OPTIONS, and request-size helpers. CORS is not authentication.
 */

export const MAX_JSON_BYTES = 32 * 1024;
export const MAX_WEBHOOK_BYTES = 256 * 1024;

/**
 * @param {string} [raw]
 * @returns {string[]}
 */
export function parseOriginAllowlist(raw) {
  return String(raw || '')
    .split(',')
    .map((item) => item.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

/**
 * @param {Request} request
 * @param {string[]} allowlist
 * @returns {string}
 */
const LOCAL_STOREFRONT = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

export function pickAllowOrigin(request, allowlist) {
  const origin = request.headers.get('Origin') || '';
  const normalized = origin.replace(/\/$/, '');
  if (allowlist.includes(normalized)) return origin;
  if (LOCAL_STOREFRONT.test(normalized)) return origin;
  if (!origin && allowlist.length) return allowlist[0];
  return '';
}

/**
 * Stripe success/cancel must land on the origin that holds the capability token.
 * Only SITE_URL, CORS allowlist, and local static-server origins are accepted.
 * @param {object} env
 * @param {string} [origin]
 */
export function checkoutReturnOrigin(env, origin) {
  const site = String(env?.SITE_URL || 'https://like-dealer.com').replace(/\/$/, '');
  const candidate = String(origin || '')
    .trim()
    .replace(/\/$/, '');
  if (!candidate) return site;
  if (LOCAL_STOREFRONT.test(candidate)) return candidate;
  const allowlist = parseOriginAllowlist(env?.CORS_ALLOW_ORIGINS || site);
  if (allowlist.includes(candidate) || candidate === site) return candidate;
  return site;
}

/**
 * @param {Request} request
 * @param {object} env
 */
export function corsHeaders(request, env) {
  const allowlist = parseOriginAllowlist(
    env.CORS_ALLOW_ORIGINS || `${env.SITE_URL || 'https://like-dealer.com'},http://localhost:3000,http://127.0.0.1:3000`
  );
  const allowOrigin = pickAllowOrigin(request, allowlist);
  /** @type {Record<string, string>} */
  const headers = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers':
      'Authorization, Content-Type, X-Checkout-Token, X-Worker-Secret, Stripe-Signature, apikey',
    'Access-Control-Max-Age': '86400',
  };
  if (allowOrigin) headers['Access-Control-Allow-Origin'] = allowOrigin;
  return headers;
}

/**
 * @param {unknown} body
 * @param {number} status
 * @param {Record<string, string>} [headers]
 */
export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
}

/**
 * @param {Request} request
 */
export function clientIp(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

/**
 * @param {Request} request
 * @param {number} maxBytes
 * @returns {Promise<{ ok: true, text: string }|{ ok: false, error: string }>}
 */
export async function readTextLimited(request, maxBytes) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > maxBytes) return { ok: false, error: 'Request is too large.' };
  const reader = request.body?.getReader?.();
  if (!reader) {
    const text = await request.text();
    if (text.length > maxBytes) return { ok: false, error: 'Request is too large.' };
    return { ok: true, text };
  }
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) return { ok: false, error: 'Request is too large.' };
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return { ok: true, text: new TextDecoder().decode(bytes) };
}

/**
 * @param {Request} request
 * @param {number} [maxBytes]
 */
export async function readJsonBody(request, maxBytes = MAX_JSON_BYTES) {
  const limited = await readTextLimited(request, maxBytes);
  if (!limited.ok) return { ok: false, error: limited.error };
  if (!limited.text) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(limited.text), raw: limited.text };
  } catch {
    return { ok: false, error: 'Invalid JSON body.' };
  }
}

/**
 * @param {Request} request
 */
export function readCapabilityToken(request, body = {}) {
  return (
    request.headers.get('X-Checkout-Token') ||
    request.headers.get('x-checkout-token') ||
    (typeof body.capabilityToken === 'string' ? body.capabilityToken : '') ||
    ''
  );
}

/**
 * @param {Request} [request]
 */
export function correlationId(request) {
  const header = request?.headers?.get('x-request-id') || request?.headers?.get('x-correlation-id');
  return header && header.length < 128 ? header : crypto.randomUUID();
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {string} url
 * @param {RequestInit} [init]
 * @param {number} [timeoutMs]
 */
export async function fetchWithTimeout(fetchImpl, url, init = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
