/**
 * Job worker: emails, fulfilment, and status polling. Authenticated separately
 * from guest browsers. Cron every minute is the durable fallback.
 */

import { formatMoney } from './money.js';
import { customerPaymentEmail, ownerAlertEmail, ownerPaymentEmail } from './email-templates.js';
import { resendIdempotencyExpired, sendResendEmail } from './email.js';
import { fulfillPaidOrder, isPollingTerminal, pollProviderOrders } from './fulfillment.js';
import { pollRefillStatuses, requestOrderRefill, REFILL_TERMINAL } from './refill.js';
import { logError } from './log.js';

export const JOB_TASKS = Object.freeze([
  'fulfill',
  'poll_status',
  'poll_provider_status',
  'purge_rate_limits',
  'email_customer_payment',
  'email_owner_payment',
  'email_owner_alert',
  'provider_refill',
  'poll_refill_status',
]);

function backoffMs(attempts) {
  const exp = Math.min(Math.max(Number(attempts) || 1, 1), 12);
  const base = Math.min(60 * 60 * 1000, 1000 * 2 ** exp);
  const jitter = Math.floor(Math.random() * Math.min(1000, base / 4));
  return base + jitter;
}

function maxAttempts(job) {
  return Number(job.max_attempts) > 0 ? Number(job.max_attempts) : 12;
}

function exhausted(job) {
  return Number(job.attempts || 0) >= maxAttempts(job);
}

async function noteAttempt(store, job) {
  if (typeof store.recordJobAttempt !== 'function') return;
  try {
    await store.recordJobAttempt({
      jobId: job.id,
      orderId: job.order_id,
      task: job.task,
      attempt: job.attempts,
      outcome: 'claimed',
    });
  } catch {
    /* job_attempts may be missing on older databases */
  }
}

/**
 * @param {object} env
 * @param {object} store
 * @param {object} job
 * @param {object} [deps]
 */
export async function processJob(env, store, job, deps = {}) {
  const order = job.order_id ? await store.getOrderById(job.order_id) : null;

  if (job.task === 'fulfill') {
    if (!order) {
      await store.failJob(job.id, { reason: 'missing_order' }, new Date().toISOString(), true);
      return;
    }
    await fulfillPaidOrder(env, store, order, job, deps);
    return;
  }

  if (job.task === 'poll_status' || job.task === 'poll_provider_status') {
    if (job.task === 'poll_provider_status') {
      await pollProviderOrders(env, store, deps);
    }
    await settlePollJob(env, store, job, order, deps);
    return;
  }

  if (job.task === 'purge_rate_limits') {
    if (typeof store.purgeRateLimits === 'function') {
      await store.purgeRateLimits();
    }
    await store.completeJob(job.id, { purged: true });
    return;
  }

  if (job.task === 'email_customer_payment' || job.task === 'email_owner_payment' || job.task === 'email_owner_alert') {
    if (!order) {
      await store.failJob(job.id, { reason: 'missing_order' }, new Date().toISOString(), true);
      return;
    }
    await sendJobEmail(env, store, job, order, deps);
    return;
  }

  if (job.task === 'provider_refill') {
    if (!order) {
      await store.failJob(job.id, { reason: 'missing_order' }, new Date().toISOString(), true);
      return;
    }
    await requestOrderRefill(env, store, order, job, deps);
    return;
  }

  if (job.task === 'poll_refill_status') {
    await pollRefillStatuses(env, store, deps);
    await settleRefillPollJob(store, job);
    return;
  }

  await store.skipJob(job.id, { reason: 'unknown_task' });
}

