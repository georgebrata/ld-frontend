import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../supabase/functions/_shared/store-memory.js';
import { createGuestCheckout } from '../supabase/functions/_shared/checkout.js';
import { getAuthorizedOrder } from '../supabase/functions/_shared/order-status.js';
import { hashCapabilityToken } from '../supabase/functions/_shared/crypto-token.js';
import { RETAIL_CATALOGUE } from '../supabase/functions/_shared/retail-catalogue.js';
import { clearCatalogueMemory } from '../supabase/functions/_shared/catalogue.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtures = JSON.parse(
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/socialpanel24.json'), 'utf8')
);

const originalIds = RETAIL_CATALOGUE.map((row) => row.socialpanelId);

afterEach(() => {
  delete globalThis.fetch;
  RETAIL_CATALOGUE.forEach((row, i) => {
    row.socialpanelId = originalIds[i];
  });
  clearCatalogueMemory();
});

function env() {
  return {
    SOCIALPANEL24_API_KEY: 'test-key',
    RETAIL_CURRENCY: 'USD',
    PROVIDER_CURRENCY: 'USD',
    FX_PROVIDER_TO_RETAIL: '1',
    MARKUP_MULTIPLIER: '2',
    STRIPE_SECRET_KEY: 'sk_test',
    SITE_URL: 'https://like-dealer.com',
    ORDER_ID_PREFIX: 'LD-',
  };
}

function mockProviderAndStripe() {
  const captured = { stripeBody: '' };
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    const body = String(init?.body || '');
    if (href.includes('socialpanel24.com')) {
      if (body.includes('action=services')) {
        return { ok: true, text: async () => JSON.stringify(fixtures.services) };
      }
    }
    if (href.includes('api.stripe.com/v1/checkout/sessions')) {
      captured.stripeBody = body;
      return {
        ok: true,
        json: async () => ({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }),
      };
    }
    return { ok: true, json: async () => ({}), text: async () => '{}' };
  };
  return captured;
}

test('tampered provider ids are rejected; browser prices are not trusted', async () => {
  RETAIL_CATALOGUE[0].socialpanelId = '11';
  clearCatalogueMemory();
  mockProviderAndStripe();
  const store = createMemoryStore();
  const token = 'a'.repeat(43);
  const envVars = env();
  const deps = { fetchImpl: globalThis.fetch };
  const base = {
    serviceId: '01',
    quantity: 1000,
    customerEmail: 'a@b.com',
    checkoutAttemptId: '33333333-3333-4333-8333-333333333333',
    capabilityToken: token,
    inputs: { url: 'https://instagram.com/p/x' },
  };

  const injected = await createGuestCheckout(envVars, store, { ...base, socialpanelId: '999' }, deps);
  assert.equal(injected.status, 400);

  const mismatched = await createGuestCheckout(
    envVars,
    store,
    { ...base, expectedQuote: { amountMinor: 1, currency: 'USD', quantity: 1000 } },
    deps
  );
  assert.equal(mismatched.status, 409);
  assert.equal(mismatched.body.code, 'quote_changed');
  assert.equal(mismatched.body.quote.amountMinor, 180);
});

test('missing Stripe key does not persist an order', async () => {
  RETAIL_CATALOGUE[0].socialpanelId = '11';
  clearCatalogueMemory();
  mockProviderAndStripe();
  const store = createMemoryStore();
  const envVars = env();
  delete envVars.STRIPE_SECRET_KEY;
  const result = await createGuestCheckout(
    envVars,
    store,
    {
      serviceId: '01',
      quantity: 1000,
      customerEmail: 'a@b.com',
      checkoutAttemptId: '77777777-7777-4777-8777-777777777777',
      capabilityToken: 'e'.repeat(43),
      inputs: { url: 'https://instagram.com/p/x' },
    },
    { fetchImpl: globalThis.fetch }
  );
  assert.equal(result.status, 503);
  assert.equal(await store.getOrderByAttempt('77777777-7777-4777-8777-777777777777'), null);
});

