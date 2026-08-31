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
});
