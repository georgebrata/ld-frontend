import test from 'node:test';
import assert from 'node:assert/strict';
import { retryCheckoutHref } from './capability.js';

test('retryCheckoutHref keeps tokens out of the URL and restores platform/service', () => {
  assert.equal(retryCheckoutHref(null), '/');
  assert.equal(retryCheckoutHref({}), '/');
  assert.equal(retryCheckoutHref({ platform: 'instagram' }), '/?platform=instagram');
  assert.equal(
    retryCheckoutHref({ platform: 'instagram', slug: 'comments', serviceId: '03' }),
    '/?platform=instagram&service=comments'
  );
  assert.equal(
    retryCheckoutHref({ url: '/instagram/comments/', platform: 'instagram', slug: 'comments' }),
    '/instagram/comments/'
  );
});