async function settlePollJob(env, store, job, order, deps) {
  if (job.task === 'poll_status' && order) {
    const latest = await store.getOrderById(order.id);
    if (latest && isPollingTerminal(latest.fulfillment_status)) {
      await store.completeJob(job.id, { status: latest.fulfillment_status, coalesced: true });
      return;
    }
    await store.enqueueJob({
      orderId: null,
      task: 'poll_provider_status',
      dedupeKey: 'poll:batch',
    });
    await store.completeJob(job.id, { coalesced: true });
    return;
  }

  const remaining = (await store.listPollingOrders()).filter(
    (row) => row.provider_order_id && !isPollingTerminal(row.fulfillment_status)
  );
  if (!remaining.length) {
    await store.completeJob(job.id, { polled: 0, drained: true });
    return;
  }
  const next = new Date(Date.now() + Math.max(60_000, backoffMs(job.attempts))).toISOString();
  await store.failJob(job.id, { reason: 'requeue_poll', remaining: remaining.length }, next, exhausted(job));
}

async function settleRefillPollJob(store, job) {
  const remaining =
    typeof store.listRefillPollingOrders === 'function'
      ? (await store.listRefillPollingOrders()).filter(
          (row) => row.provider_refill_id && !REFILL_TERMINAL.includes(row.provider_refill_status)
        )
      : [];
  if (!remaining.length) {
    await store.completeJob(job.id, { polled: 0, drained: true });
    return;
  }
  const next = new Date(Date.now() + Math.max(60_000, backoffMs(job.attempts))).toISOString();
  await store.failJob(job.id, { reason: 'requeue_refill_poll', remaining: remaining.length }, next, exhausted(job));
}

/**
 * @param {object} env
 * @param {object} store
 * @param {object} job
 * @param {object} order
 * @param {object} deps
 */
async function sendJobEmail(env, store, job, order, deps) {
  const payload = job.payload && typeof job.payload === 'object' ? { ...job.payload } : {};

  if (job.external_ref && (payload.acceptedAt || job.outcome?.acceptedAt)) {
    await store.completeJob(job.id, { already: true }, job.external_ref);
    return;
  }

  const attemptedAt = payload.attemptedAt || job.outcome?.payload?.attemptedAt;
  if (attemptedAt && !job.external_ref) {
    const attempted = new Date(attemptedAt);
    if (!resendIdempotencyExpired(attempted, new Date())) {
      await store.failJob(
        job.id,
        { reason: 'ambiguous_resend_window', payload },
        new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        exhausted(job)
      );
      return;
    }
  }

  const amountLabel = formatMoney(order.amount_minor, order.currency);
  const mapped = {
    ...order,
    displayId: order.display_id,
    serviceLabel: order.service_snapshot?.label,
    paymentStatus: order.payment_status,
    fulfillmentStatus: order.fulfillment_status,
    customerEmail: order.email,
    serviceId: order.service_id,
    providerOrderId: order.provider_order_id,
  };

  let rendered;
  let to = '';
  if (job.task === 'email_customer_payment') {
    rendered = customerPaymentEmail(mapped, {
      amountLabel,
      supportEmail: env.SUPPORT_EMAIL || env.REPLY_TO_EMAIL,
      siteUrl: env.SITE_URL,
    });
    to = order.email;
  } else if (job.task === 'email_owner_payment') {
    rendered = ownerPaymentEmail(mapped, { amountLabel });
    to = env.OWNER_EMAIL;
  } else {
    rendered = ownerAlertEmail(mapped, payload.alert || 'Operator attention required.');
    to = env.OWNER_EMAIL;
  }

  if (!to) {
    await store.skipJob(job.id, { reason: 'missing_recipient' });
    return;
  }

  const idempotencyKey = job.dedupe_key;
  const nextPayload = {
    ...payload,
    to,
    subject: rendered.subject,
    templateVersion: rendered.templateVersion,
    idempotencyKey,
    attemptedAt: new Date().toISOString(),
  };
  if (typeof store.updateJobPayload === 'function') {
    await store.updateJobPayload(job.id, nextPayload);
  }

  if (typeof store.recordExternalAttempt === 'function') {
    await store.recordExternalAttempt({
      orderId: order.id,
      jobId: job.id,
      vendor: 'resend',
      action: 'send',
      fingerprint: idempotencyKey,
      attemptedAt: nextPayload.attemptedAt,
    });
  }

  try {
    const result = await sendResendEmail(
      env,
      { to, subject: rendered.subject, html: rendered.html, text: rendered.text, idempotencyKey },
      deps.fetchImpl
    );
    await store.completeJob(job.id, { accepted: true, payload: { ...nextPayload, acceptedAt: new Date().toISOString() } }, result.id);
    if (job.task === 'email_customer_payment') {
      await store.updateOrder(order.id, { customer_email_state: 'accepted' });
    }
  } catch (err) {
    logError('email send failed', { task: job.task });
    if (job.task === 'email_customer_payment') {
      await store.updateOrder(order.id, { customer_email_state: 'failed' });
    }
    const retryable = err && typeof err === 'object' && /** @type {{ retryable?: boolean }} */ (err).retryable === true;
    await store.failJob(
      job.id,
      { error: 'send_failed', payload: nextPayload },
      new Date(Date.now() + backoffMs(job.attempts)).toISOString(),
      exhausted(job) || !retryable
    );
  }
}

