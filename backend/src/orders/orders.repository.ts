import { CreateOrderDto } from './dto/create-order.dto';
import { ProductionOrder } from './orders.service';

/**
 * Persistence port for production orders.
 *
 * The current OrdersService remains the memory-backed implementation. A
 * Prisma adapter can implement this port without changing controllers or DTOs.
 */
export interface OrdersRepository {
  findAll(tenantId: string): Promise<ProductionOrder[]> | ProductionOrder[];
  findOne(tenantId: string, id: string): Promise<ProductionOrder> | ProductionOrder;
  create(tenantId: string, dto: CreateOrderDto): Promise<ProductionOrder> | ProductionOrder;
  recordProgress(tenantId: string, id: string, completedQty: number): Promise<ProductionOrder> | ProductionOrder;
}
