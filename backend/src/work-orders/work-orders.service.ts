import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createId, MockEntity, timestamp } from '../common/mock.types';
import { CreateWorkOrderDto } from './dto/create-work-order.dto';
import { UpdateWorkOrderStatusDto } from './dto/update-work-order-status.dto';
import { UpdateWorkOrderDto } from './dto/update-work-order.dto';

type WorkOrderStatus = 'draft' | 'released' | 'in_progress' | 'paused' | 'completed' | 'cancelled';
type WorkOrderPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface WorkOrder extends MockEntity {
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

const allowedTransitions: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  draft: ['released', 'cancelled'],
  released: ['in_progress', 'paused', 'cancelled'],
  in_progress: ['paused', 'completed', 'cancelled'],
  paused: ['released', 'in_progress', 'cancelled'],
  completed: [],
  cancelled: [],
};

@Injectable()
export class WorkOrdersService {
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

  create(tenantId: string, dto: CreateWorkOrderDto): WorkOrder {
    const duplicate = this.findAll(tenantId).some((order) => order.orderNo === dto.orderNo);
    if (duplicate) {
      throw new ConflictException(`Work order ${dto.orderNo} already exists`);
    }

    const now = timestamp();
    const workOrder: WorkOrder = {
      id: createId('wo'),
      tenantId,
      orderNo: dto.orderNo,
      productCode: dto.productCode,
      productName: dto.productName,
      lineId: dto.lineId,
      plannedQty: dto.plannedQty,
      completedQty: dto.completedQty ?? 0,
      dueAt: dto.dueAt,
      priority: dto.priority ?? 'normal',
      status: 'draft',
      statusReason: '',
      createdAt: now,
      updatedAt: now,
    };
    this.workOrders.set(workOrder.id, workOrder);
    return workOrder;
  }

  update(tenantId: string, id: string, dto: UpdateWorkOrderDto): WorkOrder {
    const current = this.findOne(tenantId, id);
    const plannedQty = dto.plannedQty ?? current.plannedQty;
    const completedQty = dto.completedQty ?? current.completedQty;
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
    this.workOrders.set(id, updated);
    return updated;
  }

  updateStatus(tenantId: string, id: string, dto: UpdateWorkOrderStatusDto): WorkOrder {
    const current = this.findOne(tenantId, id);
    if (!allowedTransitions[current.status].includes(dto.status)) {
      throw new ConflictException(`Cannot change work order from ${current.status} to ${dto.status}`);
    }

    const updated: WorkOrder = {
      ...current,
      status: dto.status,
      statusReason: dto.reason ?? '',
      updatedAt: timestamp(),
    };
    this.workOrders.set(id, updated);
    return updated;
  }

  remove(tenantId: string, id: string): { id: string; deleted: true } {
    const workOrder = this.findOne(tenantId, id);
    if (workOrder.status === 'in_progress') {
      throw new ConflictException('In-progress work orders cannot be deleted');
    }

    this.workOrders.delete(id);
    return { id, deleted: true };
  }
}
