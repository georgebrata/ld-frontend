import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkoutReturnOrigin, pickAllowOrigin } from '../supabase/functions/_shared/http.js';

function req(origin) {
  return { headers: { get: (name) => (name === 'Origin' ? origin : null) } };
}

test('CORS allows localhost on any port for static servers', () => {
  const allow = ['https://like-dealer.com'];
  assert.equal(pickAllowOrigin(req('http://127.0.0.1:8765'), allow), 'http://127.0.0.1:8765');
  assert.equal(pickAllowOrigin(req('http://localhost:3000'), allow), 'http://localhost:3000');
  assert.equal(pickAllowOrigin(req('https://evil.example'), allow), '');
  assert.equal(pickAllowOrigin(req('https://like-dealer.com'), allow), 'https://like-dealer.com');
});

test('Stripe return origin follows the capability-token storefront', () => {
  const env = { SITE_URL: 'https://like-dealer.com' };
  assert.equal(checkoutReturnOrigin(env, 'http://127.0.0.1:8765'), 'http://127.0.0.1:8765');
  assert.equal(checkoutReturnOrigin(env, 'https://evil.example'), 'https://like-dealer.com');
  assert.equal(checkoutReturnOrigin(env, ''), 'https://like-dealer.com');
  assert.equal(
    checkoutReturnOrigin({ ...env, CORS_ALLOW_ORIGINS: 'https://like-dealer.com,https://preview.like-dealer.com' }, 'https://preview.like-dealer.com'),
    'https://preview.like-dealer.com'
  );
});
