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
});
