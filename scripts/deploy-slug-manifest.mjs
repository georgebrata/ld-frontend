#!/usr/bin/env node
/** Print deploy args for one slug (stdout). Used with Supabase MCP deploy_edge_function. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const slug = process.argv[2];
if (!slug) {
  console.error('Usage: node scripts/deploy-slug-manifest.mjs <slug>');
  process.exit(1);
}
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, `.deploy-${slug}.manifest.json`), 'utf8'));
const files = manifest.filePaths.map((rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')));
const args = {
  name: manifest.name,
  entrypoint_path: manifest.entrypoint_path,
  verify_jwt: manifest.verify_jwt,
  files,
};
process.stdout.write(JSON.stringify(args));
