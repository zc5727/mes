import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type {
  Approval,
  GovernedAuditEntry,
} from './audit.service';

export interface PersistedAuditSnapshot {
  audit: GovernedAuditEntry[];
  approvals: Approval[];
}

/**
 * Persists audit events and approvals without changing the synchronous
 * in-memory API used by the domain services.
 *
 * API requests flush this queue before returning. Required database mode
 * therefore fails closed instead of reporting a successful unpersisted write.
 */
@Injectable()
export class AuditPersistenceService {
  private readonly logger = new Logger(AuditPersistenceService.name);
  private writeChain: Promise<void> = Promise.resolve();
  private pendingError?: Error;

  constructor(private readonly prisma: PrismaService) {}

  enqueueAudit(entry: GovernedAuditEntry): void {
    this.enqueue(() => this.persistAudit(entry));
  }

  enqueueApproval(approval: Approval): void {
    this.enqueue(() => this.persistApproval(approval));
  }

  /** Wait for queued writes and fail when required persistence is unavailable. */
  async flush(): Promise<void> {
    const chain = this.writeChain;
    await chain;
    if (chain !== this.writeChain) {
      await this.flush();
      return;
    }

    const error = this.pendingError;
    this.pendingError = undefined;
    if (!error) return;
    if (this.isRequired()) {
      throw new Error(`AUDIT_PERSISTENCE_REQUIRED: ${error.message}`);
    }
    this.logger.error(`audit persistence failed; memory projection remains active: ${error.message}`);
  }

  /** Restore persisted events and approvals during application startup. */
  async restore(): Promise<PersistedAuditSnapshot> {
    await this.prisma.ensureConnection();
    if (!this.prisma.isReady()) {
      if (this.isRequired()) {
        throw new Error('AUDIT_PERSISTENCE_REQUIRED: PostgreSQL is unavailable');
      }
      return { audit: [], approvals: [] };
    }

    try {
      const [auditRows, approvalRows] = await Promise.all([
        this.prisma.auditEvent.findMany({ orderBy: { createdAt: 'asc' } }),
        this.prisma.auditApproval.findMany({ orderBy: { createdAt: 'asc' } }),
      ]);
      return {
        audit: orderAuditChain(auditRows.map((row) => this.toAuditEntry(row))),
        approvals: approvalRows.map((row) => this.toApproval(row)),
      };
    } catch (error: unknown) {
      const normalized = toError(error);
      if (this.isRequired()) {
        throw new Error(`AUDIT_PERSISTENCE_REQUIRED: ${normalized.message}`);
      }
      this.logger.error(`restore audit persistence failed: ${normalized.message}`);
      return { audit: [], approvals: [] };
    }
  }

  private enqueue(operation: () => Promise<void>): void {
    this.writeChain = this.writeChain.then(operation).catch((error: unknown) => {
      this.pendingError ??= toError(error);
    });
  }

  private async persistAudit(entry: GovernedAuditEntry): Promise<void> {
    await this.prisma.ensureConnection();
    if (!this.prisma.enabled) return;
    if (!this.prisma.isReady()) {
      throw new Error('PostgreSQL is unavailable');
    }
    await this.prisma.auditEvent.upsert({
      where: { id: entry.id },
      create: this.auditData(entry),
      // Audit events are append-only; retries must not rewrite history.
      update: {},
    });
  }

  private async persistApproval(approval: Approval): Promise<void> {
    await this.prisma.ensureConnection();
    if (!this.prisma.enabled) return;
    if (!this.prisma.isReady()) {
      throw new Error('PostgreSQL is unavailable');
    }
    await this.prisma.auditApproval.upsert({
      where: { id: approval.id },
      create: this.approvalData(approval),
      update: this.approvalData(approval),
    });
  }

  private auditData(entry: GovernedAuditEntry): Prisma.AuditEventCreateInput {
    return {
      id: entry.id,
      tenant: { connect: { id: entry.tenantId } },
      actor: entry.actor,
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId,
      details: entry.details as Prisma.InputJsonValue,
      operator: entry.operator,
      object: entry.object,
      before: entry.before as Prisma.InputJsonValue,
      after: entry.after as Prisma.InputJsonValue,
      reason: entry.reason,
      traceId: entry.traceId,
      result: entry.result,
      prevHash: entry.prevHash,
      hash: entry.hash,
      createdAt: new Date(entry.createdAt),
    };
  }

