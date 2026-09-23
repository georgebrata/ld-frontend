import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  adaptSheetCatalogue,
  applySocialpanelIdOverlay,
  loadRetailCatalogue,
  productRowToRetail,
} from '../supabase/functions/_shared/retail-adapter.js';
import {
  clearCatalogueMemory,
  getPublicCatalogue,
  joinService,
  refreshCatalogue,
} from '../supabase/functions/_shared/catalogue.js';
import { normalizeProviderService } from '../supabase/functions/_shared/socialpanel24.js';
import { toPublicService } from '../supabase/functions/_shared/pricing.js';

const providerFixture = JSON.parse(
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/socialpanel24.json'), 'utf8')
).services;

afterEach(() => {
  clearCatalogueMemory();
});

test('sheet adapter accepts ID/Platform aliases and commentsList', () => {
  const rows = adaptSheetCatalogue({
    ok: true,
    data: [
      {
        ID: '01',
        Platform: 'Instagram',
        Service: 'Likes',
        Inputs: 'url, commentsList',
        Visible: 'TRUE',
        socialpanelId: '11',
        rateUnit: 'per_1000',
      },
      { ID: '99', Visible: 'FALSE', Platform: 'Instagram', Service: 'Hidden', socialpanelId: '22' },
    ],
  });
  assert.equal(rows[0].inputs.includes('comments'), true);
  assert.equal(rows[0].socialpanelId, '11');
  assert.equal(rows.find((row) => row.id === '99').visible, false);
});

test('RETAIL_SOCIALPANEL_IDS overlay maps ids without replacing retail rows', () => {
  const rows = applySocialpanelIdOverlay(
    [{ id: '01', socialpanelId: '', service: 'Likes' }],
    '{"01":"  11  "}'
  );
  assert.equal(rows[0].socialpanelId, '11');
  assert.equal(rows[0].service, 'Likes');
  const untouched = applySocialpanelIdOverlay([{ id: '01', socialpanelId: '' }], '{not json');
  assert.equal(untouched[0].socialpanelId, '');
});

test('unmapped and subscription types are disabled and public payload omits provider ids', () => {
  const retail = {
    id: '01',
    platform: 'instagram',
    platformLabel: 'Instagram',
    service: 'Likes',
    description: '',
    inputs: ['url'],
    visible: true,
    socialpanelId: '',
    rateUnit: 'per_1000',
    retailCurrency: 'USD',
    markupMultiplier: 2,
    quantityStep: 100,
    quantityDefault: 1000,
    packagePriceMinor: null,
    dripEnabled: false,
  };
  const joined = joinService(retail, null, {
    retailCurrency: 'USD',
    providerCurrency: 'USD',
    fxProviderToRetail: 1,
  });
  assert.equal(joined.enabled, false);
  assert.equal(joined.purchasable, false);
  const comments = joinService(
    { ...retail, id: '03', service: 'Comments', inputs: ['url', 'comments'], rateUnit: 'per_comment' },
    null,
    { retailCurrency: 'USD', providerCurrency: 'USD', fxProviderToRetail: 1 }
  );
  assert.equal(comments.quantityMode, 'from_comments');
  const pub = toPublicService(joined);
  assert.equal(pub.socialpanelId, undefined);
  assert.equal(pub.providerServiceId, undefined);

  const sub = joinService(
    { ...retail, socialpanelId: '44' },
    normalizeProviderService({ service: 44, type: 'Subscriptions', rate: '1', min: '1', max: '10' }),
    { retailCurrency: 'USD', providerCurrency: 'USD', fxProviderToRetail: 1 }
  );
  assert.equal(sub.enabled, false);
  assert.equal(sub.disableReason, 'unsupported_type');
});

test('empty products list falls back to the bundled catalogue', async () => {
  const rows = await loadRetailCatalogue({
    listProducts: async () => [],
  });
  assert.equal(rows.some((row) => row.id === '01'), true);
  assert.equal(rows.some((row) => row.service === 'Saves'), true);
});

