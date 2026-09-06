import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapInputsToOrderFields } from './order-fields.js';

test('maps url and comments into sheet fields', () => {
  assert.deepEqual(
    mapInputsToOrderFields({ url: 'https://x.com/p/1', commentsList: 'nice\nwork' }),
    { url: 'https://x.com/p/1', notes: 'commentsList: nice\nwork' }
  );
});

test('username becomes URL when no post url is present', () => {
  assert.deepEqual(mapInputsToOrderFields({ username: 'dealer' }), {
    url: 'dealer',
    notes: '',
  });
});
