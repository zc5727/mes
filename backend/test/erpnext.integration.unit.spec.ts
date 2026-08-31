import { ErpNextClient } from '../src/integrations/erpnext/erpnext.client';
import { ErpNextService } from '../src/integrations/erpnext/erpnext.service';
import type { ErpNextConfig } from '../src/integrations/erpnext/erpnext.types';

describe('ERPNext integration adapter', () => {
  afterEach(() => jest.restoreAllMocks());

  it('degrades explicitly when ERPNext is not configured', async () => {
    const config: ErpNextConfig = { enabled: false, timeoutMs: 5000, tenantMapping: {} };
    const service = new ErpNextService(config, new ErpNextClient(config));

    await expect(service.health()).resolves.toMatchObject({
      integration: 'erpnext', status: 'disabled', configured: false,
    });
    await expect(service.workOrders('tenant-demo')).rejects.toMatchObject({ status: 503 });
  });

  it('uses token authentication and maps ERPNext resource data', async () => {
    const config: ErpNextConfig = {
      enabled: true, baseUrl: 'http://erpnext.local/', apiKey: 'key', apiSecret: 'secret', timeoutMs: 5000,
      tenantMapping: { 'tenant-demo': 'Demo Manufacturing' },
    };
    const response = { ok: true, status: 200, text: jest.fn().mockResolvedValue(JSON.stringify({ data: [{ name: 'WO-001' }] })) };
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(response as unknown as Response);
    const service = new ErpNextService(config, new ErpNextClient(config));

    await expect(service.workOrders('tenant-demo')).resolves.toEqual({
      data: [{ name: 'WO-001' }], source: 'erpnext', degraded: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('http://erpnext.local/api/resource/Work%20Order?filters='),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'token key:secret' }) }),
    );
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(JSON.parse(requestUrl.searchParams.get('filters') ?? 'null')).toEqual([
      ['Work Order', 'company', '=', 'Demo Manufacturing'],
    ]);
  });

  it('maps upstream auth failures and bridges a report as a Job Card', async () => {
    const config: ErpNextConfig = {
      enabled: true, baseUrl: 'http://erpnext.local', apiKey: 'key', apiSecret: 'secret', timeoutMs: 5000,
      tenantMapping: { 'tenant-demo': 'Demo Manufacturing' },
    };
    const unauthorized = { ok: false, status: 401, text: jest.fn().mockResolvedValue('{}') };
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce(unauthorized as unknown as Response);
    const service = new ErpNextService(config, new ErpNextClient(config));
    await expect(service.productionOrders('tenant-demo')).rejects.toMatchObject({ status: 401 });

    const accepted = { ok: true, status: 200, text: jest.fn().mockResolvedValue(JSON.stringify({ data: { name: 'JC-001' } })) };
    fetchMock.mockResolvedValueOnce(accepted as unknown as Response);
    await expect(service.bridgeReport('tenant-demo', 'WO-001', { completed_qty: 4 })).resolves.toMatchObject({
      accepted: true, externalId: 'JC-001',
    });
    expect(decodeURIComponent(String(fetchMock.mock.calls[1]?.[0]))).toBe('http://erpnext.local/api/resource/Job Card');
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      method: 'POST', body: JSON.stringify({ work_order: 'WO-001', completed_qty: 4, company: 'Demo Manufacturing' }),
    }));
  });

  it('fails closed when a tenant has no ERPNext company mapping', async () => {
    const config: ErpNextConfig = {
      enabled: true, baseUrl: 'http://erpnext.local', apiKey: 'key', apiSecret: 'secret', timeoutMs: 5000,
      tenantMapping: { 'tenant-demo': 'Demo Manufacturing' },
    };
    const service = new ErpNextService(config, new ErpNextClient(config));

    await expect(service.workOrders('tenant-other')).rejects.toMatchObject({ status: 503 });
  });
});
