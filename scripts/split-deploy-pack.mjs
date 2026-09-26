#!/usr/bin/env node
/** Split compact pack into .deploy-files/*.json for MCP deploy assembly. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const slug = process.argv[2];
if (!slug) {
  console.error('Usage: node scripts/split-deploy-pack.mjs <slug>');
  process.exit(1);
}
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pack = JSON.parse(fs.readFileSync(path.join(root, 'tmp-deploy', `${slug}-compact.json`), 'utf8'));
const outDir = path.join(root, '.deploy-files', slug);
fs.mkdirSync(outDir, { recursive: true });
pack.files.forEach((file, i) => {
  const safe = file.name.replace(/\//g, '__');
  fs.writeFileSync(path.join(outDir, `${String(i).padStart(2, '0')}_${safe}.json`), JSON.stringify(file));
});
const manifest = {
  name: pack.name,
  entrypoint_path: pack.entrypoint_path,
  verify_jwt: false,
  filePaths: pack.files.map((_, i) => {
    const safe = pack.files[i].name.replace(/\//g, '__');
    return `.deploy-files/${slug}/${String(i).padStart(2, '0')}_${safe}.json`;
  }),
};
fs.writeFileSync(path.join(root, `.deploy-${slug}.manifest.json`), JSON.stringify(manifest, null, 2));
console.log(`Wrote ${pack.files.length} files and manifest .deploy-${slug}.manifest.json`);
