import { json } from '../_shared/http.js';
import { createContext, readEnv } from '../_shared/context.js';
import { timingSafeEqual } from '../_shared/crypto-token.js';
import { queueAlerts } from '../_shared/metrics.js';

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
  if (request.method === 'GET') {
    return json({
      ok: true,
      service: 'like-dealer',
      ts: new Date().toISOString(),
      gitSha: Deno.env.get('GIT_SHA') || null,
    });
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const ctx = await createContext(readEnv());
    if (!authorized(request, ctx.env)) return json({ error: 'Unauthorized.' }, 401);
    const snapshot = typeof ctx.store.operationalSnapshot === 'function' ? await ctx.store.operationalSnapshot() : {};
    const alerts = queueAlerts(snapshot);
    return json({ ok: true, alerts, ...snapshot });
  } catch {
    return json({ error: 'Health check failed.' }, 500);
  }
});
