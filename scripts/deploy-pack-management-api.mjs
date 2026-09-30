#!/usr/bin/env node
/**
 * Deploy one slug using Management API (same body as deploy_edge_function MCP).
 * Token: SUPABASE_ACCESS_TOKEN or supabase/.access-token
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_REF = 'xvrvxofujpqavgnprpmq';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const slug = process.argv[2];
const useFull = process.argv.includes('--full');
if (!slug) {
  console.error('Usage: node scripts/deploy-pack-management-api.mjs <slug> [--full]');
  process.exit(1);
}

function loadToken() {
  const fromEnv = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const tokenPath = path.join(root, 'supabase', '.access-token');
  if (fs.existsSync(tokenPath)) return fs.readFileSync(tokenPath, 'utf8').trim();
  return '';
}

function loadPack() {
  const mcpPath = path.join(root, 'tmp-deploy', `mcp-${slug}-args.json`);
  if (fs.existsSync(mcpPath)) return JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
  const packPath = path.join(root, 'tmp-deploy', `${slug}${useFull ? '' : '-compact'}.json`);
  const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
  return {
    name: pack.name,
    entrypoint_path: pack.entrypoint_path,
    verify_jwt: false,
    files: pack.files,
  };
}

const token = loadToken();
const pack = loadPack();
const url = `https://api.supabase.com/v1/projects/${PROJECT_REF}/functions/deploy?slug=${encodeURIComponent(slug)}`;
const body = {
  name: pack.name,
  entrypoint_path: pack.entrypoint_path,
  verify_jwt: false,
  files: pack.files,
};

async function deployOnce() {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { res, text };
}

if (!token) {
  console.log(JSON.stringify({ slug, ok: false, error: 'no_management_token', need: 'SUPABASE_ACCESS_TOKEN or supabase/.access-token' }));
  process.exit(2);
}

let { res, text } = await deployOnce();
if (!res.ok && /payload|size|too large/i.test(text) && !useFull) {
  const fullPath = path.join(root, 'tmp-deploy', `${slug}.json`);
  if (fs.existsSync(fullPath)) {
    const full = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    body.files = full.files;
    ({ res, text } = await deployOnce());
  }
}

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
