/**
 * In-memory store used by unit tests. Mirrors the Edge Function repository
 * surface without a live database.
 */

function nowIso(date) {
  return (date instanceof Date ? date : new Date()).toISOString();
}

function matches(row, filters) {
  return filters.every(([col, val]) => row[col] === val);
}

export function createMemoryStore(clock = () => new Date()) {
  /** @type {any[]} */
  const orders = [];
  /** @type {Map<string, any>} */
  const events = new Map();
  /** @type {any[]} */
  const jobs = [];
  /** @type {Map<string, { windowStart: number, count: number }>} */
  const rateLimits = new Map();
  /** @type {Map<string, { expires: number, value: any }>} */
  const cache = new Map();

  const store = {
    orders,
    events,
    jobs,

    async transaction(fn) {
      return fn(store);
    },

    async getOrderById(id) {
      return orders.find((row) => row.id === id) || null;
    },

    async getOrderByAttempt(attemptId) {
      return orders.find((row) => row.checkout_attempt_id === attemptId) || null;
    },

    async getOrderBySession(sessionId) {
      return orders.find((row) => row.stripe_session_id === sessionId) || null;
    },

    async getOrderByTokenHash(hash, lookup) {
      return (
        orders.find((row) => {
          if (row.capability_token_hash !== hash) return false;
          if (lookup.orderId && row.id === lookup.orderId) return true;
          if (lookup.sessionId && row.stripe_session_id === lookup.sessionId) return true;
          if (lookup.attemptId && row.checkout_attempt_id === lookup.attemptId) return true;
          return false;
        }) || null
      );
    },

    async insertOrder(order) {
      const existing = orders.find((row) => row.checkout_attempt_id === order.checkout_attempt_id);
      if (existing) {
        const err = new Error('duplicate_attempt');
        err.code = '23505';
        err.existing = existing;
        throw err;
      }
      orders.push({ ...order });
      return { ...order };
    },

    async updateOrder(id, patch) {
      const index = orders.findIndex((row) => row.id === id);
      if (index < 0) return null;
      orders[index] = { ...orders[index], ...patch, updated_at: nowIso(clock()) };
      return { ...orders[index] };
    },

    async insertStripeEvent(eventId, eventType, livemode, extra = {}) {
      if (events.has(eventId)) return { duplicate: true, row: events.get(eventId) };
      const row = {
        event_id: eventId,
        event_type: eventType,
        livemode,
        processed_at: nowIso(clock()),
        outcome: extra.outcome || 'received',
        mismatch: extra.mismatch || null,
        object_id: extra.objectId || null,
        session_id: extra.sessionId || null,
        payment_intent_id: extra.paymentIntentId || null,
      };
      events.set(eventId, row);
      return { duplicate: false, row };
    },

    /**
     * Atomic paid transition: only the first pending→paid enqueues work.
     * Session ids must be cs_…; PaymentIntent ids never overwrite stripe_session_id.
     */
    async applyPaymentEvent({
      eventId,
      eventType,
      livemode,
      orderId,
      sessionId,
      amountMinor,
      currency,
      paymentIntentId,
      desiredPayment,
      objectId,
    }) {
      const existingEvent = events.get(eventId);
      if (existingEvent && ['accepted', 'ignored', 'duplicate'].includes(existingEvent.outcome)) {
        return { duplicate: true, enqueued: false, outcome: 'duplicate', order: await store.getOrderById(orderId) };
      }

      const session = typeof sessionId === 'string' && sessionId.startsWith('cs_') ? sessionId : '';
      const intent = typeof paymentIntentId === 'string' && paymentIntentId.startsWith('pi_') ? paymentIntentId : '';

      if (!desiredPayment) {
        await store.insertStripeEvent(eventId, eventType, livemode, {
          outcome: 'ignored',
          objectId,
          sessionId: session,
          paymentIntentId: intent,
        });
        if (existingEvent) existingEvent.outcome = 'ignored';
        return { duplicate: Boolean(existingEvent), ignored: true, enqueued: false, outcome: 'ignored' };
      }

      const order =
        (orderId && (await store.getOrderById(orderId))) ||
        (session && (await store.getOrderBySession(session))) ||
        (intent && orders.find((row) => row.stripe_payment_intent_id === intent)) ||
        null;
      if (!order) {
        await store.insertStripeEvent(eventId, eventType, livemode, {
          outcome: 'ignored',
          objectId,
          sessionId: session,
          paymentIntentId: intent,
        });
        if (existingEvent) existingEvent.outcome = 'ignored';
        return { duplicate: false, missing: true, enqueued: false, outcome: 'ignored' };
      }

      if (order.stripe_session_id && session && order.stripe_session_id !== session) {
        await store.insertStripeEvent(eventId, eventType, livemode, {
          outcome: 'rejected',
          mismatch: 'session',
          objectId,
          sessionId: session,
          paymentIntentId: intent,
        });
        if (existingEvent) {
          existingEvent.outcome = 'rejected';
          existingEvent.mismatch = 'session';
        }
        return { duplicate: false, mismatch: 'session', enqueued: false, outcome: 'rejected', order };
      }
      if (desiredPayment === 'paid') {
        if (Number(order.amount_minor) !== Number(amountMinor) || String(order.currency).toLowerCase() !== String(currency).toLowerCase()) {
          await store.insertStripeEvent(eventId, eventType, livemode, {
            outcome: 'rejected',
            mismatch: 'amount',
            objectId,
            sessionId: session,
            paymentIntentId: intent,
          });
          if (existingEvent) {
            existingEvent.outcome = 'rejected';
            existingEvent.mismatch = 'amount';
          }
          return { duplicate: false, mismatch: 'amount', enqueued: false, outcome: 'rejected', order };
        }
      }

      const alreadyPaid = order.payment_status === 'paid';
      let nextPayment = order.payment_status;
      if (!alreadyPaid) {
        nextPayment = desiredPayment === 'paid' ? 'paid' : desiredPayment;
      }

      const patch = {
        payment_status: nextPayment,
        stripe_payment_intent_id: intent || order.stripe_payment_intent_id,
        stripe_livemode: livemode,
      };
      if (session) patch.stripe_session_id = session;

      const updated = await store.updateOrder(order.id, patch);

      const shouldEnqueue = !alreadyPaid && nextPayment === 'paid';
      if (shouldEnqueue) {
        await store.enqueueJob({
          orderId: order.id,
          task: 'fulfill',
          dedupeKey: `fulfill:${order.id}`,
        });
        await store.enqueueJob({
          orderId: order.id,
          task: 'email_customer_payment',
          dedupeKey: `email:customer:payment:${order.id}`,
        });
        await store.enqueueJob({
          orderId: order.id,
          task: 'email_owner_payment',
          dedupeKey: `email:owner:payment:${order.id}`,
        });
      }

      await store.insertStripeEvent(eventId, eventType, livemode, {
        outcome: 'accepted',
        objectId,
        sessionId: session,
        paymentIntentId: intent,
      });
      if (existingEvent) existingEvent.outcome = 'accepted';

      return { duplicate: false, enqueued: shouldEnqueue, outcome: 'accepted', order: updated };
    },

    async enqueueJob({ orderId, task, dedupeKey, payload = {}, nextRetryAt }) {
      const existing = jobs.find((job) => job.dedupe_key === dedupeKey);
      if (existing) return existing;
      const job = {
        id: crypto.randomUUID(),
        order_id: orderId,
        task,
        dedupe_key: dedupeKey,
        payload,
        attempts: 0,
        max_attempts: 12,
        next_retry_at: nextRetryAt || nowIso(clock()),
        lease_until: null,
        lease_owner: null,
        status: 'pending',
        outcome: null,
        external_ref: null,
        created_at: nowIso(clock()),
        updated_at: nowIso(clock()),
      };
      jobs.push(job);
      return job;
    },

    async claimJobs(workerId, limit, leaseMs = 55000) {
      const now = clock();
      const due = jobs
        .filter((job) => {
          if (job.status !== 'pending' && job.status !== 'leased') return false;
          if (job.attempts >= (job.max_attempts || 12)) return false;
          if (job.status === 'leased' && job.lease_until && new Date(job.lease_until) > now) return false;
          return new Date(job.next_retry_at) <= now;
        })
        .slice(0, limit);

      due.forEach((job) => {
        job.status = 'leased';
        job.lease_owner = workerId;
        job.lease_until = new Date(now.getTime() + leaseMs).toISOString();
        job.attempts += 1;
        job.updated_at = nowIso(now);
      });
      return due.map((job) => ({ ...job }));
    },

    async completeJob(id, outcome, externalRef) {
      const job = jobs.find((row) => row.id === id);
      if (!job) return null;
      job.status = 'succeeded';
      job.outcome = outcome;
      job.external_ref = externalRef || job.external_ref;
      job.lease_until = null;
      job.updated_at = nowIso(clock());
      return job;
    },

    async failJob(id, outcome, nextRetryAt, terminal = false) {
      const job = jobs.find((row) => row.id === id);
      if (!job) return null;
      job.status = terminal ? 'failed' : 'pending';
      job.outcome = outcome;
      job.next_retry_at = nextRetryAt || nowIso(clock());
      job.lease_until = null;
      job.updated_at = nowIso(clock());
      return job;
    },

    async skipJob(id, outcome) {
      const job = jobs.find((row) => row.id === id);
      if (!job) return null;
      job.status = 'skipped';
      job.outcome = outcome;
      job.lease_until = null;
      job.updated_at = nowIso(clock());
      return job;
    },

    async updateJobPayload(id, payload) {
      const job = jobs.find((row) => row.id === id);
      if (!job) return null;
      job.payload = { ...(job.payload || {}), ...payload };
      job.updated_at = nowIso(clock());
      return job;
    },

    async recordExternalAttempt(row) {
      const attempts = store.externalAttempts || (store.externalAttempts = []);
      attempts.push({ ...row, id: crypto.randomUUID(), created_at: nowIso(clock()) });
      return attempts[attempts.length - 1];
    },

    async purgeRateLimits() {
      rateLimits.clear();
      return { purged: true };
    },

    async operationalSnapshot() {
      return {
        jobsPending: jobs.filter((job) => job.status === 'pending').length,
        jobsFailed: jobs.filter((job) => job.status === 'failed').length,
        jobsLeased: jobs.filter((job) => job.status === 'leased').length,
        unknownSubmissions: orders.filter((row) => row.fulfillment_status === 'submission_unknown').length,
        deferredFulfillment: orders.filter((row) => row.fulfillment_status === 'deferred').length,
        paidUnfulfilled: orders.filter(
          (row) => row.payment_status === 'paid' && !['completed', 'skipped_test_mode'].includes(row.fulfillment_status)
        ).length,
      };
    },

    async getJobByExternalRef(ref) {
      return jobs.find((job) => job.external_ref === ref) || null;
    },

    async getJobById(id) {
      return jobs.find((job) => job.id === id) || null;
    },

    async replayJob(id) {
      const job = jobs.find((row) => row.id === id);
      if (!job) return null;
      job.status = 'pending';
      job.next_retry_at = nowIso(clock());
      job.attempts = Math.max(0, (job.attempts || 1) - 1);
      job.lease_until = null;
      job.updated_at = nowIso(clock());
      return job;
    },

    async recordJobAttempt(row) {
      const attempts = store.jobAttempts || (store.jobAttempts = []);
      attempts.push({ ...row, id: crypto.randomUUID(), created_at: nowIso(clock()) });
      return attempts[attempts.length - 1];
    },

    async insertOperatorAction(row) {
      const actions = store.operatorActions || (store.operatorActions = []);
      const item = { id: crypto.randomUUID(), created_at: nowIso(clock()), ...row };
      actions.push(item);
      return item;
    },

    async consumeRateLimit(bucket, key, limit, windowSec) {
      const windowStart = Math.floor(clock().getTime() / (windowSec * 1000));
      const id = `${bucket}:${key}:${windowStart}`;
      const current = rateLimits.get(id) || { windowStart, count: 0 };
      current.count += 1;
      rateLimits.set(id, current);
      return { allowed: current.count <= limit, count: current.count };
    },

    async cacheGet(key) {
      const entry = cache.get(key);
      if (!entry) return null;
      if (entry.expires && entry.expires < clock().getTime()) return null;
      return entry.value;
    },

    async cacheSet(key, value, ttlMs) {
      cache.set(key, { value, expires: clock().getTime() + ttlMs });
    },

    async listPollingOrders() {
      return orders.filter(
        (row) =>
          row.payment_status === 'paid' &&
          row.provider_order_id &&
          ['submitted', 'in_progress', 'dispatching'].includes(row.fulfillment_status)
      );
    },

    async listAppSecrets() {
      return {};
    },

    async listProducts() {
      return [];
    },
  };

  return store;
}

export { matches };
