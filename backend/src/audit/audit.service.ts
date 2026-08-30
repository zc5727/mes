import { Injectable, NotFoundException } from '@nestjs/common';
import { createId, timestamp } from '../common/mock.types';
import { CreateApprovalDto, CreateAuditDto } from './dto/audit.dto';
export interface AuditEntry { id: string; tenantId: string; actor: string; action: string; resource: string; resourceId?: string; details: Record<string, unknown>; createdAt: string; }
export interface Approval { id: string; tenantId: string; resource: string; resourceId: string; status: 'pending' | 'approved' | 'rejected'; comment: string; createdAt: string; decidedAt?: string; }
@Injectable()
export class AuditService {
  private readonly audit = new Map<string, AuditEntry[]>();
  private readonly approvals = new Map<string, Approval[]>();
  list(tenantId: string) { return this.audit.get(tenantId) ?? []; }
  record(tenantId: string, actor: string, dto: CreateAuditDto): AuditEntry { const entry: AuditEntry = { id: createId('audit'), tenantId, actor, action: dto.action, resource: dto.resource, resourceId: dto.resourceId, details: dto.details ?? {}, createdAt: timestamp() }; this.audit.set(tenantId, [...this.list(tenantId), entry]); return entry; }
  listApprovals(tenantId: string) { return this.approvals.get(tenantId) ?? []; }
  createApproval(tenantId: string, dto: CreateApprovalDto): Approval { const item: Approval = { id: createId('approval'), tenantId, resource: dto.resource, resourceId: dto.resourceId, status: 'pending', comment: dto.comment ?? '', createdAt: timestamp() }; this.approvals.set(tenantId, [...this.listApprovals(tenantId), item]); return item; }
  decide(tenantId: string, id: string, status: 'approved' | 'rejected', comment?: string): Approval { const item = this.listApprovals(tenantId).find((approval) => approval.id === id); if (!item) throw new NotFoundException(`Approval ${id} not found`); const updated = { ...item, status, comment: comment ?? item.comment, decidedAt: timestamp() }; this.approvals.set(tenantId, this.listApprovals(tenantId).map((approval) => approval.id === id ? updated : approval)); return updated; }
}
