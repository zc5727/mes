import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const port = Number(process.env.SMOKE_PORT ?? 3199);
const configuredBaseUrl = process.env.SMOKE_BASE_URL ?? process.env.MES_BASE_URL;
const baseUrl = configuredBaseUrl
  ? `${configuredBaseUrl.replace(/\/$/, '')}${configuredBaseUrl.replace(/\/$/, '').endsWith('/api/v1') ? '' : '/api/v1'}`
  : `http://127.0.0.1:${port}/api/v1`;
const shouldStart = !process.argv.includes('--no-start');
const apiKey = process.env.MES_API_KEY?.trim();
const tenantId = process.env.MES_TENANT_ID?.trim() || 'tenant-demo';
let server;

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  if (apiKey) headers.set('Authorization', `Bearer ${apiKey}`);
  headers.set('X-Tenant-Id', tenantId);
  return fetch(`${baseUrl}${path}`, { ...options, headers });
}

async function waitForHealth() {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await request('/health');
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
    const backendDir = fileURLToPath(new URL('..', import.meta.url));
    const entrypoint = existsSync(join(backendDir, 'dist/src/main.js'))
      ? 'dist/src/main.js'
      : 'dist/main.js';
    server = spawn(process.execPath, [entrypoint], {
      cwd: backendDir,
      env: { ...process.env, NODE_ENV: 'test', PORT: String(port) },
      stdio: 'ignore',
    });
  }
  const body = await waitForHealth();
  console.log(`API smoke passed: ${baseUrl}/health (${body.timestamp})`);
  const protectedEndpoints = [
    '/health/readiness',
    '/health/components',
    '/factories',
    '/production-lines',
    '/devices',
    '/alarms',
    '/work-orders',
    '/dashboard/overview',
    '/digital-twin/snapshot',
  ];
  for (const endpoint of protectedEndpoints) {
    const response = await request(endpoint);
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`${endpoint} returned HTTP ${response.status}: ${detail.slice(0, 240)}`);
    }
  }
  console.log(`API contract smoke passed: ${protectedEndpoints.length} protected endpoints`);
} finally {
  if (server && !server.killed) server.kill('SIGTERM');
}
