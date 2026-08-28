import { ConflictException } from '@nestjs/common';
import { OrdersService } from '../src/orders/orders.service';
import { ProductionLinesService } from '../src/production-lines/production-lines.service';
import { WorkOrdersService } from '../src/work-orders/work-orders.service';

describe('production execution flow', () => {
  it('creates an order, runs a work order, reports production and completes it', () => {
    const orders = new OrdersService();
    const workOrders = new WorkOrdersService(orders, new ProductionLinesService());
    const order = orders.create('tenant-demo', {
      orderNo: 'PO-TEST-001', productCode: 'PART-TEST', productName: '测试产品',
      plannedQty: 5, dueAt: '2026-08-29T18:00:00.000Z', priority: 'normal',
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
});
