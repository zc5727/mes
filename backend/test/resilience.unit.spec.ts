import { ConflictException, NotFoundException } from '@nestjs/common';
import { DevicesService } from '../src/devices/devices.service';
import { FactoriesService } from '../src/factories/factories.service';
import { WorkOrdersService } from '../src/work-orders/work-orders.service';

describe('MES resilience and failure boundaries', () => {
  it('recovers an offline device when telemetry arrives', () => {
    const service = new DevicesService();

    const offline = service.updateStatus('tenant-demo', 'device-cnc-01', {
      status: 'offline',
      reason: '采集网关断开',
    });
    expect(offline.status).toBe('offline');
    expect(offline.statusReason).toBe('采集网关断开');

    const recovered = service.ingestTelemetry('tenant-demo', 'device-cnc-01', {
      source: 'edge-gateway-01',
      timestamp: '2026-08-28T08:05:00.000Z',
      metrics: { temperature: 43.2, load: 71, healthy: true },
    });

    expect(recovered.status).toBe('online');
    expect(recovered.statusReason).toBe('');
    expect(recovered.lastSeenAt).toBe('2026-08-28T08:05:00.000Z');
    expect(recovered.metrics).toEqual({ temperature: 43.2, load: 71, healthy: true });
  });

  it('does not let a delayed device telemetry overwrite the current ledger state', () => {
    const service = new DevicesService();
    const current = service.ingestTelemetry('tenant-demo', 'device-cnc-01', {
      timestamp: '2026-08-28T09:00:00.000Z', metrics: { temperature: 50 },
    });

    const delayed = service.ingestTelemetry('tenant-demo', 'device-cnc-01', {
      timestamp: '2026-08-28T08:59:00.000Z', metrics: { temperature: 10 },
    });

    expect(delayed).toEqual(current);
    expect(service.findOne('tenant-demo', 'device-cnc-01').metrics).toEqual({ temperature: 50 });
  });

  it('projects gateway device IDs into the tenant-scoped ledger with alarm state', () => {
    const service = new DevicesService();

    const projected = service.projectTelemetry('tenant-demo', 'line-cnc', 'cnc-01', {
      timestamp: '2026-08-28T09:00:00.000Z', metrics: { temperatureCelsius: 90 }, status: 'alarm',
      statusReason: 'OVERHEAT',
    });

    expect(projected).toEqual(expect.objectContaining({
      id: 'device-cnc-01', status: 'alarm', statusReason: 'OVERHEAT',
    }));
    expect(service.projectTelemetry('tenant-other', 'line-cnc', 'cnc-01', {
      timestamp: '2026-08-28T09:01:00.000Z', metrics: {}, status: 'online',
    })).toBeUndefined();
  });

  it('does not leak device data across tenants', () => {
    const service = new DevicesService();

    expect(service.findAll('tenant-other')).toEqual([]);
    expect(() => service.findOne('tenant-other', 'device-cnc-01')).toThrow(NotFoundException);
  });

  it('rejects duplicate factory and device identifiers at the service boundary', () => {
    const factories = new FactoriesService();
    expect(() => factories.create('tenant-demo', {
      code: 'F001',
      name: '重复工厂',
    })).toThrow(ConflictException);

    const devices = new DevicesService();
    expect(() => devices.create('tenant-demo', {
      lineId: 'line-cnc',
      code: 'CNC-001',
      name: '重复设备',
    })).toThrow(ConflictException);
  });

  it('rejects invalid work-order transitions and impossible quantities', () => {
    const service = new WorkOrdersService();

    expect(() => service.updateStatus('tenant-demo', 'wo-demo-001', {
      status: 'draft',
    })).toThrow(ConflictException);
    expect(() => service.update('tenant-demo', 'wo-demo-001', {
      completedQty: 1201,
    })).toThrow(ConflictException);
  });
});
