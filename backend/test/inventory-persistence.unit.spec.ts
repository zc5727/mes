import { InventoryPersistenceService } from '../src/database/inventory-persistence.service';
import { MasterDataService } from '../src/master-data/master-data.service';
import { PrismaService } from '../src/database/prisma.service';

describe('batch inventory PostgreSQL persistence', () => {
  it('restores batches into the tenant-scoped in-memory projection', async () => {
    const persistence = {
      restore: jest.fn().mockResolvedValue([{ id: 'batch-1', tenantId: 'tenant-demo', materialCode: 'RAW-1', batchNo: 'B-1', quantity: 4, unit: 'kg', updatedAt: '2026-08-31T00:00:00.000Z' }]),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const service = new MasterDataService(persistence as never);
    await service.onModuleInit();
    expect(service.listBatches('tenant-demo')).toEqual([expect.objectContaining({ id: 'batch-1', quantity: 4 })]);
    expect(service.listBatches('tenant-other')).toEqual([]);
  });

  it('upserts decimal quantities for restart-safe inventory writes', async () => {
    const upsert = jest.fn().mockResolvedValue(undefined);
    const prisma = { required: false, ensureConnection: jest.fn().mockResolvedValue(undefined), isReady: () => true, batchInventory: { upsert } } as unknown as PrismaService;
    await new InventoryPersistenceService(prisma).save({ id: 'batch-1', tenantId: 'tenant-demo', materialCode: 'RAW-1', batchNo: 'B-1', quantity: 2.5, unit: 'kg', updatedAt: '2026-08-31T00:00:00.000Z' });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'batch-1' }, create: expect.objectContaining({ quantity: expect.anything() }) }));
  });

  it('uses one Prisma transaction for multi-batch consumption persistence', async () => {
    const upsert = jest.fn()
      .mockReturnValueOnce(Promise.resolve('first'))
      .mockReturnValueOnce(Promise.resolve('second'));
    const transaction = jest.fn().mockResolvedValue(['first', 'second']);
    const prisma = { required: false, ensureConnection: jest.fn().mockResolvedValue(undefined), isReady: () => true, batchInventory: { upsert }, $transaction: transaction } as unknown as PrismaService;
    const service = new InventoryPersistenceService(prisma);
    await service.saveMany([
      { id: 'batch-1', tenantId: 'tenant-demo', materialCode: 'RAW-1', batchNo: 'B-1', quantity: 1, unit: 'kg', updatedAt: '2026-08-31T00:00:00.000Z' },
      { id: 'batch-2', tenantId: 'tenant-demo', materialCode: 'RAW-2', batchNo: 'B-2', quantity: 2, unit: 'kg', updatedAt: '2026-08-31T00:00:00.000Z' },
    ]);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(2);
  });
});
