#!/usr/bin/env node
/** Load tmp-deploy/mcp-<slug>-args.json; invoke deploy if __cursorMcpInvoke exists. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const slug = process.argv[2];
if (!slug) {
  console.error('Usage: node scripts/mcp-deploy-slug-direct-call.mjs <slug>');
  process.exit(1);
}
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = JSON.parse(fs.readFileSync(path.join(root, 'tmp-deploy', `mcp-${slug}-args.json`), 'utf8'));
const payload = {
  name: args.name,
  entrypoint_path: args.entrypoint_path,
  verify_jwt: args.verify_jwt,
  files: args.files,
};
const invoke = globalThis.__cursorMcpInvoke;
if (typeof invoke === 'function') {
  const result = await invoke('user-supabase', 'deploy_edge_function', payload);
  console.log(JSON.stringify(result));
  process.exit(0);
}
console.error('__cursorMcpInvoke not available; emit payload size for MCP call');
console.log(JSON.stringify({ slug, payloadBytes: JSON.stringify(payload).length, name: payload.name }));
