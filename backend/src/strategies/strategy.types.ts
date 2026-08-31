export type RiskLevel = 'low' | 'medium' | 'high';
export type StrategyAction =
  | 'transfer_work_order'
  | 'rebalance_line'
  | 'reschedule_material'
  | 'schedule_recovery'
  | 'expedite_work_order';
export type StrategyLifecycleStatus = 'pending_approval' | 'approved' | 'rejected' | 'revoked' | 'simulated_execution';

export type StrategyRole =
  | 'system_admin'
  | 'plant_manager'
  | 'production_supervisor'
  | 'equipment_supervisor'
  | 'quality_supervisor'
  | 'team_leader'
  | 'operator'
  | 'auditor';

export interface StrategyRequestContext {
  userId: string;
  role: StrategyRole;
  factoryId: string;
  scope: string[];
  sessionId: string;
  traceId: string;
}

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
  factoryId?: string;
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
  scoreBreakdown: StrategyScore;
  impactAssessment: StrategyImpactAssessment;
}

export interface StrategyScore {
  total: number;
  factors: {
    priority: number;
    urgency: number;
    risk: number;
    feasibility: number;
  };
}

export interface StrategyImpactAssessment {
  affectedOrders: string[];
  affectedLines: string[];
  affectedDevices: string[];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  summary: string;
  executionAllowed: false;
  rollbackPlan: StrategyRollbackPlan;
}

export interface StrategyRollbackPlan {
  supported: true;
  action: 'discard_simulation';
  status: 'available';
  restores: Array<'workOrders' | 'lines' | 'devices'>;
  executionAllowed: false;
  reason: string;
}

export interface StrategyRollbackState {
  supported: true;
  action: 'discard_simulation';
  status: 'available' | 'discarded';
  executionAllowed: false;
  discardedAt?: string;
  discardedBy?: string;
}

export interface StrategyAggregateImpactAssessment {
  affectedOrders: string[];
  affectedLines: string[];
  affectedDevices: string[];
  candidateCount: number;
  highRiskCandidateCount: number;
  executionAllowed: false;
}

export interface StrategySimulationResult {
  simulationId: string;
  strategyVersion: string;
  generatedAt: string;
  snapshot: StrategySnapshot;
  risks: Array<{ level: RiskLevel; message: string; evidence: StrategyEvidence[] }>;
  candidates: StrategyCandidate[];
  recommended: StrategyCandidate | null;
  requiresApproval: true;
  executionAllowed: false;
  impactAssessment: StrategyAggregateImpactAssessment;
}
