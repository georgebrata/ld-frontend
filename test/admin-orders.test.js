import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryStore } from '../supabase/functions/_shared/store-memory.js';
import { handleAdminAction } from '../supabase/functions/_shared/admin.js';
import { ORDER_FIELDS, parseOrderQuery, toAdminOrder } from '../supabase/functions/_shared/admin-orders.js';
import { JOB_TASKS } from '../supabase/functions/_shared/jobs.js';

const fixtures = JSON.parse(
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/socialpanel24.json'), 'utf8')
);

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

function fetchProvider() {
  return async () => ({
    ok: true,
    text: async () => JSON.stringify(fixtures.services),
  });
}

async function withAdmin(store, user = { id: 'admin-1', email: 'ops@like-dealer.com' }) {
  await store.insertAdminUser({ user_id: user.id, email: user.email, role: 'admin' });
  return {
    request: request({ Authorization: 'Bearer valid-token' }),
    getUser: async (token) => (token === 'valid-token' ? user : null),
    fetchImpl: fetchProvider(),
  };
}

function sampleOrder(overrides = {}) {
  const n = overrides._n || 1;
  delete overrides._n;
  const id = overrides.id || `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${n}`;
  return {
    id,
    display_id: overrides.display_id || `LD-00000${n}`,
    checkout_attempt_id: overrides.checkout_attempt_id || `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb${n}`,
    capability_token_hash: 'secret-hash-must-not-leak',
    email: overrides.email || `user${n}@example.com`,
    service_id: '01',
    service_snapshot: { label: 'Instagram Likes', platform: 'instagram' },
    provider_service_id: '11',
    provider_type: 'Default',
    provider_payload: { link: 'https://instagram.com/p/x', quantity: '1000' },
    quantity: 1000,
    billable_quantity: 1000,
    currency: 'USD',
    amount_minor: 180 + n,
    quote_version: 'v1',
    rate_unit: 'per_1000',
    retail_rate_minor: 90,
    markup: 2,
    inputs: { url: 'https://instagram.com/p/x' },
    params_fingerprint: 'fp',
    payment_status: 'paid',
    fulfillment_status: 'completed',
    stripe_session_id: `cs_test_${n}`,
    stripe_payment_intent_id: `pi_test_${n}`,
    stripe_livemode: true,
    checkout_revision: 1,
    provider_order_id: String(20000 + n),
    created_at: new Date(1_700_000_000_000 + n * 1000).toISOString(),
    updated_at: new Date(1_700_000_000_000 + n * 1000).toISOString(),
    customer_email_state: 'sent',
    ...overrides,
  };
}

const liveEnv = {
  SOCIALPANEL24_API_KEY: 'k',
  SOCIALPANEL24_ENABLED: 'true',
  PROVIDER_ENV: 'live',
  APP_ENV: 'production',
  RETAIL_CURRENCY: 'USD',
};

test('JOB_TASKS matches the admin_orders jobs_task_check constraint', () => {
  const sql = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../supabase/migrations/20260912000001_admin_orders.sql'),
    'utf8'
  );
  for (const task of JOB_TASKS) {
    assert.match(sql, new RegExp(`'${task}'`));
  }
  assert.match(sql, /provider_refill/);
  assert.match(sql, /poll_refill_status/);
});

test('parseOrderQuery accepts every sortable field and rejects an unknown column', () => {
  for (const [name, spec] of Object.entries(ORDER_FIELDS)) {
    if (!spec.sortable) continue;
    const parsed = parseOrderQuery({ sort: name, dir: 'asc' });
    assert.equal(parsed.ok, true, name);
    assert.equal(parsed.value.sort, name);
  }
  const bad = parseOrderQuery({ sort: 'capability_token_hash' });
  assert.equal(bad.ok, false);
  const unknown = parseOrderQuery({ filters: [{ field: 'not_a_column', op: 'eq', value: 'x' }] });
  assert.equal(unknown.ok, false);
});

test('unauthenticated orders.list is rejected', async () => {
  const store = createMemoryStore();
  const result = await handleAdminAction({ env: {}, store }, { action: 'orders.list' }, { request: request() });
  assert.equal(result.status, 401);
});

test('a non-admin JWT cannot list orders', async () => {
  const store = createMemoryStore();
  await store.insertAdminUser({ user_id: 'admin-1', email: 'ops@like-dealer.com' });
  const result = await handleAdminAction(
    { env: {}, store },
    { action: 'orders.list' },
    {
      request: request({ Authorization: 'Bearer stranger' }),
      getUser: async () => ({ id: 'not-admin', email: 'a@b.com' }),
    }
  );
  assert.equal(result.status, 403);
});

test('orders.list paginates and hides capability_token_hash', async () => {
  const store = createMemoryStore();
  for (let n = 1; n <= 3; n += 1) await store.insertOrder(sampleOrder({ _n: n }));
  const extras = await withAdmin(store);
  const result = await handleAdminAction(
    { env: liveEnv, store },
    { action: 'orders.list', page: 2, pageSize: 1, sort: 'created_at', dir: 'asc' },
    extras
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.total, 3);
  assert.equal(result.body.page, 2);
  assert.equal(result.body.rows.length, 1);
  assert.equal(result.body.rows[0].display_id, 'LD-000002');
  assert.equal(result.body.rows[0].capability_token_hash, undefined);
  assert.equal('capability_token_hash' in result.body.rows[0], false);
});

