#!/usr/bin/env node
/**
 * Post-deploy smoke against hosted Supabase functions.
 * Usage: SUPABASE_FUNCTIONS_URL=https://<ref>.supabase.co/functions/v1 node scripts/smoke-deploy.mjs
 */

const base = String(process.env.SUPABASE_FUNCTIONS_URL || '').replace(/\/$/, '');
const anon = process.env.SUPABASE_ANON_KEY || '';

if (!base) {
  console.error('Set SUPABASE_FUNCTIONS_URL');
  process.exit(1);
}

async function expectStatus(path, init, expected) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(anon ? { apikey: anon } : {}),
      ...(init.headers || {}),
    },
  });
  if (response.status !== expected) {
    const body = await response.text();
    throw new Error(`${path} expected ${expected}, got ${response.status}: ${body.slice(0, 200)}`);
  }
}

async function main() {
  await expectStatus('/process-jobs', { method: 'POST', body: '{}' }, 401);
  await expectStatus('/operator', { method: 'POST', body: '{}' }, 401);
  const catalogue = await fetch(`${base}/catalogue`, {
    headers: { Accept: 'application/json', ...(anon ? { apikey: anon } : {}) },
  });
  if (!catalogue.ok) throw new Error(`catalogue GET failed: ${catalogue.status}`);
  const json = await catalogue.json();
  if (!json || typeof json !== 'object') throw new Error('catalogue response is not JSON object');

  try {
    await expectStatus('/health', { method: 'GET' }, 200);
  } catch (err) {
    console.warn(String(err instanceof Error ? err.message : err));
  }

  console.log('smoke-deploy: ok');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
