#!/usr/bin/env node
/**
 * Deploy all packed functions via Supabase Management API.
 * Token: SUPABASE_ACCESS_TOKEN env, or first line of supabase/.access-token (gitignored).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_REF = 'xvrvxofujpqavgnprpmq';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tokenPath = path.join(root, 'supabase', '.access-token');

function loadToken() {
  const fromEnv = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  if (fs.existsSync(tokenPath)) return fs.readFileSync(tokenPath, 'utf8').trim();
  return '';
}

const token = loadToken();
if (!token) {
  console.error('Set SUPABASE_ACCESS_TOKEN or create supabase/.access-token (gitignored).');
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
  const packPath = path.join(root, 'tmp-deploy', `${slug}-compact.json`);
  const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
  const url = `https://api.supabase.com/v1/projects/${PROJECT_REF}/functions/deploy?slug=${encodeURIComponent(slug)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: pack.name,
      entrypoint_path: pack.entrypoint_path,
      verify_jwt: false,
      files: pack.files,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`${slug}: HTTP ${res.status}`, text.slice(0, 600));
    process.exit(1);
  }
  console.log(`${slug}: ok`, text.slice(0, 120));
}
