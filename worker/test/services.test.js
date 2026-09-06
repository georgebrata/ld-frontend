import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeService, fetchVisibleServices } from '../src/services.js';
import { handleCatalog } from '../src/checkout.js';
import { memoryStore } from './helpers.js';

afterEach(() => {
  delete globalThis.fetch;
});

test('catalog filter keeps only visible rows', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      ok: true,
      data: [
        { ID: '01', Visible: 'TRUE', Platform: 'Instagram', Service: 'Likes', socialpanelId: '11' },
        { ID: '99', Visible: 'FALSE', Platform: 'Instagram', Service: 'Hidden', socialpanelId: '22' },
        { ID: '', Visible: 'TRUE', Platform: 'TikTok', Service: 'Likes' },
      ],
    }),
  });

  const visible = await fetchVisibleServices({
    ORDERS_API_URL: 'https://script.google.com/macros/s/test/exec',
  });
  assert.equal(visible.length, 1);
  assert.equal(visible[0].id, '01');
});

test('normalizeService reads SocialPanelId variants', () => {
  assert.equal(normalizeService({ SocialPanelId: '11' }).socialpanelId, '11');
  assert.equal(normalizeService({ socialPanelId: '12' }).socialpanelId, '12');
});

test('public catalog omits socialpanelId', async () => {
  globalThis.fetch = async (url) => {
    if (String(url).includes('sheet=Services')) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          data: [
            {
              ID: '01',
              Visible: 'TRUE',
              Platform: 'Instagram',
              Service: 'Likes',
              Inputs: 'url',
              socialpanelId: 'SECRET11',
            },
          ],
        }),
      };
    }
    return {
      ok: true,
      json: async () => [{ service: 'SECRET11', rate: '0.90', min: '50', max: '10000' }],
    };
  };

  const response = await handleCatalog(
    memoryStore(),
    {
      ORDERS_API_URL: 'https://script.google.com/macros/s/test/exec',
      SOCIAL_PANEL_API_URL: 'https://socialpanel24.com/api/v2',
      SOCIAL_PANEL_API_KEY: 'key',
      MARKUP_MULTIPLIER: '2',
    },
    '01'
  );
  const body = await response.json();
  assert.equal(body.socialpanelId, undefined);
  assert.equal(body.purchasable, true);
  assert.equal(body.unitPriceInCents, 180);
});
