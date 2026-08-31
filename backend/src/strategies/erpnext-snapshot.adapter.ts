import { StrategyDevice, StrategyLine, StrategySnapshot, StrategyWorkOrder } from './strategy.types';

/** Read-only ERPNext/Manufacturing snapshot used by the strategy boundary. */
export interface ErpNextSnapshotPayload {
  company: string;
  asOf: string;
  workstations: ErpNextWorkstation[];
  machines: ErpNextMachine[];
  workOrders: ErpNextWorkOrder[];
  materialShortages?: Array<{ materialCode: string; affectedWorkOrderIds: string[] }>;
}

export interface ErpNextWorkstation {
  name: string;
  workstationName: string;
  productionCapacity: number;
  enabled: boolean;
}

export interface ErpNextMachine {
  name: string;
  workstation: string;
  status: 'Running' | 'Idle' | 'Stopped' | 'Down' | 'Maintenance';
  productionCapacity: number;
}

export interface ErpNextWorkOrder {
  name: string;
  workstation: string;
  qty: number;
  producedQty: number;
  plannedEndDate: string;
  priority: number;
  status: 'Not Started' | 'In Process' | 'Stopped' | 'Completed' | 'Cancelled';
}

/**
 * Maps an ERPNext read response into the strategy input contract.
 * No ERPNext write endpoint or control command is represented here.
 */
export function mapErpNextSnapshot(source: ErpNextSnapshotPayload): StrategySnapshot {
  validateSource(source);
  const lines: StrategyLine[] = source.workstations.map((line) => ({
    id: line.name,
    name: line.workstationName,
    capacityPerHour: line.productionCapacity,
    active: line.enabled,
  }));
  const devices: StrategyDevice[] = source.machines.map((machine) => ({
    id: machine.name,
    lineId: machine.workstation,
    status: mapMachineStatus(machine.status),
    capacityPerHour: machine.productionCapacity,
  }));
  const workOrders: StrategyWorkOrder[] = source.workOrders.map((order) => ({
    id: order.name,
    lineId: order.workstation,
    remainingQty: order.qty - order.producedQty,
    dueAt: order.plannedEndDate,
    priority: order.priority,
    status: mapWorkOrderStatus(order.status),
  }));
  return {
    factoryId: source.company,
    timestamp: source.asOf,
    lines,
    devices,
    workOrders,
    materialShortages: source.materialShortages?.map((shortage) => ({
      materialCode: shortage.materialCode,
      affectedWorkOrderIds: [...shortage.affectedWorkOrderIds],
    })),
  };
}

function validateSource(source: ErpNextSnapshotPayload): void {
  if (!source || !source.company?.trim()) throw new Error('ERPNext snapshot requires company');
  if (Number.isNaN(Date.parse(source.asOf))) throw new Error('ERPNext snapshot asOf must be valid');
  if (!Array.isArray(source.workstations) || source.workstations.length === 0) {
    throw new Error('ERPNext snapshot requires workstations');
  }
  if (!Array.isArray(source.machines) || !Array.isArray(source.workOrders)) {
    throw new Error('ERPNext snapshot requires machines and workOrders');
  }
  const workstationIds = new Set<string>();
  source.workstations.forEach((line) => {
    if (!line.name || workstationIds.has(line.name) || !Number.isFinite(line.productionCapacity) || line.productionCapacity < 0) {
      throw new Error(`invalid ERPNext workstation: ${line.name}`);
    }
    workstationIds.add(line.name);
  });
  source.machines.forEach((machine) => {
    if (!machine.name || !workstationIds.has(machine.workstation) || !Number.isFinite(machine.productionCapacity) || machine.productionCapacity < 0) {
      throw new Error(`invalid ERPNext machine: ${machine.name}`);
    }
  });
  source.workOrders.forEach((order) => {
    if (!order.name || !workstationIds.has(order.workstation) || !Number.isFinite(order.qty)
      || !Number.isFinite(order.producedQty) || order.qty < 0 || order.producedQty < 0
      || order.producedQty > order.qty || Number.isNaN(Date.parse(order.plannedEndDate))) {
      throw new Error(`invalid ERPNext work order: ${order.name}`);
    }
  });
}

function mapMachineStatus(status: ErpNextMachine['status']): StrategyDevice['status'] {
  if (status === 'Down') return 'alarm';
  if (status === 'Maintenance') return 'maintenance';
  if (status === 'Stopped') return 'offline';
  return 'online';
}

function mapWorkOrderStatus(status: ErpNextWorkOrder['status']): StrategyWorkOrder['status'] {
  if (status === 'In Process') return 'running';
  if (status === 'Stopped') return 'paused';
  return 'released';
}
