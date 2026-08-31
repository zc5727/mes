import { DevicesService } from '../src/devices/devices.service';
import { MaintenanceService } from '../src/maintenance/maintenance.service';
import { ProductionLinesService } from '../src/production-lines/production-lines.service';

describe('maintenance spare-part idempotency persistence', () => {
  it('restores consumed and returned operation markers across restart', async () => {
    const part = { id: 'part-1', tenantId: 'tenant-demo', code: 'SP-001', name: '润滑脂', stock: 3, minimumStock: 1, updatedAt: '2026-08-31T00:00:00.000Z' };
    const persistence = {
      restore: jest.fn().mockResolvedValue({ maintenance: [] }),
      restoreAux: jest.fn((domain: string) => Promise.resolve(domain === 'spare-part'
        ? [{ id: part.id, tenantId: part.tenantId, domain, payload: part, createdAt: part.updatedAt, updatedAt: part.updatedAt }]
        : domain === 'maintenance-part-movement'
          ? [{ id: 'movement-1', tenantId: part.tenantId, domain, payload: { kind: 'consume', operationId: 'op-1', part }, createdAt: part.updatedAt, updatedAt: part.updatedAt }]
          : [])),
      saveAux: jest.fn(),
    };
    const service = new MaintenanceService(new DevicesService(), new ProductionLinesService(), persistence as never);

    await service.onModuleInit();

    expect(service.consumeSparePart('tenant-demo', { code: 'SP-001', quantity: 1, operationId: 'op-1' })).toEqual(part);
    expect(service.returnSparePart('tenant-demo', { code: 'SP-001', quantity: 1, operationId: 'op-2' }).stock).toBe(4);
    expect(persistence.saveAux).toHaveBeenCalledWith(expect.objectContaining({ domain: 'maintenance-part-movement' }));
  });
});
