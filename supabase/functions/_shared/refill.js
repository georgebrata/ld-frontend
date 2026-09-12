/**
 * SocialPanel24 refill: eligibility, provider call, and refill-status polling.
 * Ambiguous refill outcomes become `unknown` and are never auto-retried.
 */

import { getProviderCatalog } from './catalogue.js';
import { providerDispatchGate } from './fulfillment.js';
import { findProviderService } from './pricing.js';
import { logError } from './log.js';
import { SocialPanelError, fetchProviderRefillStatuses, requestProviderRefill } from './socialpanel24.js';

export const REFILL_IN_FLIGHT = Object.freeze(['requested', 'pending']);
export const REFILL_ELIGIBLE_FULFILLMENT = Object.freeze(['completed', 'partial']);
export const REFILL_TERMINAL = Object.freeze(['completed', 'rejected', 'failed', 'unknown']);

function providerEnv(env, fetchImpl) {
  return {
    apiKey: env.SOCIALPANEL24_API_KEY,
    fetchImpl,
    timeoutMs: Number(env.SOCIALPANEL24_TIMEOUT_MS || 15000),
  };
}

function catalogueDeps(env, store, extras) {
  return {
    fetchImpl: extras.fetchImpl,
    now: extras.now,
    cacheGet: typeof store.cacheGet === 'function' ? (key) => store.cacheGet(key) : undefined,
    cacheSet: typeof store.cacheSet === 'function' ? (key, value, ttl) => store.cacheSet(key, value, ttl) : undefined,
  };
}

async function recordAttempt(store, row) {
  if (typeof store.recordExternalAttempt === 'function') {
    await store.recordExternalAttempt(row);
  }
}

function fakeRefillResult(order) {
  const suffix = String(order.id || '0').replace(/[^0-9]/g, '').slice(-8) || '1';
  return { refillId: `8${suffix.padStart(7, '0')}`.slice(0, 8), fake: true };
}

/**
 * Map SocialPanel24 refill_status strings.
 * @param {string} raw
 */
export function mapRefillStatus(raw) {
  const lower = String(raw || '').trim().toLowerCase();
  if (lower === 'completed' || lower === 'complete' || lower === 'success') return 'completed';
  if (lower === 'pending' || lower === 'in progress' || lower === 'processing') return 'pending';
  if (lower === 'rejected' || lower === 'canceled' || lower === 'cancelled') return 'rejected';
  if (lower === 'error' || lower === 'failed') return 'failed';
  return 'pending';
}

/**
 * @param {object} env
 * @param {object} store
 * @param {object} order
 * @param {object} [deps]
 * @returns {Promise<{ eligible: boolean, reason: string }>}
 */
export async function refillEligibility(env, store, order, deps = {}) {
  if (!order) return { eligible: false, reason: 'not_found' };
  if (order.payment_status !== 'paid') return { eligible: false, reason: 'not_paid' };
  if (!order.provider_order_id) return { eligible: false, reason: 'missing_provider_order' };
  if (!REFILL_ELIGIBLE_FULFILLMENT.includes(order.fulfillment_status)) {
    return { eligible: false, reason: 'not_refillable_status' };
  }
  if (REFILL_IN_FLIGHT.includes(order.provider_refill_status)) {
    return { eligible: false, reason: 'refill_in_flight' };
  }
  if (order.provider_refill_status === 'unknown') {
    return { eligible: false, reason: 'refill_unknown' };
  }

  if (typeof store.cacheGet === 'function') {
    const kill = await store.cacheGet('ops:provider_kill');
    if (kill && kill.enabled === false) return { eligible: false, reason: 'provider_kill_switch' };
  }

  const gate = providerDispatchGate(env, order);
  if (gate.action !== 'live' && gate.action !== 'fake') {
    return { eligible: false, reason: gate.reason || gate.action };
  }

  try {
    const rows = await getProviderCatalog(env, catalogueDeps(env, store, deps));
    const provider = findProviderService(rows, order.provider_service_id);
    if (!provider) return { eligible: false, reason: 'service_not_found' };
    if (!provider.refill) return { eligible: false, reason: 'refill_not_supported' };
  } catch {
    return { eligible: false, reason: 'provider_unavailable' };
  }

  return { eligible: true, reason: '' };
}

/**
 * @param {object} env
 * @param {object} store
 * @param {object} order
 * @param {object} job
 * @param {object} [deps]
 */
