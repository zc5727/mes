import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import type { CorePersistenceSnapshot, PersistedDevice, PersistedFactory, PersistedLine, PersistedOrder, PersistedReport, PersistedWorkOrder } from './core-persistence.types';

/** PostgreSQL repository for the core MES aggregates; callers keep memory fallback when disabled. */
@Injectable()
export class CorePersistenceService {
  private readonly logger = new Logger(CorePersistenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Returns whether the application selected the PostgreSQL adapter. */
  isEnabled(): boolean {
    return this.prisma.enabled;
  }

  async restore(): Promise<CorePersistenceSnapshot> {
    await this.prisma.ensureConnection();
    if (!this.prisma.isReady()) {
      this.failIfRequired('restore core entities');
      return this.empty();
    }
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
      this.failIfRequired('restore core entities', error);
      return this.empty();
    }
  }

  async saveFactory(item: PersistedFactory): Promise<void> {
    await this.write('factory', () => this.prisma.factory.upsert({ where: { id: item.id }, create: { id: item.id, tenantId: item.tenantId, code: item.code, name: item.name, createdAt: new Date(item.createdAt), updatedAt: new Date(item.updatedAt) }, update: { code: item.code, name: item.name, updatedAt: new Date(item.updatedAt) } }));
  }

  async saveLine(item: PersistedLine): Promise<void> {
    const status = item.status ?? (item.active ? 'active' : 'inactive');
    await this.write('production line', () => this.prisma.productionLine.upsert({ where: { id: item.id }, create: { id: item.id, tenantId: item.tenantId, factoryId: item.factoryId, code: item.code, name: item.name, type: item.type, active: item.active, status, statusReason: item.statusReason ?? null, targetOee: item.targetOee, createdAt: new Date(item.createdAt), updatedAt: new Date(item.updatedAt) }, update: { factoryId: item.factoryId, code: item.code, name: item.name, type: item.type, active: item.active, status, statusReason: item.statusReason ?? null, targetOee: item.targetOee, updatedAt: new Date(item.updatedAt) } }));
  }

  async saveDevice(item: PersistedDevice): Promise<void> {
    await this.write('device', () => this.prisma.device.upsert({ where: { id: item.id }, create: { id: item.id, tenantId: item.tenantId, lineId: item.lineId, code: item.code, name: item.name, model: item.model, protocol: item.protocol, status: item.status as never, statusReason: item.statusReason, lastSeenAt: item.lastSeenAt ? new Date(item.lastSeenAt) : null, metrics: this.json(item.metrics), metadata: this.json(item.metadata), createdAt: new Date(item.createdAt), updatedAt: new Date(item.updatedAt) }, update: { lineId: item.lineId, code: item.code, name: item.name, model: item.model, protocol: item.protocol, status: item.status as never, statusReason: item.statusReason, lastSeenAt: item.lastSeenAt ? new Date(item.lastSeenAt) : null, metrics: this.json(item.metrics), metadata: this.json(item.metadata), updatedAt: new Date(item.updatedAt) } }));
  }

  async saveOrder(item: PersistedOrder): Promise<void> {
    await this.write('production order', () => this.prisma.productionOrder.upsert({ where: { id: item.id }, create: { id: item.id, tenantId: item.tenantId, orderNo: item.orderNo, productCode: item.productCode, productName: item.productName, plannedQty: item.plannedQty, completedQty: item.completedQty, dueAt: new Date(item.dueAt), priority: item.priority as never, status: item.status as never, externalId: item.externalId ?? null, externalSystem: item.externalSystem ?? null, createdAt: new Date(item.createdAt), updatedAt: new Date(item.updatedAt) }, update: { orderNo: item.orderNo, productCode: item.productCode, productName: item.productName, plannedQty: item.plannedQty, completedQty: item.completedQty, dueAt: new Date(item.dueAt), priority: item.priority as never, status: item.status as never, externalId: item.externalId ?? null, externalSystem: item.externalSystem ?? null, updatedAt: new Date(item.updatedAt) } }));
  }

  async saveWorkOrder(item: PersistedWorkOrder): Promise<void> {
    await this.write('work order', () => this.workOrderUpsert(this.prisma, item));
  }

  async saveReport(item: PersistedReport): Promise<void> {
    await this.write('work order report', () => this.reportUpsert(this.prisma, item));
  }

  /** Persists the report and its progress atomically when PostgreSQL is enabled. */
  async saveReportAndWorkOrder(report: PersistedReport, workOrder: PersistedWorkOrder): Promise<void> {
    await this.prisma.ensureConnection();
    if (!this.prisma.isReady()) {
      this.failIfRequired('persist work order report transaction');
      return;
    }
    try {
      await this.prisma.$transaction(async (transaction) => {
        await this.persistReportAndIncrementWorkOrder(transaction, report, workOrder);
      });
    } catch (error: unknown) {
      this.failure('persist work order report transaction', error);
      this.failIfRequired('persist work order report transaction', error);
    }
  }

