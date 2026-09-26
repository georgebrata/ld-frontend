import { corsHeaders, json, clientIp, readJsonBody, MAX_JSON_BYTES } from '../_shared/http.js';
import { createContext, createServiceClient, readEnv } from '../_shared/context.js';
import { handleAdminAction } from '../_shared/admin.js';

Deno.serve(async (request) => {
  try {
    const ctx = await createContext(readEnv());
    const headers = corsHeaders(request, ctx.env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, headers);

    const parsed = await readJsonBody(request, MAX_JSON_BYTES);
    if (!parsed.ok) return json({ error: parsed.error }, 400, headers);

    const client = createServiceClient(ctx.env);
    const result = await handleAdminAction(
      { ...ctx, client },
      parsed.value,
      {
        request,
        ip: clientIp(request),
        fetchImpl: fetch,
        client,
        getUser: async (token) => {
          const { data, error } = await client.auth.getUser(token);
          if (error || !data?.user) return null;
          return { id: data.user.id, email: data.user.email || '' };
        },
      }
    );
    return json(result.body, result.status, headers);
  } catch (err) {
    console.error('admin failed', err instanceof Error ? err.message : 'unknown');
    const headers = corsHeaders(request, readEnv());
    return json({ error: 'Something went wrong.' }, 500, headers);
  }
});
