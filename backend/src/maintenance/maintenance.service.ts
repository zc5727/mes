import { ConflictException, Injectable, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { FoundationPersistenceService } from '../database/foundation-persistence.service';
import { createId, timestamp } from '../common/mock.types';
import { DevicesService } from '../devices/devices.service';
import { ProductionLinesService } from '../production-lines/production-lines.service';
import { BadRequestException } from '@nestjs/common';
import { CreateMaintenanceDto, CreatePreventivePlanDto, CreateSparePartDto, ConsumeSparePartDto, MaintenanceInspectionDto, UpdateMaintenanceStatusDto } from './dto/maintenance.dto';
import { MaintenanceStatus, MaintenanceWorkOrder, PreventivePlan, SparePart } from './maintenance.types';
import { AlarmsService } from '../alarms/alarms.service';
import { AuditService } from '../audit/audit.service';

const transitions: Record<MaintenanceStatus, MaintenanceStatus[]> = {
  draft: ['assigned', 'cancelled'], assigned: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'], completed: [], cancelled: [],
};

@Injectable()
export class MaintenanceService implements OnModuleInit {
  private readonly orders = new Map<string, MaintenanceWorkOrder>();
  private readonly plans = new Map<string, PreventivePlan>();
  private readonly parts = new Map<string, SparePart>();
  private readonly partMovements = new Map<string, SparePart>();
  private readonly partReturnMovements = new Map<string, SparePart>();

  constructor(
    private readonly devices: DevicesService,
    private readonly lines: ProductionLinesService,
    @Optional() private readonly persistence?: FoundationPersistenceService,
    @Optional() private readonly alarms?: AlarmsService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    const snapshot = await this.persistence?.restore();
    snapshot?.maintenance.forEach((item) => this.orders.set(item.id, item));
    const plans = await this.persistence?.restoreAux('preventive-plan'); plans?.forEach((item) => this.plans.set(item.id, item.payload as unknown as PreventivePlan));
    const parts = await this.persistence?.restoreAux('spare-part'); parts?.forEach((item) => this.parts.set(`${item.tenantId}:${(item.payload as unknown as SparePart).code}`, item.payload as unknown as SparePart));
    const movements = await this.persistence?.restoreAux('maintenance-part-movement');
    movements?.forEach((item) => {
      const payload = item.payload as { kind?: string; operationId?: string; part?: SparePart };
      if (!payload.operationId || !payload.part || (payload.kind !== 'consume' && payload.kind !== 'return')) return;
      const key = `${item.tenantId}:${payload.operationId}`;
      if (payload.kind === 'consume') this.partMovements.set(key, payload.part);
      else this.partReturnMovements.set(key, payload.part);
    });
  }

  list(tenantId: string): MaintenanceWorkOrder[] { return [...this.orders.values()].filter((item) => item.tenantId === tenantId); }

  /** Returns open maintenance orders whose planned time has elapsed. */
  overdue(tenantId: string, at = new Date()): MaintenanceWorkOrder[] {
    return this.list(tenantId)
      .filter((item) => !['completed', 'cancelled'].includes(item.status))
      .filter((item) => new Date(item.plannedAt).getTime() < at.getTime())
      .sort((left, right) => left.plannedAt.localeCompare(right.plannedAt));
  }

  isDeviceOccupied(tenantId: string, deviceId: string): boolean {
    // A draft is only a planned maintenance request. It must not block
    // production until it has been assigned to a technician or started.
    return this.list(tenantId).some((item) => item.deviceId === deviceId && ['assigned', 'in_progress'].includes(item.status));
  }

  findOne(tenantId: string, id: string): MaintenanceWorkOrder {
    const item = this.orders.get(id);
    if (!item || item.tenantId !== tenantId) throw new NotFoundException(`Maintenance work order ${id} not found`);
    return item;
  }

  createFromAlarm(tenantId: string, alarm: { id: string; lineId: string; sourceId: string; message: string }): MaintenanceWorkOrder {
    const existing = this.list(tenantId).find((item) => item.alarmId === alarm.id);
    if (existing) return existing;
    return this.create(tenantId, { alarmId: alarm.id, lineId: alarm.lineId, deviceId: alarm.sourceId, type: 'repair', title: `告警维修：${alarm.message}`, description: `由告警 ${alarm.id} 自动创建`, plannedAt: timestamp() });
  }

  create(tenantId: string, dto: CreateMaintenanceDto, actorId = 'system', persist = true): MaintenanceWorkOrder {
    const device = this.devices.findOne(tenantId, dto.deviceId);
    this.lines.findOne(tenantId, dto.lineId);
    if (device.lineId !== dto.lineId) throw new ConflictException('Maintenance device must belong to line');
    if (dto.alarmId && this.alarms) {
      const alarm = this.alarms.findOne(tenantId, dto.alarmId);
      if (alarm.lineId !== dto.lineId || alarm.sourceId !== dto.deviceId) throw new ConflictException('Maintenance alarm must belong to device and line');
    }
    const now = timestamp();
    const item: MaintenanceWorkOrder = { id: createId('maintenance'), tenantId, lineId: dto.lineId, deviceId: dto.deviceId, alarmId: dto.alarmId?.trim() || null, inspectionRequired: dto.inspectionRequired ?? Boolean(dto.alarmId), inspectionStatus: 'pending', type: dto.type, title: dto.title, description: dto.description ?? '', status: 'draft', plannedAt: dto.plannedAt, completedAt: null, createdAt: now, updatedAt: now };
    this.orders.set(item.id, item);
    if (persist) void this.persistence?.saveMaintenance(item);
    this.audit?.record(tenantId, actorId.trim() || 'system', { action: 'maintenance.created', resource: 'maintenance_work_order', resourceId: item.id, after: item as unknown as Record<string, unknown>, details: { deviceId: item.deviceId, lineId: item.lineId, alarmId: item.alarmId } });
    return item;
  }

  /** HTTP-safe variant: do not acknowledge creation until the persistence write completes. */
  async createReliable(tenantId: string, dto: CreateMaintenanceDto, actorId = 'system'): Promise<MaintenanceWorkOrder> {
    const item = this.create(tenantId, dto, actorId, false);
    try {
      await this.persistence?.saveMaintenance(item);
    } catch (error: unknown) {
      this.orders.delete(item.id);
      throw error;
    }
    return item;
  }

  updateStatus(tenantId: string, id: string, dto: UpdateMaintenanceStatusDto, actorId = 'system', persist = true): MaintenanceWorkOrder {
    const current = this.findOne(tenantId, id);
    if (!transitions[current.status].includes(dto.status)) throw new ConflictException(`Cannot change maintenance order from ${current.status} to ${dto.status}`);
    if ((dto.status === 'cancelled' || dto.status === 'completed') && !dto.reason?.trim()) throw new ConflictException('A reason is required for maintenance completion or cancellation');
    if (dto.status === 'completed' && current.inspectionRequired && current.inspectionStatus !== 'passed') throw new ConflictException('A passed point inspection is required before maintenance completion');
    const updated = { ...current, status: dto.status, completedAt: dto.status === 'completed' ? timestamp() : current.completedAt, updatedAt: timestamp() };
    this.orders.set(id, updated);
    this.audit?.record(tenantId, actorId.trim() || 'system', { action: `maintenance.${dto.status}`, resource: 'maintenance_work_order', resourceId: id, before: current as unknown as Record<string, unknown>, after: updated as unknown as Record<string, unknown>, details: { from: current.status, to: dto.status, reason: dto.reason ?? '', alarmId: current.alarmId } });
    if (persist) void this.persistence?.saveMaintenance(updated);
    return updated;
  }

  /** HTTP-safe variant: status transitions are acknowledged only after persistence. */
  async updateStatusReliable(tenantId: string, id: string, dto: UpdateMaintenanceStatusDto, actorId = 'system'): Promise<MaintenanceWorkOrder> {
    const current = this.findOne(tenantId, id);
    const updated = this.updateStatus(tenantId, id, dto, actorId, false);
    try {
      await this.persistence?.saveMaintenance(updated);
    } catch (error: unknown) {
      this.orders.set(id, current);
      throw error;
    }
    return updated;
  }

  recordInspection(tenantId: string, id: string, dto: MaintenanceInspectionDto, actorId = 'system', persist = true): MaintenanceWorkOrder {
    const current = this.findOne(tenantId, id);
    if (current.status !== 'in_progress') throw new ConflictException('Point inspection requires an in-progress maintenance order');
    const updated = { ...current, inspectionStatus: dto.result, updatedAt: timestamp() };
    this.orders.set(id, updated);
    this.audit?.record(tenantId, actorId.trim() || 'system', { action: `maintenance.point_inspection.${dto.result}`, resource: 'maintenance_work_order', resourceId: id, before: current as unknown as Record<string, unknown>, after: updated as unknown as Record<string, unknown>, details: { remark: dto.remark, alarmId: current.alarmId } });
    if (persist) void this.persistence?.saveMaintenance(updated);
    return updated;
  }

  /** HTTP-safe variant: point-inspection results must be durable before response. */
  async recordInspectionReliable(tenantId: string, id: string, dto: MaintenanceInspectionDto, actorId = 'system'): Promise<MaintenanceWorkOrder> {
    const current = this.findOne(tenantId, id);
    const updated = this.recordInspection(tenantId, id, dto, actorId, false);
    try {
      await this.persistence?.saveMaintenance(updated);
    } catch (error: unknown) {
      this.orders.set(id, current);
      throw error;
    }
    return updated;
  }

  createPreventivePlan(tenantId: string, dto: CreatePreventivePlanDto, actorId = 'system', persist = true): PreventivePlan {
    this.devices.findOne(tenantId, dto.deviceId);
    const plan: PreventivePlan = { id: createId('pm'), tenantId, deviceId: dto.deviceId, title: dto.title.trim(), intervalHours: dto.intervalHours ?? 720, nextDueAt: dto.nextDueAt, active: true, createdAt: timestamp() };
    this.plans.set(plan.id, plan);
    if (persist) void this.persistence?.saveAux({ id: plan.id, tenantId, domain: 'preventive-plan', payload: plan as unknown as Record<string, unknown>, createdAt: plan.createdAt, updatedAt: plan.createdAt });
    this.audit?.record(tenantId, actorId.trim() || 'system', { action: 'maintenance.preventive_plan_created', resource: 'preventive_plan', resourceId: plan.id, after: plan as unknown as Record<string, unknown>, details: { deviceId: plan.deviceId } });
    return plan;
  }
  async createPreventivePlanReliable(tenantId: string, dto: CreatePreventivePlanDto, actorId = 'system'): Promise<PreventivePlan> {
    const plan = this.createPreventivePlan(tenantId, dto, actorId, false);
    try {
      await this.persistence?.saveAuxReliable(this.auxiliary(plan, 'preventive-plan'));
      return plan;
    } catch (error: unknown) {
      this.plans.delete(plan.id);
      throw error;
    }
  }
  listPreventivePlans(tenantId: string): PreventivePlan[] { return [...this.plans.values()].filter((plan) => plan.tenantId === tenantId); }
  duePreventivePlans(tenantId: string, at = new Date()): PreventivePlan[] {
    return this.listPreventivePlans(tenantId).filter((plan) => plan.active && new Date(plan.nextDueAt).getTime() <= at.getTime());
  }
  triggerDuePreventivePlans(tenantId: string, at = new Date(), actorId = 'system'): MaintenanceWorkOrder[] {
    return this.duePreventivePlans(tenantId, at).flatMap((plan) => {
      const marker = `preventive-plan:${plan.id}`;
      const existing = this.list(tenantId).find((item) => item.type === 'preventive' && item.description === marker && item.status !== 'cancelled');
      if (existing) return [existing];
      const device = this.devices.findOne(tenantId, plan.deviceId);
      return [this.create(tenantId, { lineId: device.lineId, deviceId: plan.deviceId, type: 'preventive', title: plan.title, description: marker, plannedAt: plan.nextDueAt }, actorId)];
    });
  }
  createSparePart(tenantId: string, dto: CreateSparePartDto, actorId = 'system', persist = true): SparePart {
    const key = `${tenantId}:${dto.code.trim()}`;
    if (this.parts.has(key)) throw new ConflictException(`Spare part ${dto.code} already exists`);
    const part: SparePart = { id: createId('part'), tenantId, code: dto.code.trim(), name: dto.name.trim(), stock: dto.stock ?? 0, minimumStock: dto.minimumStock ?? 0, updatedAt: timestamp() };
    if (part.stock < 0 || part.minimumStock < 0) throw new BadRequestException('Spare part stock cannot be negative');
    this.parts.set(key, part);
    if (persist) void this.persistence?.saveAux({ id: part.id, tenantId, domain: 'spare-part', payload: part as unknown as Record<string, unknown>, createdAt: part.updatedAt, updatedAt: part.updatedAt });
    this.audit?.record(tenantId, actorId.trim() || 'system', { action: 'maintenance.spare_part_created', resource: 'spare_part', resourceId: part.id, after: part as unknown as Record<string, unknown>, details: { code: part.code } });
    return part;
  }
  async createSparePartReliable(tenantId: string, dto: CreateSparePartDto, actorId = 'system'): Promise<SparePart> {
    const part = this.createSparePart(tenantId, dto, actorId, false);
    try {
      await this.persistence?.saveAuxReliable(this.auxiliary(part, 'spare-part'));
      return part;
    } catch (error: unknown) {
      this.parts.delete(`${tenantId}:${part.code}`);
      throw error;
    }
  }
  listSpareParts(tenantId: string): SparePart[] { return [...this.parts.values()].filter((part) => part.tenantId === tenantId); }
  consumeSparePart(tenantId: string, dto: ConsumeSparePartDto, actorId = 'system', persist = true): SparePart {
    if (!Number.isInteger(dto.quantity) || dto.quantity <= 0) throw new BadRequestException('Spare part quantity must be a positive integer');
    const key = `${tenantId}:${dto.code.trim()}`;
    if (dto.operationId && this.partMovements.has(`${tenantId}:${dto.operationId}`)) return this.partMovements.get(`${tenantId}:${dto.operationId}`)!;
    const part = this.parts.get(key);
    if (!part) throw new NotFoundException(`Spare part ${dto.code} not found`);
    if (part.stock < dto.quantity) throw new ConflictException('Insufficient spare part stock');
    const updated = { ...part, stock: part.stock - dto.quantity, updatedAt: timestamp() };
    this.parts.set(key, updated);
    if (persist) void this.persistence?.saveAux({ id: updated.id, tenantId, domain: 'spare-part', payload: updated as unknown as Record<string, unknown>, createdAt: updated.updatedAt, updatedAt: updated.updatedAt });
    if (dto.operationId) {
      this.partMovements.set(`${tenantId}:${dto.operationId}`, updated);
      this.saveMovement(tenantId, 'consume', dto.operationId, updated, persist);
    }
    this.audit?.record(tenantId, actorId.trim() || 'system', { action: 'maintenance.spare_part_consumed', resource: 'spare_part', resourceId: updated.id, before: part as unknown as Record<string, unknown>, after: updated as unknown as Record<string, unknown>, details: { code: updated.code, quantity: dto.quantity, operationId: dto.operationId } });
    return updated;
  }
  async consumeSparePartReliable(tenantId: string, dto: ConsumeSparePartDto, actorId = 'system'): Promise<SparePart> {
    const key = `${tenantId}:${dto.code.trim()}`;
    const current = this.parts.get(key);
    const updated = this.consumeSparePart(tenantId, dto, actorId, false);
    try {
      const movement = dto.operationId ? this.movement(tenantId, 'consume', dto.operationId, updated) : undefined;
      await this.persistence?.saveAuxBatchReliable([this.auxiliary(updated, 'spare-part'), ...(movement ? [movement] : [])]);
      return updated;
    } catch (error: unknown) {
      if (current) this.parts.set(key, current);
      if (dto.operationId) this.partMovements.delete(`${tenantId}:${dto.operationId}`);
      throw error;
    }
  }

  returnSparePart(tenantId: string, dto: ConsumeSparePartDto, actorId = 'system', persist = true): SparePart {
    if (!Number.isInteger(dto.quantity) || dto.quantity <= 0) throw new BadRequestException('Spare part quantity must be a positive integer');
    const key = `${tenantId}:${dto.code.trim()}`;
    if (dto.operationId && this.partReturnMovements.has(`${tenantId}:${dto.operationId}`)) return this.partReturnMovements.get(`${tenantId}:${dto.operationId}`)!;
    const part = this.parts.get(key);
    if (!part) throw new NotFoundException(`Spare part ${dto.code} not found`);
    const updated = { ...part, stock: part.stock + dto.quantity, updatedAt: timestamp() };
    this.parts.set(key, updated);
    if (persist) void this.persistence?.saveAux({ id: updated.id, tenantId, domain: 'spare-part', payload: updated as unknown as Record<string, unknown>, createdAt: updated.updatedAt, updatedAt: updated.updatedAt });
    if (dto.operationId) {
      this.partReturnMovements.set(`${tenantId}:${dto.operationId}`, updated);
      this.saveMovement(tenantId, 'return', dto.operationId, updated, persist);
    }
    this.audit?.record(tenantId, actorId.trim() || 'system', { action: 'maintenance.spare_part_returned', resource: 'spare_part', resourceId: updated.id, before: part as unknown as Record<string, unknown>, after: updated as unknown as Record<string, unknown>, details: { code: updated.code, quantity: dto.quantity, operationId: dto.operationId } });
    return updated;
  }
  async returnSparePartReliable(tenantId: string, dto: ConsumeSparePartDto, actorId = 'system'): Promise<SparePart> {
    const key = `${tenantId}:${dto.code.trim()}`;
    const current = this.parts.get(key);
    const updated = this.returnSparePart(tenantId, dto, actorId, false);
    try {
      const movement = dto.operationId ? this.movement(tenantId, 'return', dto.operationId, updated) : undefined;
      await this.persistence?.saveAuxBatchReliable([this.auxiliary(updated, 'spare-part'), ...(movement ? [movement] : [])]);
      return updated;
    } catch (error: unknown) {
      if (current) this.parts.set(key, current);
      if (dto.operationId) this.partReturnMovements.delete(`${tenantId}:${dto.operationId}`);
      throw error;
    }
  }
  metrics(tenantId: string, deviceId?: string) {
    const completed = this.list(tenantId).filter((item) => item.status === 'completed' && (!deviceId || item.deviceId === deviceId) && item.completedAt);
    const repairOrders = completed.filter((item) => item.type === 'repair');
    const repairMinutes = repairOrders.reduce((total, item) => total + (new Date(item.completedAt!).getTime() - new Date(item.createdAt).getTime()) / 60000, 0);
    const mttrMinutes = repairOrders.length ? Math.round((repairMinutes / repairOrders.length) * 10) / 10 : 0;
    const mtbfHours = repairOrders.length > 1 ? Math.round((repairOrders.reduce((total, item, index) => index === 0 ? total : total + (new Date(item.createdAt).getTime() - new Date(repairOrders[index - 1].createdAt).getTime()) / 3600000, 0) / (repairOrders.length - 1)) * 10) / 10 : 0;
    return { tenantId, deviceId: deviceId ?? null, repairCount: repairOrders.length, mttrMinutes, mtbfHours };
  }

  private saveMovement(tenantId: string, kind: 'consume' | 'return', operationId: string, part: SparePart, persist = true): void {
    if (!persist) return;
    void this.persistence?.saveAux(this.movement(tenantId, kind, operationId, part));
  }

  private movement(tenantId: string, kind: 'consume' | 'return', operationId: string, part: SparePart) {
    const now = timestamp();
    return {
      id: `maintenance-part-movement:${tenantId}:${kind}:${operationId}`,
      tenantId,
      domain: 'maintenance-part-movement',
      payload: { kind, operationId, part } as unknown as Record<string, unknown>,
      createdAt: now,
      updatedAt: now,
    };
  }

  private auxiliary(item: PreventivePlan | SparePart, domain: string) {
    const createdAt = 'createdAt' in item ? item.createdAt : item.updatedAt;
    const updatedAt = 'updatedAt' in item ? item.updatedAt : item.createdAt;
    return { id: item.id, tenantId: item.tenantId, domain, payload: item as unknown as Record<string, unknown>, createdAt, updatedAt };
  }
}
