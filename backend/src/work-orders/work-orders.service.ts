import { ConflictException, forwardRef, Inject, Injectable, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { createId, MockEntity, timestamp } from '../common/mock.types';
import { CreateWorkOrderDto } from './dto/create-work-order.dto';
import { UpdateWorkOrderStatusDto } from './dto/update-work-order-status.dto';
import { UpdateWorkOrderDto } from './dto/update-work-order.dto';
import { ReportWorkOrderDto } from './dto/report-work-order.dto';
import { OrdersService } from '../orders/orders.service';
import { ProductionLinesService } from '../production-lines/production-lines.service';
import { DevicesService } from '../devices/devices.service';
import { MasterDataService } from '../master-data/master-data.service';
import { AuditService } from '../audit/audit.service';
import { CorePersistenceService } from '../database/core-persistence.service';
import { QualityService } from '../quality/quality.service';
import { MaintenanceService } from '../maintenance/maintenance.service';

type WorkOrderStatus = 'draft' | 'released' | 'in_progress' | 'paused' | 'completed' | 'cancelled';
type WorkOrderPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface WorkOrder extends MockEntity {
  externalId?: string;
  externalSystem?: string;
  bomId?: string;
  routingId?: string;
  orderId?: string;
  orderNo: string;
  productCode: string;
  productName: string;
  lineId: string;
  plannedQty: number;
  completedQty: number;
  dueAt: string;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  statusReason: string;
}

export interface WorkOrderReport {
  id: string;
  workOrderId: string;
  tenantId: string;
  quantity: number;
  goodQty: number;
  defectQty: number;
  deviceId: string | null;
  sourceTraceId: string;
  batchNo: string | null;
  serialNumbers: string[];
  operationCode: string | null;
  operatorId: string | null;
  qualityRecordId: string | null;
  materialConsumptions: Array<{ materialCode: string; batchNo: string; quantity: number; unit?: string }>;
  reportedAt: string;
}

export interface OperationEventTrace {
  reportId: string;
  operationCode: string;
  deviceId: string;
  batchNo: string;
  quantity: number;
  goodQty: number;
  defectQty: number;
  reportedAt: string;
}

export interface FinishedProductTrace {
  batchNo: string;
  serialNumbers: string[];
  quantity: number;
  goodQty: number;
  defectQty: number;
}

export interface TraceabilityQuery {
  batchNo?: string;
  serialNumber?: string;
  materialBatchNo?: string;
  operationCode?: string;
  deviceId?: string;
  workOrderId?: string;
  sourceTraceId?: string;
}

const allowedTransitions: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  draft: ['released', 'cancelled'],
  released: ['in_progress', 'cancelled'],
  in_progress: ['paused', 'completed', 'cancelled'],
  paused: ['released', 'in_progress', 'cancelled'],
  completed: [],
  cancelled: [],
};

@Injectable()
export class WorkOrdersService implements OnModuleInit {
  constructor(
    @Optional() private readonly ordersService: OrdersService = new OrdersService(),
    @Optional() private readonly productionLinesService: ProductionLinesService = new ProductionLinesService(),
    @Optional() private readonly devicesService?: DevicesService,
    @Optional() private readonly masterDataService?: MasterDataService,
    @Optional() private readonly auditService?: AuditService,
    @Optional() private readonly persistence?: CorePersistenceService,
    @Optional() @Inject(forwardRef(() => QualityService)) private readonly qualityService?: QualityService,
    @Optional() @Inject(forwardRef(() => MaintenanceService)) private readonly maintenanceService?: MaintenanceService,
  ) {}

  async onModuleInit(): Promise<void> {
    const snapshot = await this.persistence?.restore();
    if (this.persistence?.isEnabled?.()) {
      this.workOrders.clear();
      this.reports.length = 0;
    }
    if (snapshot?.workOrders.length) {
      this.workOrders.clear();
      snapshot.workOrders.forEach((item) => this.workOrders.set(item.id, {
        ...item,
        orderId: item.orderId ?? undefined,
        externalId: item.externalId ?? undefined,
        externalSystem: item.externalSystem ?? undefined,
        bomId: item.bomId ?? undefined,
        routingId: item.routingId ?? undefined,
        priority: item.priority as WorkOrderPriority, status: item.status as WorkOrderStatus,
      }));
    }
    if (snapshot?.reports.length) {
      this.reports.length = 0;
      this.reports.push(...snapshot.reports.map((item) => ({
        ...item,
        batchNo: item.batchNo ?? null,
        serialNumbers: item.serialNumbers ?? [],
        operationCode: item.operationCode ?? null,
        operatorId: item.operatorId ?? null,
        qualityRecordId: item.qualityRecordId ?? null,
        materialConsumptions: item.materialConsumptions ?? [],
      })));
    }
  }

