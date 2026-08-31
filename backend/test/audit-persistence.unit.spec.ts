import { AuditPersistenceService } from '../src/audit/audit-persistence.service';
import { AuditService } from '../src/audit/audit.service';
import type { PrismaService } from '../src/database/prisma.service';

const createdAt = '2026-08-31T08:00:00.000Z';

function auditEntry() {
  const service = new AuditService();
  return service.record('tenant-demo', 'user-1', {
    action: 'strategy.simulate',
    resource: 'strategy-simulation',
    resourceId: 'simulation-1',
    details: { candidateCount: 1 },
    operator: 'user-1',
    object: 'strategy-simulation:simulation-1',
    before: {},
    after: { requiresApproval: true },
    reason: 'read-only simulation',
    traceId: 'trace-1',
  });
}

function prismaMock(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    required: false,
    ensureConnection: jest.fn().mockResolvedValue(undefined),
    isReady: jest.fn().mockReturnValue(true),
    auditEvent: {
      upsert: jest.fn().mockResolvedValue(undefined),
      findMany: jest.fn().mockResolvedValue([]),
    },
    auditApproval: {
      upsert: jest.fn().mockResolvedValue(undefined),
      findMany: jest.fn().mockResolvedValue([]),
    },
    ...overrides,
  } as unknown as PrismaService;
}

describe('AuditPersistenceService', () => {
  it('flushes audit events and approvals to tenant-scoped tables', async () => {
    const prisma = prismaMock();
    const persistence = new AuditPersistenceService(prisma);
    const entry = auditEntry();
    const approval = {
      id: 'approval-1',
      tenantId: 'tenant-demo',
      resource: 'strategy-candidate',
      resourceId: 'simulation-1:candidate-1',
      status: 'pending' as const,
      comment: 'approval required',
      createdAt,
      createdBy: 'user-1',
    };

    persistence.enqueueAudit(entry);
    persistence.enqueueApproval(approval);
    await persistence.flush();

    expect(prisma.auditEvent.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: entry.id },
      create: expect.objectContaining({
        tenant: { connect: { id: 'tenant-demo' } },
        traceId: 'trace-1',
      }),
    }));
    expect(prisma.auditApproval.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'approval-1' },
      create: expect.objectContaining({
        tenant: { connect: { id: 'tenant-demo' } },
        status: 'pending',
      }),
    }));
  });

  it('restores persisted entries without crossing tenant boundaries', async () => {
    const prisma = prismaMock();
    (prisma.auditEvent.findMany as jest.Mock).mockResolvedValue([{
      id: 'audit-1', tenantId: 'tenant-demo', actor: 'user-1',
      action: 'strategy.simulate', resource: 'strategy-simulation',
      resourceId: 'simulation-1', details: { candidateCount: 1 },
      operator: 'user-1', object: 'strategy-simulation:simulation-1',
      before: {}, after: { requiresApproval: true }, reason: 'simulation',
      traceId: 'trace-1', result: 'success', prevHash: null, hash: 'hash-1',
      createdAt: new Date(createdAt),
    }]);
    (prisma.auditApproval.findMany as jest.Mock).mockResolvedValue([{
      id: 'approval-1', tenantId: 'tenant-demo', resource: 'strategy-candidate',
      resourceId: 'simulation-1:candidate-1', status: 'pending',
      comment: 'approval required', createdAt: new Date(createdAt),
      createdBy: 'user-1', decidedAt: null,
    }]);

    const snapshot = await new AuditPersistenceService(prisma).restore();

    expect(snapshot.audit).toHaveLength(1);
    expect(snapshot.audit[0].tenantId).toBe('tenant-demo');
    expect(snapshot.approvals).toEqual([expect.objectContaining({
      tenantId: 'tenant-demo', status: 'pending',
    })]);
    expect(prisma.auditEvent.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: 'asc' },
    });
  });

  it('fails closed when required persistence is unavailable', async () => {
    const prisma = prismaMock({
      required: true,
      isReady: jest.fn().mockReturnValue(false),
    });
    const persistence = new AuditPersistenceService(prisma);
    persistence.enqueueAudit(auditEntry());

    await expect(persistence.flush()).rejects.toThrow(
      'AUDIT_PERSISTENCE_REQUIRED',
    );
  });

  it('fails startup restoration when required persistence is unavailable', async () => {
    const prisma = prismaMock({
      required: true,
      isReady: jest.fn().mockReturnValue(false),
    });

    await expect(new AuditPersistenceService(prisma).restore()).rejects.toThrow(
      'AUDIT_PERSISTENCE_REQUIRED',
    );
  });
});

describe('AuditService persistence boundary', () => {
  it('queues every audit event when a persistence adapter is present', () => {
    const persistence = {
      enqueueAudit: jest.fn(),
      enqueueApproval: jest.fn(),
    };
    const service = new AuditService(persistence as never);

    const entry = service.record('tenant-demo', 'user-1', {
      action: 'device.control',
      resource: 'device',
    });

    expect(persistence.enqueueAudit).toHaveBeenCalledWith(entry);
  });

  it('restores audit and approval state after a process restart', async () => {
    const entry = auditEntry();
    const approval = {
      id: 'approval-restart',
      tenantId: 'tenant-demo',
      resource: 'strategy-candidate',
      resourceId: 'simulation-1:candidate-1',
      status: 'approved' as const,
      comment: 'approved',
      createdAt,
      createdBy: 'approver-1',
      decidedAt: createdAt,
    };
    const persistence = {
      restore: jest.fn().mockResolvedValue({
        audit: [entry],
        approvals: [approval],
      }),
    };
    const service = new AuditService(persistence as never);

    await service.onModuleInit();

    expect(service.list('tenant-demo')).toEqual([entry]);
    expect(service.listApprovals('tenant-demo')).toEqual([approval]);
    expect(service.list('tenant-other')).toEqual([]);
  });
});
