import { ConflictException, Injectable, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { FoundationPersistenceService } from '../database/foundation-persistence.service';
import { createId, timestamp } from '../common/mock.types';
import { DevicesService } from '../devices/devices.service';
import { ProductionLinesService } from '../production-lines/production-lines.service';
import { BadRequestException } from '@nestjs/common';
import { CreateMaintenanceDto, CreatePreventivePlanDto, CreateSparePartDto, ConsumeSparePartDto, UpdateMaintenanceStatusDto } from './dto/maintenance.dto';
import { MaintenanceStatus, MaintenanceWorkOrder, PreventivePlan, SparePart } from './maintenance.types';

const transitions: Record<MaintenanceStatus, MaintenanceStatus[]> = {
  draft: ['assigned', 'cancelled'], assigned: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'], completed: [], cancelled: [],
};

@Injectable()
export class MaintenanceService implements OnModuleInit {
  private readonly orders = new Map<string, MaintenanceWorkOrder>();
  private readonly plans = new Map<string, PreventivePlan>();
  private readonly parts = new Map<string, SparePart>();

  constructor(
    private readonly devices: DevicesService,
    private readonly lines: ProductionLinesService,
    @Optional() private readonly persistence?: FoundationPersistenceService,
  ) {}

  async onModuleInit(): Promise<void> {
    const snapshot = await this.persistence?.restore();
    snapshot?.maintenance.forEach((item) => this.orders.set(item.id, item));
  }

  list(tenantId: string): MaintenanceWorkOrder[] { return [...this.orders.values()].filter((item) => item.tenantId === tenantId); }

  findOne(tenantId: string, id: string): MaintenanceWorkOrder {
    const item = this.orders.get(id);
    if (!item || item.tenantId !== tenantId) throw new NotFoundException(`Maintenance work order ${id} not found`);
    return item;
  }

  create(tenantId: string, dto: CreateMaintenanceDto): MaintenanceWorkOrder {
    const device = this.devices.findOne(tenantId, dto.deviceId);
    this.lines.findOne(tenantId, dto.lineId);
    if (device.lineId !== dto.lineId) throw new ConflictException('Maintenance device must belong to line');
    const now = timestamp();
    const item: MaintenanceWorkOrder = { id: createId('maintenance'), tenantId, lineId: dto.lineId, deviceId: dto.deviceId, type: dto.type, title: dto.title, description: dto.description ?? '', status: 'draft', plannedAt: dto.plannedAt, completedAt: null, createdAt: now, updatedAt: now };
    this.orders.set(item.id, item);
    void this.persistence?.saveMaintenance(item);
    return item;
  }

  updateStatus(tenantId: string, id: string, dto: UpdateMaintenanceStatusDto): MaintenanceWorkOrder {
    const current = this.findOne(tenantId, id);
    if (!transitions[current.status].includes(dto.status)) throw new ConflictException(`Cannot change maintenance order from ${current.status} to ${dto.status}`);
    if ((dto.status === 'cancelled' || dto.status === 'completed') && !dto.reason?.trim()) throw new ConflictException('A reason is required for maintenance completion or cancellation');
    const updated = { ...current, status: dto.status, completedAt: dto.status === 'completed' ? timestamp() : current.completedAt, updatedAt: timestamp() };
    this.orders.set(id, updated);
    void this.persistence?.saveMaintenance(updated);
    return updated;
  }

  createPreventivePlan(tenantId: string, dto: CreatePreventivePlanDto): PreventivePlan {
    this.devices.findOne(tenantId, dto.deviceId);
    const plan: PreventivePlan = { id: createId('pm'), tenantId, deviceId: dto.deviceId, title: dto.title.trim(), intervalHours: dto.intervalHours ?? 720, nextDueAt: dto.nextDueAt, active: true, createdAt: timestamp() };
    this.plans.set(plan.id, plan);
    return plan;
  }
  listPreventivePlans(tenantId: string): PreventivePlan[] { return [...this.plans.values()].filter((plan) => plan.tenantId === tenantId); }
  createSparePart(tenantId: string, dto: CreateSparePartDto): SparePart {
    const key = `${tenantId}:${dto.code.trim()}`;
    if (this.parts.has(key)) throw new ConflictException(`Spare part ${dto.code} already exists`);
    const part: SparePart = { id: createId('part'), tenantId, code: dto.code.trim(), name: dto.name.trim(), stock: dto.stock ?? 0, minimumStock: dto.minimumStock ?? 0, updatedAt: timestamp() };
    if (part.stock < 0 || part.minimumStock < 0) throw new BadRequestException('Spare part stock cannot be negative');
    this.parts.set(key, part);
    return part;
  }
  listSpareParts(tenantId: string): SparePart[] { return [...this.parts.values()].filter((part) => part.tenantId === tenantId); }
  consumeSparePart(tenantId: string, dto: ConsumeSparePartDto): SparePart {
    if (!Number.isInteger(dto.quantity) || dto.quantity <= 0) throw new BadRequestException('Spare part quantity must be a positive integer');
    const key = `${tenantId}:${dto.code.trim()}`;
    const part = this.parts.get(key);
    if (!part) throw new NotFoundException(`Spare part ${dto.code} not found`);
    if (part.stock < dto.quantity) throw new ConflictException('Insufficient spare part stock');
    const updated = { ...part, stock: part.stock - dto.quantity, updatedAt: timestamp() };
    this.parts.set(key, updated);
    return updated;
  }
  metrics(tenantId: string, deviceId?: string) {
    const completed = this.list(tenantId).filter((item) => item.status === 'completed' && (!deviceId || item.deviceId === deviceId) && item.completedAt);
    const repairOrders = completed.filter((item) => item.type === 'repair');
    const repairMinutes = repairOrders.reduce((total, item) => total + (new Date(item.completedAt!).getTime() - new Date(item.createdAt).getTime()) / 60000, 0);
    const mttrMinutes = repairOrders.length ? Math.round((repairMinutes / repairOrders.length) * 10) / 10 : 0;
    const mtbfHours = repairOrders.length > 1 ? Math.round((repairOrders.reduce((total, item, index) => index === 0 ? total : total + (new Date(item.createdAt).getTime() - new Date(repairOrders[index - 1].createdAt).getTime()) / 3600000, 0) / (repairOrders.length - 1)) * 10) / 10 : 0;
    return { tenantId, deviceId: deviceId ?? null, repairCount: repairOrders.length, mttrMinutes, mtbfHours };
  }
}
