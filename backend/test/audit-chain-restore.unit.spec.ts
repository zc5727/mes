import { AuditPersistenceService } from '../src/audit/audit-persistence.service';
import { AuditService } from '../src/audit/audit.service';
import type { PrismaService } from '../src/database/prisma.service';

describe('audit chain restoration', () => {
  it('reconstructs the hash chain when database timestamps are tied or returned out of order', async () => {
    const source = new AuditService();
    const first = source.record('tenant-demo', 'user-1', { action: 'first', resource: 'test', traceId: 'trace-1' });
    const second = source.record('tenant-demo', 'user-1', { action: 'second', resource: 'test', traceId: 'trace-2' });
    const third = source.record('tenant-demo', 'user-1', { action: 'third', resource: 'test', traceId: 'trace-3' });
    const rows = [third, first, second].map((entry) => ({
      ...entry,
      resourceId: entry.resourceId ?? null,
      details: entry.details,
      before: entry.before,
      after: entry.after,
      prevHash: entry.prevHash ?? null,
      hash: entry.hash ?? null,
      createdAt: new Date(entry.createdAt),
    }));
    const prisma = {
      enabled: true,
      required: true,
      ensureConnection: jest.fn().mockResolvedValue(undefined),
      isReady: jest.fn().mockReturnValue(true),
      auditEvent: { findMany: jest.fn().mockResolvedValue(rows) },
      auditApproval: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;

    const restored = await new AuditPersistenceService(prisma).restore();

    expect(restored.audit.map((entry) => entry.id)).toEqual([first.id, second.id, third.id]);
    const service = new AuditService();
    restored.audit.forEach((entry) => service.restore(entry));
    expect(service.verify('tenant-demo')).toEqual({ valid: true, checked: 3 });
  });
});
