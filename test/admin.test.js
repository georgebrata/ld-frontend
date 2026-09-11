import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryStore } from '../supabase/functions/_shared/store-memory.js';
import { clearCatalogueMemory } from '../supabase/functions/_shared/catalogue.js';
import {
  handleAdminAction,
  validateProductPayload,
  ADMIN_REGISTERED_FLAG,
} from '../supabase/functions/_shared/admin.js';

const fixtures = JSON.parse(
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/socialpanel24.json'), 'utf8')
);

afterEach(() => {
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

function fetchProvider() {
  return async () => ({
    ok: true,
    text: async () => JSON.stringify(fixtures.services),
  });
}

function sampleProduct(overrides = {}) {
  return {
    id: '01',
    platform: 'instagram',
    platform_label: 'Instagram',
    service: 'Likes',
    slug: 'likes',
    label: 'Instagram Likes',
    description: '',
    inputs: ['url'],
    visible: true,
    socialpanel_id: '11',
    rate_unit: 'per_1000',
    retail_currency: 'USD',
    markup_multiplier: 2,
    quantity_step: 100,
    quantity_default: 1000,
    package_price_minor: null,
    drip_enabled: false,
    sort_order: 10,
    min_contribution_minor: 30,
    ...overrides,
  };
}

async function withAdmin(store, user = { id: 'admin-1', email: 'ops@like-dealer.com' }) {
  await store.insertAdminUser({ user_id: user.id, email: user.email, role: 'admin' });
  return {
    request: request({ Authorization: 'Bearer valid-token' }),
    getUser: async (token) => (token === 'valid-token' ? user : null),
    fetchImpl: fetchProvider(),
  };
}

test('unauthenticated admin actions are rejected', async () => {
  const store = createMemoryStore();
  const result = await handleAdminAction({ env: {}, store }, { action: 'products.list' }, { request: request() });
  assert.equal(result.status, 401);
});

test('a valid JWT for a non-allowlisted user is forbidden', async () => {
  const store = createMemoryStore();
  await store.insertAdminUser({ user_id: 'admin-1', email: 'ops@like-dealer.com' });
  await store.setFlag(ADMIN_REGISTERED_FLAG, false);
  const result = await handleAdminAction(
    { env: {}, store },
    { action: 'products.list' },
    {
      request: request({ Authorization: 'Bearer stranger' }),
      getUser: async () => ({ id: 'not-admin', email: 'a@b.com' }),
    }
  );
  assert.equal(result.status, 403);
});

test('the first signed-in user is claimed while registration is open', async () => {
  const store = createMemoryStore();
  await store.upsertProduct(sampleProduct());
  const result = await handleAdminAction(
    { env: { SOCIALPANEL24_API_KEY: 'k', RETAIL_CURRENCY: 'USD', MARKUP_MULTIPLIER: '2' }, store },
    { action: 'products.list' },
    {
      request: request({ Authorization: 'Bearer valid-token' }),
      getUser: async () => ({ id: 'orphan-1', email: 'ops@like-dealer.com' }),
      fetchImpl: fetchProvider(),
    }
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(await store.countAdmins(), 1);
  const flag = await store.getFlag(ADMIN_REGISTERED_FLAG);
  assert.equal(flag.enabled, false);
  const row = await store.getAdminUser('orphan-1');
  assert.equal(row.email, 'ops@like-dealer.com');
});

test('a later signed-in user cannot claim after the first admin exists', async () => {
  const store = createMemoryStore();
  await handleAdminAction(
    { env: {}, store },
    { action: 'products.list' },
    {
      request: request({ Authorization: 'Bearer first' }),
      getUser: async () => ({ id: 'first', email: 'first@like-dealer.com' }),
      fetchImpl: fetchProvider(),
    }
  );
  const second = await handleAdminAction(
    { env: {}, store },
    { action: 'products.list' },
    {
      request: request({ Authorization: 'Bearer second' }),
      getUser: async () => ({ id: 'second', email: 'second@like-dealer.com' }),
    }
  );
  assert.equal(second.status, 403);
  assert.equal(await store.countAdmins(), 1);
});

test('register attaches an existing Auth user when createUser reports a duplicate', async () => {
  const store = createMemoryStore();
  const result = await handleAdminAction(
    { env: {}, store },
    { action: 'register', email: 'ops@like-dealer.com', password: 'twelve chars!!' },
    {
      createUser: async () => {
        const err = new Error('User already registered');
        err.code = '23505';
        throw err;
      },
      findUser: async () => ({ id: 'existing-1', email: 'ops@like-dealer.com' }),
    }
  );
  assert.equal(result.status, 201);
  assert.equal(await store.countAdmins(), 1);
  const row = await store.getAdminUser('existing-1');
  assert.equal(row.email, 'ops@like-dealer.com');
});

test('bootstrap reports registerOpen without leaking products', async () => {
  const store = createMemoryStore();
  await store.upsertProduct(sampleProduct());
  const result = await handleAdminAction({ env: {}, store }, { action: 'bootstrap' });
  assert.equal(result.status, 200);
  assert.equal(result.body.registerOpen, true);
  assert.equal(result.body.products, undefined);
  assert.equal(result.body.ok, true);
});

test('register is refused when ADMIN_REGISTERED is false', async () => {
  const store = createMemoryStore();
  await store.setFlag(ADMIN_REGISTERED_FLAG, false);
  const result = await handleAdminAction(
    { env: {}, store },
    { action: 'register', email: 'ops@like-dealer.com', password: 'twelve chars!!' },
    { createUser: async () => ({ id: 'u1', email: 'ops@like-dealer.com' }) }
  );
  assert.equal(result.status, 403);
  assert.equal(store.adminUsers.length, 0);
});

test('register is refused when an admin already exists', async () => {
  const store = createMemoryStore();
  await store.insertAdminUser({ user_id: 'u0', email: 'first@like-dealer.com' });
  const result = await handleAdminAction(
    { env: {}, store },
    { action: 'register', email: 'second@like-dealer.com', password: 'twelve chars!!' },
    { createUser: async () => ({ id: 'u1', email: 'second@like-dealer.com' }) }
  );
  assert.equal(result.status, 403);
});

test('register flips ADMIN_REGISTERED exactly once', async () => {
  const store = createMemoryStore();
  let created = 0;
  const extras = {
    createUser: async ({ email }) => {
      created += 1;
      return { id: `user-${created}`, email };
    },
  };
  const first = await handleAdminAction(
    { env: {}, store },
    { action: 'register', email: 'ops@like-dealer.com', password: 'twelve chars!!' },
    extras
  );
  assert.equal(first.status, 201);
  assert.equal(first.body.registerOpen, false);
  const flag = await store.getFlag(ADMIN_REGISTERED_FLAG);
  assert.equal(flag.enabled, false);
  assert.equal(await store.countAdmins(), 1);

  const second = await handleAdminAction(
    { env: {}, store },
    { action: 'register', email: 'other@like-dealer.com', password: 'twelve chars!!' },
    extras
  );
  assert.equal(second.status, 403);
  assert.equal(await store.countAdmins(), 1);
  assert.equal(created, 1);
});

test('product validation rejects a bad rate unit, low markup, traversal slug, and unknown input', () => {
  const base = {
    id: '08',
    platform: 'instagram',
    platformLabel: 'Instagram',
    service: 'Views',
    slug: 'views',
    rateUnit: 'per_1000',
    markupMultiplier: 2,
    inputs: ['url'],
  };
  assert.equal(validateProductPayload({ ...base, rateUnit: 'per_k' }).ok, false);
  assert.equal(validateProductPayload({ ...base, markupMultiplier: 0.5 }).ok, false);
  assert.equal(validateProductPayload({ ...base, slug: '../etc' }).ok, false);
  assert.equal(validateProductPayload({ ...base, inputs: ['url', 'not_a_field'] }).ok, false);
});

test('products.list reports mapped, unmapped, and missing disableReason', async () => {
  clearCatalogueMemory();
  const store = createMemoryStore();
  await store.upsertProduct(sampleProduct({ id: '01', socialpanel_id: '11', service: 'Likes', slug: 'likes' }));
  await store.upsertProduct(
    sampleProduct({ id: '02', socialpanel_id: '', service: 'Saves', slug: 'saves', sort_order: 20 })
  );
  await store.upsertProduct(
    sampleProduct({ id: '03', socialpanel_id: '99999', service: 'Views', slug: 'views', sort_order: 30 })
  );
  const extras = await withAdmin(store);
  const result = await handleAdminAction(
    { env: { SOCIALPANEL24_API_KEY: 'k', RETAIL_CURRENCY: 'USD', MARKUP_MULTIPLIER: '2' }, store },
    { action: 'products.list' },
    extras
  );
  assert.equal(result.status, 200);
  const byId = Object.fromEntries(result.body.products.map((row) => [row.id, row]));
  assert.equal(byId['01'].disableReason, '');
  assert.equal(byId['01'].purchasable, true);
  assert.equal(byId['02'].disableReason, 'unmapped');
  assert.equal(byId['03'].disableReason, 'missing');
});

test('products.upsert persists min_contribution_minor on update', async () => {
  const store = createMemoryStore();
  await store.upsertProduct(sampleProduct());
  const extras = await withAdmin(store);
  const result = await handleAdminAction(
    { env: { SOCIALPANEL24_API_KEY: 'k', RETAIL_CURRENCY: 'USD', MARKUP_MULTIPLIER: '2' }, store },
    {
      action: 'products.upsert',
      product: {
        id: '01',
        platform: 'instagram',
        platformLabel: 'Instagram',
        service: 'Likes',
        slug: 'likes',
        rateUnit: 'per_1000',
        markupMultiplier: 2,
        inputs: ['url'],
        minContributionMinor: 45,
      },
    },
    extras
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.created, false);
  assert.equal(result.body.product.minContributionMinor, 45);
});
