import assert from "node:assert/strict";
import test from "node:test";
import { replayOperationalMessages, ReplayMessage } from "./replay";

const telemetry = (messageId: string, sequence: number, occurredAt: string, overrides: Partial<ReplayMessage> = {}): ReplayMessage => ({
  messageId,
  tenantId: "tenant-demo",
  lineId: "line-cnc",
  deviceId: "cnc-01",
  kind: "telemetry",
  sequence,
  occurredAt,
  status: "RUNNING",
  activeFaults: [],
  ...overrides,
});

test("replays single and multi-device failures into line state", () => {
  const result = replayOperationalMessages([
    telemetry("m-1", 1, "2026-08-28T08:00:00.000Z", { status: "FAULT", activeFaults: ["OVERHEAT"] }),
    telemetry("m-2", 1, "2026-08-28T08:00:00.000Z", { deviceId: "cnc-02", status: "FAULT", activeFaults: ["JAM"] }),
  ]);

  assert.equal(result.lineStatuses["line-cnc"], "FAULT");
  assert.equal(result.devices.length, 2);
  assert.deepEqual(result.devices.map((device) => device.activeFaults), [["OVERHEAT"], ["JAM"]]);
});

test("derives a stopped line only when every device is stopped", () => {
  const result = replayOperationalMessages([
    telemetry("stop-1", 1, "2026-08-28T08:00:00.000Z", { status: "STOPPED" }),
    telemetry("stop-2", 1, "2026-08-28T08:00:00.000Z", { deviceId: "cnc-02", status: "STOPPED" }),
  ]);

  assert.equal(result.lineStatuses["line-cnc"], "STOPPED");
});

test("keeps material shortage and quality anomaly faults in the accepted state", () => {
  const result = replayOperationalMessages([
    telemetry("quality-1", 1, "2026-08-28T08:00:00.000Z", {
      status: "FAULT",
      activeFaults: ["MATERIAL_SHORTAGE", "QUALITY_ANOMALY"],
    }),
  ]);

  assert.deepEqual(result.devices[0].activeFaults, ["MATERIAL_SHORTAGE", "QUALITY_ANOMALY"]);
  assert.equal(result.lineStatuses["line-cnc"], "FAULT");
});

test("handles line stop, MQTT disconnect, restart and offline recovery", () => {
  const result = replayOperationalMessages([
    telemetry("m-1", 1, "2026-08-28T08:00:00.000Z", { status: "RUNNING" }),
    telemetry("m-2", 2, "2026-08-28T08:01:00.000Z", { status: "STOPPED" }),
    { messageId: "connection-1", tenantId: "tenant-demo", kind: "connection", sequence: 3, occurredAt: "2026-08-28T08:02:00.000Z", connection: "DISCONNECTED" },
    telemetry("ignored-while-offline", 4, "2026-08-28T08:03:00.000Z", { status: "RUNNING" }),
    { messageId: "connection-2", tenantId: "tenant-demo", kind: "connection", sequence: 5, occurredAt: "2026-08-28T08:04:00.000Z", connection: "RESTARTED" },
    telemetry("m-3", 6, "2026-08-28T08:05:00.000Z", { status: "RUNNING" }),
  ]);

  assert.equal(result.connection, "CONNECTED");
  assert.equal(result.restartCount, 1);
  assert.deepEqual(result.ignoredWhileDisconnected, ["ignored-while-offline"]);
  assert.equal(result.devices[0].status, "RUNNING");
  assert.equal(result.lineStatuses["line-cnc"], "RUNNING");
});

test("classifies duplicate and delayed messages without overwriting current state", () => {
  const result = replayOperationalMessages([
    telemetry("m-1", 1, "2026-08-28T08:00:00.000Z", { status: "RUNNING" }),
    telemetry("m-duplicate", 1, "2026-08-28T08:00:00.000Z", { status: "FAULT", activeFaults: ["QUALITY_ANOMALY"] }),
    telemetry("m-late", 0, "2026-08-28T07:59:00.000Z", { status: "FAULT", activeFaults: ["MATERIAL_SHORTAGE"] }),
  ]);

  assert.deepEqual(result.duplicateMessageIds, ["m-duplicate"]);
  assert.deepEqual(result.staleMessageIds, ["m-late"]);
  assert.equal(result.devices[0].status, "RUNNING");
  assert.deepEqual(result.devices[0].activeFaults, []);
});

test("replays multiple lines and produces a reproducible fingerprint", () => {
  const messages: ReplayMessage[] = [
    telemetry("line-a-1", 1, "2026-08-28T08:00:00.000Z", { lineId: "line-a", deviceId: "a-01" }),
    telemetry("line-b-1", 1, "2026-08-28T08:00:00.000Z", { lineId: "line-b", deviceId: "b-01", status: "IDLE" }),
  ];
  const first = replayOperationalMessages(messages);
  const second = replayOperationalMessages(messages);

  assert.deepEqual(first.lineStatuses, { "line-a": "RUNNING", "line-b": "IDLE" });
  assert.equal(first.replayFingerprint, second.replayFingerprint);
  assert.match(first.replayFingerprint, /^[a-f0-9]{64}$/);
});
