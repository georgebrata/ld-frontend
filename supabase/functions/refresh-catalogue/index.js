import { json } from '../_shared/http.js';
import { createContext, readEnv } from '../_shared/context.js';
import { refreshCatalogue } from '../_shared/catalogue.js';
import { timingSafeEqual } from '../_shared/crypto-token.js';

function authorized(request, env) {
  const header = request.headers.get('Authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const custom = request.headers.get('X-Worker-Secret') || '';
  const secret = env.WORKER_SECRET || '';
  if (!secret) return false;
  return timingSafeEqual(bearer, secret) || timingSafeEqual(custom, secret);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const ctx = await createContext(readEnv());
    if (!authorized(request, ctx.env)) return json({ error: 'Unauthorized.' }, 401);

    const deps = {
      fetchImpl: fetch,
      cacheGet: (key) => ctx.store.cacheGet(key),
      cacheSet: (key, payload, ttlMs) => ctx.store.cacheSet(key, payload, ttlMs),
      listProducts: () => ctx.store.listProducts(),
    };
    const result = await refreshCatalogue(ctx.env, deps);
    if (!result.ok) return json(result, result.refreshed === false ? 503 : 500);
    return json(result);
  } catch {
    return json({ error: 'Catalogue refresh failed.' }, 500);
  }
});
