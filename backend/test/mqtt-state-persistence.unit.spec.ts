import { MqttStatePersistenceService } from '../src/database/mqtt-state-persistence.service';
import { PrismaService } from '../src/database/prisma.service';
import { CachedDeviceTelemetry } from '../src/mqtt/mqtt.types';

describe('MQTT state PostgreSQL persistence', () => {
  it('restores persisted telemetry and alarm projections after a restart', async () => {
    const telemetry = { tenantId: 'tenant-demo', lineId: 'line-cnc', deviceId: 'cnc-01' };
    const alarm = { tenantId: 'tenant-demo', alarm: { id: 'alarm-1' }, active: true };
    const prisma = {
      ensureConnection: jest.fn().mockResolvedValue(undefined),
      isReady: () => true,
      mqttDeviceState: { findMany: jest.fn().mockResolvedValue([{ payload: telemetry }]) },
      mqttAlarmState: { findMany: jest.fn().mockResolvedValue([{ payload: alarm }]) },
    } as unknown as PrismaService;

    const state = await new MqttStatePersistenceService(prisma).restore();

    expect(state).toEqual({ telemetry: [telemetry], alarms: [alarm] });
  });

  it('does not access PostgreSQL while persistence is disabled', async () => {
    const prisma = {
      ensureConnection: jest.fn().mockResolvedValue(undefined),
      isReady: () => false,
      mqttDeviceState: { findMany: jest.fn() },
      mqttAlarmState: { findMany: jest.fn() },
    } as unknown as PrismaService;

    await expect(new MqttStatePersistenceService(prisma).restore()).resolves.toEqual({ telemetry: [], alarms: [] });
    expect(prisma.mqttDeviceState.findMany).not.toHaveBeenCalled();
    expect(prisma.mqttAlarmState.findMany).not.toHaveBeenCalled();
  });

  it('writes the durable event log and current state projection atomically by contract', async () => {
    const prisma = {
      ensureConnection: jest.fn().mockResolvedValue(undefined),
      isReady: () => true,
      mqttDeviceState: { upsert: jest.fn().mockResolvedValue(undefined) },
      currentState: { upsert: jest.fn().mockResolvedValue(undefined) },
      deviceEvent: { upsert: jest.fn().mockResolvedValue(undefined) },
    } as unknown as PrismaService;
    const record: CachedDeviceTelemetry = {
      tenantId: 'tenant-demo', lineId: 'line-cnc', deviceId: 'cnc-01', deviceName: 'CNC-01',
      status: 'RUNNING', temperatureCelsius: 40, cycleTimeSeconds: 2, totalCount: 1,
      goodCount: 1, defectCount: 0, activeFaults: [], timestamp: '2026-08-28T09:00:00.000Z',
      sourceTopic: 'http://gateway/device-events', receivedAt: '2026-08-28T09:00:01.000Z',
      traceId: 'trace-1', quality: 'GOOD', eventId: 'event-1',
    };

    await new MqttStatePersistenceService(prisma).saveTelemetry(record);

    expect(prisma.mqttDeviceState.upsert).toHaveBeenCalled();
    expect(prisma.currentState.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId_lineId_deviceId: { tenantId: 'tenant-demo', lineId: 'line-cnc', deviceId: 'cnc-01' } },
    }));
    expect(prisma.deviceEvent.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: expect.stringMatching(/^telemetry:[a-f0-9]{64}$/) },
    }));
  });
});
