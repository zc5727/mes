import { NotFoundException } from '@nestjs/common';
import { DevicesService } from '../src/devices/devices.service';
import { ProductionLinesService } from '../src/production-lines/production-lines.service';
import { AuditService } from '../src/audit/audit.service';

describe('DevicesService line ownership', () => {
  it('does not acknowledge a device when durable persistence rejects it', async () => {
    const persistence = {
      isEnabled: () => true,
      restore: jest.fn().mockResolvedValue({ devices: [] }),
      saveDevice: jest.fn().mockRejectedValue(new Error('database unavailable')),
    };
    const devices = new DevicesService(persistence as never, new ProductionLinesService());
    await devices.onModuleInit();

    await expect(devices.createReliable('tenant-demo', {
      lineId: 'line-cnc', code: 'DURABLE-001', name: '持久化设备',
    })).rejects.toThrow('database unavailable');
    expect(devices.findAll('tenant-demo')).toHaveLength(0);
  });

  it('rolls back a device status when durable persistence rejects it', async () => {
    const persistence = {
      isEnabled: () => false,
      saveDevice: jest.fn().mockRejectedValue(new Error('database unavailable')),
    };
    const devices = new DevicesService(persistence as never, new ProductionLinesService());

    await expect(devices.updateStatusReliable('tenant-demo', 'device-cnc-01', { status: 'maintenance', reason: '故障隔离' }))
      .rejects.toThrow('database unavailable');
    expect(devices.findOne('tenant-demo', 'device-cnc-01').status).toBe('online');
  });

  it('rolls back an asset edit when durable persistence rejects it', async () => {
    const persistence = { saveDevice: jest.fn().mockRejectedValue(new Error('database unavailable')) };
    const devices = new DevicesService(persistence as never, new ProductionLinesService());
    await expect(devices.updateReliable('tenant-demo', 'device-cnc-01', { name: '写入失败设备' }))
      .rejects.toThrow('database unavailable');
    expect(devices.findOne('tenant-demo', 'device-cnc-01').name).toBe('立式加工中心 01');
  });

  it('restores an asset when durable deletion rejects it', async () => {
    const persistence = { deleteDevice: jest.fn().mockRejectedValue(new Error('database unavailable')) };
    const devices = new DevicesService(persistence as never, new ProductionLinesService());
    await expect(devices.removeReliable('tenant-demo', 'device-cnc-01'))
      .rejects.toThrow('database unavailable');
    expect(devices.findOne('tenant-demo', 'device-cnc-01')).toEqual(expect.objectContaining({ id: 'device-cnc-01' }));
  });

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

  it('audits device lifecycle and status changes', () => {
    const audit = new AuditService();
    const lines = new ProductionLinesService();
    const devices = new DevicesService(undefined, lines, audit);
    const device = devices.create('tenant-demo', { lineId: 'line-cnc', code: 'AUDIT-001', name: '审计设备' });

    devices.update('tenant-demo', device.id, { name: '审计设备-已更新' });
    devices.updateStatus('tenant-demo', device.id, { status: 'alarm', reason: '测试告警' });
    devices.remove('tenant-demo', device.id);

    expect(audit.list('tenant-demo').map((entry) => entry.action)).toEqual(expect.arrayContaining([
      'device.created', 'device.updated', 'device.status', 'device.deleted',
    ]));
  });
});
