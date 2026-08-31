import { CorePersistenceService } from '../src/database/core-persistence.service';
import { FoundationPersistenceService } from '../src/database/foundation-persistence.service';
import { PrismaService } from '../src/database/prisma.service';

describe('required PostgreSQL mode', () => {
  it('fails restore instead of silently returning an empty foundation snapshot', async () => {
    const prisma = {
      required: true,
      ensureConnection: jest.fn().mockResolvedValue(undefined),
      isReady: () => false,
    } as unknown as PrismaService;

    await expect(new FoundationPersistenceService(prisma).restore()).rejects.toThrow(
      'PostgreSQL is required; restore foundation entities cannot continue',
    );
  });

  it('fails a core write when the database operation is unavailable', async () => {
    const prisma = {
      required: true,
      ensureConnection: jest.fn().mockResolvedValue(undefined),
      isReady: () => true,
      factory: { upsert: jest.fn().mockRejectedValue(new Error('connection reset')) },
    } as unknown as PrismaService;

    await expect(new CorePersistenceService(prisma).saveFactory({
      id: 'factory-1',
      tenantId: 'tenant-demo',
      code: 'F001',
      name: '一厂',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })).rejects.toThrow('PostgreSQL is required; persist factory cannot continue: connection reset');
  });
});
