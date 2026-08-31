import assert from "node:assert/strict";
import test from "node:test";
import { AGV_DEFINITIONS, LINE_DEFINITIONS } from "./config/line-config";
import { adaptMqttTelemetry, adaptModbusTelemetry } from "./protocols/event-adapter";
import { parseProtocolEndpoint } from "./protocols/protocol-bridge";
import { NetworkSimulator } from "./simulator/network-simulator";
import { FactorySimulator } from "./simulator/factory-simulator";
import type { SimulationMessage } from "./types";

const message = (id: string, timestamp: string): SimulationMessage => ({
  topic: "mes/simulator/tenant-demo/lines/line-cnc/devices/cnc-01/telemetry",
  payload: {
    event: "device.telemetry",
    data: {
      tenantId: "tenant-demo", lineId: "line-cnc", deviceId: "cnc-01", timestamp,
      status: "RUNNING", temperatureCelsius: 40, cycleTimeSeconds: 42,
      totalCount: 1, goodCount: 1, defectCount: 0, activeFaults: [], eventId: id,
    },
  },
});

test("network anomalies are deterministic and delayed messages are held until due", () => {
  const network = new NetworkSimulator({ latencyMs: 1_000, duplicateRate: 1, dropRate: 0, seed: 7 }, () => 0.5);
  const at = new Date("2026-08-31T00:00:00.000Z");
  assert.deepEqual(network.enqueue([message("m-1", at.toISOString())], at), []);
  assert.equal(network.pendingCount(), 2);
  assert.deepEqual(network.drain(new Date(at.getTime() + 999)), []);
  assert.equal(network.drain(new Date(at.getTime() + 1_000)).length, 2);
  network.reset();
  assert.equal(network.pendingCount(), 0);
});

test("protocol anomalies fail closed before a device can be treated as healthy", () => {
  assert.throws(() => adaptMqttTelemetry(
    "mes/simulator/tenant-demo/lines/line-cnc/devices/cnc-01/telemetry",
    "not-json",
  ), /JSON|Unexpected token/);
  assert.throws(() => adaptModbusTelemetry({
    tenantId: "tenant-demo", lineId: "line-cnc", deviceId: "cnc-01", timestamp: "2026-08-31T00:00:00.000Z",
    registers: { status: 5, temperatureCelsius: 40, cycleTimeSeconds: 42, totalCount: 2, goodCount: 2, defectCount: 0, faultCode: 99 },
  }), /unsupported Modbus fault register/);
  assert.throws(() => parseProtocolEndpoint({ protocol: "modbus-tcp", host: "127.0.0.1", port: 0 }), /port/);
});

test("a fault in one of four lines does not change unrelated line state", () => {
  const factory = new FactorySimulator(
    "tenant-demo", 1_000, () => 0.5, LINE_DEFINITIONS, AGV_DEFINITIONS, false, undefined, 20260831,
  );
  const at = new Date("2026-08-31T00:00:00.000Z");
  factory.tick(at);
  factory.injectFault("line-welding", "weld-01", "COMMUNICATION_LOSS");

  const states = new Map(factory.snapshot(at).map((line) => [line.lineId, line.status]));
  assert.equal(states.size, 4);
  assert.equal(states.get("line-welding"), "OFFLINE");
  assert.equal(states.get("line-cnc"), "RUNNING");
  assert.equal(states.get("line-assembly"), "RUNNING");
  assert.equal(states.get("line-vision"), "RUNNING");
  assert.equal(factory.snapshot(at).find((line) => line.lineId === "line-welding")?.activeAlarms.length, 1);
  assert.equal(factory.snapshot(at).find((line) => line.lineId === "line-cnc")?.activeAlarms.length, 0);
});
