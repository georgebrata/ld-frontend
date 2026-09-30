#!/usr/bin/env node
/**
 * Read tmp-deploy/{slug}-compact.json and print deploy_edge_function args (stdout).
 * Agent should invoke plugin-supabase-supabase deploy_edge_function with this JSON.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ID = 'xvrvxofujpqavgnprpmq';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const slug = process.argv[2];
const useFull = process.argv.includes('--full');
if (!slug) process.exit(1);
const packPath = path.join(root, 'tmp-deploy', `${slug}${useFull ? '' : '-compact'}.json`);
const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
process.stdout.write(
  JSON.stringify({
    project_id: PROJECT_ID,
    name: pack.name,
    entrypoint_path: pack.entrypoint_path,
    verify_jwt: false,
    files: pack.files,
  })
);
