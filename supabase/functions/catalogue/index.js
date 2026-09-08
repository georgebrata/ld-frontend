import { corsHeaders, json, clientIp } from '../_shared/http.js';
import { createContext, readEnv } from '../_shared/context.js';
import { getPublicCatalogue } from '../_shared/catalogue.js';

Deno.serve(async (request) => {
  try {
    const ctx = await createContext(readEnv());
    const env = ctx.env;
    const headers = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405, headers);

    const limited = await ctx.store.consumeRateLimit('catalogue', clientIp(request), 60, 60);
    if (limited && limited.allowed === false) {
      return json({ error: 'Too many requests.' }, 429, headers);
    }
    const payload = await getPublicCatalogue(env, {
      fetchImpl: fetch,
      cacheGet: (key) => ctx.store.cacheGet(key),
      cacheSet: (key, value, ttl) => ctx.store.cacheSet(key, value, ttl),
    });
    return json(payload, 200, headers);
  } catch {
    const headers = corsHeaders(request, readEnv());
    return json({ ok: false, error: 'Catalogue is temporarily unavailable.' }, 503, headers);
  }
});
