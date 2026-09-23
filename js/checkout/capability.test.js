import test from 'node:test';
import assert from 'node:assert/strict';
import { draftFingerprint, retryCheckoutHref } from './capability.js';

test('draftFingerprint changes when service, quantity, email, or inputs change', () => {
  const base = { serviceId: '01', quantity: 1000, email: 'a@b.com', inputs: { url: 'https://instagram.com/p/x' } };
  assert.equal(draftFingerprint(base), draftFingerprint({ ...base, email: 'A@B.com' }));
  assert.notEqual(draftFingerprint(base), draftFingerprint({ ...base, serviceId: '02' }));
  assert.notEqual(draftFingerprint(base), draftFingerprint({ ...base, quantity: 2000 }));
});

test('retryCheckoutHref keeps tokens out of the URL and restores platform/service', () => {
  assert.equal(retryCheckoutHref(null), '/');
  assert.equal(retryCheckoutHref({}), '/');
  assert.equal(retryCheckoutHref({ platform: 'instagram' }), '/instagram/');
  assert.equal(
    retryCheckoutHref({ platform: 'instagram', slug: 'comments', serviceId: '03' }),
    '/instagram/comments/'
  );
  assert.equal(
    retryCheckoutHref({ url: '/instagram/comments/', platform: 'instagram', slug: 'comments' }),
    '/instagram/comments/'
  );
});
