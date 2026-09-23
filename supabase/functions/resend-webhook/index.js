/**
 * Resend delivery webhook. API acceptance is not delivery.
 */

import { json, readTextLimited, MAX_JSON_BYTES } from '../_shared/http.js';
import { createContext, readEnv } from '../_shared/context.js';
import { timingSafeEqual } from '../_shared/crypto-token.js';

async function verifySvix(payload, header, secret) {
  if (!header || !secret) return false;
  const signatures = String(header)
    .split(' ')
    .map((part) => part.replace(/^v1,/i, '').trim())
    .filter(Boolean);
  const encoder = new TextEncoder();
  let keyBytes;
  try {
    keyBytes = secret.startsWith('whsec_')
      ? Uint8Array.from(atob(secret.slice(6)), (c) => c.charCodeAt(0))
      : encoder.encode(secret);
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const digest = btoa(String.fromCharCode(...new Uint8Array(signed)));
  return signatures.some((item) => timingSafeEqual(item, digest));
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const limited = await readTextLimited(request, MAX_JSON_BYTES);
  if (!limited.ok) return json({ error: limited.error }, 413);

  const ctx = await createContext(readEnv());
  const id = request.headers.get('svix-id') || '';
  const timestamp = request.headers.get('svix-timestamp') || '';
  const signature = request.headers.get('svix-signature') || '';
  const valid = await verifySvix(`${id}.${timestamp}.${limited.text}`, signature, ctx.env.RESEND_WEBHOOK_SECRET || '');
  if (!valid) return json({ error: 'Invalid signature.' }, 400);

  let event;
  try {
    event = JSON.parse(limited.text);
  } catch {
    return json({ error: 'Invalid payload.' }, 400);
  }

  const type = String(event.type || '');
  const emailId = String(event.data?.email_id || event.data?.id || '');
  const state =
    type === 'email.delivered' ? 'delivered' : type === 'email.bounced' || type === 'email.complained' ? 'bounced' : '';
  if (!emailId || !state) return json({ ok: true, ignored: true });

  const job = await ctx.store.getJobByExternalRef(emailId);
  if (!job?.order_id) return json({ ok: true, missing: true });
  if (job.task === 'email_customer_payment') {
    await ctx.store.updateOrder(job.order_id, { customer_email_state: state });
  }
  return json({ ok: true, type, state });
});
