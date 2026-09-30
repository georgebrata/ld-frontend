#!/usr/bin/env node
/**
 * Print deploy_edge_function arguments JSON (stdout) from tmp-deploy/mcp-<slug>-args.json
 * or from {slug}-compact.json. For agent MCP invoke.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const slug = process.argv[2];
const useFull = process.argv.includes('--full');
if (!slug) process.exit(1);

const mcpPath = path.join(root, 'tmp-deploy', `mcp-${slug}-args.json`);
let args;
if (fs.existsSync(mcpPath)) {
  args = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
} else {
  const packPath = path.join(root, 'tmp-deploy', `${slug}${useFull ? '' : '-compact'}.json`);
  const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
  args = {
    project_id: 'xvrvxofujpqavgnprpmq',
    name: pack.name,
    entrypoint_path: pack.entrypoint_path,
    verify_jwt: false,
    files: pack.files,
  };
}
if (!args.project_id) args.project_id = 'xvrvxofujpqavgnprpmq';
process.stdout.write(JSON.stringify(args));
