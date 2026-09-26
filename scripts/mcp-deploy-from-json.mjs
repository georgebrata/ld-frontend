#!/usr/bin/env node
/**
 * Emit deploy_edge_function arguments JSON for MCP (stdout).
 * Usage: node scripts/mcp-deploy-from-json.mjs [path-to-args.json]
 * Default: .agent-mcp-args/resend-webhook-for-deploy.json or assemble via slug arg.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const slug = process.argv[2];
let jsonPath = process.argv[3];

if (!jsonPath && slug && !slug.endsWith('.json')) {
  jsonPath = path.join(root, `.agent-mcp-args/${slug}-for-deploy.json`);
  if (!fs.existsSync(jsonPath)) {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, `.deploy-${slug}.manifest.json`), 'utf8'));
    const files = manifest.filePaths.map((rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')));
    const args = {
      name: manifest.name,
      entrypoint_path: manifest.entrypoint_path,
      verify_jwt: manifest.verify_jwt,
      files,
    };
    process.stdout.write(JSON.stringify(args));
    process.exit(0);
  }
}

if (!jsonPath) {
  jsonPath = path.join(root, '.agent-mcp-args/resend-webhook-for-deploy.json');
}

const args = JSON.parse(fs.readFileSync(path.resolve(jsonPath), 'utf8'));
process.stdout.write(JSON.stringify(args));