  private readonly reports: WorkOrderReport[] = [];
  private readonly workOrders = new Map<string, WorkOrder>([
    [
      'wo-demo-001',
      {
        id: 'wo-demo-001',
        tenantId: 'tenant-demo',
        orderNo: 'MO20260828001',
        productCode: 'PART-1001',
        productName: '精密连接座',
        lineId: 'line-cnc',
        plannedQty: 1200,
        completedQty: 780,
        dueAt: '2026-08-28T18:00:00.000Z',
        priority: 'high',
        status: 'in_progress',
        statusReason: '',
        createdAt: '2026-08-28T00:00:00.000Z',
        updatedAt: '2026-08-28T08:00:00.000Z',
      },
    ],
  ]);

  findAll(tenantId: string, status?: WorkOrderStatus): WorkOrder[] {
    return [...this.workOrders.values()].filter(
      (order) => order.tenantId === tenantId && (!status || order.status === status),
    );
  }

  findOverview(tenantId: string) {
    const orders = this.findAll(tenantId);
    const plannedQty = orders.reduce((total, order) => total + order.plannedQty, 0);
    const completedQty = orders.reduce((total, order) => total + order.completedQty, 0);

    return {
      total: orders.length,
      draft: orders.filter((order) => order.status === 'draft').length,
      released: orders.filter((order) => order.status === 'released').length,
      inProgress: orders.filter((order) => order.status === 'in_progress').length,
      paused: orders.filter((order) => order.status === 'paused').length,
      completed: orders.filter((order) => order.status === 'completed').length,
      cancelled: orders.filter((order) => order.status === 'cancelled').length,
      plannedQty,
      completedQty,
      completionRate: plannedQty ? Math.round((completedQty / plannedQty) * 1000) / 10 : 0,
    };
  }

  findOne(tenantId: string, id: string): WorkOrder {
    const workOrder = this.workOrders.get(id);
    if (!workOrder || workOrder.tenantId !== tenantId) {
      throw new NotFoundException(`Work order ${id} not found`);
    }

    return workOrder;
  }

  create(tenantId: string, dto: CreateWorkOrderDto, actorId = 'system', persist = true): WorkOrder {
    const duplicate = this.findAll(tenantId).some((order) => order.orderNo === dto.orderNo);
    if (duplicate) {
      throw new ConflictException(`Work order ${dto.orderNo} already exists`);
    }

    this.productionLinesService.findOne(tenantId, dto.lineId);
    if (dto.orderId) this.ordersService.findOne(tenantId, dto.orderId);
    if (dto.bomId && this.masterDataService) this.masterDataService.findOne(tenantId, 'bom', dto.bomId);
    if (dto.routingId && this.masterDataService) this.masterDataService.findOne(tenantId, 'routing', dto.routingId);
    const completedQty = dto.completedQty ?? 0;
    if (completedQty > dto.plannedQty) {
      throw new ConflictException('completedQty cannot be greater than plannedQty');
    }
    const now = timestamp();
    const workOrder: WorkOrder = {
      id: createId('wo'),
      orderId: dto.orderId,
      externalId: dto.externalId?.trim(),
      externalSystem: dto.externalSystem?.trim(),
      bomId: dto.bomId,
      routingId: dto.routingId,
      tenantId,
      orderNo: dto.orderNo,
      productCode: dto.productCode,
      productName: dto.productName,
      lineId: dto.lineId,
      plannedQty: dto.plannedQty,
      completedQty,
      dueAt: dto.dueAt,
      priority: dto.priority ?? 'normal',
      status: 'draft',
      statusReason: '',
      createdAt: now,
      updatedAt: now,
    };
    this.workOrders.set(workOrder.id, workOrder);
    if (persist) void this.persistence?.saveWorkOrder(workOrder);
    this.productionLinesService.registerWorkOrder(tenantId, workOrder.lineId);
    this.auditService?.record(tenantId, actorId.trim() || 'system', {
      action: 'work_order.created',
      resource: 'work_order',
      resourceId: workOrder.id,
      after: workOrder as unknown as Record<string, unknown>,
      details: { orderNo: workOrder.orderNo, lineId: workOrder.lineId, plannedQty: workOrder.plannedQty },
    });
    return workOrder;
  }

  /**
   * Durable HTTP boundary for work-order creation. The memory adapter remains
   * synchronous for the execution engine, but API acknowledgement waits for
   * PostgreSQL and rolls back line registration on failure.
   */
  async createReliable(tenantId: string, dto: CreateWorkOrderDto, actorId = 'system'): Promise<WorkOrder> {
    const workOrder = this.create(tenantId, dto, actorId, false);
    try {
      await this.persistence?.saveWorkOrder(workOrder);
      return workOrder;
    } catch (error: unknown) {
      this.workOrders.delete(workOrder.id);
      this.productionLinesService.unregisterWorkOrder(tenantId, workOrder.lineId);
      throw error;
    }
  }

