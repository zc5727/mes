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
});