/**
 * @param {object} env
 * @param {object} store
 * @param {object} [deps]
 */
export async function processDueJobs(env, store, deps = {}) {
  const workerId = deps.workerId || crypto.randomUUID();
  const claimed = await store.claimJobs(workerId, deps.limit || 20);
  const pollJobs = claimed.filter((job) => job.task === 'poll_status' || job.task === 'poll_provider_status');
  const refillPollJobs = claimed.filter((job) => job.task === 'poll_refill_status');
  const others = claimed.filter(
    (job) => job.task !== 'poll_status' && job.task !== 'poll_provider_status' && job.task !== 'poll_refill_status'
  );
  const results = [];

  if (pollJobs.length) {
    try {
      await pollProviderOrders(env, store, deps);
    } catch (err) {
      logError('poll batch failed', { name: err instanceof Error ? err.name : 'error' });
    }
    for (const job of pollJobs) {
      try {
        await noteAttempt(store, job);
        const order = job.order_id ? await store.getOrderById(job.order_id) : null;
        await settlePollJob(env, store, job, order, deps);
        results.push({ id: job.id, task: job.task, ok: true });
      } catch (err) {
        logError('job failed', { task: job.task });
        await store.failJob(
          job.id,
          { error: 'exception' },
          new Date(Date.now() + backoffMs(job.attempts)).toISOString(),
          exhausted(job)
        );
        results.push({ id: job.id, task: job.task, ok: false });
      }
    }
  }

  if (refillPollJobs.length) {
    try {
      await pollRefillStatuses(env, store, deps);
    } catch (err) {
      logError('refill poll batch failed', { name: err instanceof Error ? err.name : 'error' });
    }
    for (const job of refillPollJobs) {
      try {
        await noteAttempt(store, job);
        await settleRefillPollJob(store, job);
        results.push({ id: job.id, task: job.task, ok: true });
      } catch (err) {
        logError('job failed', { task: job.task });
        await store.failJob(
          job.id,
          { error: 'exception' },
          new Date(Date.now() + backoffMs(job.attempts)).toISOString(),
          exhausted(job)
        );
        results.push({ id: job.id, task: job.task, ok: false });
      }
    }
  }

  for (const job of others) {
    try {
      await noteAttempt(store, job);
      await processJob(env, store, job, deps);
      results.push({ id: job.id, task: job.task, ok: true });
    } catch (err) {
      logError('job failed', { task: job.task });
      await store.failJob(
        job.id,
        { error: 'exception' },
        new Date(Date.now() + backoffMs(job.attempts)).toISOString(),
        exhausted(job)
      );
      results.push({ id: job.id, task: job.task, ok: false });
    }
  }
  return { workerId, processed: results.length, results };
}
