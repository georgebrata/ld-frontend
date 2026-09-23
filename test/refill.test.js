import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryStore } from '../supabase/functions/_shared/store-memory.js';
import { handleAdminAction } from '../supabase/functions/_shared/admin.js';
import { processDueJobs } from '../supabase/functions/_shared/jobs.js';
import { refillEligibility, requestOrderRefill } from '../supabase/functions/_shared/refill.js';
import { SOCIALPANEL24_URL } from '../supabase/functions/_shared/socialpanel24.js';
import { clearCatalogueMemory } from '../supabase/functions/_shared/catalogue.js';

const fixtures = JSON.parse(
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/socialpanel24.json'), 'utf8')
);

afterEach(() => {
  delete globalThis.fetch;
  clearCatalogueMemory();
});

function request(headers = {}) {
  return {
    headers: {
      get(name) {
        const key = Object.keys(headers).find((item) => item.toLowerCase() === name.toLowerCase());
        return key ? headers[key] : null;
      },
    },
  };
}

function liveEnv() {
  return {
    SOCIALPANEL24_API_KEY: 'test-key',
    SOCIALPANEL24_ENABLED: 'true',
    PROVIDER_ENV: 'live',
    APP_ENV: 'production',
  };
}

function completedOrder(store, overrides = {}) {
  return store.insertOrder({
    id: overrides.id || 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    display_id: 'LD-AAAAAA',
    checkout_attempt_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    capability_token_hash: 'hash',
    email: 'a@b.com',
    service_id: '01',
    service_snapshot: { label: 'Instagram Likes' },
    provider_service_id: '11',
    provider_type: 'Default',
    provider_payload: { link: 'https://instagram.com/p/x', quantity: '1000' },
    quantity: 1000,
    billable_quantity: 1000,
    currency: 'USD',
    amount_minor: 180,
    quote_version: 'v',
    rate_unit: 'per_1000',
    retail_rate_minor: 180,
    markup: 2,
    inputs: { url: 'https://instagram.com/p/x' },
    params_fingerprint: 'fp',
    payment_status: 'paid',
    fulfillment_status: 'completed',
    stripe_livemode: true,
    provider_order_id: '23501',
    ...overrides,
  });
}

async function withAdmin(store) {
  await store.insertAdminUser({ user_id: 'admin-1', email: 'ops@like-dealer.com', role: 'admin' });
  return {
    request: request({ Authorization: 'Bearer valid-token' }),
    getUser: async (token) => (token === 'valid-token' ? { id: 'admin-1', email: 'ops@like-dealer.com' } : null),
    fetchImpl: async () => ({
      ok: true,
      text: async () => JSON.stringify(fixtures.services),
    }),
  };
}

test('eligibility matrix blocks unpaid, missing id, wrong status, no refill flag, in-flight, unknown, and test stripe', async () => {
  const store = createMemoryStore();
  const extras = { fetchImpl: async () => ({ ok: true, text: async () => JSON.stringify(fixtures.services) }) };
  const env = liveEnv();

  const unpaid = await completedOrder(store, { payment_status: 'pending' });
  assert.equal((await refillEligibility(env, store, unpaid, extras)).reason, 'not_paid');

  const missing = await completedOrder(store, {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    checkout_attempt_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    provider_order_id: null,
  });
  assert.equal((await refillEligibility(env, store, missing, extras)).reason, 'missing_provider_order');

  const wrongStatus = await completedOrder(store, {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
    checkout_attempt_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
    fulfillment_status: 'submitted',
  });
  assert.equal((await refillEligibility(env, store, wrongStatus, extras)).reason, 'not_refillable_status');

  const noFlag = await completedOrder(store, {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
    checkout_attempt_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4',
    provider_service_id: '22',
  });
  assert.equal((await refillEligibility(env, store, noFlag, extras)).reason, 'refill_not_supported');

  const inFlight = await completedOrder(store, {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
    checkout_attempt_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5',
    provider_refill_status: 'requested',
  });
  assert.equal((await refillEligibility(env, store, inFlight, extras)).reason, 'refill_in_flight');

  const unknown = await completedOrder(store, {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6',
    checkout_attempt_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb6',
    provider_refill_status: 'unknown',
  });
  assert.equal((await refillEligibility(env, store, unknown, extras)).reason, 'refill_unknown');

  const testStripe = await completedOrder(store, {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7',
    checkout_attempt_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb7',
    stripe_livemode: false,
  });
  assert.equal((await refillEligibility(env, store, testStripe, extras)).reason, 'test_stripe');

  const ok = await completedOrder(store, {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8',
    checkout_attempt_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb8',
  });
  const eligible = await refillEligibility(env, store, ok, extras);
  assert.equal(eligible.eligible, true);
});

