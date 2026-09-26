#!/usr/bin/env node
/** Merge tmp-deploy/invoke-<slug>.part*.txt and deploy via Management API (needs SUPABASE_ACCESS_TOKEN). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_REF = 'xvrvxofujpqavgnprpmq';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const slug = process.argv[2];
if (!slug) {
  console.error('Usage: node scripts/mcp-deploy-slug-from-chunks.mjs <slug>');
  process.exit(1);
}

function loadArgs() {
  const direct = path.join(root, 'tmp-deploy', `mcp-${slug}-args.json`);
  if (fs.existsSync(direct)) {
    return JSON.parse(fs.readFileSync(direct, 'utf8'));
  }
  const metaPath = path.join(root, 'tmp-deploy', `invoke-${slug}.meta.json`);
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  let s = '';
  for (let i = 0; i < meta.parts; i++) {
    s += fs.readFileSync(path.join(root, 'tmp-deploy', `invoke-${slug}.part${i}.txt`), 'utf8');
  }
  return JSON.parse(s);
}

const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
if (!token) {
  console.error(JSON.stringify({ slug, ok: false, error: 'SUPABASE_ACCESS_TOKEN required' }));
  process.exit(2);
}

const args = loadArgs();
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
let body;
try {
  body = JSON.parse(text);
} catch {
  body = { raw: text.slice(0, 800) };
}
if (!res.ok) {
  console.error(JSON.stringify({ slug, ok: false, status: res.status, ...body }));
  process.exit(1);
}
console.log(JSON.stringify({ slug, ok: true, ...body }));
