import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface FactorySnapshot {
  factoryId: string;
  capturedAt: string;
  lines: Array<{
    id: string;
    name: string;
    status: string;
    completionRate: number;
    plannedQuantity: number;
    completedQuantity: number;
    oee: number;
    deviceOnline: string;
  }>;
  devices: Array<{
    id: string;
    lineId: string;
    name: string;
    status: string;
    temperature: number;
    power: number;
  }>;
  metrics: {
    todayTasks: number;
    powerConsumption: number;
    temperatureTrend: number[];
  };
}

describe('factory snapshot data contract', () => {
  it('keeps stable IDs, references and bounded operational metrics', () => {
    const snapshot = JSON.parse(readFileSync(
      resolve(__dirname, 'fixtures/factory-snapshot.json'),
      'utf8',
    )) as FactorySnapshot;
    const lineIds = new Set(snapshot.lines.map((line) => line.id));
    const deviceIds = new Set(snapshot.devices.map((device) => device.id));

    expect(snapshot.factoryId).toBeTruthy();
    expect(Number.isNaN(Date.parse(snapshot.capturedAt))).toBe(false);
    expect(snapshot.lines).toHaveLength(4);
    expect(lineIds.size).toBe(snapshot.lines.length);
    expect(deviceIds.size).toBe(snapshot.devices.length);

    for (const line of snapshot.lines) {
      expect(line.id).toMatch(/^LINE-\d+$/);
      expect(line.status).toMatch(/^(running|warning|error|offline)$/);
      expect(line.plannedQuantity).toBeGreaterThanOrEqual(line.completedQuantity);
      expect(line.completionRate).toBeGreaterThanOrEqual(0);
      expect(line.completionRate).toBeLessThanOrEqual(100);
      expect(line.oee).toBeGreaterThanOrEqual(0);
      expect(line.oee).toBeLessThanOrEqual(100);
    }

    for (const device of snapshot.devices) {
      expect(lineIds.has(device.lineId)).toBe(true);
      expect(device.status).toMatch(/^(running|warning|error|offline)$/);
      expect(Number.isFinite(device.temperature)).toBe(true);
      expect(Number.isFinite(device.power)).toBe(true);
    }

    expect(snapshot.metrics.temperatureTrend.length).toBeGreaterThan(0);
    expect(snapshot.metrics.temperatureTrend.every(Number.isFinite)).toBe(true);
  });
});

