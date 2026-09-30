#!/usr/bin/env node
/**
 * Parse tmp-deploy/mcp-<slug>-args.lines.txt (or build from compact pack) and
 * POST to Supabase Management API — same payload as MCP deploy_edge_function.
 * Requires SUPABASE_ACCESS_TOKEN or supabase/.access-token.
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

function loadArgs(slug, useFull) {
  const linesPath = path.join(root, 'tmp-deploy', `mcp-${slug}-args.lines.txt`);
  if (fs.existsSync(linesPath) && !useFull) {
    return JSON.parse(fs.readFileSync(linesPath, 'utf8').replace(/\n/g, ''));
  }
  const packPath = path.join(root, 'tmp-deploy', `${slug}${useFull ? '' : '-compact'}.json`);
  const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
  return {
    project_id: PROJECT_ID,
    name: pack.name,
    entrypoint_path: pack.entrypoint_path,
    verify_jwt: false,
    files: pack.files,
  };
}

const slug = process.argv[2];
const useFull = process.argv.includes('--full');
if (!slug) {
  console.error('Usage: SUPABASE_ACCESS_TOKEN=... node scripts/mcp-deploy-slug-from-lines.mjs <slug> [--full]');
  process.exit(1);
}

const token = loadToken();
if (!token) {
  console.log(JSON.stringify({ slug, ok: false, error: 'missing_token', hint: 'Use MCP deploy_edge_function or set SUPABASE_ACCESS_TOKEN' }));
  process.exit(2);
}

async function attempt(full) {
  const args = loadArgs(slug, full);
  const url = `https://api.supabase.com/v1/projects/${PROJECT_ID}/functions/deploy?slug=${encodeURIComponent(slug)}`;
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
  return { full, status: res.status, ok: res.ok, text };
}

let result = await attempt(false);
if (!result.ok && /payload|size|too large|413|limit/i.test(result.text)) {
  result = await attempt(true);
}
if (!result.ok) {
  console.log(JSON.stringify({ slug, ok: false, status: result.status, usedFull: result.full, error: result.text.slice(0, 1200) }));
  process.exit(1);
}
let body;
try {
  body = JSON.parse(result.text);
} catch {
  body = { raw: result.text.slice(0, 400) };
}
console.log(JSON.stringify({ slug, ok: true, usedFull: result.full, ...body }));
