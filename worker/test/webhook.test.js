import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { handleStripeWebhook, processPaidSession } from '../src/webhook.js';
import { verifyStripeSignature } from '../src/stripe.js';
import { memoryStore } from './helpers.js';
import { orderKey } from '../src/store.js';

const SECRET = 'whsec_test';
const env = {
  SITE_URL: 'https://like-dealer.com',
  STRIPE_WEBHOOK_SECRET: SECRET,
  ORDERS_API_URL: 'https://script.google.com/macros/s/test/exec',
  SOCIAL_PANEL_API_URL: 'https://socialpanel24.com/api/v2',
  SOCIAL_PANEL_API_KEY: 'sp-key',
  MAILERSEND_API_TOKEN: 'token',
  FROM_EMAIL: 'orders@like-dealer.com',
  OWNER_EMAIL: 'owner@like-dealer.com',
  FROM_NAME: 'LikeDealer',
};

afterEach(() => {
  delete globalThis.fetch;
});

function sign(body, secret = SECRET, timestamp = '1700000000') {
  const v1 = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

function paidOrder(overrides = {}) {
  return {
    id: 'ord_1',
    displayId: 'LD-ABC123',
    status: 'payment_pending',
    customerEmail: 'a@b.com',
    service: 'Instagram Likes',
    serviceId: '01',
    platform: 'instagram',
    quantity: 1000,
    url: 'https://instagram.com/p/x',
    inputs: { url: 'https://instagram.com/p/x' },
    socialPanelId: '11',
    amountCents: 180,
    stripeSessionId: 'cs_test',
    stripePaymentIntentId: '',
    socialPanelOrderId: '',
    stripeEventId: '',
    fulfilmentAttempted: false,
    customerEmailStatus: 'pending',
    ownerEmailStatus: 'pending',
    ...overrides,
  };
}

function installFetch(options = {}) {
  const calls = { add: 0, mail: 0 };
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    const body = String(init?.body ?? '');
    if (href.includes('mailersend')) {
      calls.mail += 1;
      if (options.mailOk === false) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, status: 202, json: async () => ({}) };
    }
    if (href.includes('socialpanel24.com') || href.includes('api/v2')) {
      if (body.includes('action=services')) {
        return {
          ok: true,
          json: async () => [{ service: '11', rate: '0.90', min: '50', max: '10000' }],
        };
      }
      if (body.includes('action=add')) {
        calls.add += 1;
        if (options.addLost) return { ok: true, json: async () => ({}) };
        return { ok: true, json: async () => ({ order: '99' }) };
      }
    }
    return { ok: true, json: async () => ({ ok: true }) };
  };
  return calls;
}

test('bad webhook signatures are rejected', async () => {
  const valid = await verifyStripeSignature('{}', 't=1,v1=nope', SECRET);
  assert.equal(valid, false);

  const response = await handleStripeWebhook(memoryStore(), env, '{}', 't=1,v1=nope');
  assert.equal(response.status, 400);
});

test('duplicate events do not add a second SocialPanel order', async () => {
  const order = paidOrder();
  const store = memoryStore({ [orderKey(order.id)]: order });
  const calls = installFetch();
  const payload = JSON.stringify({
    id: 'evt_1',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test',
        metadata: { internalOrderId: 'ord_1' },
        amount_total: 180,
        payment_intent: 'pi_1',
      },
    },
  });
  const header = sign(payload);

  const first = await handleStripeWebhook(store, env, payload, header);
  assert.equal(first.status, 200);
  const second = await handleStripeWebhook(store, env, payload, header);
  const secondBody = await second.json();
  assert.equal(secondBody.duplicate, true);
  assert.equal(calls.add, 1);
});

test('email failure after payment does not revert paid', async () => {
  const order = paidOrder({ socialPanelOrderId: '99', status: 'paid' });
  const store = memoryStore({ [orderKey(order.id)]: order });
  installFetch({ mailOk: false });

  await processPaidSession(
    store,
    env,
    { id: 'cs_test', metadata: { internalOrderId: 'ord_1' }, amount_total: 180 },
    'evt_mail'
  );

  const saved = await store.get(orderKey(order.id));
  assert.equal(saved.status, 'paid');
  assert.equal(saved.customerEmailStatus, 'failed');
});
