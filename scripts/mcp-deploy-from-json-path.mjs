#!/usr/bin/env node
/**
 * Deploy via plugin-supabase deploy_edge_function args JSON on disk.
 * Usage: node scripts/mcp-deploy-from-json-path.mjs <path-to-args.json>
 * When __cursorMcpInvoke is available (Cursor agent runtime), invokes MCP directly.
 */
import fs from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('Usage: node scripts/mcp-deploy-from-json-path.mjs <args.json>');
  process.exit(1);
}
const args = JSON.parse(fs.readFileSync(path, 'utf8'));
const invoke = globalThis.__cursorMcpInvoke;
if (typeof invoke === 'function') {
  const result = await invoke('plugin-supabase-supabase', 'deploy_edge_function', args);
  console.log(JSON.stringify({ ok: true, result }));
  process.exit(0);
}
console.log(JSON.stringify({ ok: false, error: 'needs_CallDynamicTool', slug: args.name, bytes: JSON.stringify(args).length }));
process.exit(2);
