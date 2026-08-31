import { DeviceConnectionPersistenceService } from '../src/device-connections/device-connection-persistence.service';
import { PrismaService } from '../src/database/prisma.service';
import type { DeviceConnection, DeviceConnectionStatusEvent } from '../src/device-connections/device-connection.types';

function connection(): DeviceConnection {
  return {
    id: 'device-connection-1', tenantId: 'tenant-demo', deviceId: 'device-01', name: '采集连接',
    type: 'mqtt', profileKey: null, driverVerification: 'not-verified', endpoint: 'mqtt://localhost:1883',
    config: {}, capabilities: ['telemetry'], enabled: true, status: 'running',
    health: { status: 'healthy', checkedAt: '2026-08-31T00:00:00.000Z', latencyMs: 3 },
    lastError: null, lastErrorCode: null, lastEventAt: null,
    lastHeartbeatAt: '2026-08-31T00:00:00.000Z', startedAt: '2026-08-31T00:00:00.000Z',
    createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:00:00.000Z',
  };
}

function statusEvent(): DeviceConnectionStatusEvent {
  return {
    id: 'connection-event-1', tenantId: 'tenant-demo', connectionId: 'device-connection-1',
    status: 'running', eventTime: '2026-08-31T00:00:00.000Z', errorCode: null, details: {},
  };
}

describe('device connection PostgreSQL persistence', () => {
  it('uses explicit memory mode only when DATABASE_ENABLED is false', async () => {
    const prisma = {
      enabled: false,
      ensureConnection: jest.fn(),
      isReady: jest.fn(),
    } as unknown as PrismaService;

    await expect(new DeviceConnectionPersistenceService(prisma).restore())
      .resolves.toEqual({ connections: [], statusEvents: [] });
    expect(prisma.ensureConnection).toHaveBeenCalled();
    expect(prisma.isReady).not.toHaveBeenCalled();
  });

  it('fails closed when the database is enabled but unavailable', async () => {
    const prisma = {
      enabled: true,
      ensureConnection: jest.fn().mockResolvedValue(undefined),
      isReady: jest.fn().mockReturnValue(false),
    } as unknown as PrismaService;

    await expect(new DeviceConnectionPersistenceService(prisma).restore())
      .rejects.toThrow('PostgreSQL is enabled but unavailable');
  });

  it('restores connections and lifecycle events from PostgreSQL', async () => {
    const item = connection();
    const event = statusEvent();
    const prisma = {
      enabled: true,
      ensureConnection: jest.fn().mockResolvedValue(undefined),
      isReady: jest.fn().mockReturnValue(true),
      deviceConnection: { findMany: jest.fn().mockResolvedValue([{
        ...item,
        config: {}, capabilities: ['telemetry'], health: item.health,
        lastHeartbeatAt: new Date(item.lastHeartbeatAt!), startedAt: new Date(item.startedAt!),
        lastEventAt: null, createdAt: new Date(item.createdAt), updatedAt: new Date(item.updatedAt),
      }]) },
      deviceConnectionStatusEvent: { findMany: jest.fn().mockResolvedValue([{
        ...event, eventTime: new Date(event.eventTime), details: {},
      }]) },
    } as unknown as PrismaService;

    await expect(new DeviceConnectionPersistenceService(prisma).restore()).resolves.toEqual({
      connections: [item], statusEvents: [event],
    });
  });

  it('persists the connection and status event in one transaction', async () => {
    const upsert = jest.fn().mockResolvedValue(undefined);
    const create = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      enabled: true,
      ensureConnection: jest.fn().mockResolvedValue(undefined),
      isReady: jest.fn().mockReturnValue(true),
      $transaction: jest.fn(async (callback: (transaction: unknown) => Promise<void>) => callback({
        deviceConnection: { upsert }, deviceConnectionStatusEvent: { create },
      })),
    } as unknown as PrismaService;

    await new DeviceConnectionPersistenceService(prisma).save(connection(), statusEvent());

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'device-connection-1' } }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'running' }) }));
  });

  it('deletes a persisted connection only after PostgreSQL is available', async () => {
    const deleteRecord = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      enabled: true,
      ensureConnection: jest.fn().mockResolvedValue(undefined),
      isReady: jest.fn().mockReturnValue(true),
      deviceConnection: { delete: deleteRecord },
    } as unknown as PrismaService;

    await new DeviceConnectionPersistenceService(prisma).delete('device-connection-1');

    expect(deleteRecord).toHaveBeenCalledWith({ where: { id: 'device-connection-1' } });
  });
});
