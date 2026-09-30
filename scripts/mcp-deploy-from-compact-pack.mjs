#!/usr/bin/env node
/**
 * Build tmp-deploy/mcp-<slug>-args.json from tmp-deploy/<slug>-compact.json (or .json with --full).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const slug = process.argv[2];
const useFull = process.argv.includes('--full');
if (!slug) {
  console.error('Usage: node scripts/mcp-deploy-from-compact-pack.mjs <slug> [--full]');
  process.exit(1);
}
const packPath = path.join(root, 'tmp-deploy', `${slug}${useFull ? '' : '-compact'}.json`);
const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
const args = {
  project_id: 'xvrvxofujpqavgnprpmq',
  name: pack.name,
  entrypoint_path: pack.entrypoint_path,
  verify_jwt: false,
  files: pack.files,
};
const outPath = path.join(root, 'tmp-deploy', `mcp-${slug}-args.json`);
fs.writeFileSync(outPath, JSON.stringify(args));
console.log(JSON.stringify({ slug, packPath, outPath, bytes: fs.statSync(outPath).size, files: args.files.length }));
