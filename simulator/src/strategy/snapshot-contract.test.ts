import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { AGV_DEFINITIONS, LINE_DEFINITIONS } from "../config/line-config";
import { StrategyInputSnapshot } from "../types";
import { FactorySimulator } from "../simulator/factory-simulator";

const timestamp = new Date("2026-08-29T08:00:00.000Z");
const fixturePath = [
  resolve(__dirname, "four-line-twin-snapshot.json"),
  resolve(__dirname, "../../src/strategy/four-line-twin-snapshot.json"),
].find((path) => existsSync(path)) ?? resolve(__dirname, "four-line-twin-snapshot.json");

function createFaultedFactory(): FactorySimulator {
  const factory = new FactorySimulator(
    "tenant-contract",
    1000,
    () => 0.5,
    LINE_DEFINITIONS,
    AGV_DEFINITIONS,
    true,
  );
  factory.handleControlCommand({
    action: "fault",
    commandId: "fixture-fault-001",
    lineId: "line-welding",
    deviceId: "weld-01",
    faultType: "OVERHEAT",
    timestamp: timestamp.toISOString(),
  }, timestamp);
  return factory;
}

test("four-line twin snapshot is a reproducible canonical strategy source", () => {
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as StrategyInputSnapshot;
  const first = createFaultedFactory().strategyInputSnapshot(timestamp);
  const second = createFaultedFactory().strategyInputSnapshot(timestamp);

  assert.deepEqual(first, fixture);
  assert.deepEqual(first, second);
  assert.equal(first.lines.length, 4);
  assert.equal(first.lines.every((line) => line.devices.length === 3), true);
  assert.equal(first.agvs.length, 4);
  assert.equal(first.lines.every((line) => line.agvs?.length === 1), true);
  assert.equal(first.runtime.status, "RUNNING");
  assert.equal(first.activeAlarms.length, 1);
  assert.deepEqual(first.activeAlarms[0], {
    id: "line-welding-weld-01-OVERHEAT",
    lineId: "line-welding",
    deviceId: "weld-01",
    type: "OVERHEAT",
    severity: "CRITICAL",
    message: "设备温度超过安全阈值",
    startedAt: timestamp.toISOString(),
  });
  assert.equal(first.lines.find((line) => line.lineId === "line-welding")?.status, "FAULT");
  assert.equal(
    first.lines.flatMap((line) => line.devices).find((device) => device.deviceId === "weld-01")?.status,
    "FAULT",
  );
});
