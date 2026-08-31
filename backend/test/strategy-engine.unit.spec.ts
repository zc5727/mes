import { StrategyEngineService } from '../src/strategies/strategy-engine.service';
import { StrategySnapshot } from '../src/strategies/strategy.types';

const snapshot: StrategySnapshot = {
  timestamp: '2026-08-28T08:00:00.000Z',
  lines: [{ id: 'LINE-01', name: 'CNC加工线', capacityPerHour: 20, active: true }, { id: 'LINE-03', name: '焊接线', capacityPerHour: 16, active: true }],
  devices: [{ id: 'WELD-01', lineId: 'LINE-03', status: 'alarm', capacityPerHour: 16 }, { id: 'CNC-01', lineId: 'LINE-01', status: 'online', capacityPerHour: 20 }],
  workOrders: [{ id: 'WO-001', lineId: 'LINE-03', remainingQty: 100, dueAt: '2026-08-28T14:00:00.000Z', priority: 1, status: 'running' }],
};

describe('StrategyEngineService', () => {
  it('generates deterministic transfer candidates without mutating the snapshot', () => {
    const engine = new StrategyEngineService();
    const first = engine.simulate(snapshot);
    const second = engine.simulate(snapshot);
    expect(first).toEqual(second);
    expect(first.strategyVersion).toBe('rules-v1');
    expect(first.recommended?.action).toBe('transfer_work_order');
    expect(first.recommended?.requiresApproval).toBe(true);
    expect(snapshot.workOrders[0].lineId).toBe('LINE-03');
  });
});
