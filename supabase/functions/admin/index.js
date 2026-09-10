import { corsHeaders, json, readJsonBody, clientIp } from '../_shared/http.js';
import { createContext, createServiceClient, readEnv } from '../_shared/context.js';
import { handleAdminAction } from '../_shared/admin.js';

Deno.serve(async (request) => {
  try {
    const env = readEnv();
    const headers = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, headers);

    const ctx = await createContext(env);
    const client = createServiceClient(ctx.env);
    const body = await readJsonBody(request);
    if (!body.ok) return json({ error: body.error }, 400, headers);

    const result = await handleAdminAction(
      { env: ctx.env, store: ctx.store, client },
      body.value,
      { request, ip: clientIp(request), fetchImpl: fetch }
    );
    return json(result.body, result.status, headers);
  } catch {
    const headers = corsHeaders(request, readEnv());
    return json({ error: 'Admin request failed.' }, 500, headers);
  }
});
