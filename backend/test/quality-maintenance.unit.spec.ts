import { ConflictException } from '@nestjs/common';
import { DevicesService } from '../src/devices/devices.service';
import { MaintenanceService } from '../src/maintenance/maintenance.service';
import { ProductionLinesService } from '../src/production-lines/production-lines.service';
import { QualityService } from '../src/quality/quality.service';
import { WorkOrdersService } from '../src/work-orders/work-orders.service';

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
    expect(maintenance.returnSparePart('tenant-demo', { code: 'SP-001', quantity: 1 }).stock).toBe(1);
  });

  it('requires a passed point inspection before closing an alarm-linked maintenance order', () => {
    const maintenance = new MaintenanceService(new DevicesService(), new ProductionLinesService());
    const order = maintenance.create('tenant-demo', { lineId: 'line-welding', deviceId: 'device-welding-01', type: 'repair', title: '告警维修', alarmId: 'alarm-device-welding-01', plannedAt: '2026-09-01T09:00:00.000Z' });
    maintenance.updateStatus('tenant-demo', order.id, { status: 'assigned' });
    maintenance.updateStatus('tenant-demo', order.id, { status: 'in_progress' });
    expect(() => maintenance.updateStatus('tenant-demo', order.id, { status: 'completed', reason: '已修复' })).toThrow(ConflictException);
    maintenance.recordInspection('tenant-demo', order.id, { result: 'passed', remark: '空载与联动点检通过' });
    expect(maintenance.updateStatus('tenant-demo', order.id, { status: 'completed', reason: '已修复并放行' }).status).toBe('completed');
  });

  it('only allows a released quality result to be used for reporting', () => {
    const quality = new QualityService();
    const workOrders = new WorkOrdersService(undefined, undefined, undefined, undefined, undefined, undefined, quality);
    const order = workOrders.create('tenant-demo', { orderNo: 'WO-QGATE', productCode: 'P', productName: '产品', lineId: 'line-cnc', plannedQty: 1, dueAt: '2026-09-01T09:00:00.000Z' });
    workOrders.updateStatus('tenant-demo', order.id, { status: 'released' });
    workOrders.updateStatus('tenant-demo', order.id, { status: 'in_progress' });
    const record = quality.create('tenant-demo', { workOrderId: order.id, batchNo: 'B-QGATE', lineId: 'line-cnc', operatorId: 'inspector', values: {} });
    expect(() => workOrders.report('tenant-demo', order.id, { quantity: 1, qualityRecordId: record.id })).toThrow(ConflictException);
    quality.submit('tenant-demo', record.id, { actorId: 'inspector' });
    quality.confirm('tenant-demo', record.id, { actorId: 'manager' });
    expect(workOrders.report('tenant-demo', order.id, { quantity: 1, qualityRecordId: record.id }).workOrder.status).toBe('completed');
  });
});
