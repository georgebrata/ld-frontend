import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryStore } from '../supabase/functions/_shared/store-memory.js';
import { processDueJobs } from '../supabase/functions/_shared/jobs.js';

const fixtures = JSON.parse(
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/socialpanel24.json'), 'utf8')
);

test('multiple poll jobs cause one provider status request per worker run', async () => {
  const store = createMemoryStore();
  await store.insertOrder({
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
    provider_order_id: '1',
  });
  await store.enqueueJob({ orderId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', task: 'poll_status', dedupeKey: 'poll:a' });
  await store.enqueueJob({ orderId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', task: 'poll_status', dedupeKey: 'poll:b' });
  let statusCalls = 0;
  globalThis.fetch = async () => {
    statusCalls += 1;
    return { ok: true, text: async () => JSON.stringify(fixtures.statusBatch) };
  };
  await processDueJobs(
    { SOCIALPANEL24_API_KEY: 'k', SOCIALPANEL24_ENABLED: 'true', PROVIDER_ENV: 'live', APP_ENV: 'production' },
    store,
    { fetchImpl: globalThis.fetch, limit: 20 }
  );
  assert.equal(statusCalls, 1);
});
