import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { applyMarkup, convertMinor, parseDecimalToMinor, quoteTotalMinor, quoteVersion } from '../supabase/functions/_shared/money.js';
import { findProviderService, quoteService } from '../supabase/functions/_shared/pricing.js';

const fixtures = JSON.parse(
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/socialpanel24.json'), 'utf8')
);

const likes = {
  id: '01',
  platform: 'instagram',
  visible: true,
  socialpanelId: '11',
  rateUnit: 'per_1000',
  markupMultiplier: 2,
  quantityStep: 100,
  quantityDefault: 1000,
  packagePriceMinor: null,
};

const comments = {
  id: '03',
  platform: 'instagram',
  visible: true,
  socialpanelId: '22',
  rateUnit: 'per_comment',
  markupMultiplier: 2,
  quantityStep: 1,
  quantityDefault: null,
  packagePriceMinor: null,
};

test('decimal rates become minor units without assuming USD globally', () => {
  assert.equal(parseDecimalToMinor('0.90', 'USD'), 90);
  assert.equal(parseDecimalToMinor('0.90', 'EUR'), 90);
  assert.equal(parseDecimalToMinor(100, 'JPY'), 100);
});

test('per-1000 markup is explicit, not a hidden default inside money helpers', () => {
  const providerMinor = parseDecimalToMinor('0.90', 'USD');
  const retail = applyMarkup(providerMinor, 2);
  assert.equal(retail, 180);
  assert.equal(quoteTotalMinor({ rateMinor: retail, quantity: 1000, rateUnit: 'per_1000' }), 180);
  assert.equal(quoteTotalMinor({ rateMinor: retail, quantity: 1500, rateUnit: 'per_1000' }), 270);
});

test('per-comment and package units do not use per-1000 math', () => {
  assert.equal(quoteTotalMinor({ rateMinor: 10, quantity: 3, rateUnit: 'per_comment' }), 30);
  assert.equal(quoteTotalMinor({ rateMinor: 500, quantity: 1, rateUnit: 'package', packageMinor: 500 }), 500);
});

test('same-currency conversion is identity; missing FX throws', () => {
  assert.equal(convertMinor(90, 'USD', 'USD', 1), 90);
  assert.throws(() => convertMinor(90, 'USD', 'EUR', 0));
});

test('quoteService uses provider min/max and comment count', () => {
  const provider = findProviderService(fixtures.services, '11');
  const ok = quoteService({
    retail: likes,
    provider,
    quantity: 1000,
    inputs: { url: 'https://instagram.com/p/x' },
    retailCurrency: 'USD',
    providerCurrency: 'USD',
    fxProviderToRetail: 1,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.amountMinor, 180);
  assert.equal(ok.quoteVersion, quoteVersion(ok));

  const low = quoteService({
    retail: likes,
    provider,
    quantity: 10,
    inputs: { url: 'https://instagram.com/p/x' },
    retailCurrency: 'USD',
    providerCurrency: 'USD',
    fxProviderToRetail: 1,
  });
  assert.equal(low.ok, false);

  const commentProvider = findProviderService(fixtures.services, '22');
  const commentQuote = quoteService({
    retail: comments,
    provider: commentProvider,
    quantity: 1,
    inputs: { url: 'https://instagram.com/p/x', comments: 'nice\nwork\n' },
    retailCurrency: 'USD',
    providerCurrency: 'USD',
    fxProviderToRetail: 1,
  });
  assert.equal(commentQuote.ok, true);
  assert.equal(commentQuote.billableQuantity, 2);
  assert.equal(commentQuote.amountMinor, 4000);
});
