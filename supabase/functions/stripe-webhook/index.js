import { corsHeaders, json, readTextLimited, MAX_WEBHOOK_BYTES } from '../_shared/http.js';
import { createContext, readEnv } from '../_shared/context.js';
import { handleStripeWebhook } from '../_shared/webhook.js';

Deno.serve(async (request) => {
  const envFallback = readEnv();
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request, envFallback) });
  }
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405, corsHeaders(request, envFallback));
  }

  const limited = await readTextLimited(request, MAX_WEBHOOK_BYTES);
  if (!limited.ok) return json({ error: limited.error }, 413);

  const signature = request.headers.get('Stripe-Signature') || '';
  const ctx = await createContext(envFallback);
  const env = ctx.env;

  const result = await handleStripeWebhook(env, ctx.store, limited.text, signature, {
    kickWorker: async () => {
      const base = String(env.APP_FUNCTIONS_URL || `${env.SUPABASE_URL}/functions/v1`).replace(/\/$/, '');
      await fetch(`${base}/process-jobs`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.WORKER_SECRET}`,
          'X-Worker-Secret': env.WORKER_SECRET,
        },
      });
    },
  });

  return json(result.body, result.status);
});
