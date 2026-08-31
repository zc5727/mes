import { connect } from "node:net";
import test from "node:test";
import assert from "node:assert/strict";
import { ModbusTcpSimulatorServer, ModbusTcpTelemetryClient, OpcUaTelemetrySimulator, parseProtocolEndpoint, type DeterministicTelemetryValues } from "./protocol-bridge";

const values: DeterministicTelemetryValues = {
  tenantId: "tenant-demo", lineId: "line-cnc", deviceId: "cnc-01", timestamp: "2026-08-31T00:00:00.000Z",
  status: "RUNNING", temperatureCelsius: 42.5, cycleTimeSeconds: 8.4, totalCount: 100, goodCount: 98, defectCount: 2, faultCode: 0,
};

test("protocol endpoint validation rejects unsafe or incomplete configuration", () => {
  assert.deepEqual(parseProtocolEndpoint({ protocol: "modbus-tcp", host: "127.0.0.1", port: 1502 }), { protocol: "modbus-tcp", host: "127.0.0.1", port: 1502, unitId: 1, timeoutMs: 2000 });
  assert.throws(() => parseProtocolEndpoint({ protocol: "opc-ua", host: "", port: 4842 }), /host is required/);
  assert.throws(() => parseProtocolEndpoint({ protocol: "modbus-tcp", host: "127.0.0.1", port: 70000 }), /port must be/);
});

test("Modbus TCP server/client reads deterministic telemetry and maps to canonical MQTT", async () => {
  const server = new ModbusTcpSimulatorServer(values, "127.0.0.1", 16002);
  await server.start();
  try {
    const message = await new ModbusTcpTelemetryClient({ tenantId: values.tenantId, lineId: values.lineId, deviceId: values.deviceId, timestamp: values.timestamp }, "127.0.0.1", 16002).readTelemetry();
    const data = message.payload.data as Record<string, unknown>;
    assert.equal(message.payload.event, "device.telemetry");
    assert.equal(data.status, "RUNNING");
    assert.equal(data.temperatureCelsius, 42.5);
    assert.match(message.topic, /^mes\/modbus\/tenant-demo\/lines\/line-cnc\/devices\/cnc-01\/telemetry$/);
  } finally { await server.close(); }
});

test("Modbus TCP rejects a bad function frame and surfaces disconnects", async () => {
  const server = new ModbusTcpSimulatorServer(values, "127.0.0.1", 16003);
  await server.start();
  try {
    const response = await new Promise<Buffer>((resolve, reject) => {
      const socket = connect({ host: "127.0.0.1", port: 16003 }, () => {
        const request = Buffer.alloc(12); request.writeUInt16BE(7, 0); request.writeUInt16BE(6, 4); request[6] = 1; request[7] = 4; request.writeUInt16BE(0, 8); request.writeUInt16BE(7, 10); socket.write(request);
      });
      socket.once("data", (data) => { resolve(data); socket.destroy(); }); socket.once("error", reject);
    });
    assert.equal(response[7], 0x84);
    await server.close();
    await assert.rejects(new ModbusTcpTelemetryClient({ tenantId: values.tenantId, lineId: values.lineId, deviceId: values.deviceId, timestamp: values.timestamp }, "127.0.0.1", 16003).readTelemetry());
  } finally { await server.close().catch(() => undefined); }
});

test("separate Modbus endpoints keep device telemetry isolated", async () => {
  const second = { ...values, deviceId: "cnc-02", totalCount: 200 };
  const firstServer = new ModbusTcpSimulatorServer(values, "127.0.0.1", 16004);
  const secondServer = new ModbusTcpSimulatorServer(second, "127.0.0.1", 16005);
  await Promise.all([firstServer.start(), secondServer.start()]);
  try {
    const [first, secondMessage] = await Promise.all([
      new ModbusTcpTelemetryClient({ tenantId: values.tenantId, lineId: values.lineId, deviceId: values.deviceId, timestamp: values.timestamp }, "127.0.0.1", 16004).readTelemetry(),
      new ModbusTcpTelemetryClient({ tenantId: second.tenantId, lineId: second.lineId, deviceId: second.deviceId, timestamp: second.timestamp }, "127.0.0.1", 16005).readTelemetry(),
    ]);
    assert.equal((first.payload.data as Record<string, unknown>).deviceId, "cnc-01");
    assert.equal((secondMessage.payload.data as Record<string, unknown>).deviceId, "cnc-02");
    assert.equal((secondMessage.payload.data as Record<string, unknown>).totalCount, 200);
  } finally { await Promise.all([firstServer.close(), secondServer.close()]); }
});

test("OPC UA simulator/client reads the same canonical telemetry contract", async () => {
  const server = new OpcUaTelemetrySimulator(values, 4842);
  await server.start();
  try {
    const message = await server.readTelemetry();
    const data = message.payload.data as Record<string, unknown>;
    assert.equal(data.deviceId, "cnc-01");
    assert.equal(data.totalCount, 100);
    assert.equal(data.goodCount, 98);
    assert.match(message.topic, /^mes\/opcua\/tenant-demo\/lines\/line-cnc\/devices\/cnc-01\/telemetry$/);
  } finally { await server.close(); }
});
