import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeInputs, validateCheckoutBody } from '../src/validate.js';

test('checkout body validation', () => {
  const bad = validateCheckoutBody({});
  assert.equal(bad.ok, false);

  const good = validateCheckoutBody({
    serviceId: '01',
    quantity: 1000,
    customerEmail: 'a@b.com',
    inputs: { url: 'https://x.com', extra: 'drop' },
  });
  assert.equal(good.ok, true);
  assert.deepEqual(good.inputs, { url: 'https://x.com' });
});

test('sanitizeInputs drops unknown keys', () => {
  assert.deepEqual(sanitizeInputs({ username: '@n', commentsList: 'hi', foo: '1' }), {
    username: 'n',
    commentsList: 'hi',
  });
});
