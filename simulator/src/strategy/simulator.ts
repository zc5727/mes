import {
  StrategyLineInput,
  StrategyLineLoad,
  StrategyLineStatus,
  StrategyOrderInput,
  StrategyOrderPlan,
  StrategyRecommendation,
  StrategyRisk,
  StrategySimulationInput,
  StrategySimulationResult,
} from "./types";

const HOUR_MS = 60 * 60 * 1000;
const EPSILON = 1e-9;

interface LineRuntime {
  input: StrategyLineInput;
  status: StrategyLineStatus;
  availableAt: Date | null;
  effectiveCapacityUnitsPerHour: number;
  assignedOrderIds: string[];
  assignedUnits: number;
  existingLoadUnits: number;
}

export function simulateStrategy(input: StrategySimulationInput): StrategySimulationResult {
  validateInput(input);
  const asOf = new Date(input.asOf);
  const runtimes = input.lines.map((line) => createLineRuntime(line, asOf));
  const inventory = { ...(input.materialInventory ?? {}) };
  const orderPlans = input.orders.map((order) => planOrder(order, runtimes, inventory, asOf, input.horizonHours));
  const recommendations = buildRecommendations(orderPlans, runtimes);
  const expectedCompletionAt = maxCompletion(orderPlans);
  const delayRisk = overallRisk(orderPlans);

  return {
    mode: "READ_ONLY",
    executionAllowed: false,
    asOf: input.asOf,
    expectedCompletionAt,
    delayRisk,
    affectedOrders: orderPlans.filter((plan) => plan.affected),
    orderPlans,
    lineLoads: runtimes.map((line) => toLineLoad(line, input.horizonHours, asOf)),
    recommendations,
  };
}

function planOrder(
  order: StrategyOrderInput,
  runtimes: LineRuntime[],
  inventory: Record<string, number>,
  asOf: Date,
  horizonHours: number,
): StrategyOrderPlan {
  const originalLineId = order.preferredLineId;
  const remaining = order.quantity - (order.completedQuantity ?? 0);
  const materialShortage = findMaterialShortage(order, remaining, inventory);
  if (materialShortage) {
    return {
      orderId: order.orderId,
      status: "BLOCKED",
      originalLineId,
      plannedQuantity: 0,
      expectedCompletionAt: null,
      delayRisk: "HIGH",
      affected: true,
      reason: `物料 ${materialShortage.materialId} 缺口 ${formatNumber(materialShortage.shortage)}，无法安排生产`,
    };
  }

  const candidates = runtimes.filter((line) => supports(line.input, order.product) && isAvailable(line));
  const selected = chooseLine(candidates, order, remaining, asOf, horizonHours);
  if (!selected) {
    return {
      orderId: order.orderId,
      status: "BLOCKED",
      originalLineId,
      plannedQuantity: 0,
      expectedCompletionAt: null,
      delayRisk: "HIGH",
      affected: true,
      reason: "没有满足产品兼容性、产能和设备可用性约束的产线",
    };
  }

  const completionAt = completionTime(selected, remaining, asOf);
  const status: StrategyOrderPlan["status"] = originalLineId && originalLineId !== selected.input.lineId
    ? "TRANSFERRED"
    : riskFor(completionAt, new Date(order.dueAt)) === "LOW" ? "PLANNED" : "AT_RISK";
  selected.assignedOrderIds.push(order.orderId);
  selected.assignedUnits += remaining;
  consumeMaterials(order, remaining, inventory);

  const delayRisk = riskFor(completionAt, new Date(order.dueAt));
  return {
    orderId: order.orderId,
    status,
    originalLineId,
    assignedLineId: selected.input.lineId,
    plannedQuantity: remaining,
    expectedCompletionAt: completionAt.toISOString(),
    delayRisk,
    affected: status !== "PLANNED",
    reason: reasonFor(status, selected, order, delayRisk),
  };
}

function createLineRuntime(line: StrategyLineInput, asOf: Date): LineRuntime {
  const status = line.status ?? "RUNNING";
  const deviceCount = line.deviceIds?.length ?? 0;
  const failedDeviceCount = line.failedDeviceIds?.length ?? 0;
  const healthyDeviceRatio = deviceCount === 0
    ? 1
    : Math.max(0, (deviceCount - failedDeviceCount) / deviceCount);
  const recoveryAt = line.recoveryAt ? new Date(line.recoveryAt) : null;
  const availableAt = status === "RUNNING"
    ? recoveryAt && recoveryAt > asOf ? recoveryAt : asOf
    : recoveryAt ? new Date(Math.max(asOf.getTime(), recoveryAt.getTime())) : null;
  const effectiveCapacity = line.capacityUnitsPerHour * healthyDeviceRatio;

  return {
    input: line,
    status,
    availableAt,
    effectiveCapacityUnitsPerHour: effectiveCapacity,
    assignedOrderIds: [],
    assignedUnits: 0,
    existingLoadUnits: line.currentLoadUnits ?? 0,
  };
}

