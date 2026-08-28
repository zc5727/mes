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
