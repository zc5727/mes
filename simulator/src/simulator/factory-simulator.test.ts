import assert from "node:assert/strict";
import test from "node:test";
import { LINE_DEFINITIONS } from "../config/line-config";
import { FactorySimulator } from "./factory-simulator";

test("pause stops state progression while preserving explicit messages", () => {
  const factory = new FactorySimulator("test-tenant", 1000, () => 0.5, [LINE_DEFINITIONS[0]]);
  const before = factory.tick(new Date("2026-08-28T00:00:00.000Z"));
  factory.setPaused(true);
  const paused = factory.tick(new Date("2026-08-28T00:01:00.000Z"));
  assert.equal(paused.length, 0);
  assert.equal(factory.snapshot()[0].oee.plannedTimeSeconds, (before[before.length - 1].payload.data as { oee: { plannedTimeSeconds: number } }).oee.plannedTimeSeconds);
});

test("records delivered paused messages in replay history", () => {
  const factory = new FactorySimulator("test-tenant", 1000, () => 0.5, [LINE_DEFINITIONS[0]]);
  factory.setPaused(true);
  factory.injectFault("line-cnc", "cnc-01", "JAM");

  const timestamp = new Date("2026-08-28T00:00:00.000Z");
  const delivered = factory.tick(timestamp);
  const replay = JSON.parse(factory.exportReplay()) as { frames: Array<{ timestamp: string; messages: unknown[] }> };

  assert.equal(delivered[0].payload.event, "alarm.created");
  assert.equal(replay.frames.length, 1);
  assert.equal(replay.frames[0].timestamp, timestamp.toISOString());
  assert.deepEqual(replay.frames[0].messages, delivered);
});

test("reset clears output history and restores the initial device state", () => {
  const factory = new FactorySimulator("test-tenant", 1000, () => 0.5, [LINE_DEFINITIONS[0]]);
  factory.tick();
  assert.notEqual(factory.exportHistory(), "[]");
  factory.reset();
  assert.equal(factory.exportHistory(), "[]");
  assert.equal(factory.snapshot()[0].oee.totalCount, 0);
});

test("material shortage and quality anomaly are represented as active faults", () => {
  const factory = new FactorySimulator("test-tenant", 1000, () => 0.5, [LINE_DEFINITIONS[0]]);
  factory.injectFault("line-cnc", "cnc-01", "MATERIAL_SHORTAGE");
  factory.injectFault("line-cnc", "cnc-01", "QUALITY_ANOMALY");
  const device = factory.snapshot()[0].devices.find((item) => item.deviceId === "cnc-01");
  assert.deepEqual(device?.activeFaults, ["MATERIAL_SHORTAGE", "QUALITY_ANOMALY"]);
});

test("control protocol covers lifecycle, speed, fault, snapshot and export", () => {
  const factory = new FactorySimulator("test-tenant", 1000, () => 0.5, [LINE_DEFINITIONS[0]]);
  const start = new Date("2026-08-28T00:00:00.000Z");

  factory.tick(start);
  const countBeforeStop = factory.snapshot(start).at(0)?.oee.totalCount;
  factory.handleControlCommand({ action: "stop", commandId: "stop-1" }, start);
  factory.tick(new Date("2026-08-28T00:01:00.000Z"));
  assert.equal(factory.snapshot(start).at(0)?.oee.totalCount, countBeforeStop);
  assert.equal(factory.getControlState().status, "STOPPED");

  factory.handleControlCommand({ action: "start" }, start);
  factory.handleControlCommand({ action: "pause" }, start);
  assert.equal(factory.getControlState().status, "PAUSED");
  factory.handleControlCommand({ action: "resume" }, start);
  factory.handleControlCommand({ action: "speed", speed: 2 }, start);
  assert.deepEqual(factory.getControlState(), { status: "RUNNING", paused: false, timeScale: 2 });

  const faultMessages = factory.handleControlCommand({
    action: "fault",
    lineId: "line-cnc",
    deviceId: "cnc-01",
    faultType: "JAM",
  }, start);
  assert.equal(faultMessages[0].payload.event, "alarm.created");
  assert.equal(factory.snapshot(start).at(0)?.status, "FAULT");

  const snapshotMessage = factory.handleControlCommand({ action: "snapshot" }, start)[0];
  assert.equal(snapshotMessage.payload.event, "simulator.snapshot");
  assert.equal(Array.isArray(snapshotMessage.payload.data), true);
  const exportMessage = factory.handleControlCommand({ action: "export" }, start)[0];
  assert.equal(exportMessage.payload.event, "simulator.export");
  assert.equal(Array.isArray(exportMessage.payload.data), true);
});

test("scoped reset clears only the requested fault, device or line", () => {
  const factory = new FactorySimulator("test-tenant", 1000, () => 0.5, LINE_DEFINITIONS.slice(0, 2));
  const timestamp = new Date("2026-08-29T08:00:00.000Z");
  const inject = (lineId: string, deviceId: string, faultType: "JAM" | "OVERHEAT") => factory.handleControlCommand({
    action: "fault",
    lineId,
    deviceId,
    faultType,
    timestamp: timestamp.toISOString(),
  }, timestamp);

  inject("line-cnc", "cnc-01", "JAM");
  inject("line-cnc", "cnc-01", "OVERHEAT");
  inject("line-assembly", "asm-01", "JAM");

  const deviceReset = factory.handleControlCommand({
    action: "reset",
    lineId: "line-cnc",
    deviceId: "cnc-01",
    faultType: "JAM",
    timestamp: timestamp.toISOString(),
  }, timestamp);
  const cncDevice = factory.snapshot(timestamp).find((line) => line.lineId === "line-cnc")?.devices
    .find((device) => device.deviceId === "cnc-01");
  const assemblyDevice = factory.snapshot(timestamp).find((line) => line.lineId === "line-assembly")?.devices
    .find((device) => device.deviceId === "asm-01");
  assert.equal(deviceReset.filter((message) => message.payload.event === "alarm.cleared").length, 1);
  assert.deepEqual(cncDevice?.activeFaults, ["OVERHEAT"]);
  assert.deepEqual(assemblyDevice?.activeFaults, ["JAM"]);

  factory.handleControlCommand({
    action: "reset",
    lineId: "line-cnc",
    timestamp: timestamp.toISOString(),
  }, timestamp);
  assert.deepEqual(factory.snapshot(timestamp).find((line) => line.lineId === "line-cnc")?.devices
    .find((device) => device.deviceId === "cnc-01")?.activeFaults, []);
  assert.deepEqual(factory.snapshot(timestamp).find((line) => line.lineId === "line-assembly")?.devices
    .find((device) => device.deviceId === "asm-01")?.activeFaults, ["JAM"]);
});
