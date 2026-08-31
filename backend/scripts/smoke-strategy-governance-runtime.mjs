import { readFile, writeFile } from 'node:fs/promises';

const baseUrl = (process.env.MES_BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const apiKey = process.env.MES_API_KEY?.trim();
const tenantId = process.env.MES_TENANT_ID ?? 'tenant-demo';
const factoryId = process.env.MES_FACTORY_ID ?? 'factory-demo';
const stateFile = process.env.MES_STRATEGY_SMOKE_STATE
  ?? `${process.cwd()}/../.runtime/strategy-governance-smoke.json`;
const mode = process.env.MES_STRATEGY_SMOKE_MODE ?? 'write';
const idempotencyKey = process.env.MES_STRATEGY_SMOKE_IDEMPOTENCY_KEY
  ?? 'runtime-governance-smoke-v1';

if (!apiKey) throw new Error('MES_API_KEY is required for the real strategy governance smoke');
if (mode !== 'write' && mode !== 'restore') throw new Error(`Unsupported MES_STRATEGY_SMOKE_MODE: ${mode}`);

const snapshot = {
  timestamp: '2026-08-31T08:00:00.000Z',
  factoryId,
  lines: [
    { id: 'LINE-01', name: '冲压线', capacityPerHour: 30, active: true },
    { id: 'LINE-02', name: '备用线', capacityPerHour: 30, active: true },
    { id: 'LINE-03', name: '焊接线', capacityPerHour: 24, active: true },
    { id: 'LINE-04', name: '装配线', capacityPerHour: 30, active: true },
  ],
  devices: [
    { id: 'PRESS-01', lineId: 'LINE-01', status: 'alarm', capacityPerHour: 30 },
    { id: 'CNC-01', lineId: 'LINE-02', status: 'online', capacityPerHour: 30 },
    { id: 'WELD-01', lineId: 'LINE-03', status: 'online', capacityPerHour: 24 },
    { id: 'ASM-01', lineId: 'LINE-04', status: 'online', capacityPerHour: 30 },
  ],
  workOrders: [
    { id: 'WO-RUNTIME-01', lineId: 'LINE-01', remainingQty: 120, dueAt: '2026-08-31T10:00:00.000Z', priority: 1, status: 'running' },
  ],
};

function headers(role, userId = `${role}-runtime-smoke`) {
  return {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
    'x-tenant-id': tenantId,
    'x-user-id': userId,
    'x-user-role': role,
    'x-role': role,
    'x-factory-id': factoryId,
    'x-scope': '*',
    'x-session-id': `session-${userId}`,
    'x-trace-id': `trace-${mode}-${userId}`,
  };
}

async function request(path, role, options = {}, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...headers(role), ...(options.headers ?? {}) },
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
  if (response.status !== expectedStatus) {
    throw new Error(`${options.method ?? 'GET'} ${path} expected HTTP ${expectedStatus}, got ${response.status}: ${text}`);
  }
  return body;
}

function postBody(body, extraHeaders = {}) {
  return { method: 'POST', body: JSON.stringify(body), headers: extraHeaders };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

if (mode === 'write') {
  await request('/api/v1/strategies/simulate', 'operator', postBody(snapshot), 403);
  const simulated = await request(
    '/api/v1/strategies/simulate',
    'plant_manager',
    postBody(snapshot, { 'idempotency-key': idempotencyKey }),
  );
  const simulation = simulated?.data;
  const audit = simulated?.audit;
  assert(simulation?.simulationId, 'strategy simulation did not return simulationId');
  assert(simulation.executionAllowed === false, 'strategy suggestion must never allow execution');
  assert(simulation.requiresApproval === true, 'strategy suggestion must require approval');
  assert(audit?.executionAllowed === false, 'strategy audit must remain non-executable');

  await request(`/api/v1/strategies/simulations/${simulation.simulationId}/execute`, 'plant_manager', postBody({}), 409);
  const auditIntegrity = await request('/api/v1/audit/logs/verify', 'plant_manager');
  assert(auditIntegrity?.data?.valid === true, 'audit hash chain is invalid');
  await writeFile(stateFile, JSON.stringify({ simulationId: simulation.simulationId, callId: audit.callId }), 'utf8');
  console.log(JSON.stringify({ mode, simulationId: simulation.simulationId, callId: audit.callId, executionAllowed: false, auditValid: true }));
} else {
  let state;
  try { state = JSON.parse(await readFile(stateFile, 'utf8')); } catch (error) {
    throw new Error(`strategy smoke state is missing; run write mode first: ${error instanceof Error ? error.message : String(error)}`);
  }
  const restored = await request(
    '/api/v1/strategies/simulate',
    'plant_manager',
    postBody(snapshot, { 'idempotency-key': idempotencyKey }),
  );
  assert(restored?.data?.simulationId === state.simulationId, 'idempotency state was not restored after backend restart');
  assert(restored?.audit?.callId === state.callId, 'strategy audit identity was not restored after backend restart');
  assert(restored.data.executionAllowed === false, 'restored strategy suggestion must remain non-executable');
  const history = await request('/api/v1/strategies/history', 'auditor');
  assert(history?.data?.some((item) => item.simulationId === state.simulationId), 'restored strategy history is not queryable');
  const auditIntegrity = await request('/api/v1/audit/logs/verify', 'auditor');
  assert(auditIntegrity?.data?.valid === true, 'restored audit hash chain is invalid');
  console.log(JSON.stringify({ mode, simulationId: state.simulationId, restored: true, executionAllowed: false, auditValid: true }));
}
