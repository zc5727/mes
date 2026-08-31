import { mapOpenMesSnapshot, OpenMesSnapshotPayload } from '../src/strategies/openmes-snapshot.adapter';

const openMesSnapshot: OpenMesSnapshotPayload = {
  factoryId: 'factory-demo',
  timestamp: '2026-08-31T08:00:00.000Z',
  lines: [
    { id: 'L1', name: '冲压线', capacityPerHour: 30, status: 'RUNNING' },
    { id: 'L2', name: '机加线', capacityPerHour: 20, status: 'ACTIVE' },
  ],
  devices: [
    { id: 'D1', lineId: 'L1', status: 'FAULT', capacityPerHour: 30 },
    { id: 'D2', lineId: 'L2', status: 'RUNNING', capacityPerHour: 20 },
  ],
  workOrders: [{ id: 'WO1', lineId: 'L1', plannedQty: 100, completedQty: 25, dueAt: '2026-08-31T12:00:00.000Z', priority: 4, status: 'IN_PROGRESS' }],
  materialShortages: [{ materialCode: 'MAT-01', affectedWorkOrderIds: ['WO1'] }],
};

describe('OpenMES snapshot adapter', () => {
  it('maps external read-only state into the strategy snapshot contract', () => {
    const before = JSON.stringify(openMesSnapshot);
    const snapshot = mapOpenMesSnapshot(openMesSnapshot);

    expect(snapshot).toEqual({
      factoryId: 'factory-demo',
      timestamp: openMesSnapshot.timestamp,
      lines: [
        { id: 'L1', name: '冲压线', capacityPerHour: 30, active: true },
        { id: 'L2', name: '机加线', capacityPerHour: 20, active: true },
      ],
      devices: [
        { id: 'D1', lineId: 'L1', status: 'alarm', capacityPerHour: 30 },
        { id: 'D2', lineId: 'L2', status: 'online', capacityPerHour: 20 },
      ],
      workOrders: [{ id: 'WO1', lineId: 'L1', remainingQty: 75, dueAt: '2026-08-31T12:00:00.000Z', priority: 4, status: 'running' }],
      materialShortages: [{ materialCode: 'MAT-01', affectedWorkOrderIds: ['WO1'] }],
    });
    expect(JSON.stringify(openMesSnapshot)).toBe(before);
  });

  it('rejects invalid references and never exposes a control operation', () => {
    expect(() => mapOpenMesSnapshot({ ...openMesSnapshot, devices: [{ ...openMesSnapshot.devices[0], lineId: 'UNKNOWN' }] })).toThrow('invalid OpenMES device');
    expect(() => mapOpenMesSnapshot({ ...openMesSnapshot, workOrders: [{ ...openMesSnapshot.workOrders[0], completedQty: 101 }] })).toThrow('invalid OpenMES work order');
    expect(Object.keys(mapOpenMesSnapshot(openMesSnapshot))).not.toContain('commands');
  });
});
