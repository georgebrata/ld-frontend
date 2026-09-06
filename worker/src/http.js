/**
 * @param {string} [message='Not found']
 */
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
}

/**
 * @param {Request} request
 * @param {Record<string, string>} env
 */
export function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = [env.SITE_URL].filter(Boolean);
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const match =
    isLocal ||
    allowed.some((item) => origin === item || origin.startsWith(`${item}/`));
  return {
    'Access-Control-Allow-Origin': match ? origin || env.SITE_URL || '*' : env.SITE_URL || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

/**
 * @param {Request} request
 */
export async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
