import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DeviceConnectionsService } from '../src/device-connections/device-connections.service';
import { DeviceProfilesService } from '../src/device-profiles/device-profiles.service';
import type { DeviceConnectionProbe } from '../src/device-connections/device-connection.types';

describe('device connections', () => {
  const createService = (probe: DeviceConnectionProbe): DeviceConnectionsService => (
    new DeviceConnectionsService(probe, new DeviceProfilesService())
  );

  it('keeps configurations tenant scoped and declares capabilities', async () => {
    const probe: DeviceConnectionProbe = { probe: jest.fn() };
    const service = createService(probe);
    const connection = await service.create('tenant-a', {
      deviceId: 'device-01', name: 'HTTP采集', type: 'http', endpoint: 'http://localhost:3100/events',
      capabilities: ['telemetry', 'alarm', 'telemetry'],
    });

    expect(connection.capabilities).toEqual(['telemetry', 'alarm']);
    expect(service.list('tenant-a')).toHaveLength(1);
    expect(service.list('tenant-b')).toHaveLength(0);
    expect(() => service.findOne('tenant-b', connection.id)).toThrow(NotFoundException);
  });

  it('tests, starts, reports health and stops without touching a PLC', async () => {
    const probe: DeviceConnectionProbe = { probe: jest.fn().mockResolvedValue({ ok: true, latencyMs: 12 }) };
    const service = createService(probe);
    const connection = await service.create('tenant-a', {
      deviceId: 'device-01', name: 'Webhook', type: 'webhook', endpoint: 'https://example.test/hook',
      capabilities: ['status'],
    });

    const tested = await service.test('tenant-a', connection.id);
    expect(tested.test).toEqual({ ok: true, latencyMs: 12, error: null });
    expect(tested.connection.health.status).toBe('healthy');
    expect((await service.start('tenant-a', connection.id)).status).toBe('running');
    expect(service.health('tenant-a', connection.id).checkedAt).toEqual(expect.any(String));
    expect((await service.stop('tenant-a', connection.id)).status).toBe('stopped');
    expect(service.listStatusEvents('tenant-a', connection.id).map((event) => event.status))
      .toEqual(['created', 'running', 'stopped']);
    expect(probe.probe).toHaveBeenCalledTimes(2);
  });

  it('stores a unified event only for a running connection and rejects duplicates', async () => {
    const probe: DeviceConnectionProbe = { probe: jest.fn().mockResolvedValue({ ok: true, latencyMs: 1 }) };
    const service = createService(probe);
    const connection = await service.create('tenant-a', {
      deviceId: 'device-01', name: 'MQTT', type: 'mqtt', endpoint: 'mqtt://localhost:1883',
    });
    expect(() => service.ingestEvent('tenant-a', connection.id, { type: 'telemetry', eventId: 'event-1', payload: { temperature: 42 } })).toThrow(ConflictException);
    await service.start('tenant-a', connection.id);
    const event = service.ingestEvent('tenant-a', connection.id, { type: 'telemetry', eventId: 'event-1', occurredAt: '2026-08-30T00:00:00.000Z', payload: { temperature: 42 } });
    expect(event).toEqual(expect.objectContaining({ tenantId: 'tenant-a', connectionId: connection.id, deviceId: 'device-01' }));
    expect(service.listEvents('tenant-a', connection.id)).toHaveLength(1);
    expect(service.ingestEvent('tenant-a', connection.id, { type: 'telemetry', eventId: 'event-1', payload: {} })).toEqual(event);
  });

  it('records the last error and validates protocol endpoints', async () => {
    const probe: DeviceConnectionProbe = { probe: jest.fn().mockResolvedValue({ ok: false, latencyMs: 8, error: 'connection refused' }) };
    const service = createService(probe);
    await expect(service.create('tenant-a', { deviceId: 'd', name: 'Bad', type: 'mqtt', endpoint: 'https://example.test' })).rejects.toThrow(BadRequestException);
    const connection = await service.create('tenant-a', { deviceId: 'device-02', name: 'HTTP', type: 'http', endpoint: 'http://localhost:3100' });
    const result = await service.test('tenant-a', connection.id);
    expect(result.test.error).toBe('connection refused');
    expect(result.connection.lastError).toBe('connection refused');
    await expect(service.start('tenant-a', connection.id)).resolves.toEqual(expect.objectContaining({ status: 'error', lastError: 'connection refused' }));
  });

  it('rejects mismatched profiles and keeps unimplemented protocols fail-closed', async () => {
    const probe: DeviceConnectionProbe = { probe: jest.fn() };
    const service = createService(probe);

    await expect(service.create('tenant-a', {
      deviceId: 'device-03',
      name: 'Modbus设备',
      type: 'modbus-tcp',
      profileKey: 'generic-cnc-opcua',
      endpoint: 'modbus-tcp://localhost:502',
    })).rejects.toThrow(BadRequestException);

    const mtconnect = await service.create('tenant-a', {
      deviceId: 'device-04',
      name: 'MTConnect设备',
      type: 'mtconnect',
      profileKey: 'fanuc-cnc-mtconnect',
      endpoint: 'http://localhost:5000/mtconnect',
    });
    expect(mtconnect.status).toBe('unsupported');
    await expect(service.start('tenant-a', mtconnect.id)).resolves.toEqual(
      expect.objectContaining({
        status: 'unsupported',
        health: expect.objectContaining({ status: 'unsupported' }),
        lastError: 'MTConnect adapter is not implemented',
        lastErrorCode: 'PROTOCOL_UNIMPLEMENTED',
        driverVerification: 'unimplemented',
      }),
    );
    expect(probe.probe).not.toHaveBeenCalled();
  });

  it('binds a compatible profile and exposes it without crossing tenant boundaries', async () => {
    const service = createService({ probe: jest.fn() });
    const connection = await service.create('tenant-a', {
      deviceId: 'device-05',
      name: 'OPC UA设备',
      type: 'opc-ua',
      profileKey: 'generic-cnc-opcua',
      endpoint: 'opc.tcp://localhost:4840',
    });

    expect(connection.driverVerification).toBe('not-verified');
    expect(service.profile('tenant-a', connection.id)).toEqual(
      expect.objectContaining({ key: 'generic-cnc-opcua', protocol: 'opcua', verified: false }),
    );
    const rebound = await service.update('tenant-a', connection.id, { profileKey: 'generic-cnc-opcua' });
    expect(rebound.profileKey).toBe('generic-cnc-opcua');
    expect(() => service.profile('tenant-b', connection.id)).toThrow(NotFoundException);
  });

  it('marks an invalid persisted configuration unavailable before it can be started', async () => {
    const persisted = {
      restore: jest.fn().mockResolvedValue({
        connections: [{
          id: 'device-connection-invalid', tenantId: 'tenant-a', deviceId: 'device-99', name: '坏连接',
          type: 'modbus-tcp', profileKey: null, driverVerification: 'not-verified',
          endpoint: 'http://wrong-protocol', config: {}, capabilities: [], enabled: true,
          status: 'running', health: { status: 'healthy', checkedAt: null, latencyMs: null },
          lastError: null, lastErrorCode: null, lastEventAt: null, lastHeartbeatAt: null,
          startedAt: null, createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:00:00.000Z',
        }],
        statusEvents: [],
      }),
    };
    const service = new DeviceConnectionsService(
      { probe: jest.fn() },
      new DeviceProfilesService(),
      persisted as never,
    );

    await service.onModuleInit();

    expect(service.findOne('tenant-a', 'device-connection-invalid')).toEqual(expect.objectContaining({
      status: 'error', lastErrorCode: 'INVALID_CONNECTION_CONFIG', startedAt: null,
    }));
  });

  it('validates configuration, exposes capabilities and deletes a connection', async () => {
    const service = createService({ probe: jest.fn() });
    await expect(service.create('tenant-a', {
      deviceId: 'device-06', name: '非法配置', type: 'mqtt', endpoint: 'mqtt://localhost:1883',
      config: { timeoutMs: 0 },
    })).rejects.toThrow(BadRequestException);

    const connection = await service.create('tenant-a', {
      deviceId: 'device-06', name: 'Modbus连接', type: 'modbus-tcp',
      profileKey: 'generic-cnc-modbus', endpoint: 'modbus-tcp://localhost:502',
      capabilities: ['telemetry', 'alarm'],
    });
    expect(service.capabilities('tenant-a', connection.id)).toEqual(expect.objectContaining({
      protocol: 'modbus-tcp', profileKey: 'generic-cnc-modbus',
      declared: ['telemetry', 'alarm'], profileDataPoints: expect.arrayContaining(['status']),
    }));

    await service.delete('tenant-a', connection.id);
    expect(() => service.findOne('tenant-a', connection.id)).toThrow(NotFoundException);
  });

  it('requires a stopped connection for runtime changes and deletion', async () => {
    const service = createService({ probe: jest.fn().mockResolvedValue({ ok: true, latencyMs: 1 }) });
    const connection = await service.create('tenant-a', {
      deviceId: 'device-07', name: '受保护连接', type: 'mqtt', endpoint: 'mqtt://localhost:1883',
    });
    await service.start('tenant-a', connection.id);

    await expect(service.update('tenant-a', connection.id, { endpoint: 'mqtt://localhost:1884' }))
      .rejects.toThrow(ConflictException);
    await expect(service.delete('tenant-a', connection.id)).rejects.toThrow(ConflictException);
    await expect(service.delete('tenant-b', connection.id)).rejects.toThrow(NotFoundException);

    await service.stop('tenant-a', connection.id);
    await expect(service.update('tenant-a', connection.id, { endpoint: 'mqtt://localhost:1884' }))
      .resolves.toEqual(expect.objectContaining({ endpoint: 'mqtt://localhost:1884', status: 'stopped' }));
    await expect(service.delete('tenant-a', connection.id)).resolves.toBeUndefined();
  });
});
