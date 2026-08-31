import assert from "node:assert/strict";
import test from "node:test";
import { LINE_DEFINITIONS } from "../config/line-config";
import { FactorySimulator } from "./factory-simulator";

const t0 = new Date("2026-08-31T00:00:00.000Z");

test("same seed and operation sequence reproduce telemetry, faults, network delivery and replay", () => {
  const first = createFactory();
  const second = createFactory();
  const firstTrace = runSequence(first);
  const secondTrace = runSequence(second);
  assert.deepEqual(firstTrace, secondTrace);
  assert.deepEqual(first.exportReplay(), second.exportReplay());
  const replay = JSON.parse(first.exportReplay()) as { seed?: number; networkSeed?: number };
  assert.equal(replay.seed, 20260831);
  assert.equal(replay.networkSeed, 77);
});

test("reset rewinds seeded simulation and network randomness", () => {
  const factory = createFactory();
  factory.tick(t0);
  factory.tick(new Date(t0.getTime() + 1000));
  factory.reset();

  const fresh = createFactory();
  assert.deepEqual(factory.tick(t0), fresh.tick(t0));
});

function createFactory(): FactorySimulator {
  return new FactorySimulator(
    "determinism-tenant",
    1000,
    seededRandom(20260831),
    LINE_DEFINITIONS,
    [],
    false,
    { duplicateRate: 0.35, dropRate: 0.1, seed: 77 },
    20260831,
  );
}

function runSequence(factory: FactorySimulator): unknown {
  const messages = [factory.tick(t0)];
  messages.push(...[factory.handleControlCommand({
    action: "fault", lineId: "line-cnc", deviceId: "cnc-01", faultType: "QUALITY_DRIFT", commandId: "deterministic-fault",
  }, new Date(t0.getTime() + 1000))]);
  messages.push(factory.tick(new Date(t0.getTime() + 1000)));
  messages.push(...[factory.handleControlCommand({
    action: "reset", lineId: "line-cnc", deviceId: "cnc-01", faultType: "QUALITY_DRIFT", commandId: "deterministic-reset",
  }, new Date(t0.getTime() + 2000))]);
  messages.push(factory.tick(new Date(t0.getTime() + 2000)));
  return messages;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
