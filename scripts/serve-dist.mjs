import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const port = process.env.PORT || '3000';
const child = spawn('python3', ['-m', 'http.server', String(port)], {
  cwd: dist,
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 0));