function chooseLine(
  candidates: LineRuntime[],
  order: StrategyOrderInput,
  remaining: number,
  asOf: Date,
  horizonHours: number,
): LineRuntime | undefined {
  return [...candidates].sort((left, right) => {
    const leftScore = projectedLoad(left, remaining, asOf, horizonHours);
    const rightScore = projectedLoad(right, remaining, asOf, horizonHours);
    const preferredDelta = (right.input.lineId === order.preferredLineId ? 1 : 0)
      - (left.input.lineId === order.preferredLineId ? 1 : 0);
    return leftScore - rightScore || preferredDelta || left.input.lineId.localeCompare(right.input.lineId);
  })[0];
}

function projectedLoad(line: LineRuntime, units: number, asOf: Date, horizonHours: number): number {
  if (line.effectiveCapacityUnitsPerHour <= EPSILON) return Number.POSITIVE_INFINITY;
  const startDelayHours = line.availableAt ? Math.max(0, (line.availableAt.getTime() - asOf.getTime()) / HOUR_MS) : Number.POSITIVE_INFINITY;
  const availableHours = Math.max(0, horizonHours - startDelayHours);
  const capacity = availableHours * line.effectiveCapacityUnitsPerHour;
  return capacity <= EPSILON ? Number.POSITIVE_INFINITY : (line.existingLoadUnits + line.assignedUnits + units) / capacity;
}

function completionTime(line: LineRuntime, units: number, asOf: Date): Date {
  if (!line.availableAt || line.effectiveCapacityUnitsPerHour <= EPSILON) {
    throw new Error(`Line '${line.input.lineId}' is not schedulable`);
  }
  const startAt = new Date(Math.max(asOf.getTime(), line.availableAt.getTime()));
  const loadHours = (line.existingLoadUnits + line.assignedUnits + units) / line.effectiveCapacityUnitsPerHour;
  return new Date(startAt.getTime() + loadHours * HOUR_MS);
}

function isAvailable(line: LineRuntime): boolean {
  return (line.status === "RUNNING" || line.status === "WARNING" || line.status === "MAINTENANCE")
    && line.availableAt !== null
    && line.effectiveCapacityUnitsPerHour > EPSILON;
}

function supports(line: StrategyLineInput, product: string): boolean {
  return line.supportedProducts.includes(product);
}

function findMaterialShortage(
  order: StrategyOrderInput,
  remaining: number,
  inventory: Record<string, number>,
): { materialId: string; shortage: number } | undefined {
  for (const [materialId, unitsPerProduct] of Object.entries(order.materialRequirements ?? {})) {
    const required = remaining * unitsPerProduct;
    const available = inventory[materialId] ?? 0;
    if (available + EPSILON < required) return { materialId, shortage: required - available };
  }
  return undefined;
}

function consumeMaterials(order: StrategyOrderInput, remaining: number, inventory: Record<string, number>): void {
  for (const [materialId, unitsPerProduct] of Object.entries(order.materialRequirements ?? {})) {
    inventory[materialId] = (inventory[materialId] ?? 0) - remaining * unitsPerProduct;
  }
}

function riskFor(completionAt: Date, dueAt: Date): StrategyRisk {
  const slackHours = (dueAt.getTime() - completionAt.getTime()) / HOUR_MS;
  if (slackHours < 0) return "HIGH";
  if (slackHours < 4) return "MEDIUM";
  return "LOW";
}

function reasonFor(
  status: StrategyOrderPlan["status"],
  line: LineRuntime,
  order: StrategyOrderInput,
  delayRisk: StrategyRisk,
): string {
  if (status === "TRANSFERRED") return `原产线 ${order.preferredLineId} 不可用，转移至 ${line.input.lineId} 以保持生产连续性`;
  if (delayRisk !== "LOW") return `预计完成时间接近或超过交期，建议提前处理产能和维修风险`;
  if ((line.input.failedDeviceIds?.length ?? 0) > 0) return "部分设备故障，已按剩余设备产能估算";
  return "按当前产能与既有负载排产";
}

function toLineLoad(line: LineRuntime, horizonHours: number, asOf: Date): StrategyLineLoad {
  const recoveryDelayHours = line.availableAt
    ? Math.max(0, (line.availableAt.getTime() - asOf.getTime()) / HOUR_MS)
    : horizonHours;
  const availableHours = isAvailable(line) ? Math.max(0, horizonHours - recoveryDelayHours) : 0;
  const availableCapacityUnits = line.effectiveCapacityUnitsPerHour * availableHours;
  const totalLoad = line.existingLoadUnits + line.assignedUnits;
  return {
    lineId: line.input.lineId,
    name: line.input.name,
    status: line.status,
    assignedOrderIds: [...line.assignedOrderIds],
    assignedUnits: line.assignedUnits,
    existingLoadUnits: line.existingLoadUnits,
    availableCapacityUnits,
    loadRatio: availableCapacityUnits <= EPSILON ? 0 : Number((totalLoad / availableCapacityUnits).toFixed(6)),
    availableAt: line.availableAt?.toISOString() ?? null,
  };
}

