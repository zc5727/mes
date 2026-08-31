import { ErpNextShadowAdapter } from '../src/integrations/erpnext/erpnext-adapter.port';

describe('ERPNext shadow adapter port', () => {
  it('provides fixture reads without implying an ERPNext connection', async () => {
    const adapter = new ErpNextShadowAdapter({
      'tenant-demo': { 'Work Order': [{ name: 'WO-SHADOW-001', qty: 10 }] },
    });

    await expect(adapter.health()).resolves.toEqual({
      mode: 'shadow', status: 'shadow', configured: false, error: 'shadow_only_no_external_connection',
    });
    await expect(adapter.list('tenant-demo', 'Work Order')).resolves.toEqual({
      data: [{ name: 'WO-SHADOW-001', qty: 10 }], source: 'shadow', degraded: true,
    });
    await expect(adapter.list('tenant-other', 'Work Order')).resolves.toEqual({ data: [], source: 'shadow', degraded: true });
  });

  it('records report proposals but never returns upstream acceptance', async () => {
    const adapter = new ErpNextShadowAdapter();

    await expect(adapter.report('tenant-demo', 'WO-SHADOW-001', { completed_qty: 2 })).resolves.toEqual({
      accepted: false,
      source: 'shadow',
      externalId: null,
      mode: 'shadow',
      data: { workOrderId: 'WO-SHADOW-001', completed_qty: 2 },
      reason: 'shadow_only_no_external_write',
    });
    expect(adapter.getProposals()).toEqual([{
      tenantId: 'tenant-demo', workOrderId: 'WO-SHADOW-001', payload: { completed_qty: 2 },
    }]);
  });
});
