import { StrategySnapshot, StrategyWorkOrder } from './strategy.types';

/** Read-only projection of the ERPNext Work Order fields consumed by strategies. */
export interface ErpNextWorkOrder {
  name: string;
  production_item: string;
  qty: number;
  produced_qty: number;
  planned_end_date: string;
  priority?: 'Low' | 'Medium' | 'High' | 'Urgent' | number;
  status: 'Draft' | 'Not Started' | 'In Process' | 'Stopped' | 'Completed' | 'Cancelled';
  custom_production_line?: string;
  production_line?: string;
}

/**
 * Maps ERPNext work orders only; product compatibility and scheduling remain
 * responsibilities of the strategy engine. No ERPNext write/status endpoint
 * is called by this adapter.
 */
export function mapErpNextWorkOrders(source: ErpNextWorkOrder[]): StrategyWorkOrder[] {
  if (!Array.isArray(source)) throw new Error('ERPNext work orders must be an array');
  const ids = new Set<string>();
  return source.map((order) => {
    validateOrder(order);
    if (ids.has(order.name)) throw new Error(`duplicate ERPNext work order: ${order.name}`);
    ids.add(order.name);
    return {
      id: order.name,
      lineId: order.custom_production_line ?? order.production_line!,
      remainingQty: order.qty - order.produced_qty,
      dueAt: order.planned_end_date,
      priority: mapPriority(order.priority),
      status: mapStatus(order.status),
    };
  });
}

export function mergeErpNextWorkOrders(snapshot: StrategySnapshot, source: ErpNextWorkOrder[]): StrategySnapshot {
  const workOrders = mapErpNextWorkOrders(source);
  const merged = { ...snapshot, workOrders: workOrders.map((order) => ({ ...order })) };
  return {
    ...merged,
    lines: snapshot.lines.map((line) => ({ ...line })),
    devices: snapshot.devices.map((device) => ({ ...device })),
  };
}

function validateOrder(order: ErpNextWorkOrder): void {
  const lineId = order.custom_production_line ?? order.production_line;
  if (!order.name?.trim() || !order.production_item?.trim() || !lineId?.trim()) throw new Error(`invalid ERPNext work order: ${order.name}`);
  if (!Number.isFinite(order.qty) || !Number.isFinite(order.produced_qty) || order.qty < 0 || order.produced_qty < 0 || order.produced_qty > order.qty) {
    throw new Error(`invalid ERPNext work order quantities: ${order.name}`);
  }
  if (Number.isNaN(Date.parse(order.planned_end_date))) throw new Error(`invalid ERPNext work order due date: ${order.name}`);
}

function mapPriority(priority: ErpNextWorkOrder['priority']): number {
  if (typeof priority === 'number') return Number.isFinite(priority) && priority >= 0 ? priority : 0;
  return priority === 'Urgent' ? 4 : priority === 'High' ? 3 : priority === 'Medium' ? 2 : 1;
}

function mapStatus(status: ErpNextWorkOrder['status']): StrategyWorkOrder['status'] {
  if (status === 'In Process') return 'running';
  if (status === 'Stopped' || status === 'Completed' || status === 'Cancelled') return 'paused';
  return 'released';
}
