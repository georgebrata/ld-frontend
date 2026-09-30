#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const file = process.argv[2];
const chunk = Number(process.argv[3] || 90000);
const text = fs.readFileSync(file, 'utf8');
const base = file.replace(/\.json$/, '');
for (let i = 0, part = 0; i < text.length; i += chunk, part++) {
  fs.writeFileSync(`${base}.part${part}.txt`, text.slice(i, i + chunk));
}
console.log(JSON.stringify({ file, parts: Math.ceil(text.length / chunk), bytes: text.length }));
