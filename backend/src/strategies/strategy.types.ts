export type RiskLevel = 'low' | 'medium' | 'high';
export type StrategyAction =
  | 'transfer_work_order'
  | 'rebalance_line'
  | 'reschedule_material'
  | 'schedule_recovery'
  | 'expedite_work_order';

export interface StrategyDevice {
  id: string;
  lineId: string;
  status: 'online' | 'offline' | 'maintenance' | 'alarm';
  capacityPerHour: number;
}

export interface StrategyLine {
  id: string;
  name: string;
  capacityPerHour: number;
  active: boolean;
}

export interface StrategyWorkOrder {
  id: string;
  lineId: string;
  remainingQty: number;
  dueAt: string;
  priority: number;
  status: 'released' | 'running' | 'paused';
}

export interface StrategySnapshot {
  timestamp: string;
  lines: StrategyLine[];
  devices: StrategyDevice[];
  workOrders: StrategyWorkOrder[];
  materialShortages?: Array<{ materialCode: string; affectedWorkOrderIds: string[] }>;
}

export interface StrategyEvidence {
  type: 'device_fault' | 'line_load' | 'material_shortage' | 'due_risk' | 'maintenance';
  message: string;
  resourceIds: string[];
}

export interface StrategyCandidate {
  id: string;
  action: StrategyAction;
  risk: RiskLevel;
  affectedOrders: string[];
  fromLine?: string;
  toLine?: string;
  expectedFinishTime: string;
  expectedImpact: string;
  reason: string;
  requiresApproval: true;
  score: number;
}

export interface StrategySimulationResult {
  simulationId: string;
  generatedAt: string;
  risks: Array<{ level: RiskLevel; message: string; evidence: StrategyEvidence[] }>;
  candidates: StrategyCandidate[];
  recommended: StrategyCandidate | null;
}
