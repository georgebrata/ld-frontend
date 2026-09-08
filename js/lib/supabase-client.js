import { CONFIG, functionsBaseUrl } from '../config.js';

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm';

/** @type {import('@supabase/supabase-js').SupabaseClient|null} */
let client = null;

/**
 * One pinned browser Supabase client. The anon key is not purchaser authorization.
 * @returns {Promise<import('@supabase/supabase-js').SupabaseClient|null>}
 */
export async function getSupabase() {
  if (client) return client;
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) return null;
  const { createClient } = await import(SUPABASE_JS);
  client = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}

/**
 * Invoke an Edge Function. Tokens travel in headers/body, never query strings.
 * @param {string} name
 * @param {{ method?: string, body?: unknown, headers?: Record<string, string> }} [options]
 */
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
