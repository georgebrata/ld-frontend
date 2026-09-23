import { corsHeaders, json, clientIp, readJsonBody, MAX_JSON_BYTES } from '../_shared/http.js';
import { createContext, readEnv } from '../_shared/context.js';
import { createGuestCheckout } from '../_shared/checkout.js';

Deno.serve(async (request) => {
  try {
    const ctx = await createContext(readEnv());
    const env = ctx.env;
    const headers = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, headers);

    const limited = await ctx.store.consumeRateLimit('create-checkout', clientIp(request), 10, 60);
    if (limited && limited.allowed === false) {
      return json({ error: 'Too many requests.' }, 429, headers);
    }
    const parsed = await readJsonBody(request, MAX_JSON_BYTES);
    if (!parsed.ok) return json({ error: parsed.error }, 400, headers);
    const result = await createGuestCheckout(env, ctx.store, parsed.value, {
      fetchImpl: fetch,
      storefrontOrigin: request.headers.get('Origin') || '',
    });
    return json(result.body, result.status, headers);
  } catch (err) {
    console.error('create-checkout failed', err instanceof Error ? err.message : 'unknown');
    const headers = corsHeaders(request, readEnv());
    return json({ error: 'Something went wrong. Please try again.' }, 500, headers);
  }
});
