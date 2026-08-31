import { NotFoundException } from '@nestjs/common';
import { DevicesService } from '../src/devices/devices.service';
import { ProductionLinesService } from '../src/production-lines/production-lines.service';

describe('DevicesService line ownership', () => {
  it('does not retain demo devices when an enabled database restores an empty snapshot', async () => {
    const persistence = {
      isEnabled: () => true,
      restore: jest.fn().mockResolvedValue({ devices: [] }),
    };
    const devices = new DevicesService(persistence as never);

    await devices.onModuleInit();

    expect(devices.findAll('tenant-demo')).toHaveLength(0);
  });

  it('rejects a device when its line does not belong to the tenant', () => {
    const lines = new ProductionLinesService();
    const devices = new DevicesService(undefined, lines);

    expect(() => devices.create('tenant-demo', {
      lineId: 'line-does-not-exist',
      code: 'NEW-001',
      name: '未绑定设备',
    })).toThrow(NotFoundException);
  });

  it('rejects moving a device to an unknown line', () => {
    const lines = new ProductionLinesService();
    const devices = new DevicesService(undefined, lines);
    const created = devices.create('tenant-demo', {
      lineId: 'line-cnc',
      code: 'NEW-002',
      name: '可迁移设备',
    });

    expect(() => devices.update('tenant-demo', created.id, {
      lineId: 'line-does-not-exist',
    })).toThrow(NotFoundException);
  });
});
