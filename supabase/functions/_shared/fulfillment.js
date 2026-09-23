/**
 * Paid-order submission and status polling. The customer's browser is not required.
 *
 * Duplicate prevention: SocialPanel24 has no client idempotency key. After
 * dispatch intent is persisted, ambiguous outcomes become submission_unknown
 * and never automatic-add again.
 *
 * Live provider HTTP runs only when Stripe livemode, PROVIDER_ENV=live,
 * SOCIALPANEL24_ENABLED=true, and APP_ENV=production (or ALLOW_LIVE_PROVIDER).
 */

import { addProviderOrder, fetchProviderStatuses, SocialPanelError } from './socialpanel24.js';
import { mapProviderStatus } from './states.js';
import { ownerAlertEmail } from './email-templates.js';
import { logError } from './log.js';

export const POLL_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const POLL_BATCH_SIZE = 100;

function providerEnv(env, fetchImpl) {
  return {
    apiKey: env.SOCIALPANEL24_API_KEY,
    fetchImpl,
    timeoutMs: Number(env.SOCIALPANEL24_TIMEOUT_MS || 15000),
  };
}

/**
 * @param {object} env
 * @param {object} order
 * @returns {{ action: 'live'|'fake'|'skip_test'|'defer', reason: string }}
 */
export function providerDispatchGate(env, order) {
  const stripeLive = order.stripe_livemode === true;
  const providerLive = String(env.PROVIDER_ENV || '').trim().toLowerCase() === 'live';
  const enabled = String(env.SOCIALPANEL24_ENABLED || '').trim().toLowerCase() === 'true';
  const appEnv = String(env.APP_ENV || env.DEPLOYMENT_ENV || '').trim().toLowerCase();
  const production = appEnv === 'production' || appEnv === 'prod';
  const allowLive = String(env.ALLOW_LIVE_PROVIDER || '').trim().toLowerCase() === 'true';
  const adapter = String(env.PROVIDER_ADAPTER || '').trim().toLowerCase();

  if (adapter === 'fake') return { action: 'fake', reason: 'fake_adapter' };
  if (!stripeLive) return { action: 'skip_test', reason: 'test_stripe' };
  if (!enabled) return { action: 'defer', reason: 'provider_disabled' };
  if (!providerLive) return { action: 'defer', reason: 'provider_not_live' };
  if (!production && !allowLive) return { action: 'defer', reason: 'non_production' };
  return { action: 'live', reason: '' };
}

/** @deprecated use providerDispatchGate */
export function liveProviderBlocked(env, order) {
  const gate = providerDispatchGate(env, order);
  if (gate.action === 'live' || gate.action === 'fake') return '';
  if (gate.action === 'skip_test') return 'test_stripe_live_provider';
  return gate.reason;
}

function fakeAddResult(order) {
  const suffix = String(order.id || '0').replace(/[^0-9]/g, '').slice(-8) || '1';
  return { orderId: `9${suffix.padStart(7, '0')}`.slice(0, 8), fake: true };
}

async function recordAttempt(store, row) {
  if (typeof store.recordExternalAttempt === 'function') {
    await store.recordExternalAttempt(row);
  }
}

/**
 * @param {object} env
 * @param {object} store
 * @param {object} order
 * @param {object} job
 * @param {object} [deps]
 */
