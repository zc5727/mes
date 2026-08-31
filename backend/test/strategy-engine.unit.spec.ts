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

  it('rejects malformed direct inputs before risk or candidate evaluation', () => {
    const malformed = {
      ...snapshot,
      timestamp: 'not-a-date',
      lines: [{ ...snapshot.lines[0], capacityPerHour: Number.NaN }],
      devices: [{ ...snapshot.devices[0], lineId: 'LINE-MISSING' }],
      workOrders: [{ ...snapshot.workOrders[0], dueAt: 'not-a-date' }],
    } as StrategySnapshot;
    const engine = new StrategyEngineService();

    const validation = engine.preflight(malformed);
    expect(validation.accepted).toBe(false);
    expect(validation.errors).toEqual(expect.arrayContaining([
      'snapshot timestamp must be a valid ISO date',
    ]));
    expect(() => engine.simulate(malformed)).toThrow('invalid strategy snapshot');
  });
});
