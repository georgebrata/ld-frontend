import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { adaptSheetCatalogue, applySocialpanelIdOverlay } from '../supabase/functions/_shared/retail-adapter.js';
import { clearCatalogueMemory, getPublicCatalogue, joinService } from '../supabase/functions/_shared/catalogue.js';
import { normalizeProviderService } from '../supabase/functions/_shared/socialpanel24.js';
import { toPublicService } from '../supabase/functions/_shared/pricing.js';

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