test('orders.list sorts declared sortable columns', async () => {
  const store = createMemoryStore();
  await store.insertOrder(sampleOrder({ _n: 1, email: 'b@example.com', amount_minor: 50 }));
  await store.insertOrder(sampleOrder({ _n: 2, email: 'a@example.com', amount_minor: 90 }));
  const extras = await withAdmin(store);
  const byEmail = await handleAdminAction(
    { env: liveEnv, store },
    { action: 'orders.list', sort: 'email', dir: 'asc' },
    extras
  );
  assert.equal(byEmail.status, 200);
  assert.deepEqual(
    byEmail.body.rows.map((row) => row.email),
    ['a@example.com', 'b@example.com']
  );
  const byAmount = await handleAdminAction(
    { env: liveEnv, store },
    { action: 'orders.list', sort: 'amount_minor', dir: 'desc' },
    extras
  );
  assert.deepEqual(
    byAmount.body.rows.map((row) => row.amount_minor),
    [90, 50]
  );
});

test('orders.list applies eq, contains, in, gte, lte, and is_null filters', async () => {
  const store = createMemoryStore();
  await store.insertOrder(
    sampleOrder({
      _n: 1,
      email: 'alpha@example.com',
      payment_status: 'paid',
      amount_minor: 100,
      stripe_livemode: true,
      provider_refill_status: null,
    })
  );
  await store.insertOrder(
    sampleOrder({
      _n: 2,
      email: 'beta@example.com',
      payment_status: 'pending',
      amount_minor: 500,
      stripe_livemode: false,
      provider_refill_status: 'requested',
    })
  );
  const extras = await withAdmin(store);

  const eq = await handleAdminAction(
    { env: liveEnv, store },
    { action: 'orders.list', filters: [{ field: 'email', op: 'eq', value: 'alpha@example.com' }] },
    extras
  );
  assert.equal(eq.body.total, 1);
  assert.equal(eq.body.rows[0].email, 'alpha@example.com');

  const contains = await handleAdminAction(
    { env: liveEnv, store },
    { action: 'orders.list', filters: [{ field: 'email', op: 'contains', value: 'beta' }] },
    extras
  );
  assert.equal(contains.body.total, 1);
  assert.equal(contains.body.rows[0].email, 'beta@example.com');

  const inn = await handleAdminAction(
    { env: liveEnv, store },
    { action: 'orders.list', filters: [{ field: 'payment_status', op: 'in', value: ['pending'] }] },
    extras
  );
  assert.equal(inn.body.total, 1);

  const gte = await handleAdminAction(
    { env: liveEnv, store },
    { action: 'orders.list', filters: [{ field: 'amount_minor', op: 'gte', value: 400 }] },
    extras
  );
  assert.equal(gte.body.total, 1);
  assert.equal(gte.body.rows[0].amount_minor, 500);

  const lte = await handleAdminAction(
    { env: liveEnv, store },
    { action: 'orders.list', filters: [{ field: 'amount_minor', op: 'lte', value: 100 }] },
    extras
  );
  assert.equal(lte.body.total, 1);

  const isNull = await handleAdminAction(
    { env: liveEnv, store },
    { action: 'orders.list', filters: [{ field: 'provider_refill_status', op: 'is_null', value: true }] },
    extras
  );
  assert.equal(isNull.body.total, 1);
  assert.equal(isNull.body.rows[0].email, 'alpha@example.com');
});

test('toAdminOrder omits capability_token_hash and includes status fields', () => {
  const projected = toAdminOrder(sampleOrder({ _n: 1 }));
  assert.equal(projected.capability_token_hash, undefined);
  assert.equal(projected.payment_status, 'paid');
  assert.equal(projected.fulfillment_status, 'completed');
  assert.equal(projected.email, 'user1@example.com');
});

test('orders.get returns every projected field plus timeline and refill eligibility', async () => {
  const store = createMemoryStore();
  const order = await store.insertOrder(sampleOrder({ _n: 1 }));
  const extras = await withAdmin(store);
  const result = await handleAdminAction(
    { env: liveEnv, store },
    { action: 'orders.get', orderId: order.id },
    extras
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.order.display_id, 'LD-000001');
  assert.equal('capability_token_hash' in result.body.order, false);
  assert.equal(Array.isArray(result.body.events), true);
  assert.equal(result.body.events.length >= 1, true);
  assert.equal(result.body.refill.eligible, true);
  for (const name of Object.keys(ORDER_FIELDS)) {
    assert.equal(name in result.body.order, true, name);
  }
});

test('orders.refill enqueues a provider_refill job', async () => {
  const store = createMemoryStore();
  const order = await store.insertOrder(sampleOrder({ _n: 1 }));
  const extras = await withAdmin(store);
  const result = await handleAdminAction(
    { env: liveEnv, store },
    { action: 'orders.refill', orderId: order.id },
    extras
  );
  assert.equal(result.status, 202);
  const saved = await store.getOrderById(order.id);
  assert.equal(saved.provider_refill_status, 'requested');
  assert.equal(store.jobs.some((job) => job.task === 'provider_refill'), true);
  const again = await handleAdminAction(
    { env: liveEnv, store },
    { action: 'orders.refill', orderId: order.id },
    extras
  );
  assert.equal(again.status, 409);
});