test('products table rows become retail services and win over the bundled catalogue', async () => {
  const mapped = productRowToRetail({
    id: '07',
    platform: 'instagram',
    platform_label: 'Instagram',
    service: 'Saves',
    description: '',
    inputs: ['url'],
    visible: true,
    socialpanel_id: '',
    rate_unit: 'per_1000',
    retail_currency: 'USD',
    markup_multiplier: 2,
    quantity_step: 100,
    quantity_default: 1000,
    package_price_minor: null,
    drip_enabled: false,
  });
  assert.equal(mapped.service, 'Saves');
  assert.equal(mapped.platform, 'instagram');
  assert.equal(mapped.socialpanelId, '');

  const rows = await loadRetailCatalogue({
    listProducts: async () => [
      {
        id: '07',
        platform_label: 'Instagram',
        service: 'Saves',
        inputs: ['url'],
        visible: true,
        socialpanel_id: '',
        rate_unit: 'per_1000',
        markup_multiplier: 2,
        quantity_step: 100,
        quantity_default: 1000,
      },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, '07');
  assert.equal(rows[0].service, 'Saves');
});

test('refreshCatalogue writes provider and public cache from a live SocialPanel24 list', async () => {
  const stored = new Map();
  const result = await refreshCatalogue(
    { SOCIALPANEL24_API_KEY: 'k', MARKUP_MULTIPLIER: '2' },
    {
      now: () => 1_700_000_000_000,
      listProducts: async () => [
        {
          id: '01',
          platform: 'instagram',
          platform_label: 'Instagram',
          service: 'Likes',
          inputs: ['url'],
          visible: true,
          socialpanel_id: '11',
          rate_unit: 'per_1000',
          markup_multiplier: 2,
          quantity_step: 50,
          quantity_default: 50,
        },
        {
          id: '07',
          platform: 'instagram',
          platform_label: 'Instagram',
          service: 'Saves',
          inputs: ['url'],
          visible: true,
          socialpanel_id: '',
          rate_unit: 'per_1000',
          markup_multiplier: 2,
          quantity_step: 100,
          quantity_default: 1000,
        },
      ],
      cacheGet: async (key) => stored.get(key) || null,
      cacheSet: async (key, value) => {
        stored.set(key, value);
      },
      fetchImpl: async () => new Response(JSON.stringify(providerFixture), { status: 200 }),
    }
  );
  assert.equal(result.ok, true);
  assert.equal(result.refreshed, true);
  assert.equal(result.providerCount, providerFixture.length);
  assert.deepEqual(result.cacheKeys, ['sp24:services', 'catalogue:public']);
  assert.equal(result.purchasable, 1);
  assert.equal(result.unmapped, 1);
  assert.equal(stored.has('sp24:services'), true);
  assert.equal(stored.has('catalogue:public'), true);
  assert.equal(stored.get('catalogue:public').payload.data.find((row) => row.id === '01').purchasable, true);
});

test('refreshCatalogue bypasses a still-fresh provider cache', async () => {
  const stored = new Map();
  stored.set('sp24:services', {
    expires: Date.now() + 60_000,
    services: [{ service: '99', type: 'Default', rate: '1', min: 1, max: 10 }],
  });
  const result = await refreshCatalogue(
    { SOCIALPANEL24_API_KEY: 'k', MARKUP_MULTIPLIER: '2' },
    {
      listProducts: async () => [
        {
          id: '01',
          platform: 'instagram',
          platform_label: 'Instagram',
          service: 'Likes',
          inputs: ['url'],
          visible: true,
          socialpanel_id: '11',
          rate_unit: 'per_1000',
          markup_multiplier: 2,
          quantity_step: 50,
          quantity_default: 50,
        },
      ],
      cacheGet: async (key) => stored.get(key) || null,
      cacheSet: async (key, value) => {
        stored.set(key, value);
      },
      fetchImpl: async () => new Response(JSON.stringify(providerFixture), { status: 200 }),
    }
  );
  assert.equal(result.ok, true);
  assert.equal(result.purchasable, 1);
  assert.equal(stored.get('sp24:services').services.some((row) => String(row.service) === '11'), true);
});

test('refreshCatalogue leaves existing cache when SocialPanel24 fails or returns empty', async () => {
  const kept = { payload: { ok: true, data: ['keep'] }, expires: 9, staleUntil: 9 };
  const stored = new Map([['catalogue:public', kept]]);
  const failed = await refreshCatalogue(
    { SOCIALPANEL24_API_KEY: 'k' },
    {
      cacheGet: async (key) => stored.get(key) || null,
      cacheSet: async (key, value) => {
        stored.set(key, value);
      },
      fetchImpl: async () => {
        throw new Error('down');
      },
    }
  );
  assert.equal(failed.ok, false);
  assert.equal(failed.refreshed, false);
  assert.equal(stored.get('catalogue:public'), kept);

  const empty = await refreshCatalogue(
    { SOCIALPANEL24_API_KEY: 'k' },
    {
      cacheGet: async (key) => stored.get(key) || null,
      cacheSet: async (key, value) => {
        stored.set(key, value);
      },
      fetchImpl: async () => new Response('[]', { status: 200 }),
    }
  );
  assert.equal(empty.ok, false);
  assert.equal(empty.providerError, 'empty_provider_catalogue');
  assert.equal(stored.get('catalogue:public'), kept);
});

test('missing provider key does not persist a public catalogue cache', async () => {
  const stored = [];
  const result = await getPublicCatalogue(
    { SOCIALPANEL24_API_KEY: '' },
    {
      cacheSet: async (key, value) => {
        stored.push(key);
        return value;
      },
    }
  );
  assert.equal(result.ok, true);
  assert.equal(stored.includes('catalogue:public'), false);
  assert.equal(result.data.every((row) => row.purchasable === false), true);
});
