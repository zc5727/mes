import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { LINE_DEFINITIONS } from "../config/line-config";
import { FactorySimulator } from "./factory-simulator";
import { parseReplayDocument, parseScenarioDocument, readReplayDocument } from "./replay";

test("validates replay metadata, frame order and scenario commands", () => {
  const factory = new FactorySimulator("replay-tenant", 1000, () => 0.5, [LINE_DEFINITIONS[0]], [], false, { seed: 7 }, 42);
  const timestamp = new Date("2026-08-31T00:00:00.000Z");
  factory.tick(timestamp);
  const replay = parseReplayDocument(factory.exportReplay());

  assert.equal(replay.seed, 42);
  assert.equal(replay.networkSeed, 7);
  assert.equal(replay.frames[0].sequence, 0);
  assert.throws(() => parseReplayDocument({ ...replay, frames: [{ ...replay.frames[0], sequence: 1 }] }), /not contiguous/);
  assert.throws(() => parseReplayDocument({ ...replay, seed: "42" }), /seed must be an integer/);
  assert.throws(() => parseScenarioDocument({ version: 1, events: [{ atSeconds: 1, command: { action: "fault" } }] }), /invalid command/);
});

test("exports a replay file that a separate simulator process can publish", () => {
  const directory = mkdtempSync(join(tmpdir(), "mes-replay-"));
  const path = join(directory, "replay.json");
  const factory = new FactorySimulator("cross-process-tenant", 1000, () => 0.5, [LINE_DEFINITIONS[0]], [], false, { seed: 3 }, 11);
  factory.tick(new Date("2026-08-31T00:00:00.000Z"));
  const document = parseReplayDocument(factory.exportReplay());
  writeFileSync(path, JSON.stringify(document));

  try {
    const result = spawnSync(process.execPath, [resolve(__dirname, "..", "index.js"), "--replay-file", path], {
      encoding: "utf8",
      env: { ...process.env, MQTT_URL: "" },
    });
    assert.equal(result.status, 0, result.stderr);
    const published = result.stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const expected = document.frames.flatMap((frame) => frame.messages).map((message) => ({ topic: message.topic, ...message.payload }));
    assert.deepEqual(published, expected);
    assert.deepEqual(readReplayDocument(path), document);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
