export type StrategyLineStatus = "RUNNING" | "WARNING" | "STOPPED" | "MAINTENANCE" | "OFFLINE";

export type StrategyOrderStatus = "PLANNED" | "TRANSFERRED" | "AT_RISK" | "BLOCKED";

export type StrategyRisk = "LOW" | "MEDIUM" | "HIGH";

export interface StrategyLineInput {
  lineId: string;
  name: string;
  supportedProducts: string[];
  capacityUnitsPerHour: number;
  currentLoadUnits?: number;
  status?: StrategyLineStatus;
  deviceIds?: string[];
  failedDeviceIds?: string[];
  recoveryAt?: string;
}

export interface StrategyOrderInput {
  orderId: string;
  product: string;
  quantity: number;
  completedQuantity?: number;
  preferredLineId?: string;
  dueAt: string;
  materialRequirements?: Record<string, number>;
}

export interface StrategySimulationInput {
  asOf: string;
  horizonHours: number;
  lines: StrategyLineInput[];
  orders: StrategyOrderInput[];
  materialInventory?: Record<string, number>;
}

export interface StrategyOrderPlan {
  orderId: string;
  status: StrategyOrderStatus;
  originalLineId?: string;
  assignedLineId?: string;
  plannedQuantity: number;
  expectedCompletionAt: string | null;
  delayRisk: StrategyRisk;
  affected: boolean;
  reason: string;
}

export interface StrategyLineLoad {
  lineId: string;
  name: string;
  status: StrategyLineStatus;
  assignedOrderIds: string[];
  assignedUnits: number;
  existingLoadUnits: number;
  availableCapacityUnits: number;
  loadRatio: number;
  availableAt: string | null;
}

export type StrategyRecommendationType =
  | "FAILOVER_TRANSFER"
  | "LOAD_BALANCE"
  | "MATERIAL_SHORTAGE"
  | "MAINTENANCE_RECOVERY"
  | "DELAY_MITIGATION";

export interface StrategyRecommendation {
  type: StrategyRecommendationType;
  reason: string;
  affectedOrderIds: string[];
  targetLineId?: string;
  requiresApproval: true;
}

export interface StrategySimulationResult {
  mode: "READ_ONLY";
  executionAllowed: false;
  asOf: string;
  expectedCompletionAt: string | null;
  delayRisk: StrategyRisk;
  affectedOrders: StrategyOrderPlan[];
  orderPlans: StrategyOrderPlan[];
  lineLoads: StrategyLineLoad[];
  recommendations: StrategyRecommendation[];
}
