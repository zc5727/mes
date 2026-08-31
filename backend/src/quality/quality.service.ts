import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { createId, timestamp } from '../common/mock.types';
import { DevicesService } from '../devices/devices.service';
import { ProductionLinesService } from '../production-lines/production-lines.service';
import { WorkOrdersService } from '../work-orders/work-orders.service';
import type { CreateQualityIssueDto, CreateQualityRecordDto, CreateQualityRuleDto, QualityTransitionDto, UpdateQualityDraftDto, UpdateQualityIssueDto } from './dto/quality-record.dto';
import type { InspectionType, QualityIssue, QualityRecord, QualityRecordStatus, QualityRule, QualityTraceEvent } from './quality.types';
import { FoundationPersistenceService } from '../database/foundation-persistence.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class QualityService implements OnModuleInit {
  private readonly records = new Map<string, QualityRecord[]>();
  private readonly rules = new Map<string, QualityRule[]>();
  private readonly issues = new Map<string, QualityIssue[]>();

  constructor(
    @Optional() private readonly workOrders?: WorkOrdersService,
    @Optional() private readonly lines?: ProductionLinesService,
    @Optional() private readonly devices?: DevicesService,
    @Optional() private readonly persistence?: FoundationPersistenceService,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    const snapshot = await this.persistence?.restore();
    if (snapshot?.quality.length) snapshot.quality.forEach((record) => this.records.set(record.tenantId, [...(this.records.get(record.tenantId) ?? []), record]));
    const rules = await this.persistence?.restoreAux('quality-rule'); rules?.forEach((item) => this.rules.set(item.tenantId, [...(this.rules.get(item.tenantId) ?? []), item.payload as unknown as QualityRule]));
    const issues = await this.persistence?.restoreAux('quality-issue'); issues?.forEach((item) => this.issues.set(item.tenantId, [...(this.issues.get(item.tenantId) ?? []), item.payload as unknown as QualityIssue]));
  }

  list(tenantId: string): QualityRecord[] {
    return [...(this.records.get(tenantId) ?? [])].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  listRules(tenantId: string): QualityRule[] { return this.rules.get(tenantId) ?? []; }
  createRule(tenantId: string, dto: CreateQualityRuleDto): QualityRule {
    if (this.listRules(tenantId).some((rule) => rule.key === dto.key.trim())) throw new ConflictException(`Quality rule ${dto.key} already exists`);
    const rule: QualityRule = { id: createId('qrule'), tenantId, key: dto.key.trim(), name: dto.name.trim(), inspectionType: dto.inspectionType, requiredFields: dto.requiredFields.map((field) => field.trim()), createdAt: timestamp() };
    this.rules.set(tenantId, [...this.listRules(tenantId), rule]);
    void this.persistence?.saveAux({ id: rule.id, tenantId, domain: 'quality-rule', payload: rule as unknown as Record<string, unknown>, createdAt: rule.createdAt, updatedAt: rule.createdAt });
    return rule;
  }

  listIssues(tenantId: string): QualityIssue[] { return this.issues.get(tenantId) ?? []; }
  createIssue(tenantId: string, dto: CreateQualityIssueDto): QualityIssue {
    this.findOne(tenantId, dto.qualityRecordId);
    const now = timestamp();
    const issue: QualityIssue = { id: createId('ncr'), tenantId, qualityRecordId: dto.qualityRecordId, code: dto.code.trim(), description: dto.description.trim(), status: 'open', capa: dto.capa?.trim() || null, createdAt: now, updatedAt: now };
    this.issues.set(tenantId, [...this.listIssues(tenantId), issue]);
    void this.persistence?.saveAux({ id: issue.id, tenantId, domain: 'quality-issue', payload: issue as unknown as Record<string, unknown>, createdAt: issue.createdAt, updatedAt: issue.updatedAt });
    return issue;
  }
  updateIssue(tenantId: string, id: string, dto: UpdateQualityIssueDto): QualityIssue {
    const current = this.listIssues(tenantId).find((issue) => issue.id === id);
    if (!current) throw new NotFoundException(`Quality issue ${id} not found`);
    if (current.status === 'closed') throw new ConflictException('Closed quality issues cannot be edited');
    if (dto.status === 'closed' && !dto.capa?.trim() && !current.capa) throw new ConflictException('CAPA is required before closing a quality issue');
    const updated = { ...current, status: dto.status, capa: dto.capa?.trim() || current.capa, updatedAt: timestamp() };
    this.issues.set(tenantId, this.listIssues(tenantId).map((issue) => issue.id === id ? updated : issue));
    void this.persistence?.saveAux({ id: updated.id, tenantId, domain: 'quality-issue', payload: updated as unknown as Record<string, unknown>, createdAt: updated.createdAt, updatedAt: updated.updatedAt });
    return updated;
  }

  findOne(tenantId: string, id: string): QualityRecord {
    const record = this.list(tenantId).find((item) => item.id === id);
    if (!record) throw new NotFoundException(`Quality record ${id} not found`);
    return record;
  }

  create(tenantId: string, dto: CreateQualityRecordDto): QualityRecord {
    const traceId = dto.traceId?.trim() || createId('trace');
    if (this.list(tenantId).some((record) => record.traceId === traceId)) throw new ConflictException(`Quality trace ${traceId} already exists`);
    const now = timestamp();
    const record: QualityRecord = {
      id: createId('quality'), tenantId, formKey: dto.formKey?.trim() || 'quality-inspection',
      formVersion: dto.formVersion?.trim() || '1.0', status: 'draft', workOrderId: dto.workOrderId?.trim() || null,
      batchNo: dto.batchNo.trim(), lineId: dto.lineId.trim(), deviceId: dto.deviceId?.trim() || null,
      operatorId: dto.operatorId.trim(), values: dto.values, traceId, createdAt: now, updatedAt: now,
      trace: [{ type: 'draft_created', at: now, actorId: dto.operatorId.trim(), traceId }],
      inspectionType: dto.inspectionType ?? 'IPQC', ruleKey: dto.ruleKey?.trim() || null,
    };
    this.validateReferences(tenantId, record, false);
    this.validateRule(record);
    this.records.set(tenantId, [...(this.records.get(tenantId) ?? []), record]);
    void this.persistence?.saveQuality(record);
    return record;
  }

  updateDraft(tenantId: string, id: string, dto: UpdateQualityDraftDto): QualityRecord {
    const current = this.findOne(tenantId, id);
    if (current.status !== 'draft') throw new ConflictException('Only draft quality records can be edited');
    const now = timestamp();
    const updated = {
      ...current,
      ...dto,
      values: dto.values ?? current.values,
      batchNo: dto.batchNo?.trim() || current.batchNo,
      workOrderId: dto.workOrderId?.trim() || current.workOrderId,
      deviceId: dto.deviceId?.trim() || current.deviceId,
      updatedAt: now,
      trace: [...current.trace, { type: 'draft_updated' as const, at: now, actorId: current.operatorId, traceId: createId('trace') }],
    };
    this.validateReferences(tenantId, updated, false);
    return this.replace(updated);
  }

  submit(tenantId: string, id: string, dto: QualityTransitionDto): QualityRecord {
    return this.transition(tenantId, id, 'submitted', dto.actorId);
  }

  confirm(tenantId: string, id: string, dto: QualityTransitionDto): QualityRecord {
    return this.transition(tenantId, id, 'confirmed', dto.actorId);
  }

  reject(tenantId: string, id: string, dto: QualityTransitionDto): QualityRecord {
    return this.transition(tenantId, id, 'rejected', dto.actorId);
  }

  canCompleteWorkOrder(tenantId: string, workOrderId: string): boolean {
    const linked = this.list(tenantId).filter((record) => record.workOrderId === workOrderId);
    if (linked.length > 0 && !linked.every((record) => record.status === 'confirmed')) return false;
    const recordIds = new Set(linked.map((record) => record.id));
    return this.listIssues(tenantId).filter((issue) => recordIds.has(issue.qualityRecordId)).every((issue) => issue.status === 'closed');
  }

  canReportWorkOrder(tenantId: string, workOrderId: string, qualityRecordId: string, traceId?: string): boolean {
    const record = this.findOne(tenantId, qualityRecordId);
    if (record.workOrderId !== workOrderId) throw new ConflictException('Quality record must belong to work order');
    if (traceId && record.traceId !== traceId) throw new ConflictException('Quality record and production report must share traceId');
    return record.status === 'confirmed';
  }

  private transition(tenantId: string, id: string, next: QualityRecordStatus, actorId: string): QualityRecord {
    const current = this.findOne(tenantId, id);
    const allowed: Record<QualityRecordStatus, QualityRecordStatus[]> = { draft: ['submitted'], submitted: ['confirmed', 'rejected'], confirmed: [], rejected: ['draft'] };
    if (!allowed[current.status].includes(next)) throw new ConflictException(`Cannot change quality record from ${current.status} to ${next}`);
    if (next === 'submitted' || next === 'confirmed') { this.validateReferences(tenantId, current, true); this.validateRule(current); }
    const now = timestamp();
    const type = next === 'submitted' ? 'submitted' : next === 'confirmed' ? 'confirmed' : 'rejected';
    const updated = this.replace({ ...current, status: next, updatedAt: now, trace: [...current.trace, { type, at: now, actorId: actorId.trim(), traceId: createId('trace') }] });
    this.auditService?.record(tenantId, actorId.trim(), { action: `quality.${type}`, resource: 'quality_record', resourceId: id, details: { status: next }, traceId: updated.trace.at(-1)?.traceId });
    return updated;
  }

  private validateRule(record: Pick<QualityRecord, 'tenantId' | 'ruleKey' | 'values' | 'inspectionType'>): void {
    if (!record.ruleKey) return;
    const rule = this.listRules(record.tenantId).find((item) => item.key === record.ruleKey);
    if (!rule || rule.inspectionType !== record.inspectionType) throw new BadRequestException('Quality rule is invalid for inspection type');
    const missing = rule.requiredFields.filter((field) => record.values[field] === undefined || record.values[field] === null);
    if (missing.length) throw new BadRequestException(`Missing quality fields: ${missing.join(', ')}`);
  }

  private validateReferences(tenantId: string, record: Pick<QualityRecord, 'lineId' | 'workOrderId' | 'deviceId'>, requireWorkOrder: boolean): void {
    if (!record.lineId) throw new BadRequestException('Quality record lineId is required');
    if (this.lines) this.lines.findOne(tenantId, record.lineId);
    if (requireWorkOrder && !record.workOrderId) throw new BadRequestException('workOrderId is required before submission');
    if (record.workOrderId && this.workOrders) {
      const workOrder = this.workOrders.findOne(tenantId, record.workOrderId);
      if (workOrder.lineId !== record.lineId) throw new ConflictException('Quality work order must belong to line');
    }
    if (record.deviceId && this.devices) {
      const device = this.devices.findOne(tenantId, record.deviceId);
      if (device.lineId !== record.lineId) throw new ConflictException('Quality device must belong to line');
    }
  }

  private replace(record: QualityRecord): QualityRecord {
    this.records.set(record.tenantId, (this.records.get(record.tenantId) ?? []).map((item) => item.id === record.id ? record : item));
    void this.persistence?.saveQuality(record);
    return record;
  }
}
