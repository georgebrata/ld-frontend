/**
 * Pack Edge Functions for MCP deploy_edge_function.
 * Resolves relative ../_shared imports. Skips store-memory.js.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fnRoot = path.join(root, 'supabase/functions');
const outDir = path.join(root, 'tmp-deploy');

const FUNCTIONS = ['catalogue', 'create-checkout', 'stripe-webhook', 'order-status', 'process-jobs'];
const SKIP = new Set(['store-memory.js']);

function collect(entryRel) {
  const files = new Map();
  const queue = [entryRel];
  while (queue.length) {
    const rel = queue.shift();
    if (files.has(rel)) continue;
    const abs = path.join(fnRoot, rel);
    const content = fs.readFileSync(abs, 'utf8');
    files.set(rel, content);
    const dir = path.posix.dirname(rel);
    for (const match of content.matchAll(/from ['"](\.\.?\/[^'"]+)['"]/g)) {
      let spec = match[1];
      if (!spec.endsWith('.js')) spec += '.js';
      const resolved = path.posix.normalize(`${dir}/${spec}`);
      const base = path.posix.basename(resolved);
      if (SKIP.has(base)) continue;
      queue.push(resolved);
    }
  }
  return [...files.entries()].map(([name, content]) => ({ name, content }));
}

function compactJs(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const trimmed = line.replace(/^\s+/, '');
      return trimmed.startsWith('//') ? '' : trimmed;
    })
    .filter(Boolean)
    .join('\n');
}

fs.mkdirSync(outDir, { recursive: true });
const summary = [];
for (const name of FUNCTIONS) {
  const entry = `${name}/index.js`;
  const files = collect(entry);
  const pack = {
    name,
    entrypoint_path: entry,
    verify_jwt: false,
    files,
  };
  const compact = {
    ...pack,
    files: files.map((file) => ({ name: file.name, content: compactJs(file.content) })),
  };
  fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(pack));
  fs.writeFileSync(path.join(outDir, `${name}-compact.json`), JSON.stringify(compact));
  summary.push({
    name,
    files: files.map((f) => f.name),
    bytes: Buffer.byteLength(JSON.stringify(pack)),
    compactBytes: Buffer.byteLength(JSON.stringify(compact)),
  });
}
console.log(JSON.stringify(summary, null, 2));
