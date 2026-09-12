import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { getServices, resetServicesCache } from '../js/api/services-api.js';

const originalFetch = globalThis.fetch;
const originalDocument = globalThis.document;

function embedServices(rows) {
  globalThis.document = {
    getElementById(id) {
      if (id !== 'services-data') return null;
      return { textContent: JSON.stringify({ services: rows }) };
    },
  };
}

afterEach(() => {
  resetServicesCache();
  if (originalFetch) globalThis.fetch = originalFetch;
  else delete globalThis.fetch;
  if (originalDocument) globalThis.document = originalDocument;
  else delete globalThis.document;
});

test('getServices waits for the live catalogue and does not keep stale embed extras', async () => {
  embedServices([
    {
      id: '01',
      platform: 'instagram',
      platformLabel: 'Instagram',
      service: 'Likes',
      visible: true,
      purchasable: false,
      inputs: ['url'],
    },
  ]);
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/catalogue$/);
    return {
      ok: true,
      json: async () => ({
        ok: true,
        data: [
          {
            id: '02',
            platform: 'instagram',
            platformLabel: 'Instagram',
            service: 'Followers',
            visible: true,
            purchasable: true,
            inputs: ['username'],
          },
        ],
      }),
    };
  };

  const services = await getServices({ force: true });
  assert.equal(services.length, 1);
  assert.equal(services[0].id, '02');
  assert.equal(services[0].purchasable, true);
  assert.deepEqual(services[0].inputs, ['username']);
});

test('getServices falls back to the embedded catalogue when live fetch fails', async () => {
  embedServices([
    {
      id: '03',
      platform: 'instagram',
      platformLabel: 'Instagram',
      service: 'Comments',
      visible: true,
      purchasable: false,
      inputs: ['url', 'comments'],
    },
  ]);
  globalThis.fetch = async () => {
    throw new Error('offline');
  };

  const services = await getServices({ force: true });
  assert.equal(services[0].id, '03');
  assert.deepEqual(services[0].inputs, ['url', 'comments']);
});
