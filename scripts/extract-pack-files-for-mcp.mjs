#!/usr/bin/env node
/** Write each pack file to tmp-deploy/extracted/<slug>/<safeName>.content for agent MCP assembly. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const slug = process.argv[2];
const useFull = process.argv.includes('--full');
if (!slug) process.exit(1);
const packPath = path.join(root, 'tmp-deploy', `${slug}${useFull ? '' : '-compact'}.json`);
const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
const outDir = path.join(root, 'tmp-deploy', 'extracted', slug);
fs.mkdirSync(outDir, { recursive: true });
const meta = {
  project_id: 'xvrvxofujpqavgnprpmq',
  name: pack.name,
  entrypoint_path: pack.entrypoint_path,
  verify_jwt: false,
  files: pack.files.map((f, i) => {
    const safe = String(i).padStart(2, '0') + '-' + f.name.replace(/\//g, '__');
    fs.writeFileSync(path.join(outDir, `${safe}.txt`), f.content);
    return { index: i, name: f.name, path: `${safe}.txt`, bytes: Buffer.byteLength(f.content) };
  }),
};
fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 2));
console.log(JSON.stringify({ slug, fileCount: meta.files.length, outDir }));
