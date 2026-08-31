import { ConflictException } from '@nestjs/common';
import { DevicesService } from '../src/devices/devices.service';
import { MaintenanceService } from '../src/maintenance/maintenance.service';
import { ProductionLinesService } from '../src/production-lines/production-lines.service';
import { QualityService } from '../src/quality/quality.service';

describe('quality and maintenance minimum loops', () => {
  it('validates an inspection rule and closes an NCR with CAPA', () => {
    const quality = new QualityService();
    quality.createRule('tenant-demo', { key: 'IQC-MATERIAL', name: '来料检验', inspectionType: 'IQC', requiredFields: ['hardness'] });
    const record = quality.create('tenant-demo', { inspectionType: 'IQC', ruleKey: 'IQC-MATERIAL', batchNo: 'RAW-001', lineId: 'line-cnc', workOrderId: 'wo-demo-001', operatorId: 'inspector', values: { hardness: 62 } });
    quality.submit('tenant-demo', record.id, { actorId: 'inspector' });
    expect(quality.confirm('tenant-demo', record.id, { actorId: 'quality-manager' }).status).toBe('confirmed');
    const issue = quality.createIssue('tenant-demo', { qualityRecordId: record.id, code: 'NCR-001', description: '硬度偏差' });
    expect(() => quality.updateIssue('tenant-demo', issue.id, { status: 'closed' })).toThrow(ConflictException);
    expect(quality.updateIssue('tenant-demo', issue.id, { status: 'closed', capa: '调整热处理参数并复检' }).status).toBe('closed');
  });

  it('creates preventive maintenance and prevents spare-part stock underflow', () => {
    const maintenance = new MaintenanceService(new DevicesService(), new ProductionLinesService());
    const plan = maintenance.createPreventivePlan('tenant-demo', { deviceId: 'device-cnc-01', title: '主轴保养', nextDueAt: '2026-09-10T09:00:00.000Z' });
    expect(maintenance.listPreventivePlans('tenant-demo')).toContainEqual(plan);
    maintenance.createSparePart('tenant-demo', { code: 'SP-001', name: '润滑脂', stock: 2, minimumStock: 1 });
    expect(maintenance.consumeSparePart('tenant-demo', { code: 'SP-001', quantity: 2 }).stock).toBe(0);
    expect(() => maintenance.consumeSparePart('tenant-demo', { code: 'SP-001', quantity: 1 })).toThrow(ConflictException);
  });
});
