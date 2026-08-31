import { mergeErpNextWorkOrders, mapErpNextWorkOrders, ErpNextWorkOrder } from '../src/strategies/erpnext-work-order.adapter';
import { StrategySnapshot } from '../src/strategies/strategy.types';

const erpOrders: ErpNextWorkOrder[] = [{
  name: 'MFG-WO-0001',
  production_item: 'ITEM-STRUCTURE',
  qty: 100,
  produced_qty: 25,
  planned_end_date: '2026-08-31T12:00:00.000Z',
  priority: 'High',
  status: 'In Process',
  custom_production_line: 'LINE-03',
}];

describe('ERPNext work-order adapter', () => {
  it('maps ERPNext fields into the strategy work-order contract without business writes', () => {
    expect(mapErpNextWorkOrders(erpOrders)).toEqual([{
      id: 'MFG-WO-0001',
      lineId: 'LINE-03',
      remainingQty: 75,
      dueAt: '2026-08-31T12:00:00.000Z',
      priority: 3,
      status: 'running',
    }]);
  });

  it('replaces only the read-only work-order projection and preserves snapshot inputs', () => {
    const snapshot: StrategySnapshot = {
      factoryId: 'factory-demo',
      timestamp: '2026-08-31T08:00:00.000Z',
      lines: [{ id: 'LINE-03', name: '焊接线', capacityPerHour: 20, active: true }],
      devices: [{ id: 'WELD-01', lineId: 'LINE-03', status: 'alarm', capacityPerHour: 20 }],
      workOrders: [],
    };
    const before = JSON.stringify(snapshot);
    const merged = mergeErpNextWorkOrders(snapshot, erpOrders);

    expect(merged.workOrders[0].id).toBe('MFG-WO-0001');
    expect(merged.factoryId).toBe('factory-demo');
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('rejects missing line mapping, invalid quantities and duplicate ERPNext names', () => {
    expect(() => mapErpNextWorkOrders([{ ...erpOrders[0], custom_production_line: undefined, production_line: undefined }])).toThrow('invalid ERPNext work order');
    expect(() => mapErpNextWorkOrders([{ ...erpOrders[0], produced_qty: 101 }])).toThrow('invalid ERPNext work order quantities');
    expect(() => mapErpNextWorkOrders([erpOrders[0], erpOrders[0]])).toThrow('duplicate ERPNext work order');
  });
});
