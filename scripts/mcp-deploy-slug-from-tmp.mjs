#!/usr/bin/env node
/**
 * Load tmp-deploy/mcp-<slug>-args.json (Node fs) and deploy via Supabase Management API.
 * Primary path for agents when MCP tool args exceed editor read limits.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_REF = 'xvrvxofujpqavgnprpmq';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const slug = process.argv[2];
if (!slug) {
  console.error('Usage: node scripts/mcp-deploy-slug-from-tmp.mjs <slug>');
  process.exit(1);
}
const argsPath = path.join(root, 'tmp-deploy', `mcp-${slug}-args.json`);
const args = JSON.parse(fs.readFileSync(argsPath, 'utf8'));
const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
if (!token) {
  console.error('SUPABASE_ACCESS_TOKEN is required for API deploy fallback');
  process.exit(2);
}
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
  console.error(JSON.stringify({ slug, ok: false, status: res.status, error: text.slice(0, 1000) }));
  process.exit(1);
}
let body;
try {
  body = JSON.parse(text);
} catch {
  body = { raw: text.slice(0, 500) };
}
console.log(JSON.stringify({ slug, ok: true, ...body }));
