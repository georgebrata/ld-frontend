#!/usr/bin/env node
/** Deploy from a single args JSON file (e.g. deploy-process-jobs.args.json). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_REF = 'xvrvxofujpqavgnprpmq';
const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
const file = process.argv[2];
if (!token || !file) {
  console.error('Usage: SUPABASE_ACCESS_TOKEN=... node scripts/deploy-args-file.mjs <args.json>');
  process.exit(1);
}
const args = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
const slug = args.name;
const url = `https://api.supabase.com/v1/projects/${PROJECT_REF}/functions/deploy?slug=${encodeURIComponent(slug)}`;
const res = await fetch(url, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: args.name,
    entrypoint_path: args.entrypoint_path,
    verify_jwt: args.verify_jwt ?? false,
    files: args.files,
  }),
});
const text = await res.text();
if (!res.ok) {
  console.error(`Deploy ${slug} failed (${res.status}):`, text.slice(0, 800));
  process.exit(1);
}
console.log(`Deployed ${slug}:`, text.slice(0, 300));
