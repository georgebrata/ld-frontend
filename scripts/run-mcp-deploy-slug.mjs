#!/usr/bin/env node
/**
 * Deploy one slug: read tmp-deploy/<slug>-compact.json (or --full non-compact),
 * write MCP-shaped args, invoke Supabase Management API when SUPABASE_ACCESS_TOKEN is set.
 * For agents: also writes tmp-deploy/.deploy-<slug>-payload.json for MCP deploy_edge_function.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ID = 'xvrvxofujpqavgnprpmq';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const slug = process.argv[2];
const useFull = process.argv.includes('--full');
if (!slug) {
  console.error('Usage: node scripts/run-mcp-deploy-slug.mjs <slug> [--full]');
  process.exit(1);
}

function loadPack(full) {
  const packPath = path.join(root, 'tmp-deploy', `${slug}${full ? '' : '-compact'}.json`);
  if (!fs.existsSync(packPath)) throw new Error(`missing ${packPath}`);
  return JSON.parse(fs.readFileSync(packPath, 'utf8'));
}

let pack;
try {
  pack = loadPack(false);
} catch (e) {
  if (!useFull) throw e;
  pack = loadPack(true);
}

const payload = {
  project_id: PROJECT_ID,
  name: pack.name,
  entrypoint_path: pack.entrypoint_path,
  verify_jwt: false,
  files: pack.files,
};

const payloadPath = path.join(root, 'tmp-deploy', `.deploy-${slug}-payload.json`);
fs.writeFileSync(payloadPath, JSON.stringify(payload));

const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
if (!token) {
  console.log(
    JSON.stringify({
      slug,
      ok: false,
      reason: 'no_token',
      payloadPath,
      bytes: fs.statSync(payloadPath).size,
      files: payload.files.length,
      hint: 'Use MCP deploy_edge_function with payload at payloadPath',
    })
  );
  process.exit(0);
}

const url = `https://api.supabase.com/v1/projects/${PROJECT_ID}/functions/deploy?slug=${encodeURIComponent(slug)}`;
const res = await fetch(url, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: payload.name,
    entrypoint_path: payload.entrypoint_path,
    verify_jwt: payload.verify_jwt,
    files: payload.files,
  }),
});
const text = await res.text();
if (!res.ok) {
  console.log(JSON.stringify({ slug, ok: false, status: res.status, error: text.slice(0, 800), usedFull: false }));
  if (!useFull && /payload|size|too large|413/i.test(text)) {
    console.error('Retry with --full');
  }
  process.exit(1);
}
console.log(JSON.stringify({ slug, ok: true, status: res.status, body: text.slice(0, 400) }));
