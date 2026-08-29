import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadLineDefinitions } from "./line-config";

test("accepts the object-wrapped line configuration contract", () => {
  const directory = mkdtempSync(join(tmpdir(), "mes-line-config-"));
  const path = join(directory, "lines.json");
  writeFileSync(path, JSON.stringify({ lines: [{
    id: "line-test",
    code: "T01",
    name: "测试线",
    product: "测试产品",
    idealCycleTimeSeconds: 10,
    devices: [{ id: "device-test", name: "测试设备", kind: "CNC", cycleTimeSeconds: 10 }],
  }] }));

  try {
    assert.equal(loadLineDefinitions(path)[0].id, "line-test");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects duplicate line and device identifiers in configuration", () => {
  const directory = mkdtempSync(join(tmpdir(), "mes-line-config-"));
  const path = join(directory, "lines.json");
  const line = {
    id: "line-test",
    code: "T01",
    name: "测试线",
    product: "测试产品",
    idealCycleTimeSeconds: 10,
    devices: [
      { id: "device-test", name: "测试设备", kind: "CNC", cycleTimeSeconds: 10 },
      { id: "device-test", name: "重复设备", kind: "CNC", cycleTimeSeconds: 10 },
    ],
  };
  writeFileSync(path, JSON.stringify([line, { ...line, devices: [line.devices[0]] }]));

  try {
    assert.throws(() => loadLineDefinitions(path), /Duplicate device id/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

