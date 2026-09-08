/**
 * Paid-order submission and status polling. The customer's browser is not required.
 *
 * Duplicate prevention: SocialPanel24 has no client idempotency key. After
 * dispatch intent is persisted, ambiguous outcomes become submission_unknown
 * and never automatic-add again.
 */

import { addProviderOrder, fetchProviderStatuses, SocialPanelError } from './socialpanel24.js';
import { mapProviderStatus } from './states.js';
import { ownerAlertEmail } from './email-templates.js';
import { logError } from './log.js';

function providerEnv(env, fetchImpl) {
  return {
    apiKey: env.SOCIALPANEL24_API_KEY,
    fetchImpl,
    timeoutMs: Number(env.SOCIALPANEL24_TIMEOUT_MS || 15000),
  };
}

function liveProviderBlocked(env, order) {
  const stripeLive = order.stripe_livemode === true;
  const providerLive = String(env.PROVIDER_ENV || 'test') === 'live';
  if (!stripeLive && providerLive) return 'test_stripe_live_provider';
  if (String(env.SOCIALPANEL24_ENABLED || 'true') === 'false') return 'provider_disabled';
  return '';
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
      task: 'poll_status',
      dedupeKey: `poll:${order.id}`,
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

  const blocked = liveProviderBlocked(env, order);
  if (blocked) {
    await store.updateOrder(order.id, { fulfillment_status: 'skipped_test_mode' });
    await store.completeJob(job.id, { reason: blocked });
    return { skipped: true, reason: blocked };
  }

  await store.updateOrder(order.id, {
    fulfillment_status: 'dispatching',
    provider_dispatched_at: new Date().toISOString(),
  });

  const payload = {
    service: String(order.provider_service_id),
    ...(order.provider_payload || {}),
  };

  try {
    const result = await addProviderOrder(providerEnv(env, deps.fetchImpl), payload);
    await store.updateOrder(order.id, {
      provider_order_id: result.orderId,
      fulfillment_status: 'submitted',
    });
    await store.enqueueJob({
      orderId: order.id,
      task: 'poll_status',
      dedupeKey: `poll:${order.id}`,
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

/**
 * @param {object} env
 * @param {object} store
 * @param {object} [deps]
 */
export async function pollProviderOrders(env, store, deps = {}) {
  const orders = await store.listPollingOrders();
  const ids = orders.map((row) => row.provider_order_id).filter(Boolean);
  if (!ids.length) return { polled: 0 };

  const batches = [];
  for (let i = 0; i < ids.length; i += 100) batches.push(ids.slice(i, i + 100));

  let polled = 0;
  for (const batch of batches) {
    let result;
    try {
      result = await fetchProviderStatuses(providerEnv(env, deps.fetchImpl), batch);
    } catch (err) {
      logError('status batch failed', { size: batch.length });
      continue;
    }
    for (const order of orders.filter((row) => batch.includes(row.provider_order_id))) {
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
        fulfillment_status: mapped === 'review' ? order.fulfillment_status : mapped,
        provider_status_raw: String(entry.status || ''),
        provider_charge: entry.charge != null ? String(entry.charge) : order.provider_charge,
        provider_currency: entry.currency != null ? String(entry.currency) : order.provider_currency,
        provider_start_count: entry.start_count != null ? String(entry.start_count) : order.provider_start_count,
        provider_remains: entry.remains != null ? String(entry.remains) : order.provider_remains,
        provider_last_status_at: new Date().toISOString(),
      });
      if (mapped === 'review') {
        await store.updateOrder(order.id, { fulfillment_status: 'review' });
      }
    }
  }
  return { polled };
}

export { ownerAlertEmail, liveProviderBlocked };