  private approvalData(approval: Approval): Prisma.AuditApprovalCreateInput {
    return {
      id: approval.id,
      tenant: { connect: { id: approval.tenantId } },
      resource: approval.resource,
      resourceId: approval.resourceId,
      status: approval.status,
      comment: approval.comment,
      createdAt: new Date(approval.createdAt),
      createdBy: approval.createdBy,
      decidedAt: approval.decidedAt ? new Date(approval.decidedAt) : null,
    };
  }

  private toAuditEntry(row: {
    id: string;
    tenantId: string;
    actor: string;
    action: string;
    resource: string;
    resourceId: string | null;
    details: Prisma.JsonValue;
    operator: string;
    object: string;
    before: Prisma.JsonValue | null;
    after: Prisma.JsonValue | null;
    reason: string;
    traceId: string;
    result: string;
    prevHash: string | null;
    hash: string | null;
    createdAt: Date;
  }): GovernedAuditEntry {
    return {
      id: row.id,
      tenantId: row.tenantId,
      actor: row.actor,
      action: row.action,
      resource: row.resource,
      resourceId: row.resourceId ?? undefined,
      details: recordValue(row.details),
      operator: row.operator,
      object: row.object,
      before: nullableRecord(row.before),
      after: nullableRecord(row.after),
      reason: row.reason,
      traceId: row.traceId,
      result: auditResult(row.result),
      createdAt: row.createdAt.toISOString(),
      prevHash: row.prevHash ?? undefined,
      hash: row.hash ?? undefined,
    };
  }

  private toApproval(row: {
    id: string;
    tenantId: string;
    resource: string;
    resourceId: string;
    status: string;
    comment: string;
    createdAt: Date;
    createdBy: string | null;
    decidedAt: Date | null;
  }): Approval {
    return {
      id: row.id,
      tenantId: row.tenantId,
      resource: row.resource,
      resourceId: row.resourceId,
      status: approvalStatus(row.status),
      comment: row.comment,
      createdAt: row.createdAt.toISOString(),
      createdBy: row.createdBy ?? undefined,
      decidedAt: row.decidedAt?.toISOString(),
    };
  }

  private isRequired(): boolean {
    return this.prisma.required || process.env.MES_AUDIT_PERSISTENCE_REQUIRED === 'true';
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function recordValue(value: Prisma.JsonValue): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('persisted audit details must be an object');
  }
  return value as Record<string, unknown>;
}

function nullableRecord(
  value: Prisma.JsonValue | null,
): Record<string, unknown> | null {
  if (value === null) return null;
  return recordValue(value);
}

function auditResult(value: string): GovernedAuditEntry['result'] {
  if (value === 'success' || value === 'denied' || value === 'failure'
    || value === 'pending' || value === 'rejected') return value;
  throw new Error(`unsupported persisted audit result: ${value}`);
}

function approvalStatus(value: string): Approval['status'] {
  if (value === 'pending' || value === 'approved'
    || value === 'rejected' || value === 'revoked') return value;
  throw new Error(`unsupported persisted approval status: ${value}`);
}

/** Restore each tenant's hash chain in prevHash order, not timestamp order. */
function orderAuditChain(entries: GovernedAuditEntry[]): GovernedAuditEntry[] {
  const byTenant = new Map<string, GovernedAuditEntry[]>();
  entries.forEach((entry) => {
    byTenant.set(entry.tenantId, [...(byTenant.get(entry.tenantId) ?? []), entry]);
  });

  return [...byTenant.values()].flatMap((tenantEntries) => {
    const byPreviousHash = new Map<string, GovernedAuditEntry>();
    tenantEntries.forEach((entry) => {
      if (entry.prevHash) byPreviousHash.set(entry.prevHash, entry);
    });
    const roots = tenantEntries
      .filter((entry) => !entry.prevHash)
      .sort(compareAuditEntries);
    const ordered: GovernedAuditEntry[] = [];
    const visited = new Set<string>();

    const appendChain = (root: GovernedAuditEntry): void => {
      let current: GovernedAuditEntry | undefined = root;
      while (current && !visited.has(current.id)) {
        ordered.push(current);
        visited.add(current.id);
        current = current.hash ? byPreviousHash.get(current.hash) : undefined;
      }
    };

    roots.forEach(appendChain);
    tenantEntries
      .filter((entry) => !visited.has(entry.id))
      .sort(compareAuditEntries)
      .forEach(appendChain);
    return ordered;
  });
}

function compareAuditEntries(left: GovernedAuditEntry, right: GovernedAuditEntry): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}
