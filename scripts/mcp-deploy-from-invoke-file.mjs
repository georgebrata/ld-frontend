#!/usr/bin/env node
/**
 * Deploy tmp-deploy/_invoke-<slug>.json via Supabase Management API (same as deploy_edge_function).
 * Usage: SUPABASE_ACCESS_TOKEN=... node scripts/mcp-deploy-from-invoke-file.mjs <slug> [--full]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_REF = 'xvrvxofujpqavgnprpmq';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const slug = process.argv[2];
const useFull = process.argv.includes('--full');
if (!slug) process.exit(1);

function token() {
  const e = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (e) return e;
  const p = path.join(root, 'supabase', '.access-token');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : '';
}

function loadArgs() {
  const invoke = path.join(root, 'tmp-deploy', `_invoke-${slug}.json`);
  if (fs.existsSync(invoke)) return JSON.parse(fs.readFileSync(invoke, 'utf8'));
  const packPath = path.join(root, 'tmp-deploy', `${slug}${useFull ? '' : '-compact'}.json`);
  const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
  return {
    project_id: PROJECT_REF,
    name: pack.name,
    entrypoint_path: pack.entrypoint_path,
    verify_jwt: false,
    files: pack.files,
  };
}

async function post(body, usedFull) {
  const t = token();
  if (!t) {
    return {
      slug,
      ok: false,
      via: 'needs_mcp_deploy_edge_function',
      invokePath: path.join(root, 'tmp-deploy', `_invoke-${slug}.json`),
      error: 'no_management_token',
    };
  }
  const url = `https://api.supabase.com/v1/projects/${PROJECT_REF}/functions/deploy?slug=${encodeURIComponent(slug)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: body.name,
      entrypoint_path: body.entrypoint_path,
      verify_jwt: body.verify_jwt ?? false,
      files: body.files,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    return {
      slug,
      ok: false,
      via: 'management_api',
      status: res.status,
      usedFull,
      error: text.slice(0, 800),
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text.slice(0, 200) };
  }
  return { slug, ok: true, via: 'management_api', usedFull, ...parsed };
}

let args = loadArgs();
let result = await post(args, false);
if (!result.ok && /payload|size|too large|413/i.test(String(result.error || '')) && !useFull) {
  const fullPath = path.join(root, 'tmp-deploy', `${slug}.json`);
  if (fs.existsSync(fullPath)) {
    const pack = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    args = { ...args, files: pack.files };
    result = await post(args, true);
  }
}
console.log(JSON.stringify(result));
process.exit(result.ok ? 0 : result.error === 'no_management_token' ? 2 : 1);
