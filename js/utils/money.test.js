import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMarkup, formatUsd, toCents, totalInCents } from './money.js';

test('integer-cent markup and totals', () => {
  assert.equal(toCents('0.90'), 90);
  assert.equal(applyMarkup(90, 2), 180);
  assert.equal(totalInCents(180, 1000), 180);
  assert.equal(totalInCents(180, 1500), 270);
  assert.equal(formatUsd(270), '$2.70');
});
