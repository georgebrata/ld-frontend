import { corsHeaders, json, clientIp, readJsonBody, readCapabilityToken } from '../_shared/http.js';
import { createContext, readEnv } from '../_shared/context.js';
import { getAuthorizedOrder, toPublicOrder } from '../_shared/order-status.js';

Deno.serve(async (request) => {
  try {
    const ctx = await createContext(readEnv());
    const env = ctx.env;
    const headers = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, headers);

    const limited = await ctx.store.consumeRateLimit('order-status', clientIp(request), 30, 60);
    if (limited && limited.allowed === false) {
      return json({ error: 'Too many requests.' }, 429, headers);
    }
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return json({ error: parsed.error }, 400, headers);
    const token = readCapabilityToken(request, parsed.value);
    const order = await getAuthorizedOrder(ctx.store, {
      token,
      orderId: parsed.value.orderId,
      sessionId: parsed.value.sessionId,
      attemptId: parsed.value.checkoutAttemptId || parsed.value.attemptId,
    });
    if (!order) return json({ error: 'Order not found.' }, 404, headers);
    return json({ order: toPublicOrder(order) }, 200, headers);
  } catch {
    const headers = corsHeaders(request, readEnv());
    return json({ error: 'Something went wrong. Please try again.' }, 500, headers);
  }
});