test('admin refill is refused when the dispatch gate blocks and never calls the provider', async () => {
  const store = createMemoryStore();
  const order = await completedOrder(store, { stripe_livemode: false });
  const extras = await withAdmin(store);
  let calls = 0;
  extras.fetchImpl = async () => {
    calls += 1;
    return { ok: true, text: async () => JSON.stringify(fixtures.services) };
  };
  const result = await handleAdminAction(
    { env: liveEnv(), store },
    { action: 'orders.refill', orderId: order.id },
    extras
  );
  assert.equal(result.status, 409);
  assert.equal(result.body.error, 'test_stripe');
  assert.equal(
    store.jobs.filter((job) => job.task === 'provider_refill').length,
    0
  );
  assert.equal(calls, 0);
});

test('refill worker posts action=refill without putting the key in the URL', async () => {
  const store = createMemoryStore();
  const order = await completedOrder(store, { provider_refill_status: 'requested' });
  const job = await store.enqueueJob({
    orderId: order.id,
    task: 'provider_refill',
    dedupeKey: `refill:${order.id}:1`,
  });
  let requested = '';
  let body = '';
  globalThis.fetch = async (url, init) => {
    requested = String(url);
    body = String(init.body);
    return { ok: true, text: async () => JSON.stringify(fixtures.refillAccepted) };
  };
  const claimed = await store.claimJobs('w1', 1);
  await requestOrderRefill(liveEnv(), store, order, claimed[0] || job);
  const saved = await store.getOrderById(order.id);
  assert.equal(saved.provider_refill_id, '99001');
  assert.equal(saved.provider_refill_status, 'pending');
  assert.equal(requested, SOCIALPANEL24_URL);
  assert.equal(requested.includes('key='), false);
  assert.match(body, /action=refill/);
  assert.match(body, /order=23501/);
  assert.equal(store.jobs.some((item) => item.task === 'poll_refill_status'), true);
  assert.equal(store.externalAttempts.some((item) => item.action === 'refill'), true);
});

test('ambiguous refill outcome becomes unknown and is not retried', async () => {
  const store = createMemoryStore();
  const order = await completedOrder(store, { provider_refill_status: 'requested' });
  const job = await store.enqueueJob({
    orderId: order.id,
    task: 'provider_refill',
    dedupeKey: `refill:${order.id}:1`,
  });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: true, text: async () => '{}' };
  };
  await requestOrderRefill(liveEnv(), store, order, job);
  const first = await store.getOrderById(order.id);
  assert.equal(first.provider_refill_status, 'unknown');
  const job2 = await store.enqueueJob({
    orderId: order.id,
    task: 'provider_refill',
    dedupeKey: `refill:${order.id}:2`,
  });
  await requestOrderRefill(liveEnv(), store, first, job2);
  assert.equal(calls, 1);
});

test('processDueJobs runs a refill job and then polls refill_status', async () => {
  const store = createMemoryStore();
  const order = await completedOrder(store, { provider_refill_status: 'requested' });
  await store.enqueueJob({
    orderId: order.id,
    task: 'provider_refill',
    dedupeKey: `refill:${order.id}:1`,
  });
  let refillBody = '';
  let statusBody = '';
  globalThis.fetch = async (url, init) => {
    const body = String(init.body);
    if (body.includes('action=refill_status')) {
      statusBody = body;
      return { ok: true, text: async () => JSON.stringify(fixtures.refillStatusCompleted) };
    }
    refillBody = body;
    return { ok: true, text: async () => JSON.stringify(fixtures.refillAccepted) };
  };
  await processDueJobs(liveEnv(), store, { fetchImpl: globalThis.fetch, limit: 20 });
  assert.match(refillBody, /action=refill/);
  const afterAdd = await store.getOrderById(order.id);
  assert.equal(afterAdd.provider_refill_id, '99001');
  await processDueJobs(liveEnv(), store, { fetchImpl: globalThis.fetch, limit: 20 });
  assert.match(statusBody, /action=refill_status/);
  assert.match(statusBody, /refill=99001/);
  const saved = await store.getOrderById(order.id);
  assert.equal(saved.provider_refill_status, 'completed');
});
