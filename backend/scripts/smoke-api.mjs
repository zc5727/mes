import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.SMOKE_PORT ?? 3199);
const baseUrl = process.env.SMOKE_BASE_URL ?? `http://127.0.0.1:${port}/api/v1`;
const shouldStart = !process.argv.includes('--no-start');
let server;

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForHealth() {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (body.status !== 'ok' || body.service !== 'mes-saas-backend') throw new Error('Unexpected health payload');
      return body;
    } catch (error) {
      lastError = error;
      await sleep(200);
    }
  }
  throw new Error(`Health endpoint unavailable: ${lastError?.message ?? 'unknown error'}`);
}

try {
  if (shouldStart) {
    server = spawn(process.execPath, ['dist/main.js'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, NODE_ENV: 'test', PORT: String(port) },
      stdio: 'ignore',
    });
  }
  const body = await waitForHealth();
  console.log(`API smoke passed: ${baseUrl}/health (${body.timestamp})`);
} finally {
  if (server && !server.killed) server.kill('SIGTERM');
}
