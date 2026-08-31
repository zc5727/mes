import { StrategyPersistenceService } from '../src/strategies/strategy-persistence.service';
import { StrategyEngineService } from '../src/strategies/strategy-engine.service';
import { StrategyGovernanceService } from '../src/strategies/strategy-governance.service';
import { AuditService } from '../src/audit/audit.service';
import type { PrismaService } from '../src/database/prisma.service';
import type { StrategySnapshot } from '../src/strategies/strategy.types';

const snapshot: StrategySnapshot = {
  timestamp: '2026-08-31T08:00:00.000Z',
  factoryId: 'factory-demo',
  lines: [{ id: 'LINE-01', name: '装配线', capacityPerHour: 30, active: true }],
  devices: [{ id: 'DEV-01', lineId: 'LINE-01', status: 'alarm', capacityPerHour: 30 }],
  workOrders: [{ id: 'WO-01', lineId: 'LINE-01', remainingQty: 10, dueAt: '2026-08-31T10:00:00.000Z', priority: 2, status: 'running' }],
};

function prismaMock() {
  return {
    ensureConnection: jest.fn().mockResolvedValue(undefined),
    isReady: jest.fn().mockReturnValue(true),
    strategyRun: { upsert: jest.fn().mockResolvedValue(undefined), findMany: jest.fn() },
  } as unknown as PrismaService;
}

describe('StrategyPersistenceService', () => {
  it('persists the snapshot, all candidates, and governance projection', async () => {
    const prisma = prismaMock();
    const persistence = new StrategyPersistenceService(prisma);
    const result = new StrategyEngineService().simulate(snapshot);
    const audit = new StrategyGovernanceService(new AuditService()).recordSimulation('tenant-demo', 'user-1', snapshot, result);

    await persistence.save('tenant-demo', result, audit, []);

    const call = (prisma.strategyRun.upsert as jest.Mock).mock.calls[0][0];
    expect(call.where).toEqual({ tenantId_simulationId: { tenantId: 'tenant-demo', simulationId: result.simulationId } });
    expect(call.create.snapshot).toEqual(result.snapshot);
    expect(call.create.governance).toEqual(expect.objectContaining({ result, audit, approvals: [] }));
    expect(call.create.candidates).toEqual(expect.objectContaining({ create: expect.any(Array) }));
  });

  it('restores only governance-backed runs with their approval projection', async () => {
    const prisma = prismaMock();
    const persistence = new StrategyPersistenceService(prisma);
    const result = new StrategyEngineService().simulate(snapshot);
    const audit = new StrategyGovernanceService(new AuditService()).recordSimulation('tenant-demo', 'user-1', snapshot, result);
    const approvals = [{ id: 'approval-1', tenantId: 'tenant-demo', resource: 'strategy-candidate', resourceId: result.candidates[0]?.id ?? 'candidate', status: 'pending' as const, comment: '', createdAt: result.generatedAt }];
    (prisma.strategyRun.findMany as jest.Mock).mockResolvedValue([
      { tenantId: 'tenant-demo', governance: { result, audit, approvals } },
      { tenantId: 'tenant-demo', governance: null },
    ]);

    await expect(persistence.restore()).resolves.toEqual([{ tenantId: 'tenant-demo', result, audit, approvals }]);
    expect(prisma.strategyRun.findMany).toHaveBeenCalledWith({ where: { governance: { not: expect.anything() } } });
  });
});
