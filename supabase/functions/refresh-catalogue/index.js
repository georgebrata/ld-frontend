import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { json } from '../_shared/http.js';
import { timingSafeEqual } from '../_shared/crypto-token.js';
import { fetchProviderServices, normalizeProviderService } from '../_shared/socialpanel24.js';

const PROVIDER_TTL_MS = 24 * 60 * 60 * 1000;
const STALE_MS = 25 * 60 * 60 * 1000;

function authorized(request, env) {
  const header = request.headers.get('Authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const custom = request.headers.get('X-Worker-Secret') || '';
  const secret = env.WORKER_SECRET || '';
  if (!secret) return false;
  return timingSafeEqual(bearer, secret) || timingSafeEqual(custom, secret);
}

function readProcessEnv() {
  const env = {};
  for (const key of ['WORKER_SECRET', 'SOCIALPANEL24_API_KEY', 'SOCIALPANEL24_TIMEOUT_MS', 'APP_FUNCTIONS_URL']) {
    const value = Deno.env.get(key);
    if (value) env[key] = value;
  }
  return env;
}

async function mergeAppSecrets(client, env) {
  const merged = { ...env };
  const { data, error } = await client.from('app_secrets').select('name, value');
  if (error) throw error;
  (data || []).forEach((row) => {
    if (row?.name && row?.value && !merged[row.name]) merged[row.name] = String(row.value);
  });
  return merged;
}

async function upsertCache(client, key, payload, ttlMs, now) {
  const { error } = await client.from('catalogue_cache').upsert({
    cache_key: key,
    payload,
    fetched_at: new Date(now).toISOString(),
    expires_at: new Date(now + ttlMs).toISOString(),
  });
  if (error) throw error;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const client = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const env = await mergeAppSecrets(client, readProcessEnv());
    if (!authorized(request, env)) return json({ error: 'Unauthorized.' }, 401);

    const now = Date.now();
    let providerRows = [];
    try {
      const services = await fetchProviderServices({
        apiKey: env.SOCIALPANEL24_API_KEY,
        timeoutMs: Number(env.SOCIALPANEL24_TIMEOUT_MS || 20000),
      });
      providerRows = services.map((row) => normalizeProviderService(row));
    } catch (err) {
      return json(
        {
          ok: false,
          refreshed: false,
          providerError: err instanceof Error ? err.message : 'provider_unavailable',
          providerCount: 0,
          cacheKeys: [],
        },
        503
      );
    }

    if (!providerRows.length) {
      return json(
        {
          ok: false,
          refreshed: false,
          providerError: 'empty_provider_catalogue',
          providerCount: 0,
          cacheKeys: [],
        },
        503
      );
    }

    await upsertCache(
      client,
      'sp24:services',
      { expires: now + PROVIDER_TTL_MS, services: providerRows },
      STALE_MS,
      now
    );
    await client.from('catalogue_cache').delete().eq('cache_key', 'catalogue:public');

    let warmed = false;
    let visible = 0;
    let purchasable = 0;
    const fnUrl = String(env.APP_FUNCTIONS_URL || '').replace(/\/$/, '');
    if (fnUrl) {
      try {
        const warm = await fetch(`${fnUrl}/catalogue`, {
          method: 'GET',
          headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY') || '' },
        });
        if (warm.ok) {
          const body = await warm.json();
          if (Array.isArray(body?.data)) {
            warmed = true;
            visible = body.data.length;
            purchasable = body.data.filter((row) => row?.purchasable).length;
          }
        }
      } catch {
        warmed = false;
      }
    }

    return json({
      ok: true,
      refreshed: true,
      providerCount: providerRows.length,
      cacheKeys: warmed ? ['sp24:services', 'catalogue:public'] : ['sp24:services'],
      warmed,
      visible,
      purchasable,
    });
  } catch {
    return json({ error: 'Catalogue refresh failed.' }, 500);
  }
});
