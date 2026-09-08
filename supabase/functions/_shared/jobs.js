/**
 * Job worker: emails, fulfilment, and status polling. Authenticated separately
 * from guest browsers. Cron every minute is the durable fallback.
 */

import { formatMoney } from './money.js';
import { customerPaymentEmail, ownerAlertEmail, ownerPaymentEmail } from './email-templates.js';
import { resendIdempotencyExpired, sendResendEmail } from './email.js';
import { fulfillPaidOrder, pollProviderOrders } from './fulfillment.js';
import { logError } from './log.js';

function backoffMs(attempts) {
  const capped = Math.min(Math.max(attempts, 1), 8);
  return Math.min(60 * 60 * 1000, 1000 * 2 ** capped);
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

  if (job.task === 'poll_status') {
    await pollProviderOrders(env, store, deps);
    const latest = order ? await store.getOrderById(order.id) : null;
    const terminal = latest && ['completed', 'failed', 'cancelled'].includes(latest.fulfillment_status);
    if (terminal) {
      await store.completeJob(job.id, { status: latest.fulfillment_status });
      return;
    }
    const next = new Date(Date.now() + Math.max(60_000, backoffMs(job.attempts))).toISOString();
    await store.failJob(job.id, { reason: 'requeue_poll' }, next, false);
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

  await store.skipJob(job.id, { reason: 'unknown_task' });
}

/**
 * @param {object} env
 * @param {object} store
 * @param {object} job
 * @param {object} order
 * @param {object} deps
 */
async function sendJobEmail(env, store, job, order, deps) {
  if (job.external_ref && job.payload?.acceptedAt) {
    await store.completeJob(job.id, { already: true }, job.external_ref);
    return;
  }

  if (job.payload?.attemptedAt && !job.external_ref) {
    const attempted = new Date(job.payload.attemptedAt);
    if (!resendIdempotencyExpired(attempted, new Date())) {
      await store.failJob(job.id, { reason: 'ambiguous_resend_window' }, new Date(Date.now() + 10 * 60 * 1000).toISOString());
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
    rendered = ownerAlertEmail(mapped, job.payload?.alert || 'Operator attention required.');
    to = env.OWNER_EMAIL;
  }

  if (!to) {
    await store.skipJob(job.id, { reason: 'missing_recipient' });
    return;
  }

  const idempotencyKey = job.dedupe_key;
  await store.failJob(
    job.id,
    { queued: true },
    new Date(Date.now() + backoffMs(job.attempts)).toISOString(),
    false
  );
  await store.updateOrder(order.id, {});

  const payload = {
    ...job.payload,
    to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    templateVersion: rendered.templateVersion,
    idempotencyKey,
    attemptedAt: new Date().toISOString(),
  };

  try {
    const result = await sendResendEmail(
      env,
      { to, subject: rendered.subject, html: rendered.html, text: rendered.text, idempotencyKey },
      deps.fetchImpl
    );
    await store.completeJob(job.id, { accepted: true, payload }, result.id);
    if (job.task === 'email_customer_payment') {
      await store.updateOrder(order.id, { customer_email_state: 'sent' });
    }
  } catch (err) {
    logError('email send failed', { task: job.task });
    if (job.task === 'email_customer_payment') {
      await store.updateOrder(order.id, { customer_email_state: 'failed' });
    }
    const retryable = Boolean(err && err.retryable);
    await store.failJob(
      job.id,
      { error: 'send_failed', payload },
      new Date(Date.now() + backoffMs(job.attempts)).toISOString(),
      !retryable && job.attempts >= (job.max_attempts || 12)
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
  const results = [];
  for (const job of claimed) {
    try {
      await processJob(env, store, job, deps);
      results.push({ id: job.id, task: job.task, ok: true });
    } catch (err) {
      logError('job failed', { task: job.task });
      await store.failJob(
        job.id,
        { error: 'exception' },
        new Date(Date.now() + backoffMs(job.attempts)).toISOString(),
        job.attempts >= (job.max_attempts || 12)
      );
      results.push({ id: job.id, task: job.task, ok: false });
    }
  }
  return { workerId, processed: results.length, results };
}