export async function requestOrderRefill(env, store, order, job, deps = {}) {
  if (!order) {
    await store.failJob(job.id, { reason: 'missing_order' }, new Date().toISOString(), true);
    return { skipped: true, reason: 'missing_order' };
  }
  if (!order.provider_order_id) {
    await store.skipJob(job.id, { reason: 'missing_provider_order' });
    return { skipped: true, reason: 'missing_provider_order' };
  }
  if (order.provider_refill_status === 'unknown') {
    await store.skipJob(job.id, { reason: 'refill_unknown' });
    return { skipped: true, reason: 'refill_unknown' };
  }
  if (order.provider_refill_id) {
    await store.enqueueJob({
      orderId: null,
      task: 'poll_refill_status',
      dedupeKey: 'refill-poll:batch',
    });
    await store.completeJob(job.id, { reason: 'already_refilling' });
    return { skipped: true, reason: 'already_refilling' };
  }

  if (typeof store.cacheGet === 'function') {
    const kill = await store.cacheGet('ops:provider_kill');
    if (kill && kill.enabled === false) {
      const next = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      await store.failJob(job.id, { reason: 'provider_kill_switch' }, next, false);
      return { skipped: true, deferred: true, reason: 'provider_kill_switch' };
    }
  }

  const gate = providerDispatchGate(env, order);
  if (gate.action === 'skip_test') {
    await store.updateOrder(order.id, { provider_refill_status: 'failed' });
    await store.completeJob(job.id, { reason: gate.reason });
    return { skipped: true, reason: gate.reason };
  }
  if (gate.action === 'defer') {
    const next = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await store.failJob(job.id, { reason: gate.reason }, next, false);
    return { skipped: true, deferred: true, reason: gate.reason };
  }

  await recordAttempt(store, {
    orderId: order.id,
    jobId: job.id,
    vendor: 'socialpanel24',
    action: 'refill',
    fingerprint: JSON.stringify({ order: order.provider_order_id }),
    attemptedAt: new Date().toISOString(),
  });

  try {
    const result =
      gate.action === 'fake'
        ? fakeRefillResult(order)
        : await requestProviderRefill(providerEnv(env, deps.fetchImpl), order.provider_order_id);
    await store.updateOrder(order.id, {
      provider_refill_id: result.refillId,
      provider_refill_status: 'pending',
      provider_refill_last_status_at: new Date().toISOString(),
    });
    await store.enqueueJob({
      orderId: null,
      task: 'poll_refill_status',
      dedupeKey: 'refill-poll:batch',
    });
    await store.completeJob(job.id, { refillId: result.refillId }, result.refillId);
    return { ok: true, refillId: result.refillId };
  } catch (err) {
    const code = err instanceof SocialPanelError ? err.code : 'TRANSPORT';
    if (code === 'INSUFFICIENT_BALANCE' || code === 'PROVIDER_REJECTED') {
      await store.updateOrder(order.id, { provider_refill_status: 'rejected' });
      await store.enqueueJob({
        orderId: order.id,
        task: 'email_owner_alert',
        dedupeKey: `email:owner:refill_rejected:${order.id}:${job.id}`,
        payload: {
          alert: `Provider rejected the refill: ${err instanceof Error ? err.message : 'rejected'}`,
        },
      });
      await store.completeJob(job.id, { reason: 'provider_rejected', code });
      return { ok: false, reason: 'provider_rejected' };
    }

    await store.updateOrder(order.id, { provider_refill_status: 'unknown' });
    await store.enqueueJob({
      orderId: order.id,
      task: 'email_owner_alert',
      dedupeKey: `email:owner:refill_unknown:${order.id}`,
      payload: {
        alert:
          'Provider refill outcome is unknown. Search SocialPanel24 before requesting another refill. Automatic refill retries are disabled.',
      },
    });
    await store.completeJob(job.id, { reason: 'refill_unknown', code });
    logError('refill unknown', { code });
    return { ok: false, reason: 'refill_unknown' };
  }
}

/**
 * @param {object} env
 * @param {object} store
 * @param {object} [deps]
 */
export async function pollRefillStatuses(env, store, deps = {}) {
  if (typeof store.listRefillPollingOrders !== 'function') return { polled: 0 };
  const orders = await store.listRefillPollingOrders();
  const due = orders.filter(
    (row) => row.provider_refill_id && !REFILL_TERMINAL.includes(row.provider_refill_status)
  );
  if (!due.length) return { polled: 0 };

  let polled = 0;
  for (const order of due) {
    let result;
    try {
      result = await fetchProviderRefillStatuses(providerEnv(env, deps.fetchImpl), [order.provider_refill_id]);
    } catch {
      logError('refill status failed', { size: 1 });
      continue;
    }
    const entry = result[order.provider_refill_id];
    if (!entry) continue;
    polled += 1;
    if (entry.error) {
      await store.updateOrder(order.id, {
        provider_refill_status: 'failed',
        provider_refill_last_status_at: new Date().toISOString(),
      });
      continue;
    }
    const mapped = mapRefillStatus(entry.status);
    await store.updateOrder(order.id, {
      provider_refill_status: mapped,
      provider_refill_last_status_at: new Date().toISOString(),
    });
  }
  return { polled };
}
