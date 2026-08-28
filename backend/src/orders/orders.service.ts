import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createId, MockEntity, timestamp } from '../common/mock.types';
import { CreateOrderDto } from './dto/create-order.dto';

export interface ProductionOrder extends MockEntity {
  orderNo: string;
  productCode: string;
  productName: string;
  plannedQty: number;
  completedQty: number;
  dueAt: string;
  priority: CreateOrderDto['priority'];
  status: 'planned' | 'in_progress' | 'completed' | 'cancelled';
}

@Injectable()
export class OrdersService {
  private readonly orders = new Map<string, ProductionOrder>([
    ['order-demo-001', {
      id: 'order-demo-001', tenantId: 'tenant-demo', orderNo: 'PO20260828001',
      productCode: 'PART-1001', productName: '精密连接座', plannedQty: 1200,
      completedQty: 780, dueAt: '2026-08-28T18:00:00.000Z', priority: 'high',
      status: 'in_progress', createdAt: '2026-08-28T00:00:00.000Z', updatedAt: '2026-08-28T08:00:00.000Z',
    }],
  ]);

  findAll(tenantId: string): ProductionOrder[] {
    return [...this.orders.values()].filter((order) => order.tenantId === tenantId);
  }

  findOne(tenantId: string, id: string): ProductionOrder {
    const order = this.orders.get(id);
    if (!order || order.tenantId !== tenantId) throw new NotFoundException(`Order ${id} not found`);
    return order;
  }

  create(tenantId: string, dto: CreateOrderDto): ProductionOrder {
    if (this.findAll(tenantId).some((order) => order.orderNo === dto.orderNo)) {
      throw new ConflictException(`Order ${dto.orderNo} already exists`);
    }
    const now = timestamp();
    const order: ProductionOrder = {
      id: createId('order'), tenantId, orderNo: dto.orderNo, productCode: dto.productCode,
      productName: dto.productName, plannedQty: dto.plannedQty, completedQty: 0,
      dueAt: dto.dueAt, priority: dto.priority, status: 'planned', createdAt: now, updatedAt: now,
    };
    this.orders.set(order.id, order);
    return order;
  }

  recordProgress(tenantId: string, id: string, completedQty: number): ProductionOrder {
    const order = this.findOne(tenantId, id);
    const nextQty = Math.min(order.plannedQty, Math.max(order.completedQty, completedQty));
    const status: ProductionOrder['status'] = nextQty === order.plannedQty ? 'completed' : 'in_progress';
    const updated: ProductionOrder = { ...order, completedQty: nextQty, status, updatedAt: timestamp() };
    this.orders.set(id, updated);
    return updated;
  }
}
