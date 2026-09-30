#!/usr/bin/env node
/**
 * Deploy packed slug via Supabase Management API (same body as MCP deploy_edge_function).
 * Token: SUPABASE_ACCESS_TOKEN or supabase/.access-token
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ID = 'xvrvxofujpqavgnprpmq';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadToken() {
  const fromEnv = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const tokenPath = path.join(root, 'supabase', '.access-token');
  if (fs.existsSync(tokenPath)) return fs.readFileSync(tokenPath, 'utf8').trim();
  return '';
}

function loadPayload(slug, useFull) {
  const compactPath = path.join(root, 'tmp-deploy', `${slug}-compact.json`);
  const fullPath = path.join(root, 'tmp-deploy', `${slug}.json`);
  const packPath = useFull ? fullPath : compactPath;
  if (!fs.existsSync(packPath)) throw new Error(`missing ${packPath}`);
  const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
  return {
    name: pack.name,
    entrypoint_path: pack.entrypoint_path,
    verify_jwt: false,
    files: pack.files,
  };
}

const slug = process.argv[2];
if (!slug) {
  console.error('Usage: SUPABASE_ACCESS_TOKEN=... node scripts/mcp-deploy-via-plugin-bridge.mjs <slug>');
  process.exit(1);
}

const token = loadToken();
if (!token) {
  console.log(JSON.stringify({ slug, ok: false, error: 'missing SUPABASE_ACCESS_TOKEN' }));
  process.exit(2);
}

async function deploy(useFull) {
  const body = loadPayload(slug, useFull);
  const url = `https://api.supabase.com/v1/projects/${PROJECT_ID}/functions/deploy?slug=${encodeURIComponent(slug)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { useFull, status: res.status, ok: res.ok, text };
}

let result = await deploy(false);
if (!result.ok && /payload|size|too large|413|limit/i.test(result.text)) {
  result = await deploy(true);
}
if (!result.ok) {
  console.log(
    JSON.stringify({
      slug,
      ok: false,
      status: result.status,
      usedFull: result.useFull,
      error: result.text.slice(0, 1000),
    })
  );
  process.exit(1);
}
let parsed;
try {
  parsed = JSON.parse(result.text);
} catch {
  parsed = { raw: result.text.slice(0, 300) };
}
console.log(JSON.stringify({ slug, ok: true, usedFull: result.useFull, ...parsed }));
