#!/usr/bin/env node
/**
 * Deploy one slug via Management API (same payload as deploy_edge_function).
 * Reads JSON args from stdin (full deploy_edge_function arguments object).
 * Token: SUPABASE_ACCESS_TOKEN or supabase/.access-token
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadToken() {
  const fromEnv = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const tokenPath = path.join(root, 'supabase', '.access-token');
  if (fs.existsSync(tokenPath)) return fs.readFileSync(tokenPath, 'utf8').trim();
  return '';
}

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const raw = Buffer.concat(chunks).toString('utf8');
const args = JSON.parse(raw);
const slug = args.name;
const token = loadToken();
if (!token) {
  console.log(JSON.stringify({ slug, ok: false, error: 'no_management_token' }));
  process.exit(2);
}
const projectId = args.project_id || 'xvrvxofujpqavgnprpmq';
const url = `https://api.supabase.com/v1/projects/${projectId}/functions/deploy?slug=${encodeURIComponent(slug)}`;
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
  console.log(JSON.stringify({ slug, ok: false, status: res.status, error: text.slice(0, 800) }));
  process.exit(1);
}
let body;
try {
  body = JSON.parse(text);
} catch {
  body = { raw: text.slice(0, 300) };
}
console.log(JSON.stringify({ slug, ok: true, status: res.status, ...body }));
