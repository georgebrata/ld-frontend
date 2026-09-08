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
        .not('fulfillment_status', 'in', '(completed,failed,cancelled)');
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
  };

  return store;
}
