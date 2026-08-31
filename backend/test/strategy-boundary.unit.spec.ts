import { StrategyEngineService } from '../src/strategies/strategy-engine.service';
import { StrategySnapshot } from '../src/strategies/strategy.types';

const baseSnapshot = (): StrategySnapshot => ({
  timestamp: '2026-08-28T08:00:00.000Z',
  lines: [
    { id: 'LINE-01', name: 'CNC加工线', capacityPerHour: 20, active: true },
    { id: 'LINE-02', name: '装配线', capacityPerHour: 12, active: true },
    { id: 'LINE-03', name: '焊接线', capacityPerHour: 16, active: true },
  ],
  devices: [
    { id: 'CNC-01', lineId: 'LINE-01', status: 'online', capacityPerHour: 20 },
    { id: 'ASM-01', lineId: 'LINE-02', status: 'online', capacityPerHour: 12 },
    { id: 'WLD-01', lineId: 'LINE-03', status: 'online', capacityPerHour: 16 },
  ],
  workOrders: [],
});

describe('StrategyEngineService read-only boundary', () => {
  it.each([
    ['transfer_work_order', (snapshot: StrategySnapshot) => {
      snapshot.devices[2].status = 'alarm';
      snapshot.workOrders.push({ id: 'WO-TRANSFER', lineId: 'LINE-03', remainingQty: 32, dueAt: '2026-08-28T18:00:00.000Z', priority: 1, status: 'running' });
    }],
    ['rebalance_line', (snapshot: StrategySnapshot) => {
      snapshot.workOrders.push({ id: 'WO-LOAD', lineId: 'LINE-02', remainingQty: 200, dueAt: '2026-08-28T22:00:00.000Z', priority: 2, status: 'running' });
    }],
    ['reschedule_material', (snapshot: StrategySnapshot) => {
      snapshot.materialShortages = [{ materialCode: 'MAT-001', affectedWorkOrderIds: ['WO-MATERIAL'] }];
      snapshot.workOrders.push({ id: 'WO-MATERIAL', lineId: 'LINE-01', remainingQty: 20, dueAt: '2026-08-28T18:00:00.000Z', priority: 2, status: 'running' });
    }],
    ['schedule_recovery', (snapshot: StrategySnapshot) => {
      snapshot.workOrders.push({ id: 'WO-RECOVERY', lineId: 'LINE-03', remainingQty: 20, dueAt: '2026-08-28T18:00:00.000Z', priority: 2, status: 'paused' });
    }],
    ['expedite_work_order', (snapshot: StrategySnapshot) => {
      snapshot.workOrders.push({ id: 'WO-DELAY', lineId: 'LINE-01', remainingQty: 100, dueAt: '2026-08-28T09:00:00.000Z', priority: 3, status: 'running' });
    }],
  ])('returns approval-gated %s suggestions only', (action, arrange) => {
    const snapshot = baseSnapshot();
    arrange(snapshot);
    const before = JSON.stringify(snapshot);
    const result = new StrategyEngineService().simulate(snapshot);
    const candidates = result.candidates.filter((candidate) => candidate.action === action);

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((candidate) => candidate.requiresApproval === true)).toBe(true);
    expect(candidates.every((candidate) => Boolean(candidate.impactAssessment.rollbackPlan))).toBe(true);
    expect(candidates.every((candidate) => candidate.impactAssessment.rollbackPlan.action === 'discard_simulation')).toBe(true);
    expect(candidates.every((candidate) => candidate.expectedImpact.length > 0 && candidate.reason.length > 0)).toBe(true);
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('keeps the multi-protocol snapshot contract read-only and complete', () => {
    const snapshot = baseSnapshot();
    snapshot.devices[2].status = 'offline';
    snapshot.workOrders.push({
      id: 'WO-CONTRACT', lineId: 'LINE-03', remainingQty: 80,
      dueAt: '2026-08-28T09:00:00.000Z', priority: 4, status: 'running',
    });
    snapshot.materialShortages = [{ materialCode: 'MAT-CONTRACT', affectedWorkOrderIds: ['WO-CONTRACT'] }];
    const before = JSON.stringify(snapshot);
    const result = new StrategyEngineService().simulate(snapshot);

    expect(result).toEqual(expect.objectContaining({
      simulationId: expect.stringMatching(/^sim-/),
      strategyVersion: 'rules-v1',
      requiresApproval: true,
      executionAllowed: false,
      inputSummary: expect.objectContaining({ snapshotHash: expect.any(String) }),
      outputSummary: expect.objectContaining({ executionAllowed: false }),
    }));
    expect(result.candidates.length).toBeGreaterThan(1);
    expect(result.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'transfer_work_order' }),
      expect.objectContaining({ action: 'reschedule_material' }),
      expect.objectContaining({ action: 'expedite_work_order' }),
    ]));
    for (const candidate of result.candidates) {
      expect(candidate).toEqual(expect.objectContaining({
        expectedFinishTime: expect.any(String),
        affectedOrders: expect.any(Array),
        risk: expect.any(String),
        requiresApproval: true,
        impactAssessment: expect.objectContaining({ executionAllowed: false }),
      }));
    }
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});