  update(tenantId: string, id: string, dto: UpdateWorkOrderDto, actorId = 'system'): WorkOrder {
    const current = this.findOne(tenantId, id);
    if (current.status === 'completed' || current.status === 'cancelled') {
      throw new ConflictException(`Work orders in ${current.status} status cannot be edited`);
    }
    if (dto.completedQty !== undefined && dto.completedQty !== current.completedQty) {
      throw new ConflictException('completedQty can only be changed by production report');
    }
    if (dto.lineId) this.productionLinesService.findOne(tenantId, dto.lineId);
    const plannedQty = dto.plannedQty ?? current.plannedQty;
    const completedQty = dto.completedQty ?? current.completedQty;
    if (completedQty < current.completedQty) {
      throw new ConflictException('completedQty cannot be decreased');
    }
    if (completedQty > plannedQty) {
      throw new ConflictException('completedQty cannot be greater than plannedQty');
    }

    const updated: WorkOrder = {
      ...current,
      ...dto,
      plannedQty,
      completedQty,
      updatedAt: timestamp(),
    };
    if (dto.lineId && dto.lineId !== current.lineId) {
      this.productionLinesService.unregisterWorkOrder(tenantId, current.lineId);
      this.productionLinesService.registerWorkOrder(tenantId, dto.lineId);
    }
    this.workOrders.set(id, updated);
    void this.persistence?.saveWorkOrder(updated);
    this.auditService?.record(tenantId, actorId.trim() || 'system', {
      action: 'work_order.updated',
      resource: 'work_order',
      resourceId: id,
      before: current as unknown as Record<string, unknown>,
      after: updated as unknown as Record<string, unknown>,
      details: { orderNo: updated.orderNo, lineId: updated.lineId, plannedQty: updated.plannedQty },
    });
    return updated;
  }

