import assert from "node:assert/strict";
import test from "node:test";
import { simulateStrategy } from "./simulator";
import { StrategySimulationInput } from "./types";

const asOf = "2026-08-28T08:00:00.000Z";

function scenario(overrides: Partial<StrategySimulationInput> = {}): StrategySimulationInput {
  return {
    asOf,
    horizonHours: 8,
    lines: [
      {
        lineId: "line-cnc",
        name: "CNC加工线",
        supportedProducts: ["P-100"],
        capacityUnitsPerHour: 60,
        currentLoadUnits: 0,
        deviceIds: ["cnc-01", "cnc-02"],
      },
      {
        lineId: "line-assembly",
        name: "装配线",
        supportedProducts: ["P-100"],
        capacityUnitsPerHour: 40,
        currentLoadUnits: 0,
        deviceIds: ["asm-01", "asm-02"],
      },
      {
        lineId: "line-welding",
        name: "焊接线",
        supportedProducts: ["P-200"],
        capacityUnitsPerHour: 30,
        status: "MAINTENANCE",
        recoveryAt: "2026-08-28T10:00:00.000Z",
        deviceIds: ["weld-01", "weld-02"],
      },
    ],
    orders: [
      {
        orderId: "order-001",
        product: "P-100",
        quantity: 120,
        preferredLineId: "line-cnc",
        dueAt: "2026-08-28T14:00:00.000Z",
        materialRequirements: { aluminum: 1 },
      },
      {
        orderId: "order-002",
        product: "P-100",
        quantity: 80,
        preferredLineId: "line-cnc",
        dueAt: "2026-08-28T16:00:00.000Z",
        materialRequirements: { aluminum: 1 },
      },
    ],
    materialInventory: { aluminum: 1_000 },
    ...overrides,
  };
}

test("returns a read-only plan with completion time, load and reasons", () => {
  const input = scenario();
  const before = structuredClone(input);
  const result = simulateStrategy(input);

  assert.equal(result.mode, "READ_ONLY");
  assert.equal(result.executionAllowed, false);
  assert.equal(typeof result.expectedCompletionAt, "string");
  assert.ok(["LOW", "MEDIUM", "HIGH"].includes(result.delayRisk));
  assert.equal(result.orderPlans.length, 2);
  assert.equal(result.lineLoads.length, 3);
  assert.ok(result.lineLoads.some((line) => line.assignedUnits > 0));
  assert.ok(result.orderPlans.every((order) => order.reason.length > 0));
  assert.ok(result.recommendations.every((recommendation) => recommendation.requiresApproval === true));
  assert.deepEqual(input, before);
});

test("transfers an order when the preferred line has a multi-device failure", () => {
  const input = scenario({
    lines: scenario().lines.map((line) => line.lineId === "line-cnc"
      ? { ...line, failedDeviceIds: ["cnc-01", "cnc-02"] }
      : line),
    orders: [scenario().orders[0]],
  });
  const result = simulateStrategy(input);
  const plan = result.orderPlans[0];

  assert.equal(plan.status, "TRANSFERRED");
  assert.equal(plan.originalLineId, "line-cnc");
  assert.equal(plan.assignedLineId, "line-assembly");
  assert.ok(result.recommendations.some((recommendation) => recommendation.type === "FAILOVER_TRANSFER"));
  assert.ok(result.affectedOrders.some((order) => order.orderId === "order-001"));
});

test("balances compatible orders across available lines", () => {
  const result = simulateStrategy(scenario());
  const plans = new Map(result.orderPlans.map((plan) => [plan.orderId, plan]));
  const loads = new Map(result.lineLoads.map((line) => [line.lineId, line]));

  assert.equal(plans.get("order-001")?.assignedLineId, "line-cnc");
  assert.equal(plans.get("order-002")?.assignedLineId, "line-assembly");
  assert.equal(loads.get("line-cnc")?.assignedUnits, 120);
  assert.equal(loads.get("line-assembly")?.assignedUnits, 80);
  assert.ok(result.recommendations.some((recommendation) => recommendation.type === "LOAD_BALANCE"));
});

test("models material shortage as a blocked order without execution", () => {
  const result = simulateStrategy(scenario({
    orders: [{ ...scenario().orders[0], quantity: 50, materialRequirements: { aluminum: 2 } }],
    materialInventory: { aluminum: 30 },
  }));
  const plan = result.orderPlans[0];

  assert.equal(plan.status, "BLOCKED");
  assert.equal(plan.expectedCompletionAt, null);
  assert.equal(plan.delayRisk, "HIGH");
  assert.equal(result.expectedCompletionAt, null);
  assert.match(plan.reason, /物料 aluminum/);
  assert.ok(result.recommendations.some((recommendation) => recommendation.type === "MATERIAL_SHORTAGE"));
});

test("waits for maintenance recovery and reports the resulting risk", () => {
  const result = simulateStrategy(scenario({
    orders: [{
      orderId: "order-weld-001",
      product: "P-200",
      quantity: 60,
      preferredLineId: "line-welding",
      dueAt: "2026-08-28T13:00:00.000Z",
    }],
  }));
  const plan = result.orderPlans[0];
  const load = result.lineLoads.find((line) => line.lineId === "line-welding");

  assert.equal(plan.assignedLineId, "line-welding");
  assert.equal(plan.status, "AT_RISK");
  assert.equal(plan.expectedCompletionAt, "2026-08-28T12:00:00.000Z");
  assert.equal(load?.availableAt, "2026-08-28T10:00:00.000Z");
  assert.ok(result.recommendations.some((recommendation) => recommendation.type === "MAINTENANCE_RECOVERY"));
});

test("reports delay mitigation as a suggestion without execution", () => {
  const result = simulateStrategy(scenario({
    orders: [{
      orderId: "order-due-soon",
      product: "P-100",
      quantity: 500,
      preferredLineId: "line-cnc",
      dueAt: "2026-08-28T09:00:00.000Z",
    }],
  }));

  assert.equal(result.delayRisk, "HIGH");
  assert.ok(result.recommendations.some((recommendation) => recommendation.type === "DELAY_MITIGATION"));
  assert.equal(result.executionAllowed, false);
  assert.ok(result.recommendations.every((recommendation) => recommendation.requiresApproval === true));
});
