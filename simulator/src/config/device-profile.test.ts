import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEVICE_PROFILES, validateDeviceProfile } from "./device-profile";
import { LINE_DEFINITIONS, loadLineDefinitions, loadSimulatorConfig } from "./line-config";

test("built-in line devices resolve to synthetic, contract-only profiles", () => {
  assert.equal(LINE_DEFINITIONS.every((line) => line.devices.every((device) => device.profileId)), true);
  assert.equal(DEVICE_PROFILES.every((profile) => profile.compatibility === "SIMULATED_CONTRACT_ONLY"), true);
  assert.equal(DEVICE_PROFILES.some((profile) => profile.protocol === "MTCONNECT"), true);
});

test("loads embedded profiles and fills an omitted profile from device kind", () => {
  const directory = mkdtempSync(join(tmpdir(), "mes-profile-"));
  const path = join(directory, "config.json");
  writeFileSync(path, JSON.stringify({
    profiles: DEVICE_PROFILES,
    lines: [{ id: "line-profile", code: "P01", name: "Profile 线", product: "产品", idealCycleTimeSeconds: 10, devices: [
      { id: "machine-01", name: "机床", kind: "CNC", cycleTimeSeconds: 10 },
    ] }],
  }));
  try {
    const config = loadSimulatorConfig(path);
    assert.equal(config.lines[0].devices[0].profileId, "generic-cnc-opcua");
    assert.equal(loadLineDefinitions(path)[0].devices[0].profileId, "generic-cnc-opcua");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects a profile that cannot drive the declared device kind", () => {
  const directory = mkdtempSync(join(tmpdir(), "mes-profile-"));
  const path = join(directory, "config.json");
  writeFileSync(path, JSON.stringify({ lines: [{ id: "line-profile", code: "P01", name: "Profile 线", product: "产品", idealCycleTimeSeconds: 10, devices: [
    { id: "robot-01", name: "机器人", kind: "ROBOT", cycleTimeSeconds: 10, profileId: "generic-cnc-opcua" },
  ] }] }));
  try {
    assert.throws(() => loadSimulatorConfig(path), /is not supported by profile/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects a profile with an undeclared kind or fault", () => {
  assert.throws(() => validateDeviceProfile({
    ...DEVICE_PROFILES[0],
    deviceKinds: ["UNKNOWN"],
  }), /Invalid device profile/);
  assert.throws(() => validateDeviceProfile({
    ...DEVICE_PROFILES[0],
    faultTypes: ["UNKNOWN"],
  }), /Invalid device profile/);
});
