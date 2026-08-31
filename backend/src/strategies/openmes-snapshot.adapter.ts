import { StrategyDevice, StrategyLine, StrategySnapshot, StrategyWorkOrder } from './strategy.types';

/**
 * Minimal read-only boundary for an external OpenMES-style snapshot.
 * The adapter intentionally accepts transport data only and exposes no write
 * operation or command mapping.
 */
export interface OpenMesSnapshotPayload {
  factoryId: string;
  timestamp: string;
  lines: OpenMesLine[];
  devices: OpenMesDevice[];
  workOrders: OpenMesWorkOrder[];
  materialShortages?: OpenMesMaterialShortage[];
}

export interface OpenMesLine {
  id: string;
  name: string;
  capacityPerHour: number;
  status: 'RUNNING' | 'ACTIVE' | 'WARNING' | 'STOPPED' | 'OFFLINE' | 'MAINTENANCE';
}

export interface OpenMesDevice {
  id: string;
  lineId: string;
  status: 'RUNNING' | 'IDLE' | 'WARNING' | 'STOPPED' | 'FAULT' | 'OFFLINE' | 'MAINTENANCE';
  capacityPerHour: number;
}

export interface OpenMesWorkOrder {
  id: string;
  lineId: string;
  plannedQty: number;
  completedQty: number;
  dueAt: string;
  priority: number;
  status: 'RELEASED' | 'CREATED' | 'RUNNING' | 'IN_PROGRESS' | 'PAUSED' | 'HOLD';
}

export interface OpenMesMaterialShortage {
  materialCode: string;
  affectedWorkOrderIds: string[];
}

export function mapOpenMesSnapshot(source: OpenMesSnapshotPayload): StrategySnapshot {
  validateSource(source);
  const lines: StrategyLine[] = source.lines.map((line) => ({
    id: line.id,
    name: line.name,
    capacityPerHour: line.capacityPerHour,
    active: line.status !== 'STOPPED' && line.status !== 'OFFLINE',
  }));
  const devices: StrategyDevice[] = source.devices.map((device) => ({
    id: device.id,
    lineId: device.lineId,
    status: mapDeviceStatus(device.status),
    capacityPerHour: device.capacityPerHour,
  }));
  const workOrders: StrategyWorkOrder[] = source.workOrders.map((order) => ({
    id: order.id,
    lineId: order.lineId,
    remainingQty: order.plannedQty - order.completedQty,
    dueAt: order.dueAt,
    priority: order.priority,
    status: mapWorkOrderStatus(order.status),
  }));
  return {
    factoryId: source.factoryId,
    timestamp: source.timestamp,
    lines,
    devices,
    workOrders,
    materialShortages: source.materialShortages?.map((shortage) => ({
      materialCode: shortage.materialCode,
      affectedWorkOrderIds: [...shortage.affectedWorkOrderIds],
    })),
  };
}

function validateSource(source: OpenMesSnapshotPayload): void {
  if (!source || !source.factoryId?.trim()) throw new Error('OpenMES snapshot requires factoryId');
  if (Number.isNaN(Date.parse(source.timestamp))) throw new Error('OpenMES snapshot timestamp must be valid');
  if (!Array.isArray(source.lines) || source.lines.length === 0) throw new Error('OpenMES snapshot requires lines');
  if (!Array.isArray(source.devices) || !Array.isArray(source.workOrders)) throw new Error('OpenMES snapshot requires devices and workOrders');
  const lineIds = new Set<string>();
  source.lines.forEach((line) => {
    if (!line.id || lineIds.has(line.id) || !Number.isFinite(line.capacityPerHour) || line.capacityPerHour < 0) {
      throw new Error(`invalid OpenMES line: ${line.id}`);
    }
    lineIds.add(line.id);
  });
  source.devices.forEach((device) => {
    if (!device.id || !lineIds.has(device.lineId) || !Number.isFinite(device.capacityPerHour) || device.capacityPerHour < 0) {
      throw new Error(`invalid OpenMES device: ${device.id}`);
    }
  });
  source.workOrders.forEach((order) => {
    if (!order.id || !lineIds.has(order.lineId) || !Number.isFinite(order.plannedQty) || !Number.isFinite(order.completedQty)
      || order.completedQty < 0 || order.completedQty > order.plannedQty || Number.isNaN(Date.parse(order.dueAt))) {
      throw new Error(`invalid OpenMES work order: ${order.id}`);
    }
  });
}

function mapDeviceStatus(status: OpenMesDevice['status']): StrategyDevice['status'] {
  if (status === 'FAULT') return 'alarm';
  if (status === 'MAINTENANCE') return 'maintenance';
  if (status === 'OFFLINE') return 'offline';
  return 'online';
}

function mapWorkOrderStatus(status: OpenMesWorkOrder['status']): StrategyWorkOrder['status'] {
  if (status === 'RUNNING' || status === 'IN_PROGRESS') return 'running';
  if (status === 'PAUSED' || status === 'HOLD') return 'paused';
  return 'released';
}
