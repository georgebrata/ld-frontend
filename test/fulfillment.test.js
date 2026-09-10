import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryStore } from '../supabase/functions/_shared/store-memory.js';
import { fulfillPaidOrder, pollProviderOrders } from '../supabase/functions/_shared/fulfillment.js';
import { processDueJobs } from '../supabase/functions/_shared/jobs.js';
import { SOCIALPANEL24_URL } from '../supabase/functions/_shared/socialpanel24.js';

const fixtures = JSON.parse(
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/socialpanel24.json'), 'utf8')
);

afterEach(() => {
  delete globalThis.fetch;
});

function paidOrder(store, overrides = {}) {
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
    fulfillment_status: 'not_started',
    stripe_livemode: true,
    ...overrides,
  });
}

function env() {
  return {
    SOCIALPANEL24_API_KEY: 'test-key',
    SOCIALPANEL24_ENABLED: 'true',
    PROVIDER_ENV: 'live',
    APP_ENV: 'production',
    RESEND_API_KEY: 're_test',
    FROM_EMAIL: 'orders@like-dealer.com',
    OWNER_EMAIL: 'owner@like-dealer.com',
  };
}

test('paid worker sends expected form fields and stores the provider id', async () => {
  const store = createMemoryStore();
  const order = await paidOrder(store);
  const job = await store.enqueueJob({ orderId: order.id, task: 'fulfill', dedupeKey: `fulfill:${order.id}` });
  let addBody = '';
  let requested = '';
  globalThis.fetch = async (url, init) => {
    requested = String(url);
    addBody = String(init.body);
    return { ok: true, text: async () => JSON.stringify(fixtures.addDefault) };
  };
  const claimed = await store.claimJobs('w1', 1);
  await fulfillPaidOrder(env(), store, order, claimed[0]);
  const saved = await store.getOrderById(order.id);
  assert.equal(saved.provider_order_id, '23501');
  assert.equal(saved.fulfillment_status, 'submitted');
  assert.equal(requested, SOCIALPANEL24_URL);
  assert.equal(requested.includes('key='), false);
  assert.match(addBody, /action=add/);
  assert.match(addBody, /service=11/);
  assert.match(addBody, /quantity=1000/);
});

test('unpaid orders never call add', async () => {
  const store = createMemoryStore();
  const order = await paidOrder(store, { payment_status: 'pending' });
  const job = await store.enqueueJob({ orderId: order.id, task: 'fulfill', dedupeKey: `fulfill:${order.id}` });
  let adds = 0;
  globalThis.fetch = async () => {
    adds += 1;
    return { ok: true, text: async () => JSON.stringify(fixtures.addDefault) };
  };
  await fulfillPaidOrder(env(), store, order, job);
  assert.equal(adds, 0);
});

test('lost add response becomes submission_unknown and is not retried', async () => {
  const store = createMemoryStore();
  const order = await paidOrder(store);
  const job = await store.enqueueJob({ orderId: order.id, task: 'fulfill', dedupeKey: `fulfill:${order.id}` });
  let adds = 0;
  globalThis.fetch = async () => {
    adds += 1;
    return { ok: true, text: async () => '{}' };
  };
  await fulfillPaidOrder(env(), store, order, job);
  const first = await store.getOrderById(order.id);
  assert.equal(first.fulfillment_status, 'submission_unknown');
  const job2 = await store.enqueueJob({
    orderId: order.id,
    task: 'fulfill',
    dedupeKey: `fulfill:${order.id}:2`,
  });
  await fulfillPaidOrder(env(), store, first, job2);
  assert.equal(adds, 1);
});

test('expired lease after dispatching does not add again', async () => {
  const store = createMemoryStore();
  const order = await paidOrder(store, { fulfillment_status: 'dispatching', provider_dispatched_at: new Date().toISOString() });
  const job = await store.enqueueJob({ orderId: order.id, task: 'fulfill', dedupeKey: `fulfill:${order.id}` });
  let adds = 0;
  globalThis.fetch = async () => {
    adds += 1;
    return { ok: true, text: async () => JSON.stringify(fixtures.addDefault) };
  };
  await fulfillPaidOrder(env(), store, order, job);
  assert.equal(adds, 0);
  const saved = await store.getOrderById(order.id);
  assert.equal(saved.fulfillment_status, 'submission_unknown');
});

test('insufficient balance blocks automatic retries', async () => {
  const store = createMemoryStore();
  const order = await paidOrder(store);
  const job = await store.enqueueJob({ orderId: order.id, task: 'fulfill', dedupeKey: `fulfill:${order.id}` });
  globalThis.fetch = async () => ({ ok: true, text: async () => JSON.stringify(fixtures.insufficientBalance) });
  await fulfillPaidOrder(env(), store, order, job);
  const saved = await store.getOrderById(order.id);
  assert.equal(saved.fulfillment_status, 'blocked_balance');
  assert.equal(saved.amount_minor, 180);
});

