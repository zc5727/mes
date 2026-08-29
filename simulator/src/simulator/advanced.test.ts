import assert from "node:assert/strict";
import test from "node:test";
import { LINE_DEFINITIONS } from "../config/line-config";
import { FactorySimulator } from "./factory-simulator";

const line = LINE_DEFINITIONS[0];
const timestamp = new Date("2026-08-28T08:00:00.000Z");

test("exposes AGV state in strategy input snapshots and AGV telemetry can be enabled", () => {
  const factory = new FactorySimulator("test-tenant", 1000, () => 0.5, [line], undefined, true);
  const messages = factory.tick(timestamp);
  const snapshot = factory.strategyInputSnapshot(timestamp);

  assert.equal(snapshot.lines[0].agvs?.length, 1);
  assert.equal(snapshot.agvs.length, 1);
  assert.equal(messages.some((message) => message.payload.event === "agv.telemetry"), true);
});

test("communication loss produces OFFLINE state while other faults remain distinct", () => {
  const factory = new FactorySimulator("test-tenant", 1000, () => 0.5, [line]);
  factory.handleControlCommand({
    action: "fault",
    lineId: line.id,
    deviceId: line.devices[0].id,
    faultType: "COMMUNICATION_LOSS",
  }, timestamp);
  const snapshot = factory.snapshot(timestamp)[0];
  assert.equal(snapshot.devices[0].status, "OFFLINE");
  assert.equal(snapshot.status, "OFFLINE");

  factory.handleControlCommand({
    action: "fault",
    lineId: line.id,
    deviceId: line.devices[1].id,
    faultType: "QUALITY_DRIFT",
  }, timestamp);
  assert.equal(factory.snapshot(timestamp)[0].devices[1].status, "WARNING");

  const recovered = factory.handleControlCommand({
    action: "reset",
    lineId: line.id,
    deviceId: line.devices[0].id,
    faultType: "COMMUNICATION_LOSS",
  }, timestamp);
  assert.equal(recovered.some((message) => message.payload.event === "alarm.cleared"), true);
  assert.equal(factory.snapshot(timestamp)[0].devices[0].status, "RUNNING");
});

test("scheduled scenarios inject faults at simulation time and replay frames are exportable", () => {
  const factory = new FactorySimulator("test-tenant", 1000, () => 0.5, [line], []);
  factory.loadScenario([{
    atSeconds: 1,
    command: {
      action: "fault",
      lineId: line.id,
      deviceId: line.devices[0].id,
      faultType: "JAM",
      commandId: "scenario-1",
    },
  }]);
  const messages = factory.tick(timestamp);
  assert.equal(messages.some((message) => message.payload.event === "alarm.created"), true);
  assert.equal(factory.snapshot(timestamp)[0].status, "FAULT");

  const replay = JSON.parse(factory.exportReplay()) as { version: number; frames: unknown[] };
  assert.equal(replay.version, 1);
  assert.equal(replay.frames.length, 1);
  assert.equal(factory.replayFrames()[0].sequence, 0);
  const replayMessage = factory.handleControlCommand({ action: "replay" }, timestamp)[0];
  assert.equal(replayMessage.payload.event, "simulator.replay");
});

test("network impairment layer supports deterministic duplication and latency", () => {
  const factory = new FactorySimulator("test-tenant", 1000, () => 0.5, [line], [], false, {
    latencyMs: 1000,
    duplicateRate: 1,
    dropRate: 0,
    seed: 7,
  });
  assert.equal(factory.tick(timestamp).length, 0);
  const delivered = factory.tick(new Date(timestamp.getTime() + 1000));
  assert.equal(delivered.length, (line.devices.length + 1) * 2);
  assert.equal(new Set(delivered.map((message) => message.topic)).size, line.devices.length + 1);
});