export async function fulfillPaidOrder(env, store, order, job, deps = {}) {
  if (order.payment_status !== 'paid') {
    await store.skipJob(job.id, { reason: 'not_paid' });
    return { skipped: true, reason: 'not_paid' };
  }

  if (order.provider_order_id) {
    await store.enqueueJob({
      orderId: order.id,
      task: 'poll_provider_status',
      dedupeKey: 'poll:batch',
    });
    await store.completeJob(job.id, { reason: 'already_submitted' });
    return { skipped: true, reason: 'already_submitted' };
  }

  if (order.fulfillment_status === 'submission_unknown') {
    await store.skipJob(job.id, { reason: 'submission_unknown' });
    return { skipped: true, reason: 'submission_unknown' };
  }

  if (order.fulfillment_status === 'dispatching') {
    await store.updateOrder(order.id, { fulfillment_status: 'submission_unknown' });
    await store.enqueueJob({
      orderId: order.id,
      task: 'email_owner_alert',
      dedupeKey: `email:owner:unknown_submission:${order.id}`,
      payload: { alert: 'Expired lease after dispatch. Reconcile in SocialPanel24 before any resubmission.' },
    });
    await store.skipJob(job.id, { reason: 'lease_expired_after_dispatch' });
    return { skipped: true, reason: 'lease_expired_after_dispatch' };
  }

  if (order.fulfillment_status === 'blocked_balance') {
    await store.skipJob(job.id, { reason: 'blocked_balance' });
    return { skipped: true, reason: 'blocked_balance' };
  }

  if (typeof store.cacheGet === 'function') {
    const kill = await store.cacheGet('ops:provider_kill');
    if (kill && kill.enabled === false) {
      await store.updateOrder(order.id, { fulfillment_status: 'deferred' });
      const next = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      await store.failJob(job.id, { reason: 'provider_kill_switch' }, next, false);
      return { skipped: true, deferred: true, reason: 'provider_kill_switch' };
    }
  }

  const gate = providerDispatchGate(env, order);
  if (gate.action === 'skip_test') {
    await store.updateOrder(order.id, { fulfillment_status: 'skipped_test_mode' });
    await store.completeJob(job.id, { reason: gate.reason });
    return { skipped: true, reason: gate.reason };
  }
  if (gate.action === 'defer') {
    await store.updateOrder(order.id, { fulfillment_status: 'deferred' });
    const next = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await store.failJob(job.id, { reason: gate.reason }, next, false);
    return { skipped: true, deferred: true, reason: gate.reason };
  }

  await store.updateOrder(order.id, {
    fulfillment_status: 'dispatching',
    provider_dispatched_at: new Date().toISOString(),
  });

  const payload = {
    service: String(order.provider_service_id),
    ...(order.provider_payload || {}),
  };

  await recordAttempt(store, {
    orderId: order.id,
    jobId: job.id,
    vendor: 'socialpanel24',
    action: 'add',
    fingerprint: JSON.stringify({ service: payload.service, quantity: payload.quantity }),
    attemptedAt: new Date().toISOString(),
  });

  try {
    const result =
      gate.action === 'fake'
        ? fakeAddResult(order)
        : await addProviderOrder(providerEnv(env, deps.fetchImpl), payload);
    await store.updateOrder(order.id, {
      provider_order_id: result.orderId,
      fulfillment_status: 'submitted',
    });
    await store.enqueueJob({
      orderId: null,
      task: 'poll_provider_status',
      dedupeKey: 'poll:batch',
    });
    await store.completeJob(job.id, { providerOrderId: result.orderId }, result.orderId);
    return { ok: true, providerOrderId: result.orderId };
  } catch (err) {
    const code = err instanceof SocialPanelError ? err.code : 'TRANSPORT';
    if (code === 'INSUFFICIENT_BALANCE') {
      await store.updateOrder(order.id, { fulfillment_status: 'blocked_balance' });
      await store.enqueueJob({
        orderId: order.id,
        task: 'email_owner_alert',
        dedupeKey: `email:owner:blocked_balance:${order.id}`,
        payload: { alert: 'SocialPanel24 rejected the order for insufficient balance. Customer charge is unchanged.' },
      });
      await store.completeJob(job.id, { reason: 'blocked_balance' });
      return { ok: false, reason: 'blocked_balance' };
    }
    if (code === 'PROVIDER_REJECTED') {
      await store.updateOrder(order.id, { fulfillment_status: 'failed' });
      await store.enqueueJob({
        orderId: order.id,
        task: 'email_owner_alert',
        dedupeKey: `email:owner:provider_rejected:${order.id}`,
        payload: { alert: `Provider rejected the order: ${err instanceof Error ? err.message : 'rejected'}` },
      });
      await store.completeJob(job.id, { reason: 'provider_rejected' });
      return { ok: false, reason: 'provider_rejected' };
    }

    await store.updateOrder(order.id, { fulfillment_status: 'submission_unknown' });
    await store.enqueueJob({
      orderId: order.id,
      task: 'email_owner_alert',
      dedupeKey: `email:owner:unknown_submission:${order.id}`,
      payload: {
        alert:
          'Provider submission is unknown. Search SocialPanel24 by time/link and attach the provider order id, or confirm non-acceptance before any resubmission. Automatic add retries are disabled.',
      },
    });
    await store.completeJob(job.id, { reason: 'submission_unknown', code });
    logError('fulfillment unknown', { code });
    return { ok: false, reason: 'submission_unknown' };
  }
}

export function isPollingTerminal(status) {
  return ['completed', 'failed', 'cancelled', 'partial', 'review', 'skipped_test_mode'].includes(status);
}

export function isPollExpired(order, now = Date.now()) {
  const started = Date.parse(order.provider_dispatched_at || order.created_at || '') || 0;
  return started > 0 && now - started > POLL_MAX_AGE_MS;
}

/**
 * @param {object} env
 * @param {object} store
 * @param {object} [deps]
 */
export async function pollProviderOrders(env, store, deps = {}) {
  const orders = await store.listPollingOrders();
  const active = orders.filter((row) => row.provider_order_id && !isPollingTerminal(row.fulfillment_status));
  const due = active.filter((row) => !isPollExpired(row));
  const ids = due.map((row) => row.provider_order_id).filter(Boolean);
  if (!ids.length) return { polled: 0 };

  const batches = [];
  for (let i = 0; i < ids.length; i += POLL_BATCH_SIZE) batches.push(ids.slice(i, i + POLL_BATCH_SIZE));

  let polled = 0;
  for (const batch of batches) {
    let result;
    try {
      result = await fetchProviderStatuses(providerEnv(env, deps.fetchImpl), batch);
    } catch (err) {
      logError('status batch failed', { size: batch.length });
      continue;
    }
    for (const order of due.filter((row) => batch.includes(row.provider_order_id))) {
      const entry = result[order.provider_order_id];
      if (!entry) continue;
      polled += 1;
      if (entry.error) {
        await store.updateOrder(order.id, {
          provider_status_raw: String(entry.error),
          provider_last_status_at: new Date().toISOString(),
        });
        continue;
      }
      const mapped = mapProviderStatus(entry.status);
      await store.updateOrder(order.id, {
        fulfillment_status: mapped === 'review' ? 'review' : mapped,
        provider_status_raw: String(entry.status || ''),
        provider_charge: entry.charge != null ? String(entry.charge) : order.provider_charge,
        provider_currency: entry.currency != null ? String(entry.currency) : order.provider_currency,
        provider_start_count: entry.start_count != null ? String(entry.start_count) : order.provider_start_count,
        provider_remains: entry.remains != null ? String(entry.remains) : order.provider_remains,
        provider_last_status_at: new Date().toISOString(),
      });
    }
  }

  for (const order of active.filter((row) => isPollExpired(row) && row.fulfillment_status !== 'review')) {
    await store.updateOrder(order.id, { fulfillment_status: 'review' });
    await store.enqueueJob({
      orderId: order.id,
      task: 'email_owner_alert',
      dedupeKey: `email:owner:stale_poll:${order.id}`,
      payload: { alert: 'Provider status polling reached the maximum age. Review the order manually.' },
    });
  }

  return { polled };
}

export { ownerAlertEmail };
