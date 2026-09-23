/**
 * Bounded operator commands. No arbitrary SQL or vendor credentials.
 * Agents may propose; execution requires human approval.
 */

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

const COMMANDS = Object.freeze({
  replay_job: { approval: true, schema: ['jobId', 'reason'] },
  attach_provider_order_id: { approval: true, schema: ['orderId', 'providerOrderId', 'reason'] },
  mark_provider_nonacceptance: { approval: true, schema: ['orderId', 'reason'] },
  pause_catalogue: { approval: true, schema: ['reason'] },
  provider_kill_switch: { approval: true, schema: ['enabled', 'reason'] },
  propose_refund: { approval: true, schema: ['orderId', 'amountMinor', 'reason'] },
});

export function listOperatorCommands() {
  return Object.keys(COMMANDS);
}

/**
 * @param {Record<string, unknown>} proposal
 */
export function validateOperatorCommand(proposal) {
  const command = String(proposal?.command || '');
  const spec = COMMANDS[command];
  if (!spec) return { ok: false, error: 'Unknown command.' };
  if (!proposal.idempotencyKey) return { ok: false, error: 'An idempotency key is required.' };
  if (!proposal.reason) return { ok: false, error: 'A reason is required.' };
  for (const key of spec.schema) {
    if (key === 'reason') continue;
    if (proposal[key] == null || proposal[key] === '') {
      return { ok: false, error: `Missing ${key}.` };
    }
  }
  if (command === 'propose_refund') {
    const amount = Number(proposal.amountMinor);
    if (!Number.isInteger(amount) || amount < 1 || amount > 500000) {
      return { ok: false, error: 'Refund amount is outside the allowed range.' };
    }
  }
  return { ok: true, command, approvalRequired: spec.approval };
}

async function recordAction(store, proposal, opts, status, extra = {}) {
  if (typeof store.insertOperatorAction !== 'function') return;
  await store.insertOperatorAction({
    command: proposal.command,
    payload: proposal,
    status,
    actor: opts.actor || (status === 'proposed' ? 'agent' : 'operator'),
    approver: opts.approver || (status === 'executed' ? opts.actor : null),
    idempotencyKey: proposal.idempotencyKey,
    ...extra,
  });
}

async function getJob(store, jobId) {
  if (typeof store.getJobById === 'function') {
    return store.getJobById(String(jobId));
  }
  const jobs = store.jobs || [];
  return jobs.find((row) => row.id === jobId) || null;
}

/**
 * Dry-run or execute a previously approved command.
 * @param {object} store
 * @param {Record<string, unknown>} proposal
 * @param {{ approved?: boolean, actor?: string, approver?: string }} [opts]
 */
export async function executeOperatorCommand(store, proposal, opts = {}) {
  const checked = validateOperatorCommand(proposal);
  if (!checked.ok) return { status: 400, body: { error: checked.error } };
  if (checked.approvalRequired && !opts.approved) {
    await recordAction(store, proposal, opts, 'proposed');
    return { status: 202, body: { ok: true, status: 'proposed', command: checked.command } };
  }

  if (checked.command === 'attach_provider_order_id') {
    const order = await store.getOrderById(String(proposal.orderId));
    if (!order) return { status: 404, body: { error: 'Order not found.' } };
    if (order.fulfillment_status !== 'submission_unknown') {
      return { status: 409, body: { error: 'Provider id can only be attached on unknown submissions.' } };
    }
    await store.updateOrder(order.id, {
      provider_order_id: String(proposal.providerOrderId),
      fulfillment_status: 'submitted',
    });
    await store.enqueueJob({ orderId: null, task: 'poll_provider_status', dedupeKey: 'poll:batch' });
  }

  if (checked.command === 'mark_provider_nonacceptance') {
    const order = await store.getOrderById(String(proposal.orderId));
    if (!order) return { status: 404, body: { error: 'Order not found.' } };
    if (order.fulfillment_status !== 'submission_unknown') {
      return { status: 409, body: { error: 'Only unknown submissions can be marked non-accepted.' } };
    }
    await store.updateOrder(order.id, { fulfillment_status: 'failed' });
  }

  if (checked.command === 'replay_job') {
    const job = await getJob(store, proposal.jobId);
    if (!job) return { status: 404, body: { error: 'Job not found.' } };
    if (typeof store.replayJob === 'function') {
      await store.replayJob(job.id, String(proposal.reason || ''));
    } else {
      job.status = 'pending';
      job.next_retry_at = new Date().toISOString();
      job.attempts = Math.max(0, (job.attempts || 1) - 1);
    }
  }

  if (checked.command === 'pause_catalogue') {
    if (typeof store.cacheSet !== 'function') {
      return { status: 500, body: { error: 'Catalogue pause storage is unavailable.' } };
    }
    await store.cacheSet('ops:catalogue_paused', { paused: true, reason: proposal.reason }, YEAR_MS);
  }

  if (checked.command === 'provider_kill_switch') {
    if (typeof store.cacheSet !== 'function') {
      return { status: 500, body: { error: 'Kill-switch storage is unavailable.' } };
    }
    await store.cacheSet(
      'ops:provider_kill',
      { enabled: Boolean(proposal.enabled), reason: proposal.reason },
      YEAR_MS
    );
  }

  if (checked.command === 'propose_refund') {
    const order = await store.getOrderById(String(proposal.orderId));
    if (!order) return { status: 404, body: { error: 'Order not found.' } };
    await recordAction(store, proposal, opts, 'executed', {
      result: { stripeRefund: false, recorded: true, amountMinor: proposal.amountMinor },
    });
    return {
      status: 200,
      body: {
        ok: true,
        status: 'executed',
        command: checked.command,
        stripeRefund: false,
        note: 'Refund is recorded for a human to complete in Stripe. Agents cannot issue refunds.',
      },
    };
  }

  await recordAction(store, proposal, opts, 'executed');
  return { status: 200, body: { ok: true, status: 'executed', command: checked.command } };
}