test('test-mode Stripe never calls the live provider', async () => {
  const store = createMemoryStore();
  const order = await paidOrder(store, { stripe_livemode: false });
  const job = await store.enqueueJob({ orderId: order.id, task: 'fulfill', dedupeKey: `fulfill:${order.id}` });
  let adds = 0;
  globalThis.fetch = async () => {
    adds += 1;
    return { ok: true, text: async () => JSON.stringify(fixtures.addDefault) };
  };
  await fulfillPaidOrder({ ...env(), PROVIDER_ENV: 'live' }, store, order, job);
  assert.equal(adds, 0);
  const saved = await store.getOrderById(order.id);
  assert.equal(saved.fulfillment_status, 'skipped_test_mode');
});

test('default test provider env cannot spend against the live endpoint', async () => {
  const store = createMemoryStore();
  const order = await paidOrder(store, { stripe_livemode: false });
  const job = await store.enqueueJob({ orderId: order.id, task: 'fulfill', dedupeKey: `fulfill:${order.id}` });
  let adds = 0;
  globalThis.fetch = async () => {
    adds += 1;
    return { ok: true, text: async () => JSON.stringify(fixtures.addDefault) };
  };
  await fulfillPaidOrder(
    { SOCIALPANEL24_API_KEY: 'test-key', SOCIALPANEL24_ENABLED: 'true', PROVIDER_ENV: 'test' },
    store,
    order,
    job
  );
  assert.equal(adds, 0);
});

test('disabling the provider defers paid live work instead of skipping it', async () => {
  const store = createMemoryStore();
  const order = await paidOrder(store, { stripe_livemode: true });
  const job = await store.enqueueJob({ orderId: order.id, task: 'fulfill', dedupeKey: `fulfill:${order.id}` });
  let adds = 0;
  globalThis.fetch = async () => {
    adds += 1;
    return { ok: true, text: async () => JSON.stringify(fixtures.addDefault) };
  };
  await fulfillPaidOrder({ ...env(), SOCIALPANEL24_ENABLED: 'false' }, store, order, job);
  assert.equal(adds, 0);
  const saved = await store.getOrderById(order.id);
  assert.equal(saved.fulfillment_status, 'deferred');
  assert.equal(store.jobs.find((j) => j.task === 'fulfill').status, 'pending');
});

test('status polling maps Partial and unknown independently per id', async () => {
  const store = createMemoryStore();
  await paidOrder(store, {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    provider_order_id: '1',
    fulfillment_status: 'submitted',
  });
  await paidOrder(store, {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    checkout_attempt_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    provider_order_id: '100',
    fulfillment_status: 'submitted',
  });
  globalThis.fetch = async () => ({ ok: true, text: async () => JSON.stringify(fixtures.statusBatch) });
  await pollProviderOrders(env(), store);
  const partial = await store.getOrderById('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  const progress = await store.getOrderById('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  assert.equal(partial.fulfillment_status, 'partial');
  assert.equal(progress.fulfillment_status, 'in_progress');
});

test('concurrent workers claim a fulfill job once', async () => {
  const store = createMemoryStore();
  const order = await paidOrder(store);
  await store.enqueueJob({ orderId: order.id, task: 'fulfill', dedupeKey: `fulfill:${order.id}` });
  const a = await store.claimJobs('w1', 10);
  const b = await store.claimJobs('w2', 10);
  assert.equal(a.length, 1);
  assert.equal(b.length, 0);
});

test('email retries are independent of fulfillment jobs', async () => {
  const store = createMemoryStore();
  const order = await paidOrder(store, { provider_order_id: '23501', fulfillment_status: 'submitted' });
  await store.enqueueJob({
    orderId: order.id,
    task: 'email_customer_payment',
    dedupeKey: `email:customer:payment:${order.id}`,
  });
  let mails = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('resend.com')) {
      mails += 1;
      return { ok: false, status: 500, json: async () => ({}) };
    }
    return { ok: true, text: async () => JSON.stringify(fixtures.statusCompleted) };
  };
  await processDueJobs(env(), store, { fetchImpl: globalThis.fetch, limit: 20 });
  const saved = await store.getOrderById(order.id);
  assert.equal(saved.fulfillment_status, 'submitted');
  assert.equal(saved.customer_email_state, 'failed');
  assert.equal(mails, 1);
  assert.equal(store.jobs.find((j) => j.task === 'email_customer_payment').status, 'pending');
});
