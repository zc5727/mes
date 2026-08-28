import assert from "node:assert/strict";
import test from "node:test";
import { LINE_DEFINITIONS } from "../config/line-config";
import { FactorySimulator } from "./factory-simulator";
import { ProductionLineSimulator } from "./production-line-simulator";

test("simulates device telemetry, production output and OEE", () => {
  const line = new ProductionLineSimulator(LINE_DEFINITIONS[0], "test-tenant", () => 0.5);
  const messages = line.tick(60, new Date("2026-08-28T00:00:00.000Z"));
  const snapshot = line.snapshot(new Date("2026-08-28T00:01:00.000Z"));

  assert.equal(messages.length, 4);
  assert.equal(snapshot.lineId, "line-cnc");
  assert.equal(snapshot.devices.length, 3);
  assert.ok(snapshot.oee.totalCount > 0);
  assert.equal(snapshot.oee.totalCount, snapshot.oee.goodCount + snapshot.oee.defectCount);
});

test("fault injection changes line status and creates a clearable alarm", () => {
  const line = new ProductionLineSimulator(LINE_DEFINITIONS[1], "test-tenant", () => 0.5);
  const timestamp = new Date("2026-08-28T00:00:00.000Z");
  const alarm = line.injectFault("asm-01", "JAM", timestamp);

  assert.equal(alarm.severity, "CRITICAL");
  assert.equal(line.snapshot(timestamp).status, "FAULT");
  assert.equal(line.snapshot(timestamp).activeAlarms.length, 1);

  line.clearFault("asm-01", "JAM", timestamp);
  assert.equal(line.snapshot(timestamp).activeAlarms.length, 0);
});

test("twin commands are reflected in the twin state message", () => {
  const factory = new FactorySimulator("test-tenant", 1000, () => 0.5, [LINE_DEFINITIONS[2]]);
  const messages = factory.handleTwinCommand({
    commandId: "cmd-001",
    action: "STOP_LINE",
    lineId: "line-welding",
    requestedBy: "plant-manager",
  }, new Date("2026-08-28T00:00:00.000Z"));
  const stateMessage = messages.find((message) => message.payload.event === "twin.state.changed");
  const state = stateMessage?.payload.data as { status: string };

  assert.equal(stateMessage?.topic, "mes/simulator/test-tenant/twin/state");
  assert.equal(state.status, "STOPPED");
});
