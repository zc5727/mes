import { CorePersistenceService } from '../src/database/core-persistence.service';
import { PrismaService } from '../src/database/prisma.service';

describe('core PostgreSQL persistence repository', () => {
  it('keeps the explicit memory fallback when PostgreSQL is disabled', async () => {
    const prisma = {
      ensureConnection: jest.fn().mockResolvedValue(undefined),
      isReady: () => false,
      factory: { findMany: jest.fn() },
    } as unknown as PrismaService;

    await expect(new CorePersistenceService(prisma).restore()).resolves.toEqual({
      factories: [], lines: [], devices: [], orders: [], workOrders: [], reports: [],
    });
    expect(prisma.factory.findMany).not.toHaveBeenCalled();
  });

  it('upserts core entities instead of silently accepting a failed database write', async () => {
    const factory = { upsert: jest.fn().mockResolvedValue(undefined) };
    const prisma = {
      ensureConnection: jest.fn().mockResolvedValue(undefined),
      isReady: () => true,
      factory,
    } as unknown as PrismaService;
    const item = {
      id: 'factory-1', tenantId: 'tenant-demo', code: 'F001', name: '一厂',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    };

    await new CorePersistenceService(prisma).saveFactory(item);

    expect(factory.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'factory-1' },
      create: expect.objectContaining({ tenantId: 'tenant-demo', code: 'F001' }),
    }));
  });

  it('persists line state and external production identifiers', async () => {
    const productionLine = { upsert: jest.fn().mockResolvedValue(undefined) };
    const productionOrder = { upsert: jest.fn().mockResolvedValue(undefined) };
    const workOrder = { upsert: jest.fn().mockResolvedValue(undefined) };
    const prisma = {
      ensureConnection: jest.fn().mockResolvedValue(undefined),
      isReady: () => true,
      productionLine,
      productionOrder,
      workOrder,
    } as unknown as PrismaService;
    const service = new CorePersistenceService(prisma);

    await service.saveLine({
      id: 'line-1', tenantId: 'tenant-demo', factoryId: 'factory-1', code: 'L001', name: '焊接线', type: '焊接',
      active: false, status: 'maintenance', statusReason: '计划保养', targetOee: 85,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await service.saveOrder({
      id: 'order-1', tenantId: 'tenant-demo', orderNo: 'PO-1', productCode: 'P-1', productName: '产品',
      plannedQty: 1, completedQty: 0, dueAt: '2026-09-01T00:00:00.000Z', priority: 'normal', status: 'planned',
      externalId: 'ERP-PO-1', externalSystem: 'ERPNext', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await service.saveWorkOrder({
      id: 'wo-1', tenantId: 'tenant-demo', orderId: null, orderNo: 'WO-1', productCode: 'P-1', productName: '产品',
      lineId: 'line-1', plannedQty: 1, completedQty: 0, dueAt: '2026-09-01T00:00:00.000Z', priority: 'normal',
      status: 'draft', statusReason: '', externalId: 'ERP-WO-1', externalSystem: 'ERPNext', bomId: 'bom-1', routingId: 'routing-1',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(productionLine.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ status: 'maintenance', statusReason: '计划保养' }),
    }));
    expect(productionOrder.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ externalId: 'ERP-PO-1', externalSystem: 'ERPNext' }),
    }));
    expect(workOrder.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ externalId: 'ERP-WO-1', bomId: 'bom-1', routingId: 'routing-1' }),
    }));
  });

  it('persists report traceability fields for restore and audit correlation', async () => {
    const report = { upsert: jest.fn().mockResolvedValue(undefined) };
    const prisma = {
      ensureConnection: jest.fn().mockResolvedValue(undefined),
      isReady: () => true,
      workOrderReport: report,
    } as unknown as PrismaService;

    await new CorePersistenceService(prisma).saveReport({
      id: 'report-1', tenantId: 'tenant-demo', workOrderId: 'wo-1', deviceId: 'device-1',
      quantity: 2, goodQty: 2, defectQty: 0, sourceTraceId: 'trace-1', batchNo: 'B-1',
      serialNumbers: ['S-1', 'S-2'], operationCode: 'OP-10', operatorId: 'operator-1',
      qualityRecordId: 'quality-1', materialConsumptions: [{ materialCode: 'RAW-1', batchNo: 'RB-1', quantity: 2 }],
      reportedAt: '2026-08-31T00:00:00.000Z',
    });

    expect(report.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        batchNo: 'B-1', serialNumbers: ['S-1', 'S-2'], operationCode: 'OP-10',
        qualityRecordId: 'quality-1', materialConsumptions: [{ materialCode: 'RAW-1', batchNo: 'RB-1', quantity: 2 }],
      }),
    }));
  });

  it('persists work-order progress and report in one transaction', async () => {
    const workOrder = { upsert: jest.fn().mockResolvedValue(undefined) };
    const workOrderReport = { upsert: jest.fn().mockResolvedValue(undefined) };
    const transaction = jest.fn(async (callback: (client: unknown) => Promise<void>) => callback({ workOrder, workOrderReport }));
    const prisma = {
      ensureConnection: jest.fn().mockResolvedValue(undefined), isReady: () => true,
      workOrder, workOrderReport, $transaction: transaction,
    } as unknown as PrismaService;
    const service = new CorePersistenceService(prisma);

    await service.saveReportAndWorkOrder(
      { id: 'report-1', tenantId: 'tenant-demo', workOrderId: 'wo-1', deviceId: 'device-1', quantity: 1, goodQty: 1, defectQty: 0, sourceTraceId: 'trace-1', reportedAt: '2026-08-31T00:00:00.000Z' },
      { id: 'wo-1', tenantId: 'tenant-demo', orderId: null, orderNo: 'WO-1', productCode: 'P-1', productName: '产品', lineId: 'line-1', plannedQty: 1, completedQty: 1, dueAt: '2026-09-01T00:00:00.000Z', priority: 'normal', status: 'completed', statusReason: '', createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:00:00.000Z' },
    );

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(workOrder.upsert).toHaveBeenCalledTimes(1);
    expect(workOrderReport.upsert).toHaveBeenCalledTimes(1);
  });

  it('increments persisted work-order progress conditionally under concurrency', async () => {
    const create = jest.fn().mockResolvedValue(undefined);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findUnique = jest.fn().mockResolvedValue({ completedQty: 2 });
    const update = jest.fn().mockResolvedValue(undefined);
    const transaction = jest.fn(async (callback: (client: unknown) => Promise<void>) => callback({
      workOrder: { create: jest.fn(), updateMany, findUnique, update },
      workOrderReport: { create },
    }));
    const prisma = {
      ensureConnection: jest.fn().mockResolvedValue(undefined), isReady: () => true,
      workOrder: { updateMany, findUnique, update }, workOrderReport: { create }, $transaction: transaction,
    } as unknown as PrismaService;

    await new CorePersistenceService(prisma).saveReportAndWorkOrder(
      { id: 'report-2', tenantId: 'tenant-demo', workOrderId: 'wo-2', deviceId: 'device-1', quantity: 2, goodQty: 2, defectQty: 0, sourceTraceId: 'trace-2', reportedAt: '2026-08-31T00:00:00.000Z' },
      { id: 'wo-2', tenantId: 'tenant-demo', orderId: null, orderNo: 'WO-2', productCode: 'P-2', productName: '产品', lineId: 'line-1', plannedQty: 2, completedQty: 2, dueAt: '2026-09-01T00:00:00.000Z', priority: 'normal', status: 'completed', statusReason: '', createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:00:00.000Z' },
    );

    expect(create).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ completedQty: { lte: 0 }, status: 'in_progress' }),
      data: expect.objectContaining({ completedQty: { increment: 2 } }),
    }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'completed' }) }));
  });

  it('commits quality, batch, report, work-order and order progress in one transaction', async () => {
    const workOrderFindUnique = jest.fn().mockResolvedValue({ tenantId: 'tenant-demo', status: 'in_progress', plannedQty: 2, completedQty: 0, orderId: 'order-1' });
    const qualityFindUnique = jest.fn().mockResolvedValue({ tenantId: 'tenant-demo', workOrderId: 'wo-atomic', status: 'confirmed' });
    const batchUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const reportCreate = jest.fn().mockResolvedValue(undefined);
    const workOrderUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const orderFindUnique = jest.fn().mockResolvedValue({ tenantId: 'tenant-demo', plannedQty: 2, completedQty: 0 });
    const orderUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const transaction = jest.fn(async (callback: (client: unknown) => Promise<void>) => callback({
      workOrder: { findUnique: workOrderFindUnique, updateMany: workOrderUpdateMany },
      qualityRecord: { findUnique: qualityFindUnique },
      batchInventory: { updateMany: batchUpdateMany },
      workOrderReport: { create: reportCreate },
      productionOrder: { findUnique: orderFindUnique, updateMany: orderUpdateMany },
    }));
    const prisma = {
      ensureConnection: jest.fn().mockResolvedValue(undefined), isReady: () => true, $transaction: transaction,
    } as unknown as PrismaService;
    const service = new CorePersistenceService(prisma);

    await service.saveCompleteReport(
      { id: 'report-atomic', tenantId: 'tenant-demo', workOrderId: 'wo-atomic', deviceId: null, quantity: 2, goodQty: 2, defectQty: 0, sourceTraceId: 'trace-atomic', qualityRecordId: 'quality-atomic', reportedAt: '2026-08-31T00:00:00.000Z' },
      { id: 'wo-atomic', tenantId: 'tenant-demo', orderId: 'order-1', orderNo: 'WO-ATOMIC', productCode: 'P-1', productName: '产品', lineId: 'line-1', plannedQty: 2, completedQty: 2, dueAt: '2026-09-01T00:00:00.000Z', priority: 'normal', status: 'completed', statusReason: '', createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:00:00.000Z' },
      [{ materialCode: 'RAW-1', batchNo: 'B-1', quantity: 2 }],
      'quality-atomic',
    );

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(qualityFindUnique).toHaveBeenCalledWith({ where: { id: 'quality-atomic' }, select: expect.any(Object) });
    expect(batchUpdateMany).toHaveBeenCalledTimes(1);
    expect(reportCreate).toHaveBeenCalledTimes(1);
    expect(workOrderUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ completedQty: 0, status: 'in_progress' }) }));
    expect(orderUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ completedQty: 0 }) }));
  });

  it('rejects an insufficient material batch before creating a report or advancing production', async () => {
    const workOrderFindUnique = jest.fn().mockResolvedValue({
      tenantId: 'tenant-demo', status: 'in_progress', plannedQty: 1, completedQty: 0, orderId: null,
    });
    const qualityFindUnique = jest.fn().mockResolvedValue({
      tenantId: 'tenant-demo', workOrderId: 'wo-shortage', status: 'confirmed',
    });
    const batchUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
    const reportCreate = jest.fn();
    const workOrderUpdateMany = jest.fn();
    const transaction = jest.fn(async (callback: (client: unknown) => Promise<void>) => callback({
      workOrder: { findUnique: workOrderFindUnique, updateMany: workOrderUpdateMany },
      qualityRecord: { findUnique: qualityFindUnique },
      batchInventory: { updateMany: batchUpdateMany },
      workOrderReport: { create: reportCreate },
      productionOrder: { findUnique: jest.fn(), updateMany: jest.fn() },
    }));
    const prisma = {
      ensureConnection: jest.fn().mockResolvedValue(undefined), isReady: () => true, $transaction: transaction,
    } as unknown as PrismaService;
    const service = new CorePersistenceService(prisma);

    await expect(service.saveCompleteReport(
      { id: 'report-shortage', tenantId: 'tenant-demo', workOrderId: 'wo-shortage', deviceId: null, quantity: 1, goodQty: 1, defectQty: 0, sourceTraceId: 'trace-shortage', qualityRecordId: 'quality-shortage', reportedAt: '2026-08-31T00:00:00.000Z' },
      { id: 'wo-shortage', tenantId: 'tenant-demo', orderId: null, orderNo: 'WO-SHORTAGE', productCode: 'P-1', productName: '产品', lineId: 'line-1', plannedQty: 1, completedQty: 1, dueAt: '2026-09-01T00:00:00.000Z', priority: 'normal', status: 'completed', statusReason: '', createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:00:00.000Z' },
      [{ materialCode: 'RAW-1', batchNo: 'B-SHORT', quantity: 1 }],
      'quality-shortage',
    )).rejects.toThrow('Insufficient material batch B-SHORT');

    expect(batchUpdateMany).toHaveBeenCalledTimes(1);
    expect(reportCreate).not.toHaveBeenCalled();
    expect(workOrderUpdateMany).not.toHaveBeenCalled();
  });
});
