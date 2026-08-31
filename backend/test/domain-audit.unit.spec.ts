import { AuditService } from '../src/audit/audit.service';
import { DevicesService } from '../src/devices/devices.service';
import { InventoryService } from '../src/inventory/inventory.service';
import { MaintenanceService } from '../src/maintenance/maintenance.service';
import { ProductionLinesService } from '../src/production-lines/production-lines.service';
import { QualityService } from '../src/quality/quality.service';
import { MasterDataService } from '../src/master-data/master-data.service';

describe('business domain audit linkage', () => {
  it('records the acting user for quality, maintenance, inventory and master-data writes', () => {
    const audit = new AuditService();
    const quality = new QualityService(undefined, undefined, undefined, undefined, audit);
    quality.createRule('tenant-demo', { key: 'IPQC-1', name: '尺寸检验', inspectionType: 'IPQC', requiredFields: [] }, 'quality-user');

    const maintenance = new MaintenanceService(new DevicesService(), new ProductionLinesService(), undefined, undefined, audit);
    maintenance.createSparePart('tenant-demo', { code: 'SP-AUDIT', name: '润滑脂', stock: 1 }, 'maintenance-user');

    const inventory = new InventoryService(undefined, audit);
    inventory.createMaterial('tenant-demo', 'factory-demo', { code: 'MAT-AUDIT', name: '钢材', unit: 'kg' }, 'warehouse-user');

    const masterData = new MasterDataService(undefined, undefined, audit);
    masterData.create('tenant-demo', 'product', { code: 'P-AUDIT', name: '审计产品' }, 'master-user');

    expect(audit.list('tenant-demo').map((entry) => entry.actor)).toEqual(expect.arrayContaining([
      'quality-user', 'maintenance-user', 'warehouse-user', 'master-user',
    ]));
  });
});
