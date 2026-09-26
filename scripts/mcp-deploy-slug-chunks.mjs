#!/usr/bin/env node
/**
 * Merge tmp-deploy/invoke-<slug>.part*.txt and write tmp-deploy/mcp-<slug>-args.json.
 * Usage: node scripts/mcp-deploy-slug-chunks.mjs [slug...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const slugs = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      'health',
      'operator',
      'resend-webhook',
      'catalogue',
      'create-checkout',
      'stripe-webhook',
      'order-status',
      'process-jobs',
      'refresh-catalogue',
      'admin',
    ];

function loadFromChunks(slug) {
  let s = '';
  for (let i = 0; ; i += 1) {
    const part = path.join(root, 'tmp-deploy', `invoke-${slug}.part${i}.txt`);
    if (!fs.existsSync(part)) break;
    s += fs.readFileSync(part, 'utf8');
  }
  if (!s) {
    const manifest = path.join(root, `.deploy-${slug}.manifest.json`);
    if (!fs.existsSync(manifest)) throw new Error(`missing manifest for ${slug}`);
    const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    const files = m.filePaths.map((rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')));
    return {
      name: m.name,
      entrypoint_path: m.entrypoint_path,
      verify_jwt: m.verify_jwt ?? false,
      files,
    };
  }
  return JSON.parse(s);
}

for (const slug of slugs) {
  const args = loadFromChunks(slug);
  const out = path.join(root, 'tmp-deploy', `mcp-${slug}-args.json`);
  fs.writeFileSync(out, JSON.stringify(args));
  console.log(JSON.stringify({ slug, files: args.files.length, bytes: fs.statSync(out).size }));
}
