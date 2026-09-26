#!/usr/bin/env node
/** Load tmp-deploy/mcp-<slug>-args.json and print deploy_edge_function arguments JSON to stdout. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const slug = process.argv[2];
if (!slug) {
  console.error('Usage: node scripts/mcp-invoke-deploy-slug.mjs <slug>');
  process.exit(1);
}
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const argsPath = path.join(root, 'tmp-deploy', `mcp-${slug}-args.json`);
const args = JSON.parse(fs.readFileSync(argsPath, 'utf8'));
process.stdout.write(
  JSON.stringify({
    name: args.name,
    entrypoint_path: args.entrypoint_path,
    verify_jwt: args.verify_jwt,
    files: args.files,
  })
);
