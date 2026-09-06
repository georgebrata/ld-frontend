import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapFulfilmentParams, mapInputsToSheetFields, profileUrl } from '../src/mappers.js';

test('default mapper sends service + link + quantity', () => {
  assert.deepEqual(
    mapFulfilmentParams({
      socialPanelId: '11',
      quantity: 500,
      inputs: { url: 'https://instagram.com/p/x' },
    }),
    {
      action: 'add',
      service: '11',
      link: 'https://instagram.com/p/x',
      quantity: '500',
    }
  );
});

test('comments mapper omits quantity', () => {
  const params = mapFulfilmentParams({
    socialPanelId: '22',
    quantity: 3,
    inputs: { url: 'https://instagram.com/p/x', commentsList: 'one\ntwo' },
  });
  assert.equal(params.comments, 'one\ntwo');
  assert.equal(params.quantity, undefined);
});

test('username becomes a profile link and extra keys are ignored', () => {
  const params = mapFulfilmentParams({
    socialPanelId: '33',
    quantity: 100,
    platform: 'instagram',
    inputs: { username: '@dealer', evil: 'nope' },
  });
  assert.equal(params.link, profileUrl('instagram', 'dealer'));
  assert.equal(params.evil, undefined);
});

test('sheet mapping keeps URL compatible', () => {
  assert.deepEqual(mapInputsToSheetFields({ username: 'dealer' }), {
    url: 'dealer',
    notes: '',
  });
});
