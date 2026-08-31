import { StrategiesController } from '../src/strategies/strategies.controller';
import { StrategyEngineService } from '../src/strategies/strategy-engine.service';
import { StrategySimulationDto } from '../src/strategies/strategy-simulation.dto';
import { AuditService } from '../src/audit/audit.service';
import { StrategyGovernanceService } from '../src/strategies/strategy-governance.service';

describe('StrategiesController', () => {
  it('returns a deterministic, approval-gated simulation without mutating the snapshot', () => {
    const controller = new StrategiesController(new StrategyEngineService());
    const dto: StrategySimulationDto = {
      timestamp: '2026-08-28T08:00:00.000Z',
      lines: [
        { id: 'LINE-01', name: '装配线', capacityPerHour: 30, active: true },
        { id: 'LINE-03', name: '焊接线', capacityPerHour: 24, active: true },
      ],
      devices: [
        { id: 'WELD-01', lineId: 'LINE-03', status: 'alarm', capacityPerHour: 24 },
        { id: 'ASM-01', lineId: 'LINE-01', status: 'online', capacityPerHour: 30 },
      ],
      workOrders: [
        {
          id: 'WO-001',
          lineId: 'LINE-03',
          remainingQty: 100,
          dueAt: '2026-08-28T20:00:00.000Z',
          priority: 2,
          status: 'running',
        },
        {
          id: 'WO-002',
          lineId: 'LINE-01',
          remainingQty: 100,
          dueAt: '2026-08-28T10:00:00.000Z',
          priority: 1,
          status: 'running',
        },
      ],
    };
    const before = JSON.stringify(dto);

    const first = controller.simulate(dto);
    const second = controller.simulate(dto);

    expect(first.data.simulationId).toBe(second.data.simulationId);
    expect(first.data.candidates.length).toBeGreaterThanOrEqual(2);
    expect(first.data.recommended).not.toBeNull();
    expect(first.data.candidates.every((candidate) => candidate.requiresApproval)).toBe(true);
    expect(first.data.recommended?.requiresApproval).toBe(true);
    expect(first.data.candidates.some((candidate) => candidate.action === 'transfer_work_order')).toBe(true);
    expect(JSON.stringify(dto)).toBe(before);
  });

  it('replays the HTTP contract by idempotency key and exposes discard-only rollback', () => {
    const audit = new AuditService();
    const controller = new StrategiesController(
      new StrategyEngineService(),
      new StrategyGovernanceService(audit),
    );
    const dto: StrategySimulationDto = {
      timestamp: '2026-08-28T08:00:00.000Z',
      factoryId: 'FACTORY-01',
      lines: [{ id: 'LINE-01', name: '装配线', capacityPerHour: 30, active: true }],
      devices: [{ id: 'ASM-01', lineId: 'LINE-01', status: 'online', capacityPerHour: 30 }],
      workOrders: [{ id: 'WO-001', lineId: 'LINE-01', remainingQty: 10, dueAt: '2026-08-28T20:00:00.000Z', priority: 1, status: 'running' }],
    };
    const args = ['tenant-a', 'user-1', 'plant_manager', 'FACTORY-01', '*', 'session-1', 'trace-1', dto, 'idem-1'] as const;

    const first = controller.simulate(...args);
    const replay = controller.simulate(...args);

    expect(replay).toBe(first);
    expect(audit.list('tenant-a')).toHaveLength(1);
    const rolledBack = controller.rollbackSimulation(
      'tenant-a', first.data.simulationId, 'user-1', 'plant_manager', 'FACTORY-01', '*', 'session-1', 'trace-2',
    );
    expect(rolledBack.data).not.toBeNull();
    if (!rolledBack.data) throw new Error('rollback result is required');
    expect(rolledBack.data.audit.rollback.status).toBe('discarded');
    expect(rolledBack.data.result.executionAllowed).toBe(false);
  });
});
