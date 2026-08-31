import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DeviceConnectionsService } from '../src/device-connections/device-connections.service';
import type { DeviceConnectionProbe } from '../src/device-connections/device-connection.types';

describe('device connections', () => {
  it('keeps configurations tenant scoped and declares capabilities', () => {
    const probe: DeviceConnectionProbe = { probe: jest.fn() };
    const service = new DeviceConnectionsService(probe);
    const connection = service.create('tenant-a', {
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
    const service = new DeviceConnectionsService(probe);
    const connection = service.create('tenant-a', {
      deviceId: 'device-01', name: 'Webhook', type: 'webhook', endpoint: 'https://example.test/hook',
      capabilities: ['status'],
    });

    const tested = await service.test('tenant-a', connection.id);
    expect(tested.test).toEqual({ ok: true, latencyMs: 12, error: null });
    expect(tested.connection.health.status).toBe('healthy');
    expect((await service.start('tenant-a', connection.id)).status).toBe('running');
    expect(service.health('tenant-a', connection.id).checkedAt).toEqual(expect.any(String));
    expect(service.stop('tenant-a', connection.id).status).toBe('stopped');
    expect(probe.probe).toHaveBeenCalledTimes(2);
  });

  it('stores a unified event only for a running connection and rejects duplicates', async () => {
    const probe: DeviceConnectionProbe = { probe: jest.fn().mockResolvedValue({ ok: true, latencyMs: 1 }) };
    const service = new DeviceConnectionsService(probe);
    const connection = service.create('tenant-a', {
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
    const service = new DeviceConnectionsService(probe);
    expect(() => service.create('tenant-a', { deviceId: 'd', name: 'Bad', type: 'mqtt', endpoint: 'https://example.test' })).toThrow(BadRequestException);
    const connection = service.create('tenant-a', { deviceId: 'device-02', name: 'HTTP', type: 'http', endpoint: 'http://localhost:3100' });
    const result = await service.test('tenant-a', connection.id);
    expect(result.test.error).toBe('connection refused');
    expect(result.connection.lastError).toBe('connection refused');
    await expect(service.start('tenant-a', connection.id)).resolves.toEqual(expect.objectContaining({ status: 'error', lastError: 'connection refused' }));
  });
});
