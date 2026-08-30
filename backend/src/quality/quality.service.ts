import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { createId, timestamp } from '../common/mock.types';
import { DevicesService } from '../devices/devices.service';
import { ProductionLinesService } from '../production-lines/production-lines.service';
import { WorkOrdersService } from '../work-orders/work-orders.service';
import type { CreateQualityRecordDto, QualityTransitionDto, UpdateQualityDraftDto } from './dto/quality-record.dto';
import type { QualityRecord, QualityRecordStatus, QualityTraceEvent } from './quality.types';

@Injectable()
export class QualityService {
  private readonly records = new Map<string, QualityRecord[]>();

  constructor(
    @Optional() private readonly workOrders?: WorkOrdersService,
    @Optional() private readonly lines?: ProductionLinesService,
    @Optional() private readonly devices?: DevicesService,
  ) {}

  list(tenantId: string): QualityRecord[] {
    return [...(this.records.get(tenantId) ?? [])].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
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
    };
    this.validateReferences(tenantId, record, false);
    this.records.set(tenantId, [...(this.records.get(tenantId) ?? []), record]);
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

  private transition(tenantId: string, id: string, next: QualityRecordStatus, actorId: string): QualityRecord {
    const current = this.findOne(tenantId, id);
    const allowed: Record<QualityRecordStatus, QualityRecordStatus[]> = { draft: ['submitted'], submitted: ['confirmed', 'rejected'], confirmed: [], rejected: ['draft'] };
    if (!allowed[current.status].includes(next)) throw new ConflictException(`Cannot change quality record from ${current.status} to ${next}`);
    if (next === 'submitted' || next === 'confirmed') this.validateReferences(tenantId, current, true);
    const now = timestamp();
    const type = next === 'submitted' ? 'submitted' : next === 'confirmed' ? 'confirmed' : 'rejected';
    return this.replace({ ...current, status: next, updatedAt: now, trace: [...current.trace, { type, at: now, actorId: actorId.trim(), traceId: createId('trace') }] });
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
    return record;
  }
}
