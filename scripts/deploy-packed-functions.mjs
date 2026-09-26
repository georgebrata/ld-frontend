#!/usr/bin/env node
/**
 * Deploy packed Edge Functions via Supabase Management API.
 * Requires: SUPABASE_ACCESS_TOKEN (from `supabase login` or dashboard token)
 * Usage: SUPABASE_ACCESS_TOKEN=... node scripts/deploy-packed-functions.mjs [slug...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_REF = 'xvrvxofujpqavgnprpmq';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'tmp-deploy');
const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
if (!token) {
  console.error('Missing SUPABASE_ACCESS_TOKEN. Run: supabase login');
  process.exit(1);
}

const slugs = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      'catalogue',
      'create-checkout',
      'stripe-webhook',
      'order-status',
      'process-jobs',
      'refresh-catalogue',
      'health',
      'operator',
      'resend-webhook',
      'admin',
    ];

for (const slug of slugs) {
  const file = path.join(outDir, `${slug}-compact.json`);
  if (!fs.existsSync(file)) {
    console.error(`Missing pack: ${file}. Run: node scripts/pack-functions.mjs`);
    process.exit(1);
  }
  const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
  const body = {
    name: pack.name,
    entrypoint_path: pack.entrypoint_path,
    verify_jwt: false,
    files: pack.files,
  };
  const url = `https://api.supabase.com/v1/projects/${PROJECT_REF}/functions/deploy?slug=${encodeURIComponent(slug)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`Deploy ${slug} failed (${res.status}):`, text.slice(0, 500));
    process.exit(1);
  }
  console.log(`Deployed ${slug}:`, text.slice(0, 200));
}
