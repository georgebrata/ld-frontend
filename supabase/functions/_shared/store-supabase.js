/**
 * Supabase repository. All writes use the service-role client from Edge Functions.
 */

export function createSupabaseStore(client, clock = () => new Date()) {
  const store = {
    async transaction(fn) {
      return fn(store);
    },

    async getOrderById(id) {
      const { data, error } = await client.from('orders').select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      return data;
    },

    async getOrderByAttempt(attemptId) {
      const { data, error } = await client
        .from('orders')
        .select('*')
        .eq('checkout_attempt_id', attemptId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    async getOrderBySession(sessionId) {
      const { data, error } = await client
        .from('orders')
        .select('*')
        .eq('stripe_session_id', sessionId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    async getOrderByTokenHash(hash, lookup) {
      let query = client.from('orders').select('*').eq('capability_token_hash', hash);
      if (lookup.orderId) query = query.eq('id', lookup.orderId);
      else if (lookup.sessionId) query = query.eq('stripe_session_id', lookup.sessionId);
      else if (lookup.attemptId) query = query.eq('checkout_attempt_id', lookup.attemptId);
      else return null;
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      return data;
    },

    async insertOrder(order) {
      const { data, error } = await client.from('orders').insert(order).select('*').single();
      if (error) throw error;
      return data;
    },

    async updateOrder(id, patch) {
      const { data, error } = await client
        .from('orders')
        .update({ ...patch, updated_at: clock().toISOString() })
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw error;
      return data;
    },

    async insertStripeEvent(eventId, eventType, livemode) {
      const { error } = await client.from('stripe_events').insert({
        event_id: eventId,
        event_type: eventType,
        livemode,
      });
      if (error && error.code === '23505') return { duplicate: true };
      if (error) throw error;
      return { duplicate: false };
    },

    async applyPaymentEvent(args) {
      const { data, error } = await client.rpc('apply_stripe_payment_event', {
        p_event_id: args.eventId,
        p_event_type: args.eventType,
        p_livemode: args.livemode,
        p_order_id: args.orderId || null,
        p_session_id: args.sessionId || null,
        p_amount_minor: Number.isInteger(args.amountMinor) ? args.amountMinor : null,
        p_currency: args.currency,
        p_payment_intent_id: args.paymentIntentId || null,
        p_desired_payment: args.desiredPayment,
        p_object_id: args.objectId || null,
      });
      if (error) throw error;
      return data;
    },

    async enqueueJob({ orderId, task, dedupeKey, payload = {}, nextRetryAt }) {
      const { data, error } = await client
        .from('jobs')
        .upsert(
          {
            order_id: orderId,
            task,
            dedupe_key: dedupeKey,
            payload,
            next_retry_at: nextRetryAt || clock().toISOString(),
            status: 'pending',
          },
          { onConflict: 'dedupe_key', ignoreDuplicates: true }
        )
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    async claimJobs(workerId, limit, leaseMs = 55000) {
      const { data, error } = await client.rpc('claim_jobs', {
        p_worker_id: workerId,
        p_limit: limit,
        p_lease_ms: leaseMs,
      });
      if (error) throw error;
      return data || [];
    },

    async completeJob(id, outcome, externalRef) {
      const { data, error } = await client
        .from('jobs')
        .update({
          status: 'succeeded',
          outcome,
          external_ref: externalRef || null,
          lease_until: null,
          updated_at: clock().toISOString(),
        })
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw error;
      return data;
    },

    async failJob(id, outcome, nextRetryAt, terminal = false) {
      const { data, error } = await client
        .from('jobs')
        .update({
          status: terminal ? 'failed' : 'pending',
          outcome,
          next_retry_at: nextRetryAt,
          lease_until: null,
          updated_at: clock().toISOString(),
        })
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw error;
      return data;
    },

    async skipJob(id, outcome) {
      const { data, error } = await client
        .from('jobs')
        .update({
          status: 'skipped',
          outcome,
          lease_until: null,
          updated_at: clock().toISOString(),
        })
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw error;
      return data;
    },

    async updateJobPayload(id, payload) {
      const { data: current, error: readError } = await client.from('jobs').select('payload').eq('id', id).single();
      if (readError) throw readError;
      const next = { ...(current?.payload || {}), ...payload };
      const { data, error } = await client
        .from('jobs')
        .update({ payload: next, updated_at: clock().toISOString() })
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw error;
      return data;
    },

    async recordExternalAttempt(row) {
      const { data, error } = await client
        .from('external_requests')
        .insert({
          order_id: row.orderId || null,
          job_id: row.jobId || null,
          vendor: row.vendor,
          action: row.action,
          fingerprint: row.fingerprint || '',
          idempotency_key: row.idempotencyKey || null,
          attempted_at: row.attemptedAt || clock().toISOString(),
          outcome: row.outcome || 'attempted',
          external_ref: row.externalRef || null,
        })
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    async purgeRateLimits() {
      const cutoff = Math.floor(clock().getTime() / 1000) - 3600;
      const { error } = await client.from('rate_limits').delete().lt('window_start', cutoff);
      if (error) throw error;
      return { purged: true };
    },

    async operationalSnapshot() {
      const { data: jobRows } = await client.from('jobs').select('status');
      const { data: orderRows } = await client.from('orders').select('payment_status, fulfillment_status');
      const jobs = jobRows || [];
      const orders = orderRows || [];
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
      const { data, error } = await client.from('jobs').select('*').eq('external_ref', ref).maybeSingle();
      if (error) throw error;
      return data;
    },

    async getJobById(id) {
      const { data, error } = await client.from('jobs').select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      return data;
    },

    async replayJob(id) {
      const { data: current, error: readError } = await client.from('jobs').select('attempts').eq('id', id).maybeSingle();
      if (readError) throw readError;
      if (!current) return null;
      const { data, error } = await client
        .from('jobs')
        .update({
          status: 'pending',
          next_retry_at: clock().toISOString(),
          attempts: Math.max(0, Number(current.attempts || 1) - 1),
          lease_until: null,
          updated_at: clock().toISOString(),
        })
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw error;
      return data;
    },

    async recordJobAttempt(row) {
      const { data, error } = await client
        .from('job_attempts')
        .insert({
          job_id: row.jobId || null,
          order_id: row.orderId || null,
          task: row.task || '',
          attempt: row.attempt || 0,
          outcome: row.outcome || 'claimed',
          correlation_id: row.correlationId || null,
        })
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    async insertOperatorAction(row) {
      const { data, error } = await client
        .from('operator_actions')
        .upsert(
          {
            command: row.command,
            payload: row.payload || {},
            status: row.status,
            actor: row.actor || null,
            approver: row.approver || null,
            idempotency_key: row.idempotencyKey,
            executed_at: row.status === 'executed' ? clock().toISOString() : null,
          },
          { onConflict: 'idempotency_key' }
        )
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    async consumeRateLimit(bucket, key, limit, windowSec) {
      const { data, error } = await client.rpc('consume_rate_limit', {
        p_bucket: bucket,
        p_key: key,
        p_limit: limit,
        p_window_sec: windowSec,
      });
      if (error) throw error;
      return data;
    },

    async cacheGet(key) {
      const { data, error } = await client.from('catalogue_cache').select('*').eq('cache_key', key).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      if (data.expires_at && new Date(data.expires_at).getTime() < clock().getTime()) return null;
      return data.payload;
    },

    async cacheSet(key, value, ttlMs) {
      const expires = new Date(clock().getTime() + ttlMs).toISOString();
      const { error } = await client.from('catalogue_cache').upsert({
        cache_key: key,
        payload: value,
        fetched_at: clock().toISOString(),
        expires_at: expires,
      });
      if (error) throw error;
    },

    async listPollingOrders() {
      const { data, error } = await client
        .from('orders')
        .select('*')
        .eq('payment_status', 'paid')
        .not('provider_order_id', 'is', null)
        .in('fulfillment_status', ['submitted', 'in_progress', 'dispatching'])
        .limit(100);
      if (error) throw error;
      return data || [];
    },

    async listProducts() {
      const { data, error } = await client
        .from('products')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('id', { ascending: true });
      if (error) throw error;
      return data || [];
    },

    async listAppSecrets() {
      const { data, error } = await client.from('app_secrets').select('name, value');
      if (error) throw error;
      /** @type {Record<string, string>} */
      const extra = {};
      (data || []).forEach((row) => {
        if (row?.name && row?.value) extra[row.name] = String(row.value);
      });
      return extra;
    },

    async getAdminUser(userId) {
      const { data, error } = await client.from('admin_users').select('*').eq('user_id', userId).maybeSingle();
      if (error) throw error;
      return data;
    },

    async countAdmins() {
      const { count, error } = await client
        .from('admin_users')
        .select('user_id', { count: 'exact', head: true })
        .is('disabled_at', null);
      if (error) throw error;
      return Number(count || 0);
    },

    async insertAdminUser(row) {
      const { data, error } = await client
        .from('admin_users')
        .insert({
          user_id: row.user_id,
          email: row.email,
          role: row.role || 'admin',
          disabled_at: row.disabled_at || null,
        })
        .select('*')
        .single();
      if (error) throw error;
      return data;
    },

    async getFlag(name) {
      const { data, error } = await client.from('app_flags').select('*').eq('name', name).maybeSingle();
      if (error) throw error;
      return data;
    },

    async setFlag(name, enabled) {
      const { data, error } = await client
        .from('app_flags')
        .upsert({ name, enabled: Boolean(enabled), updated_at: clock().toISOString() }, { onConflict: 'name' })
        .select('*')
        .single();
      if (error) throw error;
      return data;
    },

    async getProduct(id) {
      const { data, error } = await client.from('products').select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      return data;
    },

    async upsertProduct(row) {
      const { data, error } = await client.from('products').upsert(row, { onConflict: 'id' }).select('*').single();
      if (error) throw error;
      return data;
    },

    async deleteProduct(id) {
      const { data, error } = await client.from('products').delete().eq('id', id).select('*').maybeSingle();
      if (error) throw error;
      return data;
    },

    async bulkUpdateSortOrder(items) {
      const updates = Array.isArray(items) ? items : [];
      /** @type {any[]} */
      const next = [];
      for (const item of updates) {
        const { data, error } = await client
          .from('products')
          .update({ sort_order: item.sort_order })
          .eq('id', item.id)
          .select('*')
          .maybeSingle();
        if (error) throw error;
        if (data) next.push(data);
      }
      return next;
    },

    async insertProductAudit(row) {
      const { data, error } = await client
        .from('product_audit')
        .insert({
          actor_user_id: row.actor_user_id || null,
          actor_email: row.actor_email || null,
          action: row.action,
          product_id: row.product_id || null,
          before: row.before || null,
          after: row.after || null,
        })
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  };

  return store;
}
