import { ConflictException, Injectable, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { FoundationPersistenceService } from '../database/foundation-persistence.service';
import { createId, timestamp } from '../common/mock.types';
import { DevicesService } from '../devices/devices.service';
import { ProductionLinesService } from '../production-lines/production-lines.service';
import { CreateMaintenanceDto, UpdateMaintenanceStatusDto } from './dto/maintenance.dto';
import { MaintenanceStatus, MaintenanceWorkOrder } from './maintenance.types';

const transitions: Record<MaintenanceStatus, MaintenanceStatus[]> = {
  draft: ['assigned', 'cancelled'], assigned: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'], completed: [], cancelled: [],
};

@Injectable()
export class MaintenanceService implements OnModuleInit {
  private readonly orders = new Map<string, MaintenanceWorkOrder>();

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
}
