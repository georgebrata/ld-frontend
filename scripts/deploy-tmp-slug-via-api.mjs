#!/usr/bin/env node
/** Deploy one slug from tmp-deploy/mcp-<slug>-args.json via Management API (fallback). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_REF = 'xvrvxofujpqavgnprpmq';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const slug = process.argv[2];
const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
if (!slug || !token) {
  console.error('Usage: SUPABASE_ACCESS_TOKEN=... node scripts/deploy-tmp-slug-via-api.mjs <slug>');
  process.exit(1);
}
const argsPath = path.join(root, 'tmp-deploy', `mcp-${slug}-args.json`);
const args = JSON.parse(fs.readFileSync(argsPath, 'utf8'));
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
  console.error(JSON.stringify({ slug, ok: false, status: res.status, body: text.slice(0, 800) }));
  process.exit(1);
}
let parsed;
try {
  parsed = JSON.parse(text);
} catch {
  parsed = { raw: text.slice(0, 300) };
}
console.log(JSON.stringify({ slug, ok: true, ...parsed }));