function buildRecommendations(plans: StrategyOrderPlan[], lines: LineRuntime[]): StrategyRecommendation[] {
  const recommendations: StrategyRecommendation[] = [];
  const transferred = plans.filter((plan) => plan.status === "TRANSFERRED");
  if (transferred.length > 0) {
    recommendations.push({
      type: "FAILOVER_TRANSFER",
      reason: "原优先产线不可用，已选择兼容且负载较低的备用产线",
      affectedOrderIds: transferred.map((plan) => plan.orderId),
      requiresApproval: true,
    });
  }

  const loadedLines = lines.filter((line) => line.assignedUnits > 0);
  if (loadedLines.length > 1) {
    recommendations.push({
      type: "LOAD_BALANCE",
      reason: "多个兼容产线共同承接订单，避免订单集中到单条产线",
      affectedOrderIds: plans.filter((plan) => plan.assignedLineId).map((plan) => plan.orderId),
      requiresApproval: true,
    });
  }

  const materialBlocked = plans.filter((plan) => plan.reason.startsWith("物料 "));
  if (materialBlocked.length > 0) {
    recommendations.push({
      type: "MATERIAL_SHORTAGE",
      reason: "补充缺口物料后重新运行只读仿真，不自动下发采购或领料动作",
      affectedOrderIds: materialBlocked.map((plan) => plan.orderId),
      requiresApproval: true,
    });
  }

  const maintenanceLines = lines.filter((line) => line.status === "MAINTENANCE" || line.input.failedDeviceIds?.length);
  if (maintenanceLines.length > 0) {
    recommendations.push({
      type: "MAINTENANCE_RECOVERY",
      reason: "维修或设备恢复时间会改变可用产能，建议完成维修后重新评估",
      affectedOrderIds: plans.filter((plan) => plan.affected).map((plan) => plan.orderId),
      requiresApproval: true,
    });
  }

  const delayed = plans.filter((plan) => plan.delayRisk === "HIGH");
  if (delayed.length > 0) {
    recommendations.push({
      type: "DELAY_MITIGATION",
      reason: "存在延期风险，仅输出建议，不执行插单、停线或设备控制",
      affectedOrderIds: delayed.map((plan) => plan.orderId),
      requiresApproval: true,
    });
  }
  return recommendations;
}

function maxCompletion(plans: StrategyOrderPlan[]): string | null {
  if (plans.some((plan) => plan.status === "BLOCKED")) return null;
  const dates = plans
    .map((plan) => plan.expectedCompletionAt)
    .filter((value): value is string => value !== null)
    .map((value) => new Date(value).getTime());
  return dates.length === 0 ? null : new Date(Math.max(...dates)).toISOString();
}

function overallRisk(plans: StrategyOrderPlan[]): StrategyRisk {
  if (plans.some((plan) => plan.delayRisk === "HIGH")) return "HIGH";
  if (plans.some((plan) => plan.delayRisk === "MEDIUM")) return "MEDIUM";
  return "LOW";
}

function validateInput(input: StrategySimulationInput): void {
  if (!isDate(input.asOf)) throw new Error("asOf must be a valid timestamp");
  if (!Number.isFinite(input.horizonHours) || input.horizonHours <= 0) throw new Error("horizonHours must be greater than 0");
  if (input.lines.length === 0) throw new Error("at least one strategy line is required");
  unique(input.lines.map((line) => line.lineId), "lineId");
  unique(input.orders.map((order) => order.orderId), "orderId");
  for (const line of input.lines) {
    if (!line.lineId || !line.name || line.supportedProducts.length === 0 || !Number.isFinite(line.capacityUnitsPerHour) || line.capacityUnitsPerHour <= 0) {
      throw new Error(`invalid strategy line '${line.lineId}'`);
    }
    if ((line.currentLoadUnits ?? 0) < 0) throw new Error(`line '${line.lineId}' currentLoadUnits must be non-negative`);
    if (line.recoveryAt && !isDate(line.recoveryAt)) throw new Error(`line '${line.lineId}' recoveryAt must be a valid timestamp`);
  }
  for (const order of input.orders) {
    if (!order.orderId || !order.product || !Number.isInteger(order.quantity) || order.quantity <= 0) {
      throw new Error(`invalid strategy order '${order.orderId}'`);
    }
    if ((order.completedQuantity ?? 0) < 0 || (order.completedQuantity ?? 0) > order.quantity) {
      throw new Error(`order '${order.orderId}' completedQuantity must be within quantity`);
    }
    if (!isDate(order.dueAt)) throw new Error(`order '${order.orderId}' dueAt must be a valid timestamp`);
    for (const [materialId, unitsPerProduct] of Object.entries(order.materialRequirements ?? {})) {
      if (!materialId || !Number.isFinite(unitsPerProduct) || unitsPerProduct < 0) {
        throw new Error(`order '${order.orderId}' has invalid material requirement`);
      }
    }
  }
}

function unique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`duplicate ${label}`);
}

function isDate(value: string): boolean {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function formatNumber(value: number): string {
  return Number(value.toFixed(3)).toString();
}
