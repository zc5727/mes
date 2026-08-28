import { StrategyEngineService } from '../src/strategies/strategy-engine.service';
import { StrategySnapshot } from '../src/strategies/strategy.types';

describe('故障注入到策略建议集成 fixture', () => {
  it('将故障设备快照转换为工单转移候选方案', () => {
    const snapshot: StrategySnapshot = {
      timestamp: '2026-08-28T08:00:00.000Z',
      lines: [
        { id: 'LINE-03', name: '焊接线', capacityPerHour: 16, active: true },
        { id: 'LINE-01', name: 'CNC加工线', capacityPerHour: 24, active: true },
      ],
      devices: [
        { id: 'WELD-01', lineId: 'LINE-03', status: 'alarm', capacityPerHour: 16 },
        { id: 'CNC-01', lineId: 'LINE-01', status: 'online', capacityPerHour: 24 },
      ],
      workOrders: [
        { id: 'WO-001', lineId: 'LINE-03', remainingQty: 80, dueAt: '2026-08-28T16:00:00.000Z', priority: 1, status: 'running' },
      ],
    };

    const result = new StrategyEngineService().simulate(snapshot);
    const transfer = result.candidates.find((candidate) => candidate.action === 'transfer_work_order');

    expect(result.risks.some((risk) => risk.level === 'high')).toBe(true);
    expect(transfer).toMatchObject({
      affectedOrders: ['WO-001'],
      fromLine: 'LINE-03',
      toLine: 'LINE-01',
      requiresApproval: true,
    });
    expect(transfer?.expectedImpact).toContain('CNC加工线');
    expect(snapshot.workOrders[0].lineId).toBe('LINE-03');
  });
});
