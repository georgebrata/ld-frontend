import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../supabase/functions/_shared/store-memory.js';
import { executeOperatorCommand, validateOperatorCommand } from '../supabase/functions/_shared/operator.js';

test('unknown operator commands are rejected', () => {
  const result = validateOperatorCommand({ command: 'sql', reason: 'nope', idempotencyKey: 'k1' });
  assert.equal(result.ok, false);
});

test('refund proposals require a bounded amount', () => {
  const result = validateOperatorCommand({
    command: 'propose_refund',
    orderId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    amountMinor: 0,
    reason: 'test',
    idempotencyKey: 'k2',
  });
  assert.equal(result.ok, false);
});

test('unapproved commands are stored as proposals', async () => {
  const store = createMemoryStore();
  const result = await executeOperatorCommand(
    store,
    {
      command: 'provider_kill_switch',
      enabled: false,
      reason: 'incident',
      idempotencyKey: 'k3',
    },
    { approved: false, actor: 'agent' }
  );
  assert.equal(result.status, 202);
  assert.equal(store.operatorActions[0].status, 'proposed');
});

test('provider id attach is limited to submission_unknown', async () => {
  const store = createMemoryStore();
  const order = await store.insertOrder({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    display_id: 'LD-AAAAAA',
    checkout_attempt_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    capability_token_hash: 'hash',
    email: 'a@b.com',
    service_id: '01',
    service_snapshot: {},
    provider_service_id: '11',
    provider_type: 'Default',
    provider_payload: {},
    quantity: 1000,
    billable_quantity: 1000,
    currency: 'USD',
    amount_minor: 180,
    quote_version: 'v',
    rate_unit: 'per_1000',
    retail_rate_minor: 180,
    markup: 2,
    inputs: {},
    params_fingerprint: 'fp',
    payment_status: 'paid',
    fulfillment_status: 'submitted',
  });
  const denied = await executeOperatorCommand(
    store,
    {
      command: 'attach_provider_order_id',
      orderId: order.id,
      providerOrderId: '123',
      reason: 'reconcile',
      idempotencyKey: 'k4',
    },
    { approved: true }
  );
  assert.equal(denied.status, 409);
});

test('approved kill switch is stored for fulfilment to read', async () => {
  const store = createMemoryStore();
  const result = await executeOperatorCommand(
    store,
    {
      command: 'provider_kill_switch',
      enabled: false,
      reason: 'incident',
      idempotencyKey: 'k5-kill',
    },
    { approved: true, actor: 'owner' }
  );
  assert.equal(result.status, 200);
  const flag = await store.cacheGet('ops:provider_kill');
  assert.equal(flag.enabled, false);
});
