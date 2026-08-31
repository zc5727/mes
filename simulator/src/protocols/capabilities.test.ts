import assert from "node:assert/strict";
import test from "node:test";
import { getProtocolCapability } from "./capabilities";

test("protocol capability registry is explicit and fail-closed", () => {
  assert.equal(getProtocolCapability("MQTT").status, "IMPLEMENTED");
  assert.deepEqual(getProtocolCapability("http"), {
    status: "SYNTHETIC_CONTRACT", read: true, write: false, subscribe: false,
    security: { tls: "NOT_IMPLEMENTED", authentication: "NONE_OR_BEARER", certificates: "NOT_IMPLEMENTED", permissions: "TELEMETRY_INGEST_ONLY" },
    notes: "Strict local POST /events ingest; no control writes, HTTPS or vendor compatibility.",
  });
  assert.equal(getProtocolCapability("websocket").status, "NOT_IMPLEMENTED");
  assert.equal(getProtocolCapability("focas").status, "NOT_IMPLEMENTED");
  assert.throws(() => getProtocolCapability("unknown-protocol"), /Unsupported protocol/);
});

test("synthetic protocol contracts are read-only", () => {
  for (const protocol of ["modbus-tcp", "opc-ua", "mtconnect"]) {
    const capability = getProtocolCapability(protocol);
    assert.equal(capability.status, "SYNTHETIC_CONTRACT");
    assert.equal(capability.write, false);
  }
});

test("declares TLS, authentication, certificate and permission boundaries for every transport", () => {
  const mqtt = getProtocolCapability("mqtt");
  assert.deepEqual(mqtt.security, {
    tls: "URL_SCHEME_SUPPORTED", authentication: "URL_CREDENTIALS_SUPPORTED", certificates: "NOT_EXPOSED", permissions: "BROKER_DEFINED",
  });
  assert.deepEqual(getProtocolCapability("modbus-tcp").security, {
    tls: "NOT_APPLICABLE", authentication: "NOT_IMPLEMENTED", certificates: "NOT_APPLICABLE", permissions: "READ_ONLY",
  });
  assert.deepEqual(getProtocolCapability("opc-ua").security, {
    tls: "NOT_IMPLEMENTED", authentication: "ANONYMOUS_ONLY", certificates: "NOT_IMPLEMENTED", permissions: "READ_ONLY",
  });
  assert.deepEqual(getProtocolCapability("mtconnect").security, {
    tls: "NOT_IMPLEMENTED", authentication: "NOT_IMPLEMENTED", certificates: "NOT_IMPLEMENTED", permissions: "READ_ONLY",
  });
});
