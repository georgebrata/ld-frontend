import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createMemoryStore } from '../supabase/functions/_shared/store-memory.js';
import { handleStripeWebhook } from '../supabase/functions/_shared/webhook.js';
import { isCheckoutSessionId, isPaymentIntentId, verifyStripeSignature } from '../supabase/functions/_shared/stripe.js';
import { publicUiState } from '../supabase/functions/_shared/states.js';

const SECRET = 'whsec_test';

afterEach(() => {
  delete globalThis.fetch;
});

function sign(body, secret = SECRET, timestamp = String(Math.floor(Date.now() / 1000))) {
  const v1 = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

function seedOrder(store, overrides = {}) {
  const order = {
    id: '11111111-1111-4111-8111-111111111111',
    display_id: 'LD-111111',
    checkout_attempt_id: '22222222-2222-4222-8222-222222222222',
    capability_token_hash: 'abc',
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
    quote_version: '01:1000:180:USD:per_1000',
    rate_unit: 'per_1000',
    retail_rate_minor: 180,
    markup: 2,
    inputs: { url: 'https://instagram.com/p/x' },
    params_fingerprint: 'fp',
    payment_status: 'pending',
    fulfillment_status: 'not_started',
    stripe_session_id: 'cs_test',
    ...overrides,
  };
  return store.insertOrder(order);
}

test('events without a stored order are ignored after the signature checks', async () => {
  const payload = JSON.stringify({
    id: 'evt_unknown_session',
    type: 'checkout.session.expired',
    livemode: false,
    data: { object: { id: 'cs_unknown', payment_status: 'unpaid' } },
  });
  const result = await handleStripeWebhook(
    { STRIPE_WEBHOOK_SECRET: SECRET },
    createMemoryStore(),
    payload,
    sign(payload)
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.missing, true);
});

test('invalid signatures are rejected', async () => {
  const valid = await verifyStripeSignature('{}', 't=1,v1=nope', SECRET);
  assert.equal(valid, false);
  const result = await handleStripeWebhook(
    { STRIPE_WEBHOOK_SECRET: SECRET },
    createMemoryStore(),
    '{}',
    't=1,v1=nope'
  );
  assert.equal(result.status, 400);
});

test('unpaid checkout.session.completed does not mark paid or enqueue jobs', async () => {
  const store = createMemoryStore();
  await seedOrder(store);
  const payload = JSON.stringify({
    id: 'evt_unpaid',
    type: 'checkout.session.completed',
    livemode: false,
    data: {
      object: {
        id: 'cs_test',
        payment_status: 'unpaid',
        amount_total: 180,
        currency: 'usd',
        metadata: { internalOrderId: '11111111-1111-4111-8111-111111111111' },
      },
    },
  });
  const result = await handleStripeWebhook({ STRIPE_WEBHOOK_SECRET: SECRET }, store, payload, sign(payload));
  assert.equal(result.status, 200);
  const order = await store.getOrderById('11111111-1111-4111-8111-111111111111');
  assert.equal(order.payment_status, 'pending');
  assert.equal(store.jobs.length, 0);
});

test('paid event enqueues fulfill + emails once; duplicates and out-of-order failures cannot downgrade', async () => {
  const store = createMemoryStore();
  await seedOrder(store);
  const payload = JSON.stringify({
    id: 'evt_paid',
    type: 'checkout.session.completed',
    livemode: false,
    data: {
      object: {
        id: 'cs_test',
        payment_status: 'paid',
        amount_total: 180,
        currency: 'usd',
        payment_intent: 'pi_1',
        metadata: { internalOrderId: '11111111-1111-4111-8111-111111111111' },
      },
    },
  });
  const header = sign(payload);
  const first = await handleStripeWebhook({ STRIPE_WEBHOOK_SECRET: SECRET }, store, payload, header);
  const second = await handleStripeWebhook({ STRIPE_WEBHOOK_SECRET: SECRET }, store, payload, header);
  assert.equal(first.status, 200);
  assert.equal(first.body.enqueued, true);
  assert.equal(second.body.duplicate, true);
  assert.equal(store.jobs.filter((j) => j.task === 'fulfill').length, 1);

  const failPayload = JSON.stringify({
    id: 'evt_fail_later',
    type: 'checkout.session.expired',
    livemode: false,
    data: {
      object: {
        id: 'cs_test',
        metadata: { internalOrderId: '11111111-1111-4111-8111-111111111111' },
      },
    },
  });
  await handleStripeWebhook({ STRIPE_WEBHOOK_SECRET: SECRET }, store, failPayload, sign(failPayload));
  const order = await store.getOrderById('11111111-1111-4111-8111-111111111111');
  assert.equal(order.payment_status, 'paid');
});

test('amount mismatch cannot produce false payment success', async () => {
  const store = createMemoryStore();
  await seedOrder(store);
  const payload = JSON.stringify({
    id: 'evt_amt',
    type: 'checkout.session.completed',
    livemode: false,
    data: {
      object: {
        object: 'checkout.session',
        id: 'cs_test',
        payment_status: 'paid',
        amount_total: 1,
        currency: 'usd',
        metadata: { internalOrderId: '11111111-1111-4111-8111-111111111111' },
      },
    },
  });
  const result = await handleStripeWebhook({ STRIPE_WEBHOOK_SECRET: SECRET }, store, payload, sign(payload));
  assert.equal(result.status, 409);
  const order = await store.getOrderById('11111111-1111-4111-8111-111111111111');
  assert.equal(order.payment_status, 'pending');
  assert.equal(order.stripe_session_id, 'cs_test');
});

test('payment_intent.payment_failed does not overwrite the Checkout Session id', async () => {
  const store = createMemoryStore();
  await seedOrder(store);
  const payload = JSON.stringify({
    id: 'evt_pi_fail',
    type: 'payment_intent.payment_failed',
    livemode: false,
    data: {
      object: {
        object: 'payment_intent',
        id: 'pi_failed_card',
        amount: 180,
        currency: 'usd',
        metadata: { internalOrderId: '11111111-1111-4111-8111-111111111111' },
      },
    },
  });
  const result = await handleStripeWebhook({ STRIPE_WEBHOOK_SECRET: SECRET }, store, payload, sign(payload));
  assert.equal(result.status, 200);
  const order = await store.getOrderById('11111111-1111-4111-8111-111111111111');
  assert.equal(order.payment_status, 'failed');
  assert.equal(order.stripe_session_id, 'cs_test');
  assert.equal(order.stripe_payment_intent_id, 'pi_failed_card');

  const paid = JSON.stringify({
    id: 'evt_paid_after_fail',
    type: 'checkout.session.completed',
    livemode: false,
    data: {
      object: {
        object: 'checkout.session',
        id: 'cs_test',
        payment_status: 'paid',
        amount_total: 180,
        currency: 'usd',
        payment_intent: 'pi_success',
        metadata: { internalOrderId: '11111111-1111-4111-8111-111111111111' },
      },
    },
  });
  const paidResult = await handleStripeWebhook({ STRIPE_WEBHOOK_SECRET: SECRET }, store, paid, sign(paid));
  assert.equal(paidResult.status, 200);
  const after = await store.getOrderById('11111111-1111-4111-8111-111111111111');
  assert.equal(after.payment_status, 'paid');
  assert.equal(after.stripe_session_id, 'cs_test');
});

test('stale Stripe signatures are rejected', async () => {
  const payload = '{}';
  const stale = sign(payload, SECRET, '1700000000');
  const result = await handleStripeWebhook({ STRIPE_WEBHOOK_SECRET: SECRET }, createMemoryStore(), payload, stale);
  assert.equal(result.status, 400);
});

test('rejected mismatch events remain replayable and do not become duplicates', async () => {
  const store = createMemoryStore();
  await seedOrder(store);
  const payload = JSON.stringify({
    id: 'evt_wrong_session',
    type: 'checkout.session.completed',
    livemode: false,
    data: {
      object: {
        object: 'checkout.session',
        id: 'cs_other',
        payment_status: 'paid',
        amount_total: 180,
        currency: 'usd',
        metadata: { internalOrderId: '11111111-1111-4111-8111-111111111111' },
      },
    },
  });
  const first = await handleStripeWebhook({ STRIPE_WEBHOOK_SECRET: SECRET }, store, payload, sign(payload));
  const second = await handleStripeWebhook({ STRIPE_WEBHOOK_SECRET: SECRET }, store, payload, sign(payload));
  assert.equal(first.status, 409);
  assert.equal(second.status, 409);
  assert.equal(second.body.duplicate, undefined);
});

test('UI state keeps unknown unknown and does not infer email from payment', () => {
  assert.equal(publicUiState({ paymentStatus: 'pending', fulfillmentStatus: 'not_started' }), 'awaiting_confirmation');
  assert.equal(publicUiState({ paymentStatus: 'paid', fulfillmentStatus: 'not_started' }), 'payment_received');
  assert.equal(publicUiState({ paymentStatus: 'paid', fulfillmentStatus: 'completed' }), 'completed');
  assert.equal(publicUiState({ paymentStatus: 'mystery', fulfillmentStatus: 'mystery' }), 'unknown');
});

test('Stripe object ids accept test prefixes with underscores', () => {
  assert.equal(isCheckoutSessionId('cs_test_a1B2'), true);
  assert.equal(isPaymentIntentId('pi_failed_card'), true);
  assert.equal(isCheckoutSessionId('pi_failed_card'), false);
});
