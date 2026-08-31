import { FoundationPersistenceService } from '../src/database/foundation-persistence.service';
import { PrismaService } from '../src/database/prisma.service';

describe('quality, maintenance and document persistence', () => {
  it('restores persisted foundation records with API-compatible ISO timestamps', async () => {
    const prisma = {
      ensureConnection: jest.fn().mockResolvedValue(undefined), isReady: () => true,
      qualityRecord: { findMany: jest.fn().mockResolvedValue([{ id: 'q-1', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-02') }]) },
      maintenanceWorkOrder: { findMany: jest.fn().mockResolvedValue([{ id: 'm-1', plannedAt: new Date('2026-01-01'), completedAt: null, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-02') }]) },
      documentRecord: { findMany: jest.fn().mockResolvedValue([{ id: 'd-1', uploadedAt: new Date('2026-01-01'), createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-02'), analysisConfirmedAt: null }]) },
    } as unknown as PrismaService;

    await expect(new FoundationPersistenceService(prisma).restore()).resolves.toEqual({
      quality: [expect.objectContaining({ id: 'q-1', createdAt: '2026-01-01T00:00:00.000Z' })],
      maintenance: [expect.objectContaining({ id: 'm-1', plannedAt: '2026-01-01T00:00:00.000Z' })],
      documents: [expect.objectContaining({ id: 'd-1', uploadedAt: '2026-01-01T00:00:00.000Z' })],
    });
  });

  it('does not query PostgreSQL when persistence is disabled', async () => {
    const prisma = {
      ensureConnection: jest.fn().mockResolvedValue(undefined), isReady: () => false,
      qualityRecord: { findMany: jest.fn() }, maintenanceWorkOrder: { findMany: jest.fn() }, documentRecord: { findMany: jest.fn() },
    } as unknown as PrismaService;
    await expect(new FoundationPersistenceService(prisma).restore()).resolves.toEqual({ quality: [], maintenance: [], documents: [] });
    expect(prisma.qualityRecord.findMany).not.toHaveBeenCalled();
  });

  it('persists auxiliary domain records through an idempotent upsert', async () => {
    const upsert = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      ensureConnection: jest.fn().mockResolvedValue(undefined), isReady: () => true,
      foundationAuxRecord: { upsert },
    } as unknown as PrismaService;

    await new FoundationPersistenceService(prisma).saveAux({
      id: 'rule-1', tenantId: 'tenant-1', domain: 'quality-rule', payload: { key: 'dimensional' },
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
    });

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'rule-1' },
      create: expect.objectContaining({ tenantId: 'tenant-1', domain: 'quality-rule', payload: { key: 'dimensional' } }),
      update: expect.objectContaining({ tenantId: 'tenant-1', domain: 'quality-rule', payload: { key: 'dimensional' } }),
    }));
  });
});
