import assert from "node:assert/strict";
import test from "node:test";
import { LINE_DEFINITIONS } from "../config/line-config";
import { FactorySimulator } from "./factory-simulator";
import { ProductionLineSimulator } from "./production-line-simulator";

const timestamp = new Date("2026-08-28T08:00:00.000Z");

test("keeps a line in FAULT until every active fault is cleared", () => {
  const line = new ProductionLineSimulator(LINE_DEFINITIONS[0], "test-tenant", () => 0.5);

  line.injectFault("cnc-01", "JAM", timestamp);
  line.injectFault("cnc-02", "OVERHEAT", timestamp);

  assert.equal(line.snapshot(timestamp).status, "FAULT");
  assert.deepEqual(
    line.snapshot(timestamp).activeAlarms.map((alarm) => alarm.type),
    ["JAM", "OVERHEAT"],
  );

  line.clearFault("cnc-01", "JAM", timestamp);
  assert.equal(line.snapshot(timestamp).status, "FAULT");

  line.clearFault("cnc-02", "OVERHEAT", timestamp);
  assert.equal(line.snapshot(timestamp).status, "RUNNING");
  assert.deepEqual(line.snapshot(timestamp).activeAlarms, []);
});

test("repeated fault delivery does not duplicate the active alarm state", () => {
  const factory = new FactorySimulator("test-tenant", 1000, () => 0.5, [LINE_DEFINITIONS[0]]);

  factory.injectFault("line-cnc", "cnc-01", "JAM");
  factory.injectFault("line-cnc", "cnc-01", "JAM");

  const snapshot = factory.snapshot()[0];
  assert.equal(snapshot.activeAlarms.length, 1);
  assert.equal(snapshot.activeAlarms[0].id, "line-cnc-cnc-01-JAM");
});

test("drains a pending alarm message once while paused", () => {
  const factory = new FactorySimulator("test-tenant", 1000, () => 0.5, [LINE_DEFINITIONS[0]]);
  factory.setPaused(true);
  factory.injectFault("line-cnc", "cnc-01", "COMMUNICATION_LOSS");

  const firstDrain = factory.tick(timestamp);
  const secondDrain = factory.tick(new Date(timestamp.getTime() + 1000));

  assert.equal(firstDrain.length, 1);
  assert.equal(firstDrain[0].payload.event, "alarm.created");
  assert.deepEqual(secondDrain, []);
});

test("recovers production after communication loss is cleared", () => {
  const factory = new FactorySimulator("test-tenant", 1000, () => 0.5, [LINE_DEFINITIONS[0]]);
  factory.handleTwinCommand({
    commandId: "fault-001",
    action: "INJECT_FAULT",
    lineId: "line-cnc",
    deviceId: "cnc-01",
    faultType: "COMMUNICATION_LOSS",
  }, timestamp);

  const faultSnapshot = factory.tick(timestamp).find((message) => message.payload.event === "line.snapshot");
  assert.equal((faultSnapshot?.payload.data as { status: string }).status, "OFFLINE");

  factory.handleTwinCommand({
    commandId: "reset-001",
    action: "RESET_FAULT",
    lineId: "line-cnc",
  }, new Date(timestamp.getTime() + 1000));
  const recovered = factory.tick(new Date(timestamp.getTime() + 2000));
  const snapshot = recovered.find((message) => message.payload.event === "line.snapshot")?.payload.data as {
    status: string;
    oee: { operatingTimeSeconds: number };
  };

  assert.equal(snapshot.status, "RUNNING");
  assert.equal(snapshot.oee.operatingTimeSeconds, 1);
});

test("does not count stopped time as operating time", () => {
  const factory = new FactorySimulator("test-tenant", 1000, () => 0.5, [LINE_DEFINITIONS[0]]);
  factory.handleTwinCommand({
    commandId: "stop-001",
    action: "STOP_LINE",
    lineId: "line-cnc",
  }, timestamp);

  const messages = factory.tick(timestamp);
  const snapshot = messages.find((message) => message.payload.event === "line.snapshot")?.payload.data as {
    status: string;
    oee: { plannedTimeSeconds: number; operatingTimeSeconds: number; availability: number };
  };

  assert.equal(snapshot.status, "STOPPED");
  assert.equal(snapshot.oee.plannedTimeSeconds, 1);
  assert.equal(snapshot.oee.operatingTimeSeconds, 0);
  assert.equal(snapshot.oee.availability, 0);
});
