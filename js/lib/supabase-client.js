import { CONFIG, functionsBaseUrl } from '../config.js';

export async function invokeFunction(name, options = {}) {
  const base = functionsBaseUrl();
  if (!base) throw new Error('Checkout is not configured.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.FETCH_TIMEOUT_MS);
  const headers = {
    Accept: 'application/json',
    ...(CONFIG.SUPABASE_ANON_KEY ? { apikey: CONFIG.SUPABASE_ANON_KEY } : {}),
    ...options.headers,
  };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  try {
    const response = await fetch(`${base}/${name}`, {
      method: options.method || 'POST',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const json = await response.json().catch(() => ({}));
    return { response, json };
  } finally {
    clearTimeout(timer);
  }
}
