import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInputs, normalizeService } from '../api/services-api.js';
import { validateInput, formatOrderId } from './validation.js';

test('parseInputs canonicalizes comments', () => {
  assert.deepEqual(parseInputs('url, commentsList'), ['url', 'comments']);
  assert.deepEqual(parseInputs('URL, commentslist'), ['url', 'comments']);
});

test('unmapped public services stay listed but not purchasable', () => {
  const row = normalizeService({
    id: '01',
    platform: 'instagram',
    platformLabel: 'Instagram',
    service: 'Likes',
    enabled: false,
    purchasable: false,
    inputs: ['url'],
  });
  assert.equal(row.visible, true);
  assert.equal(row.enabled, false);
  assert.equal(row.purchasable, false);
});

test('validateInput covers supported types', () => {
  assert.equal(validateInput('url', 'https://instagram.com/p/x', { platform: 'instagram' }).valid, true);
  assert.equal(validateInput('url', 'ftp://x').valid, false);
  assert.equal(validateInput('username', '@good_user').valid, true);
  assert.equal(validateInput('username', 'bad name').valid, false);
  assert.equal(validateInput('email', 'a@b.com').valid, true);
  assert.equal(validateInput('email', 'nope').valid, false);
  assert.equal(validateInput('email', `${'a'.repeat(250)}@b.com`).valid, false);
  assert.equal(validateInput('comments', '').valid, false);
  assert.equal(validateInput('quantity', '500', { min: 100, max: 1000 }).valid, true);
  assert.equal(validateInput('quantity', '50', { min: 100, max: 1000 }).valid, false);
  assert.equal(validateInput('quantity', '150', { min: 50, max: 10000, step: 100 }).valid, false);
  assert.equal(validateInput('quantity', '   ', { }).valid, false);
  assert.equal(validateInput('comments', '  \n  ').valid, false);
});

test('formatOrderId uses last six characters', () => {
  assert.equal(formatOrderId('abcdef123456', 'LD-'), 'LD-123456');
});
