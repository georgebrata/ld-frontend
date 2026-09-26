#!/usr/bin/env node
/**
 * Deploy all slugs via Supabase Management API (same payload as MCP deploy_edge_function).
 * Requires SUPABASE_ACCESS_TOKEN in env or path in argv[2].
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_REF = 'xvrvxofujpqavgnprpmq';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SLUGS = [
  'health',
  'operator',
  'resend-webhook',
  'catalogue',
  'create-checkout',
  'stripe-webhook',
  'order-status',
  'process-jobs',
  'refresh-catalogue',
  'admin',
];

function loadToken() {
  const fromEnv = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const tokenFile = process.argv[2];
  if (tokenFile && fs.existsSync(tokenFile)) return fs.readFileSync(tokenFile, 'utf8').trim();
  return '';
}

const token = loadToken();
if (!token) {
  console.error('Set SUPABASE_ACCESS_TOKEN or pass token file path as argv[2]');
  process.exit(2);
}

const results = [];

for (const slug of SLUGS) {
  const argsPath = path.join(root, 'tmp-deploy', `mcp-${slug}-args.json`);
  const args = JSON.parse(fs.readFileSync(argsPath, 'utf8'));
  const url = `https://api.supabase.com/v1/projects/${PROJECT_REF}/functions/deploy?slug=${encodeURIComponent(slug)}`;
  try {
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
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 500) };
    }
    if (!res.ok) {
      results.push({ slug, ok: false, status: res.status, ...body });
      continue;
    }
    results.push({
      slug,
      ok: true,
      version: body.version ?? body.id ?? null,
      ...body,
    });
  } catch (err) {
    results.push({ slug, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

console.log(JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
process.exit(failed.length ? 1 : 0);
