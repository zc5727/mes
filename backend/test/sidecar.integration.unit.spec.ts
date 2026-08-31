import { SidecarService } from '../src/integrations/sidecar/sidecar.service';

describe('configurable ERPNext/OpenMES sidecar boundary', () => {
  it('reconciles orders, work orders and reports using tenant mapping without mutating local data', async () => {
    const service = new SidecarService({ enabled: false, provider: 'openmes', timeoutMs: 5000, retries: 2, tenantMapping: { 'tenant-demo': 'factory-a' } });
    const local = [{ id: 'wo-1', externalId: 'EXT-1', status: 'completed', plannedQty: 10, completedQty: 9 }, { id: 'wo-2' }];
    const result = await service.reconcile('tenant-demo', 'work-orders', local, [{ id: 'remote-1', externalId: 'EXT-1', status: 'in_progress', plannedQty: 10, completedQty: 8 }, { id: 'remote-3' }]);
    expect(result).toEqual(expect.objectContaining({ source: 'fixture', externalTenantId: 'factory-a', matched: 0, localOnly: ['wo-2'], externalOnly: ['remote-3'] }));
    expect(result.conflicts[0]).toEqual({ key: 'EXT-1', fields: ['status', 'completedQty'] });
    expect(local[0].completedQty).toBe(9);
  });

  it('retries external reads and sends mapped tenant and bearer credentials', async () => {
    const service = new SidecarService({ enabled: true, provider: 'erpnext', baseUrl: 'http://sidecar.local/', token: 'secret', timeoutMs: 5000, retries: 1, tenantMapping: { 'tenant-demo': 'erp-company' } });
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: false, status: 503 } as Response).mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue({ data: [{ id: 'order-1', status: 'completed' }] }) } as unknown as Response);
    await expect(service.reconcile('tenant-demo', 'orders', [{ id: 'order-1', status: 'completed' }])).resolves.toEqual(expect.objectContaining({ source: 'sidecar', matched: 1 }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain('tenantId=erp-company');
    expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer secret' }) }));
    fetchMock.mockRestore();
  });
});
