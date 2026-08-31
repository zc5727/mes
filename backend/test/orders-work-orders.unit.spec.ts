import { ConflictException } from '@nestjs/common';
import { OrdersService } from '../src/orders/orders.service';
import { ProductionLinesService } from '../src/production-lines/production-lines.service';
import { WorkOrdersService } from '../src/work-orders/work-orders.service';
import { DevicesService } from '../src/devices/devices.service';
import { MasterDataService } from '../src/master-data/master-data.service';

describe('production execution flow', () => {
  it('creates an order, runs a work order, reports production and completes it', () => {
    const orders = new OrdersService();
    const workOrders = new WorkOrdersService(orders, new ProductionLinesService());
    const order = orders.create('tenant-demo', {
      orderNo: 'PO-TEST-001', productCode: 'PART-TEST', productName: '测试产品',
      plannedQty: 5, dueAt: '2026-08-29T18:00:00.000Z', priority: 'normal', externalId: 'ERP-PO-001', externalSystem: 'ERPNext',
    });
    const workOrder = workOrders.create('tenant-demo', {
      orderId: order.id, orderNo: 'WO-TEST-001', productCode: 'PART-TEST', productName: '测试产品',
      lineId: 'line-cnc', plannedQty: 5, dueAt: '2026-08-29T18:00:00.000Z',
    });

    workOrders.updateStatus('tenant-demo', workOrder.id, { status: 'released' });
    workOrders.updateStatus('tenant-demo', workOrder.id, { status: 'in_progress' });
    workOrders.report('tenant-demo', workOrder.id, { quantity: 3, goodQty: 3, defectQty: 0, deviceId: 'device-cnc-01', sourceTraceId: 'trace-001' });
    const result = workOrders.report('tenant-demo', workOrder.id, { quantity: 2, goodQty: 1, defectQty: 1, deviceId: 'device-cnc-01', sourceTraceId: 'trace-002' });

    expect(result.workOrder.status).toBe('completed');
    expect(result.workOrder.completedQty).toBe(5);
    expect(workOrders.findReports('tenant-demo', workOrder.id)).toHaveLength(2);
    expect(orders.findOne('tenant-demo', order.id).completedQty).toBe(5);
    expect(order.externalId).toBe('ERP-PO-001');
  });

  it('rejects invalid line and over-reporting', () => {
    const orders = new OrdersService();
    const workOrders = new WorkOrdersService(orders, new ProductionLinesService());
    expect(() => workOrders.create('tenant-demo', {
      orderNo: 'WO-INVALID-LINE', productCode: 'P', productName: '产品', lineId: 'missing-line', plannedQty: 1,
      dueAt: '2026-08-29T18:00:00.000Z',
    })).toThrow();

    const workOrder = workOrders.create('tenant-demo', {
      orderNo: 'WO-OVER-REPORT', productCode: 'P', productName: '产品', lineId: 'line-cnc', plannedQty: 1,
      dueAt: '2026-08-29T18:00:00.000Z',
    });
    workOrders.updateStatus('tenant-demo', workOrder.id, { status: 'released' });
    workOrders.updateStatus('tenant-demo', workOrder.id, { status: 'in_progress' });
    expect(() => workOrders.report('tenant-demo', workOrder.id, { quantity: 2 })).toThrow(ConflictException);
  });

  it('enforces quantity integrity and exception reasons', () => {
    const workOrders = new WorkOrdersService(new OrdersService(), new ProductionLinesService());

    expect(() => workOrders.create('tenant-demo', {
      orderNo: 'WO-OVER-INITIAL', productCode: 'P', productName: '产品', lineId: 'line-cnc', plannedQty: 1,
      completedQty: 2, dueAt: '2026-08-29T18:00:00.000Z',
    })).toThrow(ConflictException);

    const workOrder = workOrders.create('tenant-demo', {
      orderNo: 'WO-VALIDATION', productCode: 'P', productName: '产品', lineId: 'line-cnc', plannedQty: 2,
      dueAt: '2026-08-29T18:00:00.000Z',
    });
    workOrders.updateStatus('tenant-demo', workOrder.id, { status: 'released' });
    workOrders.updateStatus('tenant-demo', workOrder.id, { status: 'in_progress' });

    expect(() => workOrders.report('tenant-demo', workOrder.id, { quantity: 1, goodQty: 2 })).toThrow(ConflictException);
    expect(() => workOrders.updateStatus('tenant-demo', workOrder.id, { status: 'paused' })).toThrow(ConflictException);
    expect(() => workOrders.updateStatus('tenant-demo', workOrder.id, { status: 'cancelled' })).toThrow(ConflictException);
    expect(() => workOrders.updateStatus('tenant-demo', workOrder.id, { status: 'completed' })).toThrow(ConflictException);
    expect(() => workOrders.updateStatus('tenant-demo', workOrder.id, { status: 'paused' })).toThrow(ConflictException);

    const paused = workOrders.updateStatus('tenant-demo', workOrder.id, { status: 'paused', reason: '设备换刀' });
    expect(paused.statusReason).toBe('设备换刀');
  });

  it('rejects duplicate report traces and devices from another line', () => {
    const workOrders = new WorkOrdersService(new OrdersService(), new ProductionLinesService());
    const workOrder = workOrders.create('tenant-demo', {
      orderNo: 'WO-TRACE-VALIDATION', productCode: 'P', productName: '产品', lineId: 'line-cnc', plannedQty: 2,
      dueAt: '2026-08-29T18:00:00.000Z',
    });
    workOrders.updateStatus('tenant-demo', workOrder.id, { status: 'released' });
    workOrders.updateStatus('tenant-demo', workOrder.id, { status: 'in_progress' });
    workOrders.report('tenant-demo', workOrder.id, { quantity: 1, sourceTraceId: 'trace-duplicate' });
    expect(() => workOrders.report('tenant-demo', workOrder.id, { quantity: 1, sourceTraceId: 'trace-duplicate' }))
      .toThrow(ConflictException);

    const isolatedWorkOrders = new WorkOrdersService(new OrdersService(), new ProductionLinesService(), new DevicesService());
    const isolated = isolatedWorkOrders.create('tenant-demo', {
      orderNo: 'WO-DEVICE-LINE', productCode: 'P', productName: '产品', lineId: 'line-cnc', plannedQty: 1,
      dueAt: '2026-08-29T18:00:00.000Z',
    });
    isolatedWorkOrders.updateStatus('tenant-demo', isolated.id, { status: 'released' });
    isolatedWorkOrders.updateStatus('tenant-demo', isolated.id, { status: 'in_progress' });
    expect(() => isolatedWorkOrders.report('tenant-demo', isolated.id, { quantity: 1, deviceId: 'device-assembly-01' }))
      .toThrow(ConflictException);
  });

  it('keeps batch and serial traceability on reports', () => {
    const workOrders = new WorkOrdersService(new OrdersService(), new ProductionLinesService(), new DevicesService());
    const workOrder = workOrders.create('tenant-demo', {
      orderNo: 'WO-BATCH-TRACE', productCode: 'P', productName: '产品', lineId: 'line-cnc', plannedQty: 2,
      dueAt: '2026-08-29T18:00:00.000Z',
    });
    workOrders.updateStatus('tenant-demo', workOrder.id, { status: 'released' });
    workOrders.updateStatus('tenant-demo', workOrder.id, { status: 'in_progress' });
    const result = workOrders.report('tenant-demo', workOrder.id, { quantity: 2, batchNo: 'B-001', serialNumbers: ['S-001', 'S-002'], operationCode: 'OP-10', deviceId: 'device-cnc-01', qualityRecordId: 'quality-001', materialConsumptions: [{ materialCode: 'RAW-01', batchNo: 'RAW-B-001', quantity: 2, unit: '件' }] });
    expect(result.report).toEqual(expect.objectContaining({ batchNo: 'B-001', serialNumbers: ['S-001', 'S-002'] }));
    expect(workOrders.executionSummary('tenant-demo', workOrder.id)).toEqual(expect.objectContaining({ operations: ['OP-10'], devices: ['device-cnc-01'], qualityRecordIds: ['quality-001'], finishedBatches: ['B-001'], materialConsumptions: [{ materialCode: 'RAW-01', batchNo: 'RAW-B-001', quantity: 2 }] }));
    expect(() => workOrders.update('tenant-demo', workOrder.id, { productName: '不应修改' })).toThrow(ConflictException);
  });

  it('binds a work order to existing BOM and routing records', () => {
    const masterData = new MasterDataService();
    const operation = masterData.create('tenant-demo', 'operation', { code: 'OP-BIND', name: '装配' });
    const bom = masterData.create('tenant-demo', 'bom', { code: 'BOM-BIND', name: '绑定 BOM', productCode: 'P', version: '1.0', items: [{ code: 'RAW', qty: 1 }], operationCodes: [operation.code] });
    const routing = masterData.create('tenant-demo', 'routing', { code: 'ROUTE-BIND', name: '绑定路线', productCode: 'P', version: '1.0', operationCodes: [operation.code] });
    const workOrders = new WorkOrdersService(new OrdersService(), new ProductionLinesService(), new DevicesService(), masterData);
    const workOrder = workOrders.create('tenant-demo', { orderNo: 'WO-BOM-ROUTE', productCode: 'P', productName: '产品', lineId: 'line-cnc', plannedQty: 1, dueAt: '2026-08-31T18:00:00.000Z', bomId: bom.id, routingId: routing.id });
    expect(workOrder).toEqual(expect.objectContaining({ bomId: bom.id, routingId: routing.id }));
  });
});
