/**
 * Pack all ten Edge Functions for MCP deploy_edge_function.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fnRoot = path.join(root, 'supabase/functions');
const outDir = path.join(root, 'tmp-deploy');

const FUNCTIONS = [
  'catalogue',
  'create-checkout',
  'stripe-webhook',
  'order-status',
  'process-jobs',
  'refresh-catalogue',
  'health',
  'operator',
  'resend-webhook',
  'admin',
];

/** @param {string} entryRel */
function collectShared(entryRel) {
  const files = new Map();
  const sharedDir = path.join(fnRoot, '_shared');
  files.set(entryRel, fs.readFileSync(path.join(fnRoot, entryRel), 'utf8'));
  for (const abs of walkJs(sharedDir)) {
    const rel = `_shared/${path.relative(sharedDir, abs).replace(/\\/g, '/')}`;
    files.set(rel, fs.readFileSync(abs, 'utf8'));
  }
  return [...files.entries()].map(([name, content]) => ({ name, content }));
}

/** @param {string} dir */
function walkJs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJs(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

fs.mkdirSync(outDir, { recursive: true });
const summary = [];
for (const name of FUNCTIONS) {
  const entry = `${name}/index.js`;
  const files = collectShared(entry);
  const pack = {
    name,
    entrypoint_path: entry,
    verify_jwt: false,
    files,
  };
  fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(pack));
  summary.push({ name, fileCount: files.length, bytes: Buffer.byteLength(JSON.stringify(pack)) });
}
console.log(JSON.stringify(summary, null, 2));
