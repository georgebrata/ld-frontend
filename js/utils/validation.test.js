import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInputs } from '../api/services-api.js';
import { validateInput, formatOrderId } from './validation.js';

test('parseInputs canonicalizes commentsList', () => {
  assert.deepEqual(parseInputs('url, commentsList'), ['url', 'commentsList']);
  assert.deepEqual(parseInputs('URL, commentslist'), ['url', 'commentsList']);
});

test('validateInput covers supported types', () => {
  assert.equal(validateInput('url', 'https://instagram.com/p/x').valid, true);
  assert.equal(validateInput('url', 'ftp://x').valid, false);
  assert.equal(validateInput('username', '@good_user').valid, true);
  assert.equal(validateInput('username', 'bad name').valid, false);
  assert.equal(validateInput('email', 'a@b.com').valid, true);
  assert.equal(validateInput('email', 'nope').valid, false);
  assert.equal(validateInput('email', `${'a'.repeat(250)}@b.com`).valid, false);
  assert.equal(validateInput('commentsList', '').valid, false);
  assert.equal(validateInput('quantity', '500', { min: 100, max: 1000 }).valid, true);
  assert.equal(validateInput('quantity', '50', { min: 100, max: 1000 }).valid, false);
});

test('formatOrderId uses last six characters', () => {
  assert.equal(formatOrderId('abcdef123456', 'LD-'), 'LD-123456');
});
