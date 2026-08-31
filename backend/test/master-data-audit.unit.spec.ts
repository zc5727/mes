import { MasterDataService } from '../src/master-data/master-data.service';
import { AuditService } from '../src/audit/audit.service';

describe('business foundation APIs', () => {
  it('keeps master data tenant scoped and rejects duplicate codes', () => {
    const service = new MasterDataService();
    const product = service.create('tenant-a', 'product', { code: 'P-01', name: '产品一' });
    expect(service.list('tenant-a', 'product')).toHaveLength(1);
    expect(service.list('tenant-b', 'product')).toHaveLength(0);
    expect(() => service.create('tenant-a', 'product', { code: 'P-01', name: '重复产品' })).toThrow('already exists');
    expect(product.tenantId).toBe('tenant-a');
  });

  it('records simulator audit and approval lifecycle per tenant', () => {
    const service = new AuditService();
    const approval = service.createApproval('tenant-a', { resource: 'simulator', resourceId: 'cmd-1' });
    service.record('tenant-a', 'operator-1', { action: 'simulator.fault', resource: 'simulator', resourceId: 'cmd-1' });
    expect(service.list('tenant-a')).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'APPROVAL_CREATED' }),
      expect.objectContaining({ action: 'simulator.fault' }),
    ]));
    expect(service.decide('tenant-a', approval.id, 'approved').status).toBe('approved');
    expect(service.listApprovals('tenant-b')).toHaveLength(0);
  });

  it('does not allow a decided approval to transition again', () => {
    const service = new AuditService();
    const approval = service.createApproval('tenant-a', { resource: 'strategy-candidate', resourceId: 'candidate-1' });
    service.decide('tenant-a', approval.id, 'approved');
    expect(() => service.decide('tenant-a', approval.id, 'rejected')).toThrow(/already approved/);
  });

  it('verifies the append-only audit hash chain', () => {
    const service = new AuditService();
    service.record('tenant-a', 'user-1', { action: 'strategy.simulate', resource: 'strategy-simulation' });
    service.record('tenant-a', 'user-1', { action: 'strategy.approve', resource: 'strategy-candidate' });
    expect(service.verify('tenant-a')).toEqual({ valid: true, checked: 2 });
  });

  it('supports tenant-scoped production calendars', () => {
    const service = new MasterDataService();
    const calendar = service.create('tenant-a', 'calendar', {
      code: 'CAL-20260830', name: '日班日历', date: '2026-08-30', plannedHours: 8,
    });

    expect(service.list('tenant-a', 'calendar')).toEqual([calendar]);
    expect(service.list('tenant-b', 'calendar')).toHaveLength(0);
    expect(() => service.create('tenant-a', 'calendar', {
      code: 'CAL-20260830', name: '重复日历', date: '2026-08-30',
    })).toThrow('already exists');
  });

  it('models operations, BOMs and routings as versioned tenant data', () => {
    const service = new MasterDataService();
    const operation = service.create('tenant-a', 'operation', { code: 'OP-10', name: '加工', standardSeconds: 42, workstation: 'WS-CNC-01' });
    const bom = service.create('tenant-a', 'bom', { code: 'BOM-P01', name: '产品 BOM', productCode: 'P-01', version: '1.0', items: [{ code: 'RAW-01', qty: 2 }], operationCodes: [operation.code] });
    const routing = service.create('tenant-a', 'routing', { code: 'ROUTE-P01', name: '产品工艺路线', productCode: 'P-01', version: '1.0', operationCodes: [operation.code] });
    expect(bom.data).toEqual(expect.objectContaining({ productCode: 'P-01', version: '1.0' }));
    expect(routing.data.operationCodes).toEqual(['OP-10']);
    expect(service.list('tenant-b', 'routing')).toHaveLength(0);
    expect(() => service.create('tenant-a', 'routing', { code: 'ROUTE-BAD', name: '无效路线', productCode: 'P-01', version: '1.0', operationCodes: ['OP-MISSING'] })).toThrow('Unknown operation codes');
  });

  it('restores persisted routing master data without crossing tenants', async () => {
    const persistence = {
      restoreAux: jest.fn((domain: string) => Promise.resolve(domain === 'master-data:routing' ? [{
        id: 'routing-1', tenantId: 'tenant-a', domain, payload: {
          id: 'routing-1', tenantId: 'tenant-a', code: 'ROUTE-P01', name: '持久化路线', type: 'routing',
          data: { productCode: 'P-01', version: '1.0', operationCodes: [] },
          createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:00:00.000Z',
        }, createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:00:00.000Z',
      }] : [])),
    };
    const service = new MasterDataService(undefined, persistence as never);
    await service.onModuleInit();
    expect(service.list('tenant-a', 'routing')).toHaveLength(1);
    expect(service.list('tenant-b', 'routing')).toHaveLength(0);
  });

  it('keeps batch inventory tenant-scoped and consumes atomically', () => {
    const service = new MasterDataService();
    service.createBatch('tenant-a', { materialCode: 'RAW-01', batchNo: 'B-01', quantity: 5 });
    expect(() => service.consumeBatches('tenant-b', [{ materialCode: 'RAW-01', batchNo: 'B-01', quantity: 1 }])).toThrow();
    expect(() => service.consumeBatches('tenant-a', [
      { materialCode: 'RAW-01', batchNo: 'B-01', quantity: 3 },
      { materialCode: 'RAW-02', batchNo: 'MISSING', quantity: 1 },
    ])).toThrow();
    expect(service.listBatches('tenant-a')[0].quantity).toBe(5);
    service.consumeBatches('tenant-a', [{ materialCode: 'RAW-01', batchNo: 'B-01', quantity: 2 }]);
    expect(service.listBatches('tenant-a')[0].quantity).toBe(3);
    service.consumeBatches('tenant-a', [{ materialCode: 'RAW-01', batchNo: 'B-01', quantity: 1 }], 'report-1');
    service.consumeBatches('tenant-a', [{ materialCode: 'RAW-01', batchNo: 'B-01', quantity: 1 }], 'report-1');
    expect(service.listBatches('tenant-a')[0].quantity).toBe(2);
    service.returnBatch('tenant-a', { materialCode: 'RAW-01', batchNo: 'B-01', quantity: 1, idempotencyKey: 'return-1' });
    service.returnBatch('tenant-a', { materialCode: 'RAW-01', batchNo: 'B-01', quantity: 1, idempotencyKey: 'return-1' });
    expect(service.listBatches('tenant-a')[0].quantity).toBe(3);
  });
});
