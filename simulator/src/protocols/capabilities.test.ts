import assert from "node:assert/strict";
import test from "node:test";
import { getProtocolCapability } from "./capabilities";

test("protocol capability registry is explicit and fail-closed", () => {
  assert.equal(getProtocolCapability("MQTT").status, "IMPLEMENTED");
  assert.deepEqual(getProtocolCapability("http"), {
    status: "CONTRACT_ADAPTER_ONLY", read: true, write: false, subscribe: false,
    notes: "Canonical event adapter only; no HTTP server is opened by simulator.",
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
