import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignServiceSlugs } from './slugs.js';

test('assignServiceSlugs keeps a product slug when it is unique', () => {
  const [row] = assignServiceSlugs([
    { id: '02', platform: 'instagram', service: 'Followers', slug: 'ig-followers' },
  ]);
  assert.equal(row.slug, 'ig-followers');
});

test('assignServiceSlugs derives a slug from the service name when none is set', () => {
  const [row] = assignServiceSlugs([{ id: '02', platform: 'instagram', service: 'Followers' }]);
  assert.equal(row.slug, 'followers');
});
