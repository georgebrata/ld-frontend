import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkoutFieldPlan, quantityMode, serviceInputTypesFrom } from './fields.js';

test('checkout fields come from the product inputs column and always include email', () => {
  const followers = checkoutFieldPlan({
    inputs: ['username'],
    quantityMode: 'required',
    purchasable: true,
  });
  assert.deepEqual(followers.serviceInputTypes, ['username']);
  assert.equal(followers.needsQuantity, true);
  assert.equal(followers.includeEmail, true);

  const comments = checkoutFieldPlan({
    inputs: ['url', 'comments', 'email', 'quantity'],
    purchasable: true,
  });
  assert.deepEqual(comments.serviceInputTypes, ['url', 'comments']);
  assert.equal(comments.mode, 'from_comments');
  assert.equal(comments.needsQuantity, false);
  assert.equal(comments.includeEmail, true);
});

test('unknown and aliased input names are canonicalized', () => {
  assert.deepEqual(serviceInputTypesFrom(['link', 'commentsList', 'not-a-field']), ['url', 'comments']);
  assert.equal(quantityMode({ inputs: ['url', 'comments'] }), 'from_comments');
  assert.equal(quantityMode({ quantityMode: 'package', inputs: ['url'] }), 'package');
});
