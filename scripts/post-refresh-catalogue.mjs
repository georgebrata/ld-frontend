#!/usr/bin/env node
/** POST refresh-catalogue using secrets from tmp-deploy/.refresh-env.json (gitignored). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, 'tmp-deploy', '.refresh-env.json');
if (!fs.existsSync(envPath)) {
  console.log(JSON.stringify({ ok: false, error: 'missing_refresh_env_file' }));
  process.exit(2);
}
const { appFunctionsUrl, workerSecret } = JSON.parse(fs.readFileSync(envPath, 'utf8'));
const base = String(appFunctionsUrl || '').replace(/\/$/, '');
const url = `${base}/refresh-catalogue`;
const res = await fetch(url, {
  method: 'POST',
  headers: { 'X-Worker-Secret': String(workerSecret), 'Content-Type': 'application/json' },
  body: '{}',
});
const text = await res.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  body = { raw: text.slice(0, 500) };
}
console.log(JSON.stringify({ ok: res.ok, status: res.status, body }));
