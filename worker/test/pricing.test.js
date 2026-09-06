import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findSp24Service, quoteFromSp24 } from '../src/pricing.js';

test('quote applies x2 markup and rejects out-of-range qty', () => {
  const service = { service: '11', rate: '0.90', min: '50', max: '10000' };
  const ok = quoteFromSp24(service, 1000, 2);
  assert.equal(ok.ok, true);
  assert.equal(ok.unitPriceInCents, 180);
  assert.equal(ok.totalInCents, 180);

  const low = quoteFromSp24(service, 10, 2);
  assert.equal(low.ok, false);

  const missing = quoteFromSp24(null, 1000, 2);
  assert.equal(missing.ok, false);
});

test('findSp24Service matches string ids', () => {
  const found = findSp24Service([{ service: 11, rate: '1' }], '11');
  assert.equal(found.service, 11);
  assert.equal(findSp24Service([{ service: 11 }], ''), null);
});
