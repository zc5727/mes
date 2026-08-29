type Position = { x: number; y: number; z: number } | null;

type DigitalTwinEntity = {
  lineId: string;
  timestamp: string;
  metrics: Record<string, unknown>;
  position: Position;
  snapshotVersion: string;
  dataSource: 'simulator' | 'mqtt' | 'database' | 'mock';
  lastUpdatedAt: string;
};

type DeviceEntity = DigitalTwinEntity & { deviceId: string };
type AlarmEntity = DigitalTwinEntity & { alarmId: string; deviceId: string };

const device: DeviceEntity = {
  lineId: 'line-cnc',
  deviceId: 'cnc-01',
  timestamp: '2026-08-29T09:00:00.000Z',
  metrics: { temperatureCelsius: 42 },
  position: { x: -7.8, y: 0, z: -3.6 },
  snapshotVersion: 'tenant-demo-000042',
  dataSource: 'mqtt',
  lastUpdatedAt: '2026-08-29T09:00:00.120Z',
};

const alarm: AlarmEntity = {
  ...device,
  alarmId: 'line-cnc-cnc-01-OVERHEAT',
};

function assertIsoTimestamp(value: string): void {
  expect(Number.isNaN(Date.parse(value))).toBe(false);
}

function assertCommonContract(value: DigitalTwinEntity): void {
  expect(value.lineId).toEqual(expect.any(String));
  expect(value.metrics).toEqual(expect.any(Object));
  expect(value.snapshotVersion).toEqual(expect.any(String));
  expect(['simulator', 'mqtt', 'database', 'mock']).toContain(value.dataSource);
  assertIsoTimestamp(value.timestamp);
  assertIsoTimestamp(value.lastUpdatedAt);
  if (value.position !== null) {
    expect(value.position).toEqual({
      x: expect.any(Number),
      y: expect.any(Number),
      z: expect.any(Number),
    });
  }
}

describe('digital twin realtime contract', () => {
  it('requires the frozen fields for device updates', () => {
    assertCommonContract(device);
    expect(device.deviceId).toBe('cnc-01');
  });

  it('uses alarmId for the full alarm lifecycle', () => {
    assertCommonContract(alarm);
    expect(alarm.alarmId).toBe('line-cnc-cnc-01-OVERHEAT');
    expect(alarm.deviceId).toBe(device.deviceId);
  });

  it('accepts an explicit null position instead of inventing coordinates', () => {
    const withoutPosition = { ...device, position: null };
    assertCommonContract(withoutPosition);
    expect(withoutPosition.position).toBeNull();
  });
});