  report(tenantId: string, id: string, dto: ReportWorkOrderDto, actorId = 'system', rollbackOnFailure = false): { workOrder: WorkOrder; report: WorkOrderReport } {
    const current = this.findOne(tenantId, id);
    if (current.status !== 'in_progress') throw new ConflictException('Only in-progress work orders can report production');
    const reportTraceId = dto.sourceTraceId?.trim() || createId('trace');
    if (dto.qualityRecordId && this.qualityService && !this.qualityService.canReportWorkOrder(tenantId, id, dto.qualityRecordId, reportTraceId)) {
      throw new ConflictException('Quality release is required before reporting production');
    }
    if (current.completedQty + dto.quantity > current.plannedQty) throw new ConflictException('Report quantity exceeds planned quantity');
    if (this.reports.some((item) => item.tenantId === tenantId && item.sourceTraceId === reportTraceId)) {
      throw new ConflictException(`Report trace ${reportTraceId} already exists`);
    }
    if (dto.deviceId && this.devicesService) {
      const device = this.devicesService.findOne(tenantId, dto.deviceId);
      if (device.lineId !== current.lineId) throw new ConflictException('Report device must belong to work order line');
      if (device.status !== 'online') throw new ConflictException('Report device must be online');
      if (this.maintenanceService?.isDeviceOccupied(tenantId, dto.deviceId)) throw new ConflictException('Report device is occupied by maintenance work');
    }
    const goodQty = dto.goodQty ?? dto.quantity;
    const defectQty = dto.defectQty ?? dto.quantity - goodQty;
    if (goodQty < 0 || defectQty < 0 || goodQty > dto.quantity || defectQty > dto.quantity) {
      throw new ConflictException('goodQty and defectQty must be within quantity');
    }
    if (goodQty + defectQty !== dto.quantity) throw new ConflictException('goodQty + defectQty must equal quantity');
    const serialNumbers = dto.serialNumbers ?? [];
    if (serialNumbers.length && serialNumbers.length !== dto.quantity) throw new ConflictException('serialNumbers count must equal quantity');
    if (new Set(serialNumbers).size !== serialNumbers.length) throw new ConflictException('serialNumbers must be unique');
    const existingSerialNumbers = new Set(this.reports.filter((item) => item.tenantId === tenantId && item.workOrderId === id).flatMap((item) => item.serialNumbers));
    if (serialNumbers.some((serialNumber) => existingSerialNumbers.has(serialNumber))) throw new ConflictException('serialNumbers already reported for work order');
    const materialConsumptions = (dto.materialConsumptions ?? []).map((item) => ({
      ...item,
      materialCode: item.materialCode.trim(),
      batchNo: item.batchNo.trim(),
      unit: item.unit?.trim(),
    }));
    if (materialConsumptions.some((item) => !item.materialCode?.trim() || !item.batchNo?.trim() || typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) || item.quantity <= 0)) {
      throw new ConflictException('material consumptions must have positive quantities, material codes and batch numbers');
    }
    if (dto.operationCode && this.masterDataService) this.masterDataService.validateOperation(tenantId, current.routingId, dto.operationCode.trim());
    const completedQty = current.completedQty + dto.quantity;
    if (completedQty === current.plannedQty && this.qualityService && !this.qualityService.canCompleteWorkOrder(tenantId, id)) {
      throw new ConflictException('Quality release is required before work order completion');
    }
    const rollback = rollbackOnFailure
      ? this.masterDataService?.consumeBatchesWithRollback(tenantId, materialConsumptions, reportTraceId, actorId)
      : undefined;
    if (!rollbackOnFailure && this.masterDataService) this.masterDataService.consumeBatches(tenantId, materialConsumptions, reportTraceId, actorId);
    const reportCount = this.reports.length;
    try {
      const report: WorkOrderReport = {
        id: createId('report'), workOrderId: id, tenantId, quantity: dto.quantity,
        goodQty, defectQty, deviceId: dto.deviceId ?? null,
        sourceTraceId: reportTraceId, reportedAt: timestamp(),
        batchNo: dto.batchNo?.trim() || null, serialNumbers,
        operationCode: dto.operationCode?.trim() || null,
        operatorId: dto.operatorId?.trim() || null,
        qualityRecordId: dto.qualityRecordId?.trim() || null,
        materialConsumptions,
      };
      const workOrder = this.updateProgress(current, completedQty, false);
      this.reports.push(report);
      if (this.persistence?.saveReportAndWorkOrder) void this.persistence.saveReportAndWorkOrder(report, workOrder);
      else {
        void this.persistence?.saveReport(report);
        void this.persistence?.saveWorkOrder(workOrder);
      }
      if (workOrder.orderId) this.syncOrderProgress(tenantId, workOrder.orderId);
      this.auditService?.record(tenantId, dto.operatorId?.trim() || actorId.trim() || 'system', {
        action: 'work_order.report', resource: 'work_order', resourceId: id,
        details: { reportId: report.id, quantity: report.quantity, sourceTraceId: report.sourceTraceId, operationCode: report.operationCode, batchNo: report.batchNo },
        traceId: report.sourceTraceId,
      });
      return { workOrder, report };
    } catch (error) {
      if (rollback) {
        this.reports.length = reportCount;
        this.workOrders.set(id, current);
        rollback();
      }
      throw error;
    }
  }

  /** Uses the durable transaction path when PostgreSQL is enabled. */
  async recordReport(tenantId: string, id: string, dto: ReportWorkOrderDto, actorId = 'system'): Promise<{ workOrder: WorkOrder; report: WorkOrderReport }> {
    if (this.persistence?.isEnabled?.() !== true) return this.report(tenantId, id, dto, actorId);
    return this.reportPersistent(tenantId, id, dto, actorId);
  }

  /** Records a partial or final report atomically when PostgreSQL is enabled. */
  private async reportPersistent(tenantId: string, id: string, dto: ReportWorkOrderDto, actorId: string): Promise<{ workOrder: WorkOrder; report: WorkOrderReport }> {
    if (!this.persistence?.saveReportTransaction) throw new ConflictException('shared PostgreSQL transaction for report is unavailable');
    const current = this.findOne(tenantId, id);
    if (current.status !== 'in_progress') throw new ConflictException('Only in-progress work orders can report production');
    const reportTraceId = dto.sourceTraceId?.trim() || createId('trace');
    const existing = this.reports.find((item) => item.tenantId === tenantId && item.sourceTraceId === reportTraceId);
    if (existing) {
      if (existing.workOrderId !== id) throw new ConflictException(`Report trace ${reportTraceId} belongs to another work order`);
      return { workOrder: current, report: existing };
    }
    if (dto.qualityRecordId && this.qualityService && !this.qualityService.canReportWorkOrder(tenantId, id, dto.qualityRecordId.trim(), reportTraceId)) {
      throw new ConflictException('Quality release is required before reporting production');
    }
    if (current.completedQty + dto.quantity > current.plannedQty) throw new ConflictException('Report quantity exceeds planned quantity');
    if (dto.deviceId && this.devicesService) {
      const device = this.devicesService.findOne(tenantId, dto.deviceId);
      if (device.lineId !== current.lineId) throw new ConflictException('Report device must belong to work order line');
      if (device.status !== 'online') throw new ConflictException('Report device must be online');
      if (this.maintenanceService?.isDeviceOccupied(tenantId, dto.deviceId)) throw new ConflictException('Report device is occupied by maintenance work');
    }
    const goodQty = dto.goodQty ?? dto.quantity;
    const defectQty = dto.defectQty ?? dto.quantity - goodQty;
    if (goodQty < 0 || defectQty < 0 || goodQty > dto.quantity || defectQty > dto.quantity || goodQty + defectQty !== dto.quantity) throw new ConflictException('Production quantities are invalid');
    const serialNumbers = dto.serialNumbers ?? [];
    if (serialNumbers.length && serialNumbers.length !== dto.quantity) throw new ConflictException('serialNumbers count must equal quantity');
    if (new Set(serialNumbers).size !== serialNumbers.length) throw new ConflictException('serialNumbers must be unique');
    const existingSerialNumbers = new Set(this.reports.filter((item) => item.tenantId === tenantId && item.workOrderId === id).flatMap((item) => item.serialNumbers));
    if (serialNumbers.some((serialNumber) => existingSerialNumbers.has(serialNumber))) throw new ConflictException('serialNumbers already reported for work order');
    const materialConsumptions = (dto.materialConsumptions ?? []).map((item) => ({ ...item, materialCode: item.materialCode.trim(), batchNo: item.batchNo.trim(), unit: item.unit?.trim() }));
    if (materialConsumptions.some((item) => !item.materialCode || !item.batchNo || typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) || item.quantity <= 0)) throw new ConflictException('material consumptions must have positive quantities, material codes and batch numbers');
    if (dto.operationCode && this.masterDataService) this.masterDataService.validateOperation(tenantId, current.routingId, dto.operationCode.trim());
    const report: WorkOrderReport = {
      id: createId('report'), workOrderId: id, tenantId, quantity: dto.quantity, goodQty, defectQty,
      deviceId: dto.deviceId ?? null, sourceTraceId: reportTraceId, reportedAt: timestamp(), batchNo: dto.batchNo?.trim() || null,
      serialNumbers, operationCode: dto.operationCode?.trim() || null, operatorId: dto.operatorId?.trim() || null,
      qualityRecordId: dto.qualityRecordId?.trim() || null, materialConsumptions,
    };
    const completedQty = current.completedQty + dto.quantity;
    const workOrder: WorkOrder = { ...current, completedQty, status: completedQty === current.plannedQty ? 'completed' : current.status, updatedAt: timestamp() };
    const commit = await this.persistence.saveReportTransaction(report, workOrder, materialConsumptions, dto.qualityRecordId?.trim());
    if (!commit.created) {
      const persisted = commit.existing;
      if (!persisted || persisted.workOrderId !== id) throw new ConflictException(`Report trace ${reportTraceId} belongs to another work order`);
      const restored: WorkOrderReport = { ...persisted, batchNo: persisted.batchNo ?? null, serialNumbers: persisted.serialNumbers ?? [], operationCode: persisted.operationCode ?? null, operatorId: persisted.operatorId ?? null, qualityRecordId: persisted.qualityRecordId ?? null, materialConsumptions: persisted.materialConsumptions ?? [] };
      if (!this.reports.some((item) => item.id === restored.id)) this.reports.push(restored);
      this.workOrders.set(id, workOrder);
      return { workOrder, report: restored };
    }
    this.reports.push(report);
    this.workOrders.set(id, workOrder);
    this.masterDataService?.consumeBatchesWithRollback(tenantId, materialConsumptions, reportTraceId, actorId, false, false);
    if (workOrder.orderId) this.syncOrderProgress(tenantId, workOrder.orderId);
    this.auditService?.record(tenantId, dto.operatorId?.trim() || actorId.trim() || 'system', { action: 'work_order.report', resource: 'work_order', resourceId: id, details: { reportId: report.id, quantity: report.quantity, sourceTraceId: report.sourceTraceId }, traceId: report.sourceTraceId });
    return { workOrder, report };
  }

  async completeReport(tenantId: string, id: string, dto: ReportWorkOrderDto, actorId = 'system'): Promise<{ workOrder: WorkOrder; report: WorkOrderReport }> {
    const atomicPersistence = this.persistence?.isEnabled?.() === true;
    if (process.env.DATABASE_REQUIRED === 'true' && !atomicPersistence) throw new ConflictException('complete-report requires a shared PostgreSQL transaction; request rejected');
    if (atomicPersistence && !this.persistence?.saveCompleteReport) throw new ConflictException('shared PostgreSQL transaction for complete-report is unavailable');
    const requestedTraceId = dto.sourceTraceId?.trim();
    if (requestedTraceId) {
      const existing = this.reports.find((item) => item.tenantId === tenantId && item.sourceTraceId === requestedTraceId);
      if (existing) {
        if (existing.workOrderId !== id) throw new ConflictException(`Report trace ${requestedTraceId} belongs to another work order`);
        return { workOrder: this.findOne(tenantId, id), report: existing };
      }
    }
    if (!this.qualityService || !this.masterDataService || !dto.qualityRecordId?.trim()) {
      throw new ConflictException('complete-report requires quality and inventory validation services');
    }
    if (!dto.materialConsumptions?.length) {
      throw new ConflictException('complete-report requires material consumptions');
    }
    const finishedBatchNo = dto.batchNo?.trim();
    if (!finishedBatchNo) throw new ConflictException('complete-report requires a finished-product batchNo');
    const qualityLookup = this.qualityService as unknown as { findOne?: (tenantId: string, id: string) => { batchNo: string } } | undefined;
    const qualityRecord = qualityLookup?.findOne?.(tenantId, dto.qualityRecordId.trim());
    if (qualityRecord && qualityRecord.batchNo !== finishedBatchNo) {
      throw new ConflictException('Quality record batchNo must match finished-product batchNo');
    }
    const current = this.findOne(tenantId, id);
    if (current.completedQty + dto.quantity !== current.plannedQty) {
      throw new ConflictException('complete-report must report the remaining planned quantity');
    }
    if (!atomicPersistence) return this.report(tenantId, id, dto, actorId, true);
    const reportTraceId = dto.sourceTraceId?.trim() || createId('trace');
    if (this.qualityService && !this.qualityService.canReportWorkOrder(tenantId, id, dto.qualityRecordId!.trim(), reportTraceId)) {
      throw new ConflictException('Quality release is required before reporting production');
    }
    if (current.status !== 'in_progress') throw new ConflictException('Only in-progress work orders can report production');
    if (current.completedQty + dto.quantity !== current.plannedQty) throw new ConflictException('Completion quantity changed concurrently');
    if (this.reports.some((item) => item.tenantId === tenantId && item.sourceTraceId === reportTraceId)) throw new ConflictException(`Report trace ${reportTraceId} already exists`);
    if (dto.deviceId && this.devicesService) {
      const device = this.devicesService.findOne(tenantId, dto.deviceId);
      if (device.lineId !== current.lineId) throw new ConflictException('Report device must belong to work order line');
      if (device.status !== 'online') throw new ConflictException('Report device must be online');
      if (this.maintenanceService?.isDeviceOccupied(tenantId, dto.deviceId)) throw new ConflictException('Report device is occupied by maintenance work');
    }
    const goodQty = dto.goodQty ?? dto.quantity;
    const defectQty = dto.defectQty ?? dto.quantity - goodQty;
    if (goodQty < 0 || defectQty < 0 || goodQty > dto.quantity || defectQty > dto.quantity || goodQty + defectQty !== dto.quantity) throw new ConflictException('Production quantities are invalid');
    const serialNumbers = dto.serialNumbers ?? [];
    if (serialNumbers.length && serialNumbers.length !== dto.quantity) throw new ConflictException('serialNumbers count must equal quantity');
    if (new Set(serialNumbers).size !== serialNumbers.length) throw new ConflictException('serialNumbers must be unique');
    const materialConsumptions = (dto.materialConsumptions ?? []).map((item) => ({
      ...item,
      materialCode: item.materialCode.trim(),
      batchNo: item.batchNo.trim(),
      unit: item.unit?.trim(),
    }));
    if (materialConsumptions.some((item) => !item.materialCode?.trim() || !item.batchNo?.trim() || typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) || item.quantity <= 0)) throw new ConflictException('material consumptions must have positive quantities, material codes and batch numbers');
    if (dto.operationCode && this.masterDataService) this.masterDataService.validateOperation(tenantId, current.routingId, dto.operationCode.trim());
    const report: WorkOrderReport = {
      id: createId('report'), workOrderId: id, tenantId, quantity: dto.quantity,
      goodQty, defectQty, deviceId: dto.deviceId ?? null, sourceTraceId: reportTraceId, reportedAt: timestamp(),
      batchNo: dto.batchNo?.trim() || null, serialNumbers,
      operationCode: dto.operationCode?.trim() || null, operatorId: dto.operatorId?.trim() || null,
      qualityRecordId: dto.qualityRecordId?.trim() || null, materialConsumptions,
    };
    const workOrder: WorkOrder = { ...current, completedQty: current.plannedQty, status: 'completed', updatedAt: timestamp() };
    const commit = await this.persistence.saveCompleteReport(report, workOrder, materialConsumptions, dto.qualityRecordId.trim());
    if (!commit.created) {
      const existing = commit.existing;
      if (!existing || existing.workOrderId !== id) throw new ConflictException(`Report trace ${reportTraceId} belongs to another work order`);
      const restored: WorkOrderReport = {
        ...existing,
        batchNo: existing.batchNo ?? null,
        serialNumbers: existing.serialNumbers ?? [],
        operationCode: existing.operationCode ?? null,
        operatorId: existing.operatorId ?? null,
        qualityRecordId: existing.qualityRecordId ?? null,
        materialConsumptions: existing.materialConsumptions ?? [],
      };
      if (!this.reports.some((item) => item.id === restored.id)) this.reports.push(restored);
      this.workOrders.set(id, workOrder);
      return { workOrder, report: restored };
    }
    this.reports.push(report);
    this.workOrders.set(id, workOrder);
    this.masterDataService?.consumeBatchesWithRollback(tenantId, materialConsumptions, reportTraceId, actorId, false, false);
    if (workOrder.orderId) this.syncOrderProgress(tenantId, workOrder.orderId);
    this.auditService?.record(tenantId, dto.operatorId?.trim() || actorId.trim() || 'system', {
      action: 'work_order.complete_report', resource: 'work_order', resourceId: id,
      details: { reportId: report.id, quantity: report.quantity, sourceTraceId: report.sourceTraceId }, traceId: report.sourceTraceId,
    });
    return { workOrder, report };
  }

  /** Records a fully traceable production event without changing the legacy report contract. */
  reportTrace(tenantId: string, id: string, dto: ReportWorkOrderDto, actorId = 'system'): { workOrder: WorkOrder; report: WorkOrderReport } {
    if (!dto.batchNo?.trim() || !dto.operationCode?.trim() || !dto.deviceId?.trim()) {
      throw new ConflictException('Traceable report requires batchNo, operationCode and deviceId');
    }
    return this.report(tenantId, id, dto, actorId);
  }

  async recordTraceableReport(tenantId: string, id: string, dto: ReportWorkOrderDto, actorId = 'system'): Promise<{ workOrder: WorkOrder; report: WorkOrderReport }> {
    if (!dto.batchNo?.trim() || !dto.operationCode?.trim() || !dto.deviceId?.trim()) throw new ConflictException('Traceable report requires batchNo, operationCode and deviceId');
    return this.recordReport(tenantId, id, dto, actorId);
  }

  executionSummary(tenantId: string, id: string) {
    const workOrder = this.findOne(tenantId, id);
    const reports = this.findReports(tenantId, id);
    const materialTotals = new Map<string, { materialCode: string; batchNo: string; quantity: number }>();
    reports.flatMap((report) => report.materialConsumptions).forEach((item) => {
      const key = `${item.materialCode}:${item.batchNo}`;
      const current = materialTotals.get(key) ?? { materialCode: item.materialCode, batchNo: item.batchNo, quantity: 0 };
      materialTotals.set(key, { ...current, quantity: current.quantity + item.quantity });
    });
    const deviceIds = [...new Set(reports.map((report) => report.deviceId).filter((value): value is string => Boolean(value)))];
    const qualityRecordIds = [...new Set(reports.map((report) => report.qualityRecordId).filter((value): value is string => Boolean(value)))];
    const operationEvents: OperationEventTrace[] = reports
      .filter((report): report is WorkOrderReport & { operationCode: string; deviceId: string; batchNo: string } => Boolean(report.operationCode && report.deviceId && report.batchNo))
      .map((report) => ({
        reportId: report.id, operationCode: report.operationCode, deviceId: report.deviceId,
        batchNo: report.batchNo, quantity: report.quantity, goodQty: report.goodQty,
        defectQty: report.defectQty, reportedAt: report.reportedAt,
      }));
    const finishedProducts: FinishedProductTrace[] = [...new Set(reports.map((report) => report.batchNo).filter((value): value is string => Boolean(value)))].map((batchNo) => {
      const batchReports = reports.filter((report) => report.batchNo === batchNo);
      return {
        batchNo,
        serialNumbers: [...new Set(batchReports.flatMap((report) => report.serialNumbers))],
        quantity: batchReports.reduce((total, report) => total + report.quantity, 0),
        goodQty: batchReports.reduce((total, report) => total + report.goodQty, 0),
        defectQty: batchReports.reduce((total, report) => total + report.defectQty, 0),
      };
    });
    return {
      workOrderId: workOrder.id,
      operations: [...new Set(reports.map((report) => report.operationCode).filter((value): value is string => Boolean(value)))],
      devices: deviceIds,
      qualityRecordIds,
      finishedBatches: [...new Set(reports.map((report) => report.batchNo).filter((value): value is string => Boolean(value)))],
      serialNumbers: [...new Set(reports.flatMap((report) => report.serialNumbers))],
      materialConsumptions: [...materialTotals.values()],
      operationEvents,
      finishedProducts,
      reports: reports.length,
    };
  }

  findReports(tenantId: string, workOrderId: string): WorkOrderReport[] {
    this.findOne(tenantId, workOrderId);
    return this.reports.filter((report) => report.tenantId === tenantId && report.workOrderId === workOrderId);
  }

  /** Searches the complete report-based trace graph while enforcing tenant isolation. */
  searchTraceability(tenantId: string, query: TraceabilityQuery): {
    total: number;
    reports: Array<{ workOrder: WorkOrder; report: WorkOrderReport }>;
  } {
    const normalized = Object.fromEntries(
      Object.entries(query).map(([key, value]) => [key, value?.trim()]),
    ) as TraceabilityQuery;
    if (normalized.workOrderId) this.findOne(tenantId, normalized.workOrderId);

    const reports = this.reports
      .filter((report) => report.tenantId === tenantId)
      .filter((report) => !normalized.workOrderId || report.workOrderId === normalized.workOrderId)
      .filter((report) => !normalized.batchNo || report.batchNo === normalized.batchNo)
      .filter((report) => !normalized.serialNumber || report.serialNumbers.includes(normalized.serialNumber))
      .filter((report) => !normalized.materialBatchNo || report.materialConsumptions.some((item) => item.batchNo === normalized.materialBatchNo))
      .filter((report) => !normalized.operationCode || report.operationCode === normalized.operationCode)
      .filter((report) => !normalized.deviceId || report.deviceId === normalized.deviceId)
      .filter((report) => !normalized.sourceTraceId || report.sourceTraceId === normalized.sourceTraceId);

    return {
      total: reports.length,
      reports: reports.map((report) => ({ workOrder: this.findOne(tenantId, report.workOrderId), report })),
    };
  }

  private updateProgress(current: WorkOrder, completedQty: number, persist = true): WorkOrder {
    const updated = { ...current, completedQty, status: completedQty === current.plannedQty ? 'completed' : current.status, updatedAt: timestamp() };
    this.workOrders.set(current.id, updated);
    if (persist) void this.persistence?.saveWorkOrder(updated);
    return updated;
  }

  private syncOrderProgress(tenantId: string, orderId: string): void {
    const completedQty = this.findAll(tenantId)
      .filter((item) => item.orderId === orderId)
      .reduce((total, item) => total + item.completedQty, 0);
    this.ordersService.recordProgress(tenantId, orderId, completedQty);
  }

  updateStatus(tenantId: string, id: string, dto: UpdateWorkOrderStatusDto, actorId = 'system', persist = true): WorkOrder {
    const current = this.findOne(tenantId, id);
    if (!allowedTransitions[current.status].includes(dto.status)) {
      throw new ConflictException(`Cannot change work order from ${current.status} to ${dto.status}`);
    }
    if ((dto.status === 'paused' || dto.status === 'cancelled') && !dto.reason?.trim()) {
      throw new ConflictException(`A reason is required when work order is ${dto.status}`);
    }
    if (dto.status === 'in_progress' && this.productionLinesService.findOne(tenantId, current.lineId).status !== 'active') {
      throw new ConflictException('Work order can start only on an active production line');
    }
    if (dto.status === 'completed' && current.completedQty !== current.plannedQty) {
      throw new ConflictException('Work order can be completed only after planned quantity is reported');
    }
    if (dto.status === 'completed' && this.qualityService && !this.qualityService.canCompleteWorkOrder(tenantId, id)) {
      throw new ConflictException('Quality release is required before work order completion');
    }

    const updated: WorkOrder = {
      ...current,
      status: dto.status,
      statusReason: dto.reason ?? '',
      updatedAt: timestamp(),
    };
    this.workOrders.set(id, updated);
    if (persist) void this.persistence?.saveWorkOrder(updated);
    this.auditService?.record(tenantId, actorId.trim() || 'system', { action: 'work_order.status', resource: 'work_order', resourceId: id, details: { from: current.status, to: updated.status, reason: updated.statusReason } });
    return updated;
  }

  /** Waits for durable persistence before acknowledging a work-order transition. */
  async updateStatusReliable(tenantId: string, id: string, dto: UpdateWorkOrderStatusDto, actorId = 'system'): Promise<WorkOrder> {
    const current = this.findOne(tenantId, id);
    const updated = this.updateStatus(tenantId, id, dto, actorId, false);
    try {
      await this.persistence?.saveWorkOrder(updated);
      return updated;
    } catch (error: unknown) {
      this.workOrders.set(id, current);
      throw error;
    }
  }

  remove(tenantId: string, id: string, actorId = 'system'): { id: string; deleted: true } {
    const workOrder = this.findOne(tenantId, id);
    if (workOrder.status === 'in_progress') {
      throw new ConflictException('In-progress work orders cannot be deleted');
    }
    if (this.reports.some((report) => report.tenantId === tenantId && report.workOrderId === id)) {
      throw new ConflictException('Work orders with production reports cannot be deleted');
    }

    this.workOrders.delete(id);
    void this.persistence?.deleteWorkOrder(id);
    this.productionLinesService.unregisterWorkOrder(tenantId, workOrder.lineId);
    this.auditService?.record(tenantId, actorId.trim() || 'system', {
      action: 'work_order.deleted',
      resource: 'work_order',
      resourceId: id,
      before: workOrder as unknown as Record<string, unknown>,
      details: { orderNo: workOrder.orderNo, lineId: workOrder.lineId },
    });
    return { id, deleted: true };
  }
}
