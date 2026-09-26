#!/usr/bin/env node
/**
 * Load tmp-deploy/mcp-<slug>-args.json and invoke user-supabase deploy_edge_function
 * when running inside Cursor agent (globalThis.__cursorMcpInvoke).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const slug = process.argv[2];
if (!slug) {
  console.error('Usage: node scripts/mcp-deploy-args-runner.mjs <slug>');
  process.exit(1);
}
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const argsPath = path.join(root, 'tmp-deploy', `mcp-${slug}-args.json`);
const args = JSON.parse(fs.readFileSync(argsPath, 'utf8'));
const payload = {
  name: args.name,
  entrypoint_path: args.entrypoint_path,
  verify_jwt: args.verify_jwt,
  files: args.files,
};
const invoke = globalThis.__cursorMcpInvoke;
if (typeof invoke !== 'function') {
  console.log(
    JSON.stringify({
      ok: false,
      error: '__cursorMcpInvoke unavailable',
      slug,
      fileCount: payload.files.length,
      bytes: JSON.stringify(payload).length,
    })
  );
  process.exit(3);
}
const result = await invoke('user-supabase', 'deploy_edge_function', payload);
console.log(JSON.stringify({ ok: true, slug, result }));
