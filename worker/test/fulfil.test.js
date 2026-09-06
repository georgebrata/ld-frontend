import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fulfilOrder } from '../src/fulfil.js';

const env = {
  SOCIAL_PANEL_API_KEY: 'test-key',
  SOCIAL_PANEL_API_URL: 'https://socialpanel24.com/api/v2',
};

afterEach(() => {
  delete globalThis.fetch;
});

function order(overrides = {}) {
  return {
    socialPanelId: '11',
    quantity: 1000,
    platform: 'instagram',
    inputs: { url: 'https://instagram.com/p/x' },
    fulfilmentAttempted: false,
    socialPanelOrderId: '',
    status: 'paid',
    ...overrides,
  };
}

test('successful add stores the downstream id', async () => {
  let adds = 0;
  globalThis.fetch = async (_url, init) => {
    const body = String(init?.body ?? '');
    if (body.includes('action=add')) {
      adds += 1;
      return { ok: true, json: async () => ({ order: '99' }) };
    }
    return { ok: true, json: async () => ({}) };
  };

  const result = await fulfilOrder(env, order());
  assert.equal(result.order.status, 'processing');
  assert.equal(result.order.socialPanelOrderId, '99');
  assert.equal(result.order.fulfilmentAttempted, true);
  assert.equal(adds, 1);
});

test('lost add is not retried', async () => {
  let adds = 0;
  globalThis.fetch = async (_url, init) => {
    const body = String(init?.body ?? '');
    if (body.includes('action=add')) {
      adds += 1;
      return { ok: true, json: async () => ({}) };
    }
    return { ok: true, json: async () => ({}) };
  };

  const first = await fulfilOrder(env, order());
  assert.equal(first.order.status, 'fulfilment_failed');
  assert.equal(first.order.fulfilmentAttempted, true);
  assert.equal(first.order.socialPanelOrderId, '');
  assert.equal(adds, 1);

  const second = await fulfilOrder(env, first.order);
  assert.equal(second.skipped, true);
  assert.equal(second.reason, 'unknown_prior_add');
  assert.equal(adds, 1);
});

test('existing SocialPanel order is not added again', async () => {
  let adds = 0;
  globalThis.fetch = async () => {
    adds += 1;
    return { ok: true, json: async () => ({ order: '100' }) };
  };

  const result = await fulfilOrder(env, order({ socialPanelOrderId: '99' }));
  assert.equal(result.skipped, true);
  assert.equal(adds, 0);
});
