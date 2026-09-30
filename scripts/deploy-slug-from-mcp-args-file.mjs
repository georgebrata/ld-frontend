#!/usr/bin/env node
/** Deploy slug using tmp-deploy/mcp-<slug>-args.json via Management API (MCP-equivalent body). */
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

async function deployFromPack(full) {
  const compact = path.join(root, 'tmp-deploy', `${slug}-compact.json`);
  const fullPath = path.join(root, 'tmp-deploy', `${slug}.json`);
  const packPath = full ? fullPath : compact;
  const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
  return {
    name: pack.name,
    entrypoint_path: pack.entrypoint_path,
    verify_jwt: false,
    files: pack.files,
  };
}

async function deploy(body) {
  const t = token();
  if (!t) return { slug, ok: false, error: 'no_management_token', via: 'management_api' };
  const url = `https://api.supabase.com/v1/projects/${PROJECT_REF}/functions/deploy?slug=${encodeURIComponent(slug)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    return { slug, ok: false, via: 'management_api', status: res.status, error: text.slice(0, 800), usedFull: body._usedFull };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text.slice(0, 200) };
  }
  return { slug, ok: true, via: 'management_api', status: res.status, ...parsed };
}

let body = await deployFromPack(false);
body._usedFull = false;
let result = await deploy(body);
if (!result.ok && /payload|size|too large|413/i.test(String(result.error || ''))) {
  body = await deployFromPack(true);
  body._usedFull = true;
  result = await deploy(body);
}
delete result._usedFull;
console.log(JSON.stringify(result));
process.exit(result.ok ? 0 : 1);
