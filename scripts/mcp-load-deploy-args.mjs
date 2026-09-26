#!/usr/bin/env node
/** Load deploy_edge_function args JSON (stdout) for MCP invoke. */
import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/mcp-load-deploy-args.mjs <args.json>');
  process.exit(1);
}
process.stdout.write(fs.readFileSync(file, 'utf8'));
