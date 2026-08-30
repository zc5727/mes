import assert from "node:assert/strict";
import test from "node:test";
import { AGV_DEFINITIONS, LINE_DEFINITIONS } from "../config/line-config";
import { replayOperationalMessages } from "../strategy/replay";
import { FactorySimulator } from "./factory-simulator";

const timestamp = new Date("2026-08-29T08:00:00.000Z");
const faultTypes = [
  "OVERHEAT",
  "JAM",
  "COMMUNICATION_LOSS",
  "QUALITY_DRIFT",
  "EMERGENCY_STOP",
  "MATERIAL_SHORTAGE",
  "QUALITY_ANOMALY",
] as const;

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function createFactory(): FactorySimulator {
  return new FactorySimulator(
    "tenant-audit",
    1000,
    seededRandom(20260829),
    LINE_DEFINITIONS,
    AGV_DEFINITIONS,
    true,
  );
}

function command(
  action: "fault" | "reset",
  lineId: string,
  deviceId: string,
  faultType?: (typeof faultTypes)[number],
) {
  return {
    action,
    lineId,
    deviceId,
    faultType,
    commandId: `audit-${action}-${lineId}-${deviceId}-${faultType ?? "all"}`,
    timestamp: timestamp.toISOString(),
  } as const;
}

test("final audit covers deterministic four-line state, fault vocabulary, scoped recovery and replay", () => {
  const first = createFactory();
  const second = createFactory();
  const firstInitial = first.strategyInputSnapshot(timestamp);
  const secondInitial = second.strategyInputSnapshot(timestamp);

  assert.equal(firstInitial.lines.length, 4);
  assert.equal(firstInitial.lines.every((line) => line.devices.length === 3), true);
  assert.equal(firstInitial.agvs.length, 4);
  assert.deepEqual(firstInitial, secondInitial);

  const created = faultTypes.flatMap((faultType) => first.handleControlCommand(
    command("fault", "line-cnc", "cnc-01", faultType),
    timestamp,
  ));
  const lineTwoFault = first.handleControlCommand(command("fault", "line-assembly", "asm-01", "JAM"), timestamp);
  const agvFault = first.handleControlCommand(command("fault", "line-welding", "agv-03", "COMMUNICATION_LOSS"), timestamp);
  const allCreated = [...created, ...lineTwoFault, ...agvFault];

  assert.equal(created.filter((message) => message.payload.event === "alarm.created").length, faultTypes.length);
  assert.equal(allCreated.filter((message) => message.payload.event === "alarm.created").length, faultTypes.length + 2);
  assert.equal(first.strategyInputSnapshot(timestamp).activeAlarms.length, faultTypes.length + 2);

  const oneFaultCleared = first.handleControlCommand(
    command("reset", "line-cnc", "cnc-01", "JAM"),
    timestamp,
  );
  assert.equal(oneFaultCleared.filter((message) => message.payload.event === "alarm.cleared").length, 1);
  assert.equal(first.strategyInputSnapshot(timestamp).activeAlarms.length, faultTypes.length + 1);
  assert.equal(first.strategyInputSnapshot(timestamp).lines.find((line) => line.lineId === "line-assembly")?.status, "FAULT");
  assert.equal(first.strategyInputSnapshot(timestamp).agvs.find((agv) => agv.agvId === "agv-03")?.status, "OFFLINE");

  const lineReset = first.handleControlCommand(
    command("reset", "line-cnc", "cnc-01"),
    timestamp,
  );
  assert.equal(lineReset.filter((message) => message.payload.event === "alarm.cleared").length, faultTypes.length - 1);
  assert.equal(first.strategyInputSnapshot(timestamp).activeAlarms.length, 2);
  assert.equal(first.strategyInputSnapshot(timestamp).lines.find((line) => line.lineId === "line-cnc")?.status, "RUNNING");
  assert.equal(first.strategyInputSnapshot(timestamp).lines.find((line) => line.lineId === "line-assembly")?.status, "FAULT");

  const agvReset = first.handleControlCommand(
    command("reset", "line-welding", "agv-03", "COMMUNICATION_LOSS"),
    timestamp,
  );
  assert.equal(agvReset.filter((message) => message.payload.event === "alarm.cleared").length, 1);
  assert.equal(first.strategyInputSnapshot(timestamp).activeAlarms.length, 1);

  first.tick(timestamp);
  const replay = JSON.parse(first.exportReplay()) as { version: number; frames: unknown[]; timeScale: number };
  assert.equal(replay.version, 1);
  assert.equal(replay.timeScale, 1);
  assert.equal(replay.frames.length, 1);

  const replayMessages = (first.getReplayFrames()[0]?.messages ?? []).filter((message) =>
    message.payload.event === "device.telemetry" || message.payload.event === "alarm.created" || message.payload.event === "alarm.cleared",
  );
  const replayResult = replayOperationalMessages(replayMessages.map((message, index) => ({
    messageId: `audit-replay-${index}`,
    tenantId: "tenant-audit",
    kind: message.payload.event === "alarm.created" || message.payload.event === "alarm.cleared" ? "alarm" : "telemetry",
    sequence: index,
    occurredAt: timestamp.toISOString(),
    lineId: typeof message.payload.data === "object" && message.payload.data !== null
      ? (message.payload.data as { lineId?: string }).lineId
      : undefined,
    deviceId: typeof message.payload.data === "object" && message.payload.data !== null
      ? (message.payload.data as { deviceId?: string }).deviceId
      : undefined,
    status: typeof message.payload.data === "object" && message.payload.data !== null
      ? (message.payload.data as { status?: "RUNNING" | "IDLE" | "WARNING" | "STOPPED" | "FAULT" | "OFFLINE" }).status
      : undefined,
  })));
  assert.match(replayResult.replayFingerprint, /^[a-f0-9]{64}$/);
});
