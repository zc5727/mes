import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptHttpEvent,
  adaptModbusTelemetry,
  adaptMtConnectTelemetry,
  adaptMqttTelemetry,
  adaptOpcUaTelemetry,
} from "./event-adapter";
import { getProtocolCapability } from "./capabilities";

const data = {
  tenantId: "tenant-matrix",
  lineId: "line-cnc",
  deviceId: "cnc-matrix-01",
  timestamp: "2026-08-31T00:00:00.000Z",
  status: "WARNING" as const,
  temperatureCelsius: 66.5,
  cycleTimeSeconds: 8.4,
  totalCount: 100,
  goodCount: 97,
  defectCount: 3,
  activeFaults: ["QUALITY_DRIFT" as const],
};

test("all supported protocol adapters emit the same canonical telemetry shape", () => {
  const messages = [
    adaptMqttTelemetry("mes/simulator/tenant-matrix/lines/line-cnc/devices/cnc-matrix-01/telemetry", { event: "device.telemetry", data }),
    adaptHttpEvent({ event: "device.telemetry", data }),
    adaptModbusTelemetry({
      tenantId: data.tenantId, lineId: data.lineId, deviceId: data.deviceId, timestamp: data.timestamp,
      registers: { status: 3, temperatureCelsius: data.temperatureCelsius, cycleTimeSeconds: data.cycleTimeSeconds, totalCount: data.totalCount, goodCount: data.goodCount, defectCount: data.defectCount, faultCode: 4 },
    }),
    adaptOpcUaTelemetry({ tenantId: data.tenantId, lineId: data.lineId, deviceId: data.deviceId, timestamp: data.timestamp, values: data }),
    adaptMtConnectTelemetry({ tenantId: data.tenantId, lineId: data.lineId, deviceId: data.deviceId, timestamp: data.timestamp, values: data }),
  ];

  for (const message of messages) {
    assert.equal(message.payload.event, "device.telemetry");
    assert.deepEqual(message.payload.data, data);
  }
});

test("the matrix does not silently promote synthetic transports to vendor compatibility", () => {
  const expected = {
    mqtt: "IMPLEMENTED",
    http: "SYNTHETIC_CONTRACT",
    "modbus-tcp": "SYNTHETIC_CONTRACT",
    "opc-ua": "SYNTHETIC_CONTRACT",
    mtconnect: "SYNTHETIC_CONTRACT",
  } as const;
  for (const [protocol, status] of Object.entries(expected)) {
    assert.equal(getProtocolCapability(protocol).status, status);
    if (protocol !== "mqtt") assert.notEqual(getProtocolCapability(protocol).status, "IMPLEMENTED");
  }
});
