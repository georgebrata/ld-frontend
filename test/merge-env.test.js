import { test } from 'node:test';
import assert from 'node:assert/strict';

/** Mirror of context.js mergeEnv + DENO_ONLY for Node tests (no Deno imports). */
const DENO_ONLY = new Set(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SOCIALPANEL24_ENABLED']);
const ENV_KEYS = ['SOCIALPANEL24_ENABLED', 'PROVIDER_ENV'];

function mergeEnv(env, extra) {
  const merged = {};
  Object.entries(extra || {}).forEach(([key, value]) => {
    if (!ENV_KEYS.includes(key) || DENO_ONLY.has(key)) return;
    if (value) merged[key] = String(value);
  });
  Object.entries(env || {}).forEach(([key, value]) => {
    if (value != null && value !== '') merged[key] = String(value);
  });
  return merged;
}

test('SOCIALPANEL24_ENABLED cannot be enabled from app_secrets overlay', () => {
  const merged = mergeEnv({ SOCIALPANEL24_ENABLED: 'false' }, { SOCIALPANEL24_ENABLED: 'true' });
  assert.equal(merged.SOCIALPANEL24_ENABLED, 'false');
});

test('SOCIALPANEL24_ENABLED is true only when set in process env', () => {
  const merged = mergeEnv({ SOCIALPANEL24_ENABLED: 'true' }, { SOCIALPANEL24_ENABLED: 'false' });
  assert.equal(merged.SOCIALPANEL24_ENABLED, 'true');
});
