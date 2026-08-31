import assert from "node:assert/strict";
import test from "node:test";
import {
  parseConsoleControlCommand,
  parseSimulatorControlCommand,
  parseTwinCommand,
} from "./command";

test("parses JSON control commands and the speed value alias", () => {
  assert.deepEqual(parseSimulatorControlCommand('{"action":"speed","value":2}'), {
    action: "speed",
    commandId: undefined,
    lineId: undefined,
    deviceId: undefined,
    faultType: undefined,
    speed: 2,
    requestedBy: undefined,
    timestamp: undefined,
  });
  assert.equal(parseSimulatorControlCommand('{"action":"fault","lineId":"l1","deviceId":"d1","type":"JAM"}').faultType, "JAM");
});

test("parses console control commands without changing the legacy commands", () => {
  assert.deepEqual(parseConsoleControlCommand("speed 5"), { action: "speed", speed: 5 });
  assert.deepEqual(parseConsoleControlCommand("fault line-cnc:cnc-01:OVERHEAT"), {
    action: "fault",
    lineId: "line-cnc",
    deviceId: "cnc-01",
    faultType: "OVERHEAT",
  });
  assert.deepEqual(parseConsoleControlCommand("fault line-cnc cnc-01 JAM"), {
    action: "fault",
    lineId: "line-cnc",
    deviceId: "cnc-01",
    faultType: "JAM",
  });
  assert.deepEqual(parseConsoleControlCommand("reset line-cnc:cnc-01:OVERHEAT"), {
    action: "reset",
    lineId: "line-cnc",
    deviceId: "cnc-01",
    faultType: "OVERHEAT",
  });
});

test("rejects incomplete or invalid control commands", () => {
  assert.throws(() => parseSimulatorControlCommand('{"action":"speed","speed":0}'), /positive number/);
  assert.throws(() => parseSimulatorControlCommand('{"action":"fault","lineId":"l1"}'), /requires lineId/);
  assert.throws(() => parseConsoleControlCommand("pause now"), /does not accept arguments/);
});

test("twin commands accept the complete simulator fault vocabulary", () => {
  const command = parseTwinCommand(JSON.stringify({
    commandId: "fault-1", action: "INJECT_FAULT", lineId: "line-cnc", deviceId: "cnc-01", faultType: "QUALITY_ANOMALY",
  }));
  assert.equal(command.faultType, "QUALITY_ANOMALY");
});
