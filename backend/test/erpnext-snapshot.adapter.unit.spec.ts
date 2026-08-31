import { ErpNextSnapshotPayload, mapErpNextSnapshot } from '../src/strategies/erpnext-snapshot.adapter';

const erpNextSnapshot: ErpNextSnapshotPayload = {
  company: 'Demo Manufacturing',
  asOf: '2026-08-31T09:00:00.000Z',
  workstations: [
    { name: 'WS-CNC', workstationName: 'CNC加工线', productionCapacity: 30, enabled: true },
    { name: 'WS-WELD', workstationName: '焊接线', productionCapacity: 20, enabled: false },
  ],
  machines: [
    { name: 'MC-01', workstation: 'WS-CNC', status: 'Running', productionCapacity: 30 },
    { name: 'MC-02', workstation: 'WS-WELD', status: 'Down', productionCapacity: 20 },
  ],
  workOrders: [{
    name: 'WO-ERP-001', workstation: 'WS-CNC', qty: 100, producedQty: 35,
    plannedEndDate: '2026-08-31T12:00:00.000Z', priority: 3, status: 'In Process',
  }],
  materialShortages: [{ materialCode: 'MAT-ERP-01', affectedWorkOrderIds: ['WO-ERP-001'] }],
};

describe('ERPNext snapshot adapter', () => {
  it('maps a mocked ERPNext response to the read-only strategy contract', () => {
    const before = JSON.stringify(erpNextSnapshot);
    expect(mapErpNextSnapshot(erpNextSnapshot)).toEqual({
      factoryId: 'Demo Manufacturing',
      timestamp: erpNextSnapshot.asOf,
      lines: [
        { id: 'WS-CNC', name: 'CNC加工线', capacityPerHour: 30, active: true },
        { id: 'WS-WELD', name: '焊接线', capacityPerHour: 20, active: false },
      ],
      devices: [
        { id: 'MC-01', lineId: 'WS-CNC', status: 'online', capacityPerHour: 30 },
        { id: 'MC-02', lineId: 'WS-WELD', status: 'alarm', capacityPerHour: 20 },
      ],
      workOrders: [{
        id: 'WO-ERP-001', lineId: 'WS-CNC', remainingQty: 65,
        dueAt: '2026-08-31T12:00:00.000Z', priority: 3, status: 'running',
      }],
      materialShortages: [{ materialCode: 'MAT-ERP-01', affectedWorkOrderIds: ['WO-ERP-001'] }],
    });
    expect(JSON.stringify(erpNextSnapshot)).toBe(before);
  });

  it('rejects invalid references and quantities', () => {
    expect(() => mapErpNextSnapshot({
      ...erpNextSnapshot,
      machines: [{ ...erpNextSnapshot.machines[0], workstation: 'UNKNOWN' }],
    })).toThrow('invalid ERPNext machine');
    expect(() => mapErpNextSnapshot({
      ...erpNextSnapshot,
      workOrders: [{ ...erpNextSnapshot.workOrders[0], producedQty: 101 }],
    })).toThrow('invalid ERPNext work order');
  });

  it('does not expose control operations', () => {
    expect(Object.keys(mapErpNextSnapshot(erpNextSnapshot))).not.toContain('commands');
  });
});
