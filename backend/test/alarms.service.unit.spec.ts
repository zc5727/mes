import { DevicesService } from '../src/devices/devices.service';
import { AlarmsService } from '../src/alarms/alarms.service';
import { MqttIngestionService } from '../src/mqtt/mqtt-ingestion.service';

describe('AlarmsService', () => {
  it('projects active device conditions into tenant-scoped alarms', () => {
    const service = new AlarmsService(new DevicesService());

    expect(service.findAll('tenant-demo')).toEqual([
      expect.objectContaining({
        tenantId: 'tenant-demo',
        source: 'WLD-001',
        sourceId: 'device-welding-01',
        lineId: 'line-welding',
        level: 'warning',
        message: '计划保养',
      }),
    ]);
    expect(service.findAll('other-tenant')).toEqual([]);
  });

  it('supports level and line filters', () => {
    const service = new AlarmsService(new DevicesService());

    expect(service.findAll('tenant-demo', { level: 'critical' })).toEqual([]);
    expect(service.findAll('tenant-demo', { lineId: 'line-welding' })).toHaveLength(1);
  });

  it('pushes an initial snapshot and tenant-scoped projection updates', () => {
    const ingestion = new MqttIngestionService();
    const service = new AlarmsService(new DevicesService(), ingestion);
    const events: string[] = [];
    const subscription = service.stream('tenant-demo').subscribe((event) => events.push(event.data.type));

    expect(events).toEqual(['snapshot']);
    ingestion.ingestHttpEvent('tenant-demo', {
      eventId: 'telemetry-001',
      deviceId: 'cnc-01',
      lineId: 'line-cnc',
      eventType: 'telemetry',
      eventTime: '2026-08-31T10:00:00.000Z',
      status: 'RUNNING',
      payload: { temperatureCelsius: 41, totalCount: 10, goodCount: 10 },
    });
    expect(events).toEqual(['snapshot', 'updated']);

    ingestion.ingestHttpEvent('tenant-other', {
      eventId: 'telemetry-002',
      deviceId: 'cnc-02',
      lineId: 'line-cnc',
      eventType: 'telemetry',
      eventTime: '2026-08-31T10:00:01.000Z',
      status: 'RUNNING',
      payload: { temperatureCelsius: 41, totalCount: 10, goodCount: 10 },
    });
    expect(events).toEqual(['snapshot', 'updated']);
    subscription.unsubscribe();
  });

  it('restores an acknowledged lifecycle from the persisted alarm projection', async () => {
    const persisted = {
      id: 'alarm-device-welding-01',
      tenantId: 'tenant-demo',
      lineId: 'line-welding',
      deviceId: 'device-welding-01',
      code: 'WLD-001',
      level: 'warning',
      status: 'acknowledged',
      message: '计划保养',
      dedupeKey: null,
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
      resolvedAt: null,
      updatedAt: new Date('2026-08-31T10:00:00.000Z'),
    };
    const prisma = {
      ensureConnection: async () => undefined,
      isReady: () => true,
      alarm: { findMany: async () => [persisted] },
    } as any;
    const service = new AlarmsService(new DevicesService(), undefined, undefined, prisma);

    await service.onModuleInit();

    expect(service.findOne('tenant-demo', 'alarm-device-welding-01').status).toBe('acknowledged');
    expect(service.findAll('tenant-demo', { status: 'acknowledged' })).toHaveLength(1);
  });

  it('does not acknowledge alarm work-order creation before durable persistence', async () => {
    const createReliable = jest.fn().mockRejectedValue(new Error('database unavailable'));
    const maintenance = {
      list: jest.fn().mockReturnValue([]),
      createReliable,
    };
    const service = new AlarmsService(new DevicesService(), undefined, maintenance as never);

    await expect(service.createMaintenanceWorkOrder('tenant-demo', 'alarm-device-welding-01'))
      .rejects.toThrow('database unavailable');
    expect(createReliable).toHaveBeenCalledTimes(1);
  });
});
