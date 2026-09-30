#!/usr/bin/env node
/**
 * Deploy via Management API using same payload as deploy_edge_function MCP.
 * Reads tmp-deploy/mcp-<slug>-args.json (or compact pack).
 * Token: SUPABASE_ACCESS_TOKEN or supabase/.access-token
 * On payload size errors, retries with tmp-deploy/<slug>.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_REF = 'xvrvxofujpqavgnprpmq';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadToken() {
  const fromEnv = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const tokenPath = path.join(root, 'supabase', '.access-token');
  if (fs.existsSync(tokenPath)) return fs.readFileSync(tokenPath, 'utf8').trim();
  return '';
}

function loadArgs(slug, useFull) {
  const mcpPath = path.join(root, 'tmp-deploy', `mcp-${slug}-args.json`);
  if (fs.existsSync(mcpPath) && !useFull) {
    return JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
  }
  const packPath = path.join(root, 'tmp-deploy', `${slug}${useFull ? '' : '-compact'}.json`);
  const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
  return {
    name: pack.name,
    entrypoint_path: pack.entrypoint_path,
    verify_jwt: false,
    files: pack.files,
  };
}

async function deploy(slug, useFull) {
  const token = loadToken();
  if (!token) {
    return { slug, ok: false, via: 'management_api', error: 'no_management_token' };
  }
  const args = loadArgs(slug, useFull);
  const url = `https://api.supabase.com/v1/projects/${PROJECT_REF}/functions/deploy?slug=${encodeURIComponent(slug)}`;
  const body = {
    name: args.name,
    entrypoint_path: args.entrypoint_path,
    verify_jwt: false,
    files: args.files,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    return {
      slug,
      ok: false,
      via: 'management_api',
      status: res.status,
      error: text.slice(0, 800),
      usedFull: useFull,
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text.slice(0, 200) };
  }
  return { slug, ok: true, via: 'management_api', status: res.status, usedFull: useFull, ...parsed };
}

const slug = process.argv[2];
if (!slug) process.exit(1);
let result = await deploy(slug, false);
if (!result.ok && /payload|size|too large|413/i.test(String(result.error || ''))) {
  const fullPath = path.join(root, 'tmp-deploy', `${slug}.json`);
  if (fs.existsSync(fullPath)) result = await deploy(slug, true);
}
console.log(JSON.stringify(result));
process.exit(result.ok ? 0 : 1);
