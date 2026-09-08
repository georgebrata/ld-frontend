import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeInputValues, canonicalInputName, normalizeNewlineList, parseInputList } from '../supabase/functions/_shared/inputs.js';
import { serializeProviderAdd } from '../supabase/functions/_shared/provider-types.js';
import { parseInputs } from '../js/api/services-api.js';
import { validateInput } from '../js/utils/validation.js';
import { validatePlatformUrl } from '../js/utils/urls.js';

test('aliases map commentsList to canonical comments', () => {
  assert.equal(canonicalInputName('commentsList'), 'comments');
  assert.equal(canonicalInputName('commentslist'), 'comments');
  assert.deepEqual(parseInputList('url, commentsList'), ['url', 'comments']);
  assert.deepEqual(parseInputs('URL, commentslist'), ['url', 'comments']);
});

test('newline lists keep entry text and drop blank lines', () => {
  const list = normalizeNewlineList('hello \r\n\nworld');
  assert.equal(list.count, 2);
  assert.equal(list.entries[0], 'hello ');
  assert.equal(list.text, 'hello \nworld');
});

test('custom comments serializer omits quantity and preserves multiline text', () => {
  const params = serializeProviderAdd('Custom Comments', {
    platform: 'instagram',
    quantity: 99,
    inputs: {
      url: 'https://instagram.com/p/x',
      comments: 'one\ntwo',
    },
  });
  assert.equal(params.comments, 'one\ntwo');
  assert.equal(params.quantity, undefined);
  assert.equal(params.link, 'https://instagram.com/p/x');
  assert.equal(params.service, undefined);
});

test('default serializer sends quantity and drops unknown browser fields', () => {
  const params = serializeProviderAdd('Default', {
    platform: 'instagram',
    quantity: 500,
    inputs: { url: 'https://instagram.com/p/x', evil: 'nope', commentsList: 'ignored-for-default' },
  });
  assert.equal(params.quantity, '500');
  assert.equal(params.evil, undefined);
  assert.equal(params.comments, undefined);
});

test('web traffic requires numeric device codes, not Desktop', () => {
  assert.throws(() =>
    serializeProviderAdd('Web Traffic', {
      platform: 'instagram',
      quantity: 100,
      inputs: {
        url: 'https://instagram.com/p/x',
        country: 'US',
        device: 'Desktop',
        type_of_traffic: '3',
      },
    })
  );
  const params = serializeProviderAdd('Web Traffic', {
    platform: 'other',
    quantity: 100,
    inputs: {
      url: 'https://example.com/',
      country: 'US',
      device: '1',
      type_of_traffic: '3',
    },
  });
  assert.equal(params.device, '1');
});

test('subscriptions stay unavailable', () => {
  assert.throws(() =>
    serializeProviderAdd('Subscriptions', {
      platform: 'instagram',
      quantity: 1,
      inputs: { username: 'x' },
    })
  );
});

test('URL validation uses parsed hosts rather than substrings', () => {
  assert.equal(validatePlatformUrl('https://instagram.com/p/x', 'instagram').ok, true);
  assert.equal(validatePlatformUrl('https://notinstagram.com/p/x', 'instagram').ok, false);
  assert.equal(validatePlatformUrl('https://evil.com/?q=instagram.com', 'instagram').ok, false);
  assert.equal(validateInput('comments', 'nice\nwork').valid, true);
  assert.equal(validateInput('commentsList', 'nice').valid, true);
});

test('canonicalizeInputValues maps commentsList through to comments', () => {
  const values = canonicalizeInputValues({ commentsList: 'a\nb', url: 'https://instagram.com/p/x', extra: 'drop' });
  assert.equal(values.comments, 'a\nb');
  assert.equal(values.extra, undefined);
});
