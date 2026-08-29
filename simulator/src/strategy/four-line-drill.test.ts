import assert from "node:assert/strict";
import test from "node:test";
import { AGV_DEFINITIONS, LINE_DEFINITIONS } from "../config/line-config";
import { FaultType, StrategyInputSnapshot } from "../types";
import { FactorySimulator } from "../simulator/factory-simulator";
import { simulateStrategy } from "./simulator";
import { StrategySimulationInput } from "./types";

const timestamp = new Date("2026-08-29T08:00:00.000Z");

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function createFactory(): FactorySimulator {
  return new FactorySimulator(
    "tenant-drill",
    1000,
    seededRandom(20260829),
    LINE_DEFINITIONS,
    AGV_DEFINITIONS,
    true,
  );
}

function toStrategyInput(snapshot: StrategyInputSnapshot): StrategySimulationInput {
  return {
    asOf: snapshot.timestamp,
    horizonHours: 8,
    lines: snapshot.lines.map((line) => ({
      lineId: line.lineId,
      name: line.name,
      // The drill models a shared-capability product so a backup line exists.
      supportedProducts: [line.product, "结构件总成"],
      capacityUnitsPerHour: 60,
      currentLoadUnits: 0,
      status: line.status === "FAULT" || line.status === "OFFLINE" ? "OFFLINE" : "RUNNING",
      deviceIds: line.devices.map((device) => device.deviceId),
      failedDeviceIds: line.devices
        .filter((device) => ["FAULT", "OFFLINE", "STOPPED"].includes(device.status))
        .map((device) => device.deviceId),
    })),
    orders: [{
      orderId: "WO-WELD-DRILL-001",
      product: "结构件总成",
      quantity: 240,
      preferredLineId: "line-welding",
      dueAt: "2026-08-29T10:00:00.000Z",
    }],
  };
}

function runFault(factory: FactorySimulator, type: FaultType): ReturnType<FactorySimulator["handleControlCommand"]> {
  return factory.handleControlCommand({
    action: "fault",
    commandId: `drill-${type}`,
    lineId: "line-welding",
    deviceId: "weld-01",
    faultType: type,
    timestamp: timestamp.toISOString(),
  }, timestamp);
}

test("runs the four-line fault drill from telemetry to approved recovery advice", () => {
  const factory = createFactory();
  const telemetry = factory.tick(timestamp);

  assert.equal(telemetry.filter((message) => message.payload.event === "device.telemetry").length, 12);
  assert.equal(telemetry.filter((message) => message.payload.event === "agv.telemetry").length, 4);

  const faultMessages = runFault(factory, "OVERHEAT");
  assert.equal(faultMessages[0]?.payload.event, "alarm.created");
  assert.equal(factory.strategyInputSnapshot(timestamp).activeAlarms.length, 1);

  const faultSnapshot = factory.strategyInputSnapshot(timestamp);
  const simulation = simulateStrategy(toStrategyInput(faultSnapshot));
  const transfer = simulation.recommendations.find((recommendation) => recommendation.type === "FAILOVER_TRANSFER");

  assert.equal(simulation.executionAllowed, false);
  assert.equal(simulation.delayRisk, "HIGH");
  assert.equal(transfer?.requiresApproval, true);
  assert.deepEqual(transfer?.affectedOrderIds, ["WO-WELD-DRILL-001"]);

  const clearMessages = factory.handleControlCommand({
    action: "reset",
    commandId: "drill-recover",
    lineId: "line-welding",
    deviceId: "weld-01",
    faultType: "OVERHEAT",
    timestamp: timestamp.toISOString(),
  }, timestamp);
  assert.equal(clearMessages.some((message) => message.payload.event === "alarm.cleared"), true);

  const recoveredSnapshot = factory.strategyInputSnapshot(timestamp);
  assert.equal(recoveredSnapshot.activeAlarms.length, 0);
  assert.equal(recoveredSnapshot.lines.find((line) => line.lineId === "line-welding")?.status, "RUNNING");
  assert.equal(recoveredSnapshot.lines.find((line) => line.lineId === "line-welding")?.devices
    .find((device) => device.deviceId === "weld-01")?.status, "RUNNING");
});
