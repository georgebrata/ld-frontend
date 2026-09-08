/**
 * Shared Edge Function bootstrap. Deno.env is read only here.
 * Optional public.app_secrets rows fill blanks; non-empty Deno.env wins.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { createSupabaseStore } from './store-supabase.js';
import { corsHeaders, json } from './http.js';

const ENV_KEYS = Object.freeze([
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SITE_URL',
  'CORS_ALLOW_ORIGINS',
  'RETAIL_CURRENCY',
  'PROVIDER_CURRENCY',
  'FX_PROVIDER_TO_RETAIL',
  'MARKUP_MULTIPLIER',
  'RETAIL_CATALOGUE_URL',
  'RETAIL_SOCIALPANEL_IDS',
  'SOCIALPANEL24_API_KEY',
  'SOCIALPANEL24_TIMEOUT_MS',
  'SOCIALPANEL24_ENABLED',
  'PROVIDER_ENV',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'RESEND_API_KEY',
  'FROM_EMAIL',
  'FROM_NAME',
  'REPLY_TO_EMAIL',
  'OWNER_EMAIL',
  'SUPPORT_EMAIL',
  'WORKER_SECRET',
  'ORDER_ID_PREFIX',
  'CATALOGUE_TIMEOUT_MS',
  'APP_FUNCTIONS_URL',
]);

const DENO_ONLY = new Set(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']);

/**
 * @returns {Record<string, string>}
 */
export function readEnv() {
  const env = {};
  for (const key of ENV_KEYS) {
    const value = Deno.env.get(key);
    if (value != null) env[key] = value;
  }
  return env;
}

/**
 * Merge optional database secrets under process env.
 * @param {Record<string, string>} env
 * @param {Record<string, string>} extra
 */
export function mergeEnv(env, extra) {
  const merged = {};
  Object.entries(extra || {}).forEach(([key, value]) => {
    if (!ENV_KEYS.includes(key) || DENO_ONLY.has(key)) return;
    if (value) merged[key] = String(value);
  });
  Object.entries(env || {}).forEach(([key, value]) => {
    if (value != null && value !== '') merged[key] = String(value);
  });
  return merged;
}

export function createServiceClient(env = readEnv()) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function createContext(env = readEnv()) {
  const client = createServiceClient(env);
  const store = createSupabaseStore(client);
  let extra = {};
  try {
    extra = await store.listAppSecrets();
  } catch {
    extra = {};
  }
  return { env: mergeEnv(env, extra), store };
}

export function withCors(request, env, result) {
  const headers = corsHeaders(request, env);
  if (result instanceof Response) {
    const next = new Headers(result.headers);
    Object.entries(headers).forEach(([key, value]) => next.set(key, value));
    return new Response(result.body, { status: result.status, headers: next });
  }
  return json(result.body, result.status, headers);
}
