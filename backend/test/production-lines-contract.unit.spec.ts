import { ConflictException, NotFoundException } from '@nestjs/common';
import { FactoriesService } from '../src/factories/factories.service';
import { ProductionLinesService } from '../src/production-lines/production-lines.service';
import { AuditService } from '../src/audit/audit.service';

describe('production line create contract', () => {
  it('does not acknowledge a factory when durable persistence rejects it', async () => {
    const persistence = {
      isEnabled: () => true,
      restore: jest.fn().mockResolvedValue({ factories: [], lines: [], workOrders: [] }),
      saveFactory: jest.fn().mockRejectedValue(new Error('database unavailable')),
    };
    const factories = new FactoriesService(persistence as never);
    await factories.onModuleInit();

    await expect(factories.createReliable('tenant-a', { code: 'F-DURABLE', name: '持久化工厂' }))
      .rejects.toThrow('database unavailable');
    expect(factories.findAll('tenant-a')).toHaveLength(0);
  });

  it('does not acknowledge a line when durable persistence rejects it', async () => {
    const factories = new FactoriesService();
    const factory = factories.create('tenant-a', { code: 'F-DURABLE', name: '持久化工厂' });
    const persistence = {
      isEnabled: () => true,
      restore: jest.fn().mockResolvedValue({ lines: [], workOrders: [] }),
      saveLine: jest.fn().mockRejectedValue(new Error('database unavailable')),
    };
    const service = new ProductionLinesService(factories, persistence as never);
    await service.onModuleInit();

    await expect(service.createReliable('tenant-a', { factoryId: factory.id, code: 'L-DURABLE', name: '持久化产线', type: '装配' }))
      .rejects.toThrow('database unavailable');
    expect(service.findAll('tenant-a')).toHaveLength(0);
  });

  it('creates a tenant-scoped line with safe defaults', () => {
    const factories = new FactoriesService();
    const factory = factories.create('tenant-a', { code: 'F100', name: '测试工厂' });
    const service = new ProductionLinesService(factories);
    const created = service.create('tenant-a', { factoryId: factory.id, code: 'L100', name: '包装线', type: '包装' });

    expect(created).toEqual(expect.objectContaining({ tenantId: 'tenant-a', factoryId: factory.id, code: 'L100', targetOee: 85, status: 'active' }));
    expect(service.findAll('tenant-b')).toHaveLength(0);
  });

  it('rejects duplicate codes only within the same tenant', () => {
    const factories = new FactoriesService();
    const factoryA = factories.create('tenant-a', { code: 'F100', name: '测试工厂' });
    const factoryB = factories.create('tenant-b', { code: 'F100', name: '测试工厂' });
    const service = new ProductionLinesService(factories);
    const payload = { factoryId: factoryA.id, code: 'L100', name: '包装线', type: '包装' };
    service.create('tenant-a', payload);

    expect(() => service.create('tenant-a', payload)).toThrow(ConflictException);
    expect(() => service.create('tenant-b', { ...payload, factoryId: factoryB.id })).not.toThrow();
  });

  it('validates status reasons and only deletes inactive lines', () => {
    const service = new ProductionLinesService();

    expect(() => service.updateStatus('tenant-demo', 'line-cnc', { status: 'maintenance' }))
      .toThrow(ConflictException);
    expect(() => service.update('tenant-demo', 'line-cnc', { status: 'maintenance' }))
      .toThrow(ConflictException);
    expect(() => service.remove('tenant-demo', 'line-cnc')).toThrow(ConflictException);

    service.updateStatus('tenant-demo', 'line-cnc', { status: 'inactive', reason: '产线改造' });
    expect(service.remove('tenant-demo', 'line-cnc')).toEqual({ id: 'line-cnc', deleted: true });
    expect(() => service.findOne('tenant-demo', 'line-cnc')).toThrow(NotFoundException);
  });

  it('persists maintenance state and audits line lifecycle changes', async () => {
    const persistence = {
      isEnabled: () => false,
      restore: jest.fn(),
      saveLine: jest.fn().mockResolvedValue(undefined),
    };
    const audit = new AuditService();
    const factories = new FactoriesService();
    const factory = factories.create('tenant-a', { code: 'F200', name: '审计工厂' });
    const service = new ProductionLinesService(factories, persistence as never, audit);
    const line = service.create('tenant-a', { factoryId: factory.id, code: 'L200', name: '装配线', type: '装配' });

    service.updateStatus('tenant-a', line.id, { status: 'maintenance', reason: '计划保养' });

    expect(persistence.saveLine).toHaveBeenLastCalledWith(expect.objectContaining({
      active: false,
      status: 'maintenance',
      statusReason: '计划保养',
    }));
    expect(audit.list('tenant-a').map((entry) => entry.action)).toEqual(expect.arrayContaining([
      'production_line.created', 'production_line.status',
    ]));

    const restored = new ProductionLinesService(factories, {
      isEnabled: () => true,
      restore: jest.fn().mockResolvedValue({
        lines: [{ ...line, active: false, status: 'maintenance', statusReason: '计划保养' }],
        workOrders: [],
      }),
    } as never);
    await restored.onModuleInit();
    expect(restored.findOne('tenant-a', line.id)).toEqual(expect.objectContaining({ status: 'maintenance', statusReason: '计划保养' }));
  });
});
