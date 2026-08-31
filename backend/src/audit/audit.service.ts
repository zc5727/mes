import {
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createId, timestamp } from '../common/mock.types';
import { AuditResult, CreateApprovalDto, CreateAuditDto } from './dto/audit.dto';
import { AuditPersistenceService } from './audit-persistence.service';
export interface AuditEntry { id: string; tenantId: string; actor: string; action: string; resource: string; resourceId?: string; details: Record<string, unknown>; createdAt: string; prevHash?: string; hash?: string; }
export interface GovernedAuditEntry extends AuditEntry {
  operator: string;
  object: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string;
  traceId: string;
  result: AuditResult;
}
export interface Approval {
  id: string;
  tenantId: string;
  resource: string;
  resourceId: string;
  status: 'pending' | 'approved' | 'rejected' | 'revoked';
  comment: string;
  createdAt: string;
  createdBy?: string;
  decidedAt?: string;
}
@Injectable()
export class AuditService implements OnModuleInit {
  private readonly audit = new Map<string, GovernedAuditEntry[]>();
  private readonly approvals = new Map<string, Approval[]>();

  constructor(
    @Optional() private readonly persistence?: AuditPersistenceService,
  ) {}

  async onModuleInit(): Promise<void> {
    const snapshot = await this.persistence?.restore();
    snapshot?.audit.forEach((entry) => this.restore(entry));
    snapshot?.approvals.forEach((approval) => this.restoreApproval(approval));
  }

  list(tenantId: string): GovernedAuditEntry[] { return this.audit.get(tenantId) ?? []; }
  restore(entry: GovernedAuditEntry): void {
    if (this.list(entry.tenantId).some((item) => item.id === entry.id)) return;
    this.audit.set(entry.tenantId, [...this.list(entry.tenantId), entry]);
  }
  record(tenantId: string, actor: string, dto: CreateAuditDto): GovernedAuditEntry {
    const operator = dto.operator?.trim() || actor;
    const object = dto.object?.trim() || `${dto.resource}${dto.resourceId ? `:${dto.resourceId}` : ''}`;
    const before = dto.before ?? null;
    const after = dto.after ?? null;
    const reason = dto.reason?.trim() || dto.action;
    const traceId = dto.traceId?.trim() || `audit-${createId('trace')}`;
    const result = dto.result ?? 'success';
    const previous = this.list(tenantId).at(-1);
    const entry: GovernedAuditEntry = {
      id: createId('audit'), tenantId, actor, action: dto.action, resource: dto.resource,
      resourceId: dto.resourceId,
      details: { ...dto.details, operator, object, before, after, reason, traceId, result },
      operator, object, before, after, reason, traceId, result, createdAt: timestamp(),
    };
    entry.prevHash = previous?.hash;
    entry.hash = this.hash(entry);
    this.audit.set(tenantId, [...this.list(tenantId), entry]);
    this.persistence?.enqueueAudit(entry);
    return entry;
  }
  verify(tenantId: string): { valid: boolean; checked: number; brokenId?: string } {
    let previousHash: string | undefined;
    const entries = this.list(tenantId);
    for (const entry of entries) {
      if (entry.prevHash !== previousHash || entry.hash !== this.hash(entry)) {
        return { valid: false, checked: entries.indexOf(entry), brokenId: entry.id };
      }
      previousHash = entry.hash;
    }
    return { valid: true, checked: entries.length };
  }
  listApprovals(tenantId: string) { return this.approvals.get(tenantId) ?? []; }
  findApproval(tenantId: string, id: string): Approval | undefined {
    return this.listApprovals(tenantId).find((approval) => approval.id === id);
  }
  restoreApproval(item: Approval): void {
    if (this.listApprovals(item.tenantId).some((approval) => approval.id === item.id)) return;
    this.approvals.set(item.tenantId, [...this.listApprovals(item.tenantId), item]);
  }
  createApproval(
    tenantId: string,
    dto: CreateApprovalDto,
    createdBy?: string,
    traceId?: string,
  ): Approval {
    const item: Approval = {
      id: createId('approval'),
      tenantId,
      resource: dto.resource,
      resourceId: dto.resourceId,
      status: 'pending',
      comment: dto.comment ?? '',
      createdAt: timestamp(),
      createdBy: createdBy?.trim() || undefined,
    };
    this.approvals.set(tenantId, [...this.listApprovals(tenantId), item]);
    this.persistence?.enqueueApproval(item);
    this.record(tenantId, createdBy?.trim() || 'system', {
      action: 'APPROVAL_CREATED',
      resource: item.resource,
      resourceId: item.resourceId,
      traceId,
      result: 'pending',
      details: { approvalId: item.id, createdBy: item.createdBy },
    });
    return item;
  }

  decide(
    tenantId: string,
    id: string,
    status: 'approved' | 'rejected',
    comment?: string,
    actor = 'system',
    traceId?: string,
  ): Approval {
    const item = this.findApprovalOrThrow(tenantId, id);
    this.assertNotSelfApproval(item, actor);
    if (item.status !== 'pending') {
      throw new ConflictException(`Approval ${id} is already ${item.status}`);
    }
    const updated = {
      ...item,
      status,
      comment: comment ?? item.comment,
      decidedAt: timestamp(),
    };
    this.approvals.set(
      tenantId,
      this.listApprovals(tenantId).map((approval) => (
        approval.id === id ? updated : approval
      )),
    );
    this.persistence?.enqueueApproval(updated);
    this.record(
      tenantId,
      actor,
      {
        action: `APPROVAL_${status.toUpperCase()}`,
        resource: item.resource,
        resourceId: item.resourceId,
        reason: `审批${status === 'approved' ? '通过' : '拒绝'}`,
        traceId,
        result: status === 'approved' ? 'success' : 'rejected',
        details: { approvalId: id, status, createdBy: item.createdBy },
      },
    );
    return updated;
  }

  revoke(
    tenantId: string,
    id: string,
    comment?: string,
    actor = 'system',
    traceId?: string,
  ): Approval {
    const item = this.findApprovalOrThrow(tenantId, id);
    this.assertNotSelfApproval(item, actor);
    if (item.status === 'rejected' || item.status === 'revoked') {
      throw new ConflictException(`Approval ${id} is already ${item.status}`);
    }
    const updated = {
      ...item,
      status: 'revoked' as const,
      comment: comment ?? item.comment,
      decidedAt: timestamp(),
    };
    this.approvals.set(
      tenantId,
      this.listApprovals(tenantId).map((approval) => (
        approval.id === id ? updated : approval
      )),
    );
    this.persistence?.enqueueApproval(updated);
    this.record(tenantId, actor, {
      action: 'APPROVAL_REVOKED',
      resource: item.resource,
      resourceId: item.resourceId,
      reason: '撤销审批',
      traceId,
      result: 'success',
      details: { approvalId: id, status: 'revoked', createdBy: item.createdBy },
    });
    return updated;
  }

  private findApprovalOrThrow(tenantId: string, id: string): Approval {
    const item = this.findApproval(tenantId, id);
    if (!item) throw new NotFoundException(`Approval ${id} not found`);
    return item;
  }

  private assertNotSelfApproval(item: Approval, actor: string): void {
    if (item.createdBy && item.createdBy === actor.trim()) {
      throw new ConflictException('APPROVAL_SEPARATION_REQUIRED: creator cannot decide approval');
    }
  }

  private hash(entry: AuditEntry): string {
    const { hash: _hash, ...payload } = entry;
    return createHash('sha256').update(JSON.stringify(canonicalize(payload))).digest('hex');
  }
}

/** Make audit hashes independent of JSON/JSONB object key ordering. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}
