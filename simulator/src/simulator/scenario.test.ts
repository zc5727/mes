import assert from "node:assert/strict";
import test from "node:test";
import { LINE_DEFINITIONS } from "../config/line-config";
import { FactorySimulator } from "./factory-simulator";

test("scenario documents round-trip and are included in replay metadata", () => {
  const timestamp = new Date("2026-08-31T00:00:00.000Z");
  const first = new FactorySimulator("scenario-tenant", 1000, () => 0.5, [LINE_DEFINITIONS[0]], []);
  first.loadScenario([
    { atSeconds: 1, command: {
      action: "fault", lineId: "line-cnc", deviceId: "cnc-01", faultType: "JAM", commandId: "scenario-jam",
    } },
    { atSeconds: 2, command: {
      action: "reset", lineId: "line-cnc", deviceId: "cnc-01", faultType: "JAM", commandId: "scenario-reset",
    } },
  ]);
  const document = JSON.parse(first.exportScenario()) as { version: number; events: unknown[] };
  assert.equal(document.version, 1);
  assert.equal(document.events.length, 2);

  const second = new FactorySimulator("scenario-tenant", 1000, () => 0.5, [LINE_DEFINITIONS[0]], []);
  second.loadScenarioDocument(first.exportScenario());
  const messages = second.tick(timestamp);
  assert.equal(messages.some((message) => message.payload.event === "alarm.created"), true);
  assert.equal(second.snapshot(timestamp)[0].status, "FAULT");
  assert.equal(second.snapshot(timestamp)[0].oee.availability, 0);
  const recovered = second.tick(new Date(timestamp.getTime() + 1000));
  assert.equal(recovered.some((message) => message.payload.event === "alarm.cleared"), true);
  assert.equal(second.snapshot(new Date(timestamp.getTime() + 1000))[0].status, "RUNNING");
  const replay = JSON.parse(second.exportReplay()) as { scenario?: unknown[] };
  assert.deepEqual(replay.scenario, document.events);
});
