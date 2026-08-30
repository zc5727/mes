import { AuditService } from '../src/audit/audit.service';
import { StrategyGovernanceService } from '../src/strategies/strategy-governance.service';
import { StrategyEngineService } from '../src/strategies/strategy-engine.service';
import { StrategySnapshot } from '../src/strategies/strategy.types';

const snapshot: StrategySnapshot = {
  timestamp: '2026-08-30T08:00:00.000Z',
  lines: [
    { id: 'LINE-01', name: '产线一', capacityPerHour: 30, active: true },
    { id: 'LINE-02', name: '产线二', capacityPerHour: 30, active: true },
  ],
  devices: [
    { id: 'DEV-01', lineId: 'LINE-01', status: 'alarm', capacityPerHour: 30 },
    { id: 'DEV-02', lineId: 'LINE-02', status: 'online', capacityPerHour: 30 },
  ],
  workOrders: [{
    id: 'WO-001', lineId: 'LINE-01', remainingQty: 100,
    dueAt: '2026-08-30T10:00:00.000Z', priority: 3, status: 'running',
  }],
};

describe('StrategyGovernanceService', () => {
  it('tracks completed simulations and keeps results tenant-scoped', () => {
    const audit = new AuditService();
    const governance = new StrategyGovernanceService(audit);
    const result = new StrategyEngineService().simulate(snapshot);

    const call = governance.recordSimulation('tenant-a', 'plant-manager', snapshot, result);

    expect(call).toEqual(expect.objectContaining({
      simulationId: result.simulationId,
      tenantId: 'tenant-a',
      requestedBy: 'plant-manager',
      candidateCount: result.candidates.length,
      requiresApproval: true,
      status: 'completed',
    }));
    expect(governance.getSimulation('tenant-a', result.simulationId)).toEqual({ result, audit: call });
    expect(governance.listCalls('tenant-a')).toEqual([call]);
    expect(governance.listCalls('tenant-b')).toEqual([]);
    expect(() => governance.getSimulation('tenant-b', result.simulationId)).toThrow('not found');
    expect(audit.list('tenant-a')[0]).toEqual(expect.objectContaining({
      action: 'STRATEGY_SIMULATE',
      resource: 'strategy-simulation',
      resourceId: result.simulationId,
      details: expect.objectContaining({ executionAllowed: false, requiresApproval: true }),
    }));
  });
});
