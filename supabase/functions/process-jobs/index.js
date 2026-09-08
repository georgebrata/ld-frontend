import { json } from '../_shared/http.js';
import { createContext, readEnv } from '../_shared/context.js';
import { processDueJobs } from '../_shared/jobs.js';
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
    const result = await processDueJobs(ctx.env, ctx.store, { fetchImpl: fetch, limit: 20 });
    return json({ ok: true, ...result });
  } catch {
    return json({ error: 'Worker failed.' }, 500);
  }
});
