#!/usr/bin/env node
/**
 * Read tmp-deploy/_catalogue-mcp-out.json style payload path from argv[3]
 * or default tmp-deploy/.deploy-<slug>-payload.json and print summary for agent MCP call.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const slug = process.argv[2];
const payloadPath =
  process.argv[3] ||
  path.join(root, 'tmp-deploy', `_ ${slug}-mcp-out.json`.replace('_ ', '_').replace(' ', '')) ||
  path.join(root, 'tmp-deploy', `.deploy-${slug}-payload.json`);

const defaultPath = path.join(root, 'tmp-deploy', `_ ${slug}-mcp-out.json`.replace('_ ', '_'));
const resolved =
  process.argv[3] ||
  (fs.existsSync(path.join(root, 'tmp-deploy', `_ ${slug}-mcp-out.json`.replace('_ ', '_')))
    ? path.join(root, 'tmp-deploy', `_${slug}-mcp-out.json`.replace('_catalogue', 'catalogue'))
    : path.join(root, 'tmp-deploy', `.deploy-${slug}-payload.json`));

// simplify: explicit paths only
const paths = [
  process.argv[3],
  path.join(root, 'tmp-deploy', `_ ${slug}-mcp-out.json`),
  path.join(root, 'tmp-deploy', `.deploy-${slug}-payload.json`),
  path.join(root, 'tmp-deploy', `mcp-${slug}-args.json`),
].filter(Boolean);

let file = paths.find((p) => fs.existsSync(p));
if (!file) {
  const compact = path.join(root, 'tmp-deploy', `${slug}-compact.json`);
  if (!fs.existsSync(compact)) {
    console.error(JSON.stringify({ ok: false, error: 'no payload', slug }));
    process.exit(1);
  }
  const pack = JSON.parse(fs.readFileSync(compact, 'utf8'));
  file = path.join(root, 'tmp-deploy', `.deploy-${slug}-payload.json`);
  fs.writeFileSync(
    file,
    JSON.stringify({
      project_id: 'xvrvxofujpqavgnprpmq',
      name: pack.name,
      entrypoint_path: pack.entrypoint_path,
      verify_jwt: false,
      files: pack.files,
    })
  );
}

const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
console.log(JSON.stringify({ slug, file, bytes: fs.statSync(file).size, files: payload.files.length }));
