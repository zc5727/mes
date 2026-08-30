import assert from "node:assert/strict";
import test from "node:test";
import { adaptHttpEvent, adaptModbusTelemetry, adaptMqttTelemetry, adaptOpcUaTelemetry } from "./event-adapter";

const data = {
  tenantId: "tenant-demo",
  lineId: "line-cnc",
  deviceId: "cnc-01",
  timestamp: "2026-08-30T08:00:00.000Z",
  status: "RUNNING" as const,
  temperatureCelsius: 42,
  cycleTimeSeconds: 40,
  totalCount: 100,
  goodCount: 98,
  defectCount: 2,
  activeFaults: [],
};

test("normalizes MQTT and HTTP events to the same canonical telemetry contract", () => {
  const mqtt = adaptMqttTelemetry(
    "mes/simulator/tenant-demo/lines/line-cnc/devices/cnc-01/telemetry",
    JSON.stringify({ event: "device.telemetry", data }),
  );
  const http = adaptHttpEvent({ event: "device.telemetry", data });

  assert.deepEqual(mqtt.payload.data, http.payload.data);
  assert.equal(mqtt.payload.event, "device.telemetry");
});

test("adapts deterministic Modbus and OPC UA simulated frames", () => {
  const modbus = adaptModbusTelemetry({
    tenantId: data.tenantId, lineId: data.lineId, deviceId: data.deviceId, timestamp: data.timestamp,
    registers: { status: 5, temperatureCelsius: 96, cycleTimeSeconds: 40, totalCount: 100, goodCount: 98, defectCount: 2, faultCode: 1 },
  });
  const opcua = adaptOpcUaTelemetry({
    tenantId: data.tenantId, lineId: data.lineId, deviceId: data.deviceId, timestamp: data.timestamp,
    values: { ...data, status: "FAULT", temperatureCelsius: 96, activeFaults: ["OVERHEAT"] },
  });

  assert.equal((modbus.payload.data as { status: string }).status, "FAULT");
  assert.deepEqual((modbus.payload.data as { activeFaults: string[] }).activeFaults, ["OVERHEAT"]);
  assert.deepEqual(opcua.payload.data, modbus.payload.data);
});

test("rejects invalid protocol frames and does not expose control operations", () => {
  assert.throws(() => adaptMqttTelemetry("mes/control/tenant-demo/twin/command", "{}"), /unsupported MQTT telemetry topic/);
  assert.throws(() => adaptHttpEvent({ event: "STOP_DEVICE", data }), /device.telemetry/);
  assert.throws(() => adaptModbusTelemetry({
    tenantId: data.tenantId, lineId: data.lineId, deviceId: data.deviceId, timestamp: data.timestamp,
    registers: { status: 99, temperatureCelsius: 1, cycleTimeSeconds: 1, totalCount: 0, goodCount: 0, defectCount: 0 },
  }), /unsupported Modbus status/);
  const output = adaptOpcUaTelemetry({ tenantId: data.tenantId, lineId: data.lineId, deviceId: data.deviceId, timestamp: data.timestamp, values: data });
  assert.deepEqual(Object.keys(output.payload), ["event", "data"]);
});
