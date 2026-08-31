import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import type { CorePersistenceSnapshot, PersistedDevice, PersistedFactory, PersistedLine, PersistedOrder, PersistedReport, PersistedWorkOrder } from './core-persistence.types';

/** PostgreSQL repository for the core MES aggregates; callers keep memory fallback when disabled. */
@Injectable()
export class CorePersistenceService {
  private readonly logger = new Logger(CorePersistenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async restore(): Promise<CorePersistenceSnapshot> {
    await this.prisma.ensureConnection();
    if (!this.prisma.isReady()) return this.empty();
    try {
      const [factories, lines, devices, orders, workOrders, reports] = await Promise.all([
        this.prisma.factory.findMany(), this.prisma.productionLine.findMany(), this.prisma.device.findMany(),
        this.prisma.productionOrder.findMany(), this.prisma.workOrder.findMany(), this.prisma.workOrderReport.findMany(),
      ]);
      return {
        factories: factories.map((item) => this.factory(item)), lines: lines.map((item) => this.line(item)),
        devices: devices.map((item) => this.device(item)), orders: orders.map((item) => this.order(item)),
        workOrders: workOrders.map((item) => this.workOrder(item)), reports: reports.map((item) => this.report(item)),
      };
    } catch (error: unknown) {
      this.failure('restore core entities', error);
      return this.empty();
    }
  }

  async saveFactory(item: PersistedFactory): Promise<void> {
    await this.write('factory', () => this.prisma.factory.upsert({ where: { id: item.id }, create: { id: item.id, tenantId: item.tenantId, code: item.code, name: item.name, createdAt: new Date(item.createdAt), updatedAt: new Date(item.updatedAt) }, update: { code: item.code, name: item.name, updatedAt: new Date(item.updatedAt) } }));
  }

  async saveLine(item: PersistedLine): Promise<void> {
    await this.write('production line', () => this.prisma.productionLine.upsert({ where: { id: item.id }, create: { id: item.id, tenantId: item.tenantId, factoryId: item.factoryId, code: item.code, name: item.name, type: item.type, active: item.active, targetOee: item.targetOee, createdAt: new Date(item.createdAt), updatedAt: new Date(item.updatedAt) }, update: { factoryId: item.factoryId, code: item.code, name: item.name, type: item.type, active: item.active, targetOee: item.targetOee, updatedAt: new Date(item.updatedAt) } }));
  }

  async saveDevice(item: PersistedDevice): Promise<void> {
    await this.write('device', () => this.prisma.device.upsert({ where: { id: item.id }, create: { id: item.id, tenantId: item.tenantId, lineId: item.lineId, code: item.code, name: item.name, model: item.model, protocol: item.protocol, status: item.status as never, statusReason: item.statusReason, lastSeenAt: item.lastSeenAt ? new Date(item.lastSeenAt) : null, metrics: this.json(item.metrics), metadata: this.json(item.metadata), createdAt: new Date(item.createdAt), updatedAt: new Date(item.updatedAt) }, update: { lineId: item.lineId, code: item.code, name: item.name, model: item.model, protocol: item.protocol, status: item.status as never, statusReason: item.statusReason, lastSeenAt: item.lastSeenAt ? new Date(item.lastSeenAt) : null, metrics: this.json(item.metrics), metadata: this.json(item.metadata), updatedAt: new Date(item.updatedAt) } }));
  }

  async saveOrder(item: PersistedOrder): Promise<void> {
    await this.write('production order', () => this.prisma.productionOrder.upsert({ where: { id: item.id }, create: { id: item.id, tenantId: item.tenantId, orderNo: item.orderNo, productCode: item.productCode, productName: item.productName, plannedQty: item.plannedQty, completedQty: item.completedQty, dueAt: new Date(item.dueAt), priority: item.priority as never, status: item.status as never, createdAt: new Date(item.createdAt), updatedAt: new Date(item.updatedAt) }, update: { orderNo: item.orderNo, productCode: item.productCode, productName: item.productName, plannedQty: item.plannedQty, completedQty: item.completedQty, dueAt: new Date(item.dueAt), priority: item.priority as never, status: item.status as never, updatedAt: new Date(item.updatedAt) } }));
  }

  async saveWorkOrder(item: PersistedWorkOrder): Promise<void> {
    await this.write('work order', () => this.prisma.workOrder.upsert({ where: { id: item.id }, create: { id: item.id, tenantId: item.tenantId, orderId: item.orderId, orderNo: item.orderNo, productCode: item.productCode, productName: item.productName, lineId: item.lineId, plannedQty: item.plannedQty, completedQty: item.completedQty, dueAt: new Date(item.dueAt), priority: item.priority as never, status: item.status as never, statusReason: item.statusReason, createdAt: new Date(item.createdAt), updatedAt: new Date(item.updatedAt) }, update: { orderId: item.orderId, orderNo: item.orderNo, productCode: item.productCode, productName: item.productName, lineId: item.lineId, plannedQty: item.plannedQty, completedQty: item.completedQty, dueAt: new Date(item.dueAt), priority: item.priority as never, status: item.status as never, statusReason: item.statusReason, updatedAt: new Date(item.updatedAt) } }));
  }

  async saveReport(item: PersistedReport): Promise<void> {
    await this.write('work order report', () => this.prisma.workOrderReport.upsert({
      where: { id: item.id },
      create: {
        id: item.id, tenantId: item.tenantId, workOrderId: item.workOrderId,
        deviceId: item.deviceId, quantity: item.quantity, goodQty: item.goodQty,
        defectQty: item.defectQty, sourceTraceId: item.sourceTraceId,
        batchNo: item.batchNo ?? null, serialNumbers: this.json(item.serialNumbers),
        operationCode: item.operationCode ?? null, operatorId: item.operatorId ?? null,
        qualityRecordId: item.qualityRecordId ?? null,
        materialConsumptions: this.json(item.materialConsumptions),
        reportedAt: new Date(item.reportedAt), createdAt: new Date(item.reportedAt),
      },
      update: {
        deviceId: item.deviceId, quantity: item.quantity, goodQty: item.goodQty,
        defectQty: item.defectQty, batchNo: item.batchNo ?? null,
        serialNumbers: this.json(item.serialNumbers), operationCode: item.operationCode ?? null,
        operatorId: item.operatorId ?? null, qualityRecordId: item.qualityRecordId ?? null,
        materialConsumptions: this.json(item.materialConsumptions),
        reportedAt: new Date(item.reportedAt),
      },
    }));
  }

  async deleteFactory(id: string): Promise<void> { await this.write('factory deletion', () => this.prisma.factory.delete({ where: { id } })); }
  async deleteLine(id: string): Promise<void> { await this.write('production line deletion', () => this.prisma.productionLine.delete({ where: { id } })); }
  async deleteDevice(id: string): Promise<void> { await this.write('device deletion', () => this.prisma.device.delete({ where: { id } })); }
  async deleteWorkOrder(id: string): Promise<void> { await this.write('work order deletion', () => this.prisma.workOrder.delete({ where: { id } })); }

  private async write(label: string, operation: () => Promise<unknown>): Promise<void> {
    await this.prisma.ensureConnection();
    if (!this.prisma.isReady()) return;
    try { await operation(); } catch (error: unknown) { this.failure(`persist ${label}`, error); }
  }

  private json(value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
    return value === null || value === undefined ? Prisma.JsonNull : value as Prisma.InputJsonValue;
  }
  private factory(item: any): PersistedFactory { return { ...item, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() }; }
  private line(item: any): PersistedLine { return { ...item, targetOee: item.targetOee === null ? 0 : Number(item.targetOee), createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() }; }
  private device(item: any): PersistedDevice { return { ...item, lastSeenAt: item.lastSeenAt?.toISOString() ?? null, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() }; }
  private order(item: any): PersistedOrder { return { ...item, dueAt: item.dueAt.toISOString(), createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() }; }
  private workOrder(item: any): PersistedWorkOrder { return { ...item, dueAt: item.dueAt.toISOString(), createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() }; }
  private report(item: any): PersistedReport {
    return {
      ...item,
      serialNumbers: item.serialNumbers ?? null,
      materialConsumptions: item.materialConsumptions ?? null,
      reportedAt: item.reportedAt.toISOString(),
    };
  }
  private empty(): CorePersistenceSnapshot { return { factories: [], lines: [], devices: [], orders: [], workOrders: [], reports: [] }; }
  private failure(operation: string, error: unknown): void { this.logger.error(`${operation} failed; memory mode remains available: ${error instanceof Error ? error.message : String(error)}`); }
}
