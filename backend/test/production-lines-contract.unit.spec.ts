import { ConflictException, NotFoundException } from '@nestjs/common';
import { FactoriesService } from '../src/factories/factories.service';
import { ProductionLinesService } from '../src/production-lines/production-lines.service';

describe('production line create contract', () => {
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
});
