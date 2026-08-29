import { DevicesService } from '../src/devices/devices.service';
import { AlarmsService } from '../src/alarms/alarms.service';

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
});
