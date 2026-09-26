#!/usr/bin/env node
/**
 * Print a deploy_edge_function JSON payload (name + all imported files) for MCP/CLI.
 * Usage: node scripts/bundle-edge-function.mjs process-jobs
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FN_ROOT = path.join(ROOT, 'supabase/functions');

const name = process.argv[2];
if (!name) {
  console.error('Usage: node scripts/bundle-edge-function.mjs <function-slug>');
  process.exit(1);
}

/** @param {string} dir */
async function listJsFiles(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listJsFiles(full)));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

async function main() {
  const entry = path.join(FN_ROOT, name, 'index.js');
  await stat(entry);
  const sharedDir = path.join(FN_ROOT, '_shared');
  const files = [
    { name: `${name}/index.js`, content: await readFile(entry, 'utf8') },
  ];
  for (const abs of await listJsFiles(sharedDir)) {
    const rel = `_shared/${path.relative(sharedDir, abs).replace(/\\/g, '/')}`;
    files.push({ name: rel, content: await readFile(abs, 'utf8') });
  }
  const payload = {
    name,
    entrypoint_path: `${name}/index.js`,
    verify_jwt: false,
    files,
  };
  process.stdout.write(JSON.stringify(payload));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
