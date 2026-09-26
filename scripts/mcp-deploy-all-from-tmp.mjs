#!/usr/bin/env node
/**
 * Load tmp-deploy/mcp-<slug>-args.json per slug and print one JSON line per slug
 * for agent MCP deploy_edge_function invocations (metadata only on stdout).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SLUGS = [
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

for (const slug of SLUGS) {
  const argsPath = path.join(root, 'tmp-deploy', `mcp-${slug}-args.json`);
  if (!fs.existsSync(argsPath)) {
    console.log(JSON.stringify({ slug, ok: false, error: 'missing_args_file' }));
    continue;
  }
  try {
    const args = JSON.parse(fs.readFileSync(argsPath, 'utf8'));
    const outPath = path.join(root, 'tmp-deploy', `.mcp-invoke-${slug}.json`);
    fs.writeFileSync(outPath, JSON.stringify(args));
    console.log(
      JSON.stringify({
        slug,
        ok: true,
        invokePath: outPath,
        name: args.name,
        entrypoint_path: args.entrypoint_path,
        verify_jwt: args.verify_jwt,
        fileCount: args.files?.length ?? 0,
        bytes: fs.statSync(argsPath).size,
      })
    );
  } catch (err) {
    console.log(
      JSON.stringify({
        slug,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    );
  }
}
