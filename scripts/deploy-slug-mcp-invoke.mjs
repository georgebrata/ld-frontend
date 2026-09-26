#!/usr/bin/env node
/**
 * Deploy one slug via Supabase Management API (same payload as MCP deploy_edge_function).
 * Usage: SUPABASE_ACCESS_TOKEN=... node scripts/deploy-slug-mcp-invoke.mjs <slug>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_REF = 'xvrvxofujpqavgnprpmq';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const slug = process.argv[2];
if (!slug) {
  console.error('Usage: SUPABASE_ACCESS_TOKEN=... node scripts/deploy-slug-mcp-invoke.mjs <slug>');
  process.exit(1);
}

const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
if (!token) {
  console.error('Missing SUPABASE_ACCESS_TOKEN');
  process.exit(2);
}

const argsPath = path.join(root, 'tmp-deploy', `mcp-${slug}-args.json`);
if (!fs.existsSync(argsPath)) {
  console.error(`Missing ${argsPath}. Run: node scripts/mcp-deploy-slug-chunks.mjs ${slug}`);
  process.exit(2);
}
const args = JSON.parse(fs.readFileSync(argsPath, 'utf8'));

const url = `https://api.supabase.com/v1/projects/${PROJECT_REF}/functions/deploy?slug=${encodeURIComponent(slug)}`;
const res = await fetch(url, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: args.name,
    entrypoint_path: args.entrypoint_path,
    verify_jwt: false,
    files: args.files,
  }),
});
const text = await res.text();
if (!res.ok) {
  console.error(JSON.stringify({ slug, ok: false, status: res.status, body: text.slice(0, 500) }));
  process.exit(1);
}
console.log(JSON.stringify({ slug, ok: true, body: text.slice(0, 300) }));