  async deleteFactory(id: string): Promise<void> { await this.write('factory deletion', () => this.prisma.factory.delete({ where: { id } })); }
  async deleteLine(id: string): Promise<void> { await this.write('production line deletion', () => this.prisma.productionLine.delete({ where: { id } })); }
  async deleteDevice(id: string): Promise<void> { await this.write('device deletion', () => this.prisma.device.delete({ where: { id } })); }
  async deleteWorkOrder(id: string): Promise<void> { await this.write('work order deletion', () => this.prisma.workOrder.delete({ where: { id } })); }

  private async write(label: string, operation: () => Promise<unknown>): Promise<void> {
    await this.prisma.ensureConnection();
    if (!this.prisma.isReady()) {
      this.failIfRequired(`persist ${label}`);
      return;
    }
    try {
      await operation();
    } catch (error: unknown) {
      this.failure(`persist ${label}`, error);
      this.failIfRequired(`persist ${label}`, error);
    }
  }

  private failIfRequired(operation: string, error?: unknown): void {
    if (!this.prisma.required) return;
    const detail = error instanceof Error ? `: ${error.message}` : error ? `: ${String(error)}` : '';
    throw new Error(`PostgreSQL is required; ${operation} cannot continue${detail}`);
  }

  private json(value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
    return value === null || value === undefined ? Prisma.JsonNull : value as Prisma.InputJsonValue;
  }

  /**
   * Inserts one report and atomically increments the work order from its
   * current database value. This prevents two application instances from
   * overwriting each other's progress with stale in-memory snapshots.
   */
  private async persistReportAndIncrementWorkOrder(client: any, report: PersistedReport, workOrder: PersistedWorkOrder): Promise<void> {
    if (typeof client.workOrderReport.create !== 'function'
      || typeof client.workOrder.updateMany !== 'function'
      || typeof client.workOrder.findUnique !== 'function') {
      await this.workOrderUpsert(client, workOrder);
      await this.reportUpsert(client, report);
      return;
    }

    await client.workOrderReport.create({ data: this.reportData(report) });
    const progress = await client.workOrder.updateMany({
      where: {
        id: workOrder.id,
        tenantId: workOrder.tenantId,
        status: 'in_progress',
        completedQty: { lte: workOrder.plannedQty - report.quantity },
      },
      data: { completedQty: { increment: report.quantity }, updatedAt: new Date(workOrder.updatedAt) },
    });
    if (progress.count !== 1) {
      throw new Error('Work order progress conflict during persistence');
    }

    const current = await client.workOrder.findUnique({
      where: { id: workOrder.id },
      select: { completedQty: true },
    });
    if (current?.completedQty === workOrder.plannedQty) {
      await client.workOrder.update({
        where: { id: workOrder.id },
        data: { status: 'completed', statusReason: workOrder.statusReason, updatedAt: new Date(workOrder.updatedAt) },
      });
    }
  }

  private reportData(item: PersistedReport) {
    return {
      id: item.id, tenantId: item.tenantId, workOrderId: item.workOrderId, deviceId: item.deviceId,
      quantity: item.quantity, goodQty: item.goodQty, defectQty: item.defectQty, sourceTraceId: item.sourceTraceId,
      batchNo: item.batchNo ?? null, serialNumbers: this.json(item.serialNumbers), operationCode: item.operationCode ?? null,
      operatorId: item.operatorId ?? null, qualityRecordId: item.qualityRecordId ?? null,
      materialConsumptions: this.json(item.materialConsumptions), reportedAt: new Date(item.reportedAt), createdAt: new Date(item.reportedAt),
    };
  }

  private workOrderUpsert(client: any, item: PersistedWorkOrder): Promise<unknown> {
    return client.workOrder.upsert({ where: { id: item.id }, create: { id: item.id, tenantId: item.tenantId, orderId: item.orderId, orderNo: item.orderNo, productCode: item.productCode, productName: item.productName, lineId: item.lineId, plannedQty: item.plannedQty, completedQty: item.completedQty, dueAt: new Date(item.dueAt), priority: item.priority as never, status: item.status as never, statusReason: item.statusReason, externalId: item.externalId ?? null, externalSystem: item.externalSystem ?? null, bomId: item.bomId ?? null, routingId: item.routingId ?? null, createdAt: new Date(item.createdAt), updatedAt: new Date(item.updatedAt) }, update: { orderId: item.orderId, orderNo: item.orderNo, productCode: item.productCode, productName: item.productName, lineId: item.lineId, plannedQty: item.plannedQty, completedQty: item.completedQty, dueAt: new Date(item.dueAt), priority: item.priority as never, status: item.status as never, statusReason: item.statusReason, externalId: item.externalId ?? null, externalSystem: item.externalSystem ?? null, bomId: item.bomId ?? null, routingId: item.routingId ?? null, updatedAt: new Date(item.updatedAt) } });
  }
  private reportUpsert(client: any, item: PersistedReport): Promise<unknown> {
    return client.workOrderReport.upsert({ where: { id: item.id }, create: this.reportData(item), update: { deviceId: item.deviceId, quantity: item.quantity, goodQty: item.goodQty, defectQty: item.defectQty, batchNo: item.batchNo ?? null, serialNumbers: this.json(item.serialNumbers), operationCode: item.operationCode ?? null, operatorId: item.operatorId ?? null, qualityRecordId: item.qualityRecordId ?? null, materialConsumptions: this.json(item.materialConsumptions), reportedAt: new Date(item.reportedAt) } });
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
