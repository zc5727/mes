import assert from "node:assert/strict";
import { request } from "node:http";
import test from "node:test";
import { HttpTelemetryEndpoint, parseHttpEndpoint, postHttpTelemetry } from "./http";

const telemetry = {
  event: "device.telemetry",
  data: {
    tenantId: "tenant-http",
    lineId: "line-cnc",
    deviceId: "cnc-http-01",
    timestamp: "2026-08-31T00:00:00.000Z",
    status: "RUNNING",
    temperatureCelsius: 42.5,
    cycleTimeSeconds: 8.4,
    totalCount: 100,
    goodCount: 98,
    defectCount: 2,
  },
};

test("HTTP endpoint validates endpoint security and rejects unsupported TLS", () => {
  assert.deepEqual(parseHttpEndpoint({ protocol: "http", host: "127.0.0.1", port: 16101 }), {
    protocol: "http", host: "127.0.0.1", port: 16101, path: "/events", timeoutMs: 2000,
    maxBodyBytes: 65536, authentication: "none", bearerToken: undefined, tls: false,
  });
  assert.throws(() => parseHttpEndpoint({ protocol: "http", host: "0.0.0.0", port: 16101 }), /wildcard address/);
  assert.throws(() => parseHttpEndpoint({ protocol: "http", host: "127.0.0.1", port: 16101, tls: true }), /HTTPS\/TLS is not implemented/);
  assert.throws(() => parseHttpEndpoint({ protocol: "http", host: "127.0.0.1", port: 16101, authentication: "bearer" }), /bearerToken is required/);
  assert.throws(() => parseHttpEndpoint({ protocol: "http", host: "127.0.0.1", port: 16101, bearerToken: "secret" }), /requires bearer authentication/);
});

test("HTTP endpoint accepts only authenticated telemetry POSTs and fails closed on bad input", async () => {
  const received: unknown[] = [];
  const endpoint = new HttpTelemetryEndpoint({
    protocol: "http", host: "127.0.0.1", port: 16102, authentication: "bearer", bearerToken: "demo-token",
    onTelemetry: (message) => { received.push(message); },
  });
  await endpoint.start();
  await endpoint.start();
  try {
    assert.equal((await send(16102, "GET", "/events", undefined, { authorization: "Bearer demo-token" })).statusCode, 405);
    assert.equal((await send(16102, "POST", "/events", JSON.stringify(telemetry), { "content-type": "text/plain", authorization: "Bearer demo-token" })).statusCode, 415);
    assert.equal((await send(16102, "POST", "/events", JSON.stringify(telemetry))).statusCode, 401);
    assert.equal((await send(16102, "POST", "/events", JSON.stringify({ event: "STOP_DEVICE", data: telemetry.data }), { "content-type": "application/json", authorization: "Bearer demo-token" })).statusCode, 422);
    const accepted = await postHttpTelemetry(parseHttpEndpoint({ protocol: "http", host: "127.0.0.1", port: 16102, authentication: "bearer", bearerToken: "demo-token" }), telemetry);
    assert.equal(accepted.statusCode, 202);
    assert.equal(received.length, 1);
    assert.match(accepted.body, /accepted/);
  } finally {
    await endpoint.close();
    await endpoint.close();
  }
});

test("HTTP endpoint restarts cleanly and does not hide a connection failure", async () => {
  const endpoint = new HttpTelemetryEndpoint({ protocol: "http", host: "127.0.0.1", port: 16103 });
  const config = parseHttpEndpoint({ protocol: "http", host: "127.0.0.1", port: 16103 });
  await endpoint.start();
  await endpoint.close();
  await assert.rejects(() => postHttpTelemetry(config, telemetry), /ECONNREFUSED|connect/i);
  await endpoint.start();
  try {
    assert.equal((await postHttpTelemetry(config, telemetry)).statusCode, 202);
  } finally {
    await endpoint.close();
  }
});

function send(
  port: number,
  method: string,
  path: string,
  body: string | undefined,
  headers: Record<string, string> = {},
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const requestBody = body ?? "";
    const client = request({ host: "127.0.0.1", port, path, method, headers: { ...headers, ...(body === undefined ? {} : { "content-length": Buffer.byteLength(requestBody) }) } }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.once("end", () => resolve({ statusCode: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    client.once("error", reject);
    client.end(body);
  });
}
