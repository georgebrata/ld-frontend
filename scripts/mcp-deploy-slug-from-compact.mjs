#!/usr/bin/env node
/**
 * Load tmp-deploy/{slug}-compact.json and POST to Supabase Management API
 * (same body as deploy_edge_function). Token: argv[3], SUPABASE_ACCESS_TOKEN, or supabase/.access-token
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ID = 'xvrvxofujpqavgnprpmq';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const slug = process.argv[2];
if (!slug) {
  console.error('Usage: node scripts/mcp-deploy-slug-from-compact.mjs <slug> [token-file]');
  process.exit(1);
}

function loadToken() {
  const fromEnv = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const tokenFile = process.argv[3];
  if (tokenFile && fs.existsSync(tokenFile)) return fs.readFileSync(tokenFile, 'utf8').trim();
  const tokenPath = path.join(root, 'supabase', '.access-token');
  if (fs.existsSync(tokenPath)) return fs.readFileSync(tokenPath, 'utf8').trim();
  return '';
}

const packPath = path.join(root, 'tmp-deploy', `${slug}-compact.json`);
const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
const token = loadToken();

const body = {
  name: pack.name,
  entrypoint_path: pack.entrypoint_path,
  verify_jwt: false,
  files: pack.files,
};

if (!token) {
  console.log(
    JSON.stringify({
      slug,
      ok: false,
      error: 'no_management_token',
      hint: 'Use plugin-supabase deploy_edge_function with tmp-deploy/_invoke-' + slug + '.json',
      fileCount: body.files.length,
      bytes: JSON.stringify(body).length,
    })
  );
  process.exit(2);
}

const url = `https://api.supabase.com/v1/projects/${PROJECT_ID}/functions/deploy?slug=${encodeURIComponent(slug)}`;
const res = await fetch(url, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const text = await res.text();
if (!res.ok) {
  console.log(JSON.stringify({ slug, ok: false, status: res.status, error: text.slice(0, 800) }));
  process.exit(1);
}
let parsed;
try {
  parsed = JSON.parse(text);
} catch {
  parsed = { raw: text.slice(0, 300) };
}
console.log(JSON.stringify({ slug, ok: true, status: res.status, ...parsed }));
