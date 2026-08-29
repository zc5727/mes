import assert from "node:assert/strict";
import test from "node:test";
import { LINE_DEFINITIONS } from "./config/line-config";
import { calculateOee } from "./metrics/oee";
import { parseTwinCommand } from "./twin/command";
import { FactorySimulator } from "./simulator/factory-simulator";

function record(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  return value as Record<string, unknown>;
}

test("publishes one well-formed telemetry and snapshot contract per tick", () => {
  const timestamp = new Date("2026-08-28T08:00:00.000Z");
  const factory = new FactorySimulator("tenant-contract", 1000, () => 0.5, [LINE_DEFINITIONS[0]]);
  const messages = factory.tick(timestamp);

  assert.equal(messages.length, LINE_DEFINITIONS[0].devices.length + 1);
  assert.equal(new Set(messages.map((message) => message.topic)).size, messages.length);

  for (const message of messages) {
    const payload = record(message.payload);
    assert.equal(typeof payload.event, "string");
    const data = record(payload.data);
    assert.equal(typeof data.timestamp, "string");
    assert.equal(Date.parse(data.timestamp as string), timestamp.getTime());

    if (payload.event === "device.telemetry") {
      assert.match(message.topic, /^mes\/simulator\/tenant-contract\/lines\/line-cnc\/devices\/[^/]+\/telemetry$/);
      assert.equal(typeof data.deviceId, "string");
      assert.equal(typeof data.lineId, "string");
      assert.ok(["RUNNING", "IDLE", "STOPPED", "FAULT"].includes(data.status as string));
      assert.ok(Array.isArray(data.activeFaults));
    } else {
      assert.equal(payload.event, "line.snapshot");
      assert.equal(message.topic, "mes/simulator/tenant-contract/lines/line-cnc/snapshot");
      assert.ok(Array.isArray(data.devices));
      assert.ok(Array.isArray(data.activeAlarms));
      const oee = record(data.oee);
      for (const metric of ["availability", "performance", "quality", "oee"]) {
        assert.equal(typeof oee[metric], "number");
        assert.ok((oee[metric] as number) >= 0 && (oee[metric] as number) <= 1);
      }
    }
  }
});

test("rejects malformed twin commands at the message boundary", () => {
  assert.throws(
    () => parseTwinCommand(JSON.stringify({ commandId: "cmd-1", lineId: "line-cnc", action: "START_DEVICE" })),
    /START_DEVICE requires deviceId/,
  );
  assert.throws(
    () => parseTwinCommand(JSON.stringify({ commandId: "cmd-2", lineId: "line-cnc", action: "INJECT_FAULT", deviceId: "cnc-01", faultType: "NOT_A_FAULT" })),
    /INJECT_FAULT requires deviceId and a supported faultType/,
  );
  assert.throws(
    () => parseTwinCommand("not-json"),
  );
});

test("bounds OEE ratios and preserves count invariants for bad inputs", () => {
  const result = calculateOee({
    plannedTimeSeconds: 10,
    operatingTimeSeconds: 50,
    idealCycleTimeSeconds: 2,
    totalCount: 4,
    goodCount: 7,
  });

  assert.equal(result.availability, 1);
  assert.equal(result.performance, 0.16);
  assert.equal(result.quality, 1);
  assert.equal(result.oee, 0.16);
  assert.equal(result.defectCount, 0);
  assert.ok(result.oee >= 0 && result.oee <= 1);
});

