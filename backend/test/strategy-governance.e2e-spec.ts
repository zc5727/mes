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
  });
});
