import type { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createTestApp } from './support/test-app';

const snapshot = {
  timestamp: '2026-08-31T08:00:00.000Z',
  factoryId: 'factory-demo',
  lines: [
    { id: 'LINE-01', name: '装配线', capacityPerHour: 30, active: true },
    { id: 'LINE-02', name: '备用线', capacityPerHour: 30, active: true },
  ],
  devices: [
    { id: 'DEV-01', lineId: 'LINE-01', status: 'alarm', capacityPerHour: 30 },
    { id: 'DEV-02', lineId: 'LINE-02', status: 'online', capacityPerHour: 30 },
  ],
  workOrders: [{ id: 'WO-01', lineId: 'LINE-01', remainingQty: 10, dueAt: '2026-08-31T10:00:00.000Z', priority: 2, status: 'running' }],
};

function identity(role: string, scope = '*') {
  return {
    'x-user-id': `${role}-e2e`, 'x-role': role, 'x-factory-id': 'factory-demo',
    'x-scope': scope, 'x-session-id': `session-${role}`, 'x-trace-id': `trace-${role}`,
  };
}

describe('strategy governance boundary (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });

  it('rejects missing identity and operator simulation attempts', async () => {
    const server = app.getHttpServer();
    await request(server).post('/api/v1/strategies/simulate').send(snapshot).expect(401);
    await request(server).post('/api/v1/strategies/simulate').set(identity('operator')).send(snapshot).expect(403);
  });

  it('rejects cross-scope simulation and execution before approval', async () => {
    const server = app.getHttpServer();
    await request(server).post('/api/v1/strategies/simulate')
      .set(identity('supervisor', 'LINE-OTHER')).send(snapshot).expect(403);

    const simulated = await request(server).post('/api/v1/strategies/simulate')
      .set(identity('supervisor', 'LINE-01,LINE-02')).set('idempotency-key', 'governance-e2e-1').send(snapshot).expect(200);
    const { simulationId } = simulated.body.data;
    await request(server).post(`/api/v1/strategies/simulations/${simulationId}/execute`)
      .set(identity('supervisor', 'LINE-01,LINE-02')).expect(409);

    const approvalId = simulated.body.audit.approvalIds[0];
    expect(approvalId).toEqual(expect.any(String));
    await request(server).post(`/api/v1/strategies/simulations/${simulationId}/approvals/${approvalId}/approve`)
      .set(identity('supervisor', 'LINE-01,LINE-02')).expect(200);
    const executed = await request(server).post(`/api/v1/strategies/simulations/${simulationId}/execute`)
      .set(identity('supervisor', 'LINE-01,LINE-02')).expect(200);
    expect(executed.body.data.audit.lifecycleStatus).toBe('simulated_execution');
    expect(executed.body.data.result.executionAllowed).toBe(false);

    const replay = await request(server).post(`/api/v1/strategies/simulations/${simulationId}/replay`)
      .set(identity('supervisor', 'LINE-01,LINE-02')).expect(200);
    expect(replay.body.data).toEqual(expect.objectContaining({
      sourceSimulationId: simulationId, strategyVersion: 'rules-v1', deterministic: true,
    }));
    const history = await request(server).get('/api/v1/strategies/history')
      .set(identity('supervisor', 'LINE-01,LINE-02')).expect(200);
    expect(history.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ simulationId, lifecycleStatus: 'simulated_execution' }),
    ]));
    const auditRecords = await request(server).get('/api/v1/strategies/audit-records')
      .set(identity('supervisor', 'LINE-01')).expect(200);
    expect(auditRecords.body.data).toEqual([]);
    const fullScopeAuditRecords = await request(server).get('/api/v1/strategies/audit-records')
      .set(identity('supervisor', 'LINE-01,LINE-02')).expect(200);
    expect(fullScopeAuditRecords.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ simulationId, lineIds: ['LINE-01', 'LINE-02'] }),
    ]));
    const auditIntegrity = await request(server).get('/api/v1/audit/logs/verify')
      .set(identity('supervisor', 'LINE-01,LINE-02')).expect(200);
    expect(auditIntegrity.body.data).toEqual(expect.objectContaining({ valid: true }));
    const outOfScopeHistory = await request(server).get('/api/v1/strategies/history')
      .set(identity('supervisor', 'LINE-OTHER')).expect(200);
    expect(outOfScopeHistory.body.data).toEqual([]);
  });

  it('deduplicates repeated simulation requests and blocks revoked recommendations', async () => {
    const server = app.getHttpServer();
    const headers = identity('supervisor', 'LINE-01,LINE-02');
    const first = await request(server).post('/api/v1/strategies/simulate')
      .set(headers).set('idempotency-key', 'governance-e2e-duplicate').send(snapshot).expect(200);
    const second = await request(server).post('/api/v1/strategies/simulate')
      .set(headers).set('idempotency-key', 'governance-e2e-duplicate').send(snapshot).expect(200);
    expect(second.body.data.simulationId).toBe(first.body.data.simulationId);
    expect(second.body.audit.callId).toBe(first.body.audit.callId);

    const approvalId = first.body.audit.approvalIds[0];
    await request(server).post(`/api/v1/strategies/simulations/${first.body.data.simulationId}/revoke`)
      .set(headers).expect(200);
    const approvals = await request(server).get(`/api/v1/strategies/simulations/${first.body.data.simulationId}/approvals`)
      .set(headers).expect(200);
    expect(approvals.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: approvalId, status: 'revoked' }),
    ]));
    await request(server).post(`/api/v1/strategies/simulations/${first.body.data.simulationId}/execute`)
      .set(headers).expect(409);
    await request(server).post(`/api/v1/strategies/simulations/${first.body.data.simulationId}/revoke`)
      .set(headers).expect(409);
  });
});
