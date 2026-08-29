import { StrategiesController } from '../src/strategies/strategies.controller';
import { StrategyEngineService } from '../src/strategies/strategy-engine.service';
import { StrategySimulationDto } from '../src/strategies/strategy-simulation.dto';

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
});
