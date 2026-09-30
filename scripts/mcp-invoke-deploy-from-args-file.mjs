#!/usr/bin/env node
/**
 * Print deploy_edge_function MCP arguments (with project_id) for one slug.
 * Reads tmp-deploy/mcp-<slug>-args.json or tmp-deploy/<slug>-compact.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ID = 'xvrvxofujpqavgnprpmq';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const slug = process.argv[2];
const useFull = process.argv.includes('--full');
if (!slug) {
  console.error('Usage: node scripts/mcp-invoke-deploy-from-args-file.mjs <slug> [--full]');
  process.exit(1);
}

const argsPath = path.join(root, 'tmp-deploy', `mcp-${slug}-args.json`);
let pack;
if (fs.existsSync(argsPath) && !useFull) {
  pack = JSON.parse(fs.readFileSync(argsPath, 'utf8'));
} else {
  const packPath = path.join(root, 'tmp-deploy', `${slug}${useFull ? '' : '-compact'}.json`);
  const raw = JSON.parse(fs.readFileSync(packPath, 'utf8'));
  pack = {
    project_id: PROJECT_ID,
    name: raw.name,
    entrypoint_path: raw.entrypoint_path,
    verify_jwt: false,
    files: raw.files,
  };
}

const out = {
  project_id: pack.project_id || PROJECT_ID,
  name: pack.name,
  entrypoint_path: pack.entrypoint_path,
  verify_jwt: pack.verify_jwt ?? false,
  files: pack.files,
};
process.stdout.write(JSON.stringify(out));
