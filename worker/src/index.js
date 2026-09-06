import { corsHeaders, json, readJsonBody } from './http.js';
import { createStore } from './store.js';
import { handleCatalog, handleGetOrder, handleQuote, handleSession } from './checkout.js';
import { handleStripeWebhook } from './webhook.js';

export default {
  /**
   * @param {Request} request
   * @param {Record<string, string> & { ORDERS?: KVNamespace }} env
   */
  async fetch(request, env) {
    const headers = corsHeaders(request, env);
    const url = new URL(request.url);
    const store = createStore(env.ORDERS);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    try {
      if (request.method === 'GET' && url.pathname === '/api/health') {
        return json({ ok: true }, 200, headers);
      }

      const catalogMatch = url.pathname.match(/^\/api\/catalog\/([^/]+)$/);
      if (request.method === 'GET' && catalogMatch) {
        const response = await handleCatalog(store, env, decodeURIComponent(catalogMatch[1]));
        return withCors(response, headers);
      }

      if (request.method === 'POST' && url.pathname === '/api/checkout/quote') {
        const body = await readJsonBody(request);
        if (!body) return json({ error: 'Invalid JSON body.' }, 400, headers);
        return withCors(await handleQuote(store, env, body), headers);
      }

      if (request.method === 'POST' && url.pathname === '/api/checkout/session') {
        const body = await readJsonBody(request);
        if (!body) return json({ error: 'Invalid JSON body.' }, 400, headers);
        return withCors(await handleSession(store, env, body), headers);
      }

      const orderMatch = url.pathname.match(/^\/api\/orders\/([^/]+)$/);
      if (request.method === 'GET' && orderMatch) {
        return withCors(await handleGetOrder(store, decodeURIComponent(orderMatch[1])), headers);
      }

      if (request.method === 'POST' && url.pathname === '/api/webhooks/stripe') {
        const rawBody = await request.text();
        const signature = request.headers.get('Stripe-Signature') || '';
        return handleStripeWebhook(store, env, rawBody, signature);
      }

      return json({ error: 'Not found.' }, 404, headers);
    } catch (err) {
      console.error('worker error', err instanceof Error ? err.message : 'unknown');
      return json({ error: 'Something went wrong. Please try again.' }, 500, headers);
    }
  },
};

/**
 * @param {Response} response
 * @param {Record<string, string>} headers
 */
function withCors(response, headers) {
  const next = new Headers(response.headers);
  Object.entries(headers).forEach(([key, value]) => next.set(key, value));
  return new Response(response.body, { status: response.status, headers: next });
}
