import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isVisible } from './visibility.js';

test('visible truthy forms', () => {
  assert.equal(isVisible(true), true);
  assert.equal(isVisible('TRUE'), true);
  assert.equal(isVisible('true'), true);
  assert.equal(isVisible('True'), true);
  assert.equal(isVisible('1'), true);
  assert.equal(isVisible(1), true);
  assert.equal(isVisible('yes'), true);
});

test('invisible and malformed values are excluded', () => {
  assert.equal(isVisible(false), false);
  assert.equal(isVisible('FALSE'), false);
  assert.equal(isVisible(''), false);
  assert.equal(isVisible(null), false);
  assert.equal(isVisible(undefined), false);
  assert.equal(isVisible('maybe'), false);
});