test('comments survive checkout freeze and provider payload omits quantity', async () => {
  RETAIL_CATALOGUE[2].socialpanelId = '22';
  clearCatalogueMemory();
  mockProviderAndStripe();
  const store = createMemoryStore();
  const token = 'b'.repeat(43);
  const result = await createGuestCheckout(
    env(),
    store,
    {
      serviceId: '03',
      quantity: 1,
      customerEmail: 'a@b.com',
      checkoutAttemptId: '44444444-4444-4444-8444-444444444444',
      capabilityToken: token,
      inputs: { url: 'https://instagram.com/p/x', commentsList: 'keep me\nexactly' },
      expectedQuote: { amountMinor: 4, currency: 'USD', quantity: 2 },
    },
    { fetchImpl: globalThis.fetch }
  );
  assert.equal(result.status, 200, result.body?.error);
  const order = await store.getOrderByAttempt('44444444-4444-4444-8444-444444444444');
  assert.equal(order.inputs.comments, 'keep me\nexactly');
  assert.equal(order.provider_payload.comments, 'keep me\nexactly');
  assert.equal(order.provider_payload.quantity, undefined);
  assert.equal(order.billable_quantity, 2);
});

test('Stripe success URL uses the local storefront origin', async () => {
  RETAIL_CATALOGUE[0].socialpanelId = '11';
  clearCatalogueMemory();
  const captured = mockProviderAndStripe();
  const store = createMemoryStore();
  const result = await createGuestCheckout(
    env(),
    store,
    {
      serviceId: '01',
      quantity: 1000,
      customerEmail: 'a@b.com',
      checkoutAttemptId: '88888888-8888-4888-8888-888888888888',
      capabilityToken: 'f'.repeat(43),
      inputs: { url: 'https://instagram.com/p/x' },
    },
    { fetchImpl: globalThis.fetch, storefrontOrigin: 'http://127.0.0.1:8765' }
  );
  assert.equal(result.status, 200, result.body?.error);
  assert.match(captured.stripeBody, /success_url=http%3A%2F%2F127\.0\.0\.1%3A8765%2Fsuccess/);
  assert.match(captured.stripeBody, /cancel_url=http%3A%2F%2F127\.0\.0\.1%3A8765%2Fcancel/);
  assert.equal(captured.stripeBody.includes('evil.example'), false);
  assert.equal(captured.stripeBody.includes('integration_identifier'), false);
});

test('Stripe Checkout failures are retryable and do not become a 500', async () => {
  RETAIL_CATALOGUE[0].socialpanelId = '11';
  clearCatalogueMemory();
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    const body = String(init?.body || '');
    if (href.includes('socialpanel24.com') && body.includes('action=services')) {
      return { ok: true, text: async () => JSON.stringify(fixtures.services) };
    }
    if (href.includes('api.stripe.com/v1/checkout/sessions')) {
      return { ok: false, json: async () => ({ error: { message: 'Unknown parameter' } }) };
    }
    return { ok: true, json: async () => ({}), text: async () => '{}' };
  };
  const result = await createGuestCheckout(
    env(),
    createMemoryStore(),
    {
      serviceId: '01',
      quantity: 1000,
      customerEmail: 'a@b.com',
      checkoutAttemptId: '99999999-9999-4999-8999-999999999999',
      capabilityToken: 'g'.repeat(43),
      inputs: { url: 'https://instagram.com/p/x' },
    },
    { fetchImpl: globalThis.fetch }
  );
  assert.equal(result.status, 503);
  assert.match(String(result.body.error), /try again/i);
});

test('status access requires the capability token hash', async () => {
  const store = createMemoryStore();
  const token = 'c'.repeat(43);
  const hash = await hashCapabilityToken(token);
  await store.insertOrder({
    id: '55555555-5555-4555-8555-555555555555',
    display_id: 'LD-555555',
    checkout_attempt_id: '66666666-6666-4666-8666-666666666666',
    capability_token_hash: hash,
    email: 'a@b.com',
    service_id: '01',
    service_snapshot: { label: 'Instagram Likes' },
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
    fulfillment_status: 'not_started',
    stripe_session_id: 'cs_secret',
  });

  const ok = await getAuthorizedOrder(store, {
    token,
    sessionId: 'cs_secret',
  });
  assert.equal(ok.display_id, 'LD-555555');

  const missing = await getAuthorizedOrder(store, { token: 'd'.repeat(43), sessionId: 'cs_secret' });
  assert.equal(missing, null);

  const idOnly = await getAuthorizedOrder(store, { token: '', orderId: '55555555-5555-4555-8555-555555555555' });
  assert.equal(idOnly, null);
});
