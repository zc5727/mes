import assert from "node:assert/strict";
import test from "node:test";
import { createServer, request } from "node:http";
import { MtConnectTelemetrySimulator, MTCONNECT_SYNTHETIC_DATA_ITEMS, type MtConnectTelemetryValues } from "./mtconnect";
import { ProtocolRunner, protocolRunnerForProfile } from "./protocol-runner";
import { DEVICE_PROFILES } from "../config/device-profile";

const identity = { tenantId: "tenant-mt", lineId: "line-cnc", deviceId: "cnc-mt-01", timestamp: "2026-08-31T00:00:00.000Z" };
const values: MtConnectTelemetryValues = { status: "FAULT", temperatureCelsius: 96, cycleTimeSeconds: 42, totalCount: 10, goodCount: 8, defectCount: 2, activeFaults: ["OVERHEAT"] };

test("MTConnect synthetic probe and current/sample contract expose no vendor NodeIDs", async () => {
  const server = new MtConnectTelemetrySimulator(identity, values, "127.0.0.1", 16006);
  await server.start();
  await server.start();
  try {
    const probe = await read("127.0.0.1", 16006, "/probe");
    assert.match(probe, new RegExp(MTCONNECT_SYNTHETIC_DATA_ITEMS.status));
    assert.doesNotMatch(probe, /ns=|SINUMERIK|FANUC/);
    const message = await server.readTelemetry();
    const data = message.payload.data as Record<string, unknown>;
    assert.equal(message.payload.event, "device.telemetry");
    assert.equal(data.status, "FAULT");
    assert.deepEqual(data.activeFaults, ["OVERHEAT"]);
    assert.match(message.topic, /mes\/mtconnect\/tenant-mt/);
    const sample = await read("127.0.0.1", 16006, "/sample");
    assert.match(sample, /MTConnectStreams/);
  } finally {
    await server.close();
    await server.close();
  }
});

test("MTConnect rejects a synthetic document with inconsistent production counts", async () => {
  const server = new MtConnectTelemetrySimulator(identity, { ...values, goodCount: 7 }, "127.0.0.1", 16013);
  await server.start();
  try {
    await assert.rejects(() => server.readTelemetry(), /goodCount plus defectCount/);
  } finally {
    await server.close();
  }
});

test("MTConnect rejects control methods at its read-only HTTP boundary", async () => {
  const server = new MtConnectTelemetrySimulator(identity, values, "127.0.0.1", 16016);
  await server.start();
  try {
    const response = await requestMethod("POST", "127.0.0.1", 16016, "/current");
    assert.equal(response.statusCode, 405);
    assert.equal(response.headers.allow, "GET");
  } finally {
    await server.close();
  }
});

test("MTConnect client enforces the configured read timeout", async () => {
  const sockets = new Set<import("node:net").Socket>();
  const delayed = createServer((_request, response) => {
    setTimeout(() => response.end("<delayed />"), 300);
  });
  delayed.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => delayed.listen(16017, "127.0.0.1", resolve));
  const client = new MtConnectTelemetrySimulator(identity, values, "127.0.0.1", 16017, 100);
  try {
    await assert.rejects(() => client.readTelemetry(), /timed out/);
  } finally {
    sockets.forEach((socket) => socket.destroy());
    await new Promise<void>((resolve, reject) => delayed.close((error) => error ? reject(error) : resolve()));
  }
});

test("ProtocolRunner exposes MTConnect as a canonical contract entry", async () => {
  const message = await new ProtocolRunner({ protocol: "mtconnect", host: "127.0.0.1", port: 16007, values: {
    tenantId: "tenant-runner", lineId: "line-cnc", deviceId: "cnc-runner", timestamp: identity.timestamp,
    status: "RUNNING", temperatureCelsius: 40, cycleTimeSeconds: 10, totalCount: 1, goodCount: 1, defectCount: 0,
  } }).readTelemetry();
  assert.equal(message.payload.event, "device.telemetry");
  assert.equal((message.payload.data as Record<string, unknown>).deviceId, "cnc-runner");
});

test("ProtocolRunner closes its endpoint so the configured port can be reused", async () => {
  const port = 16009;
  await new ProtocolRunner({ protocol: "mtconnect", host: "127.0.0.1", port, values: {
    tenantId: "tenant-cleanup", lineId: "line-cnc", deviceId: "cnc-cleanup", timestamp: identity.timestamp,
    status: "RUNNING", temperatureCelsius: 40, cycleTimeSeconds: 10, totalCount: 1, goodCount: 1, defectCount: 0,
  } }).readTelemetry();
  const reusable = new MtConnectTelemetrySimulator(identity, values, "127.0.0.1", port);
  await reusable.start();
  await reusable.close();
});

test("ProtocolRunner reports a port conflict without leaving an orphan endpoint", async () => {
  const port = 16010;
  const held = new MtConnectTelemetrySimulator(identity, values, "127.0.0.1", port);
  await held.start();
  try {
    await assert.rejects(
      () => new ProtocolRunner({ protocol: "mtconnect", host: "127.0.0.1", port }).readTelemetry(),
      /EADDRINUSE|address already in use/i,
    );
  } finally {
    await held.close();
  }
  const reusable = new MtConnectTelemetrySimulator(identity, values, "127.0.0.1", port);
  await reusable.start();
  await reusable.close();
});

test("profile protocol selects the contract runner without claiming vendor compatibility", async () => {
  const profile = DEVICE_PROFILES.find((item) => item.id === "fanuc-cnc-mtconnect");
  assert.ok(profile);
  const message = await protocolRunnerForProfile(profile, "127.0.0.1", 16008, {
    tenantId: "tenant-profile", lineId: "line-cnc", deviceId: "profile-device", timestamp: identity.timestamp,
    status: "IDLE", temperatureCelsius: 35, cycleTimeSeconds: 12, totalCount: 0, goodCount: 0, defectCount: 0,
  }).readTelemetry();
  assert.equal((message.payload.data as Record<string, unknown>).status, "IDLE");
});

function read(host: string, port: number, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = request({ host, port, path }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.once("end", () => response.statusCode === 200 ? resolve(Buffer.concat(chunks).toString()) : reject(new Error(`HTTP ${response.statusCode}`)));
    });
    client.once("error", reject);
    client.end();
  });
}

function requestMethod(method: string, host: string, port: number, path: string): Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const client = request({ method, host, port, path }, (response) => {
      response.resume();
      response.once("end", () => resolve({ statusCode: response.statusCode ?? 0, headers: response.headers }));
    });
    client.once("error", reject);
    client.end();
  });
}
