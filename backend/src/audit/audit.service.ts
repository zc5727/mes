import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createId, timestamp } from '../common/mock.types';
import { AuditResult, CreateApprovalDto, CreateAuditDto } from './dto/audit.dto';
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
export interface Approval { id: string; tenantId: string; resource: string; resourceId: string; status: 'pending' | 'approved' | 'rejected' | 'revoked'; comment: string; createdAt: string; decidedAt?: string; }
@Injectable()
export class AuditService {
  private readonly audit = new Map<string, AuditEntry[]>();
  private readonly approvals = new Map<string, Approval[]>();
  list(tenantId: string) { return this.audit.get(tenantId) ?? []; }
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
  restoreApproval(item: Approval): void {
    if (this.listApprovals(item.tenantId).some((approval) => approval.id === item.id)) return;
    this.approvals.set(item.tenantId, [...this.listApprovals(item.tenantId), item]);
  }
  createApproval(tenantId: string, dto: CreateApprovalDto): Approval { const item: Approval = { id: createId('approval'), tenantId, resource: dto.resource, resourceId: dto.resourceId, status: 'pending', comment: dto.comment ?? '', createdAt: timestamp() }; this.approvals.set(tenantId, [...this.listApprovals(tenantId), item]); return item; }
  decide(tenantId: string, id: string, status: 'approved' | 'rejected', comment?: string): Approval { const item = this.listApprovals(tenantId).find((approval) => approval.id === id); if (!item) throw new NotFoundException(`Approval ${id} not found`); if (item.status !== 'pending') throw new ConflictException(`Approval ${id} is already ${item.status}`); const updated = { ...item, status, comment: comment ?? item.comment, decidedAt: timestamp() }; this.approvals.set(tenantId, this.listApprovals(tenantId).map((approval) => approval.id === id ? updated : approval)); return updated; }
  revoke(tenantId: string, id: string, comment?: string): Approval { const item = this.listApprovals(tenantId).find((approval) => approval.id === id); if (!item) throw new NotFoundException(`Approval ${id} not found`); if (item.status === 'rejected' || item.status === 'revoked') throw new ConflictException(`Approval ${id} is already ${item.status}`); const updated = { ...item, status: 'revoked' as const, comment: comment ?? item.comment, decidedAt: timestamp() }; this.approvals.set(tenantId, this.listApprovals(tenantId).map((approval) => approval.id === id ? updated : approval)); return updated; }

  private hash(entry: AuditEntry): string {
    const { hash: _hash, ...payload } = entry;
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }
}
