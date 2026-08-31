import { readFileSync } from "node:fs";
import { parseSimulatorControlCommand } from "../twin/command";
import type { ReplayDocument, ReplayFrame, ScenarioDocument, ScenarioEvent, SimulationMessage, SimulatorControlCommand } from "../types";

/** Parse and validate a replay document before it is accepted by another process. */
export function parseReplayDocument(input: string | unknown): ReplayDocument {
  const parsed = parseJson(input, "Replay document");
  validateReplayDocument(parsed);

  const scenario = parsed.scenario === undefined
    ? undefined
    : parseScenarioDocument({ version: 1, events: parsed.scenario }).events;
  return {
    version: 1,
    tenantId: parsed.tenantId,
    intervalMs: parsed.intervalMs,
    timeScale: parsed.timeScale,
    ...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
    ...(parsed.networkSeed === undefined ? {} : { networkSeed: parsed.networkSeed }),
    ...(scenario === undefined ? {} : { scenario }),
    frames: parsed.frames.map(cloneReplayFrame),
  };
}

/** Read a replay document from disk with the same validation as stdin/API input. */
export function readReplayDocument(filePath: string): ReplayDocument {
  if (!filePath.trim()) throw new Error("Replay file path is required");
  try {
    return parseReplayDocument(readFileSync(filePath, "utf8"));
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith("Replay document")) throw error;
    throw new Error(`Replay document could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Parse and normalize a scenario document before it is scheduled. */
export function parseScenarioDocument(input: string | unknown): ScenarioDocument {
  const parsed = parseJson(input, "Scenario document");
  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.events)) {
    throw new Error("Scenario document must contain version 1 and an events array");
  }

  const events = parsed.events.map((event, index) => {
    if (!isRecord(event) || typeof event.atSeconds !== "number" || !Number.isFinite(event.atSeconds) || event.atSeconds < 0 || !isRecord(event.command)) {
      throw new Error(`Scenario event at index ${index} is invalid`);
    }
    let command: SimulatorControlCommand;
    try {
      command = parseSimulatorControlCommand(JSON.stringify(event.command));
    } catch (error: unknown) {
      throw new Error(`Scenario event at index ${index} has an invalid command: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { atSeconds: event.atSeconds, command } satisfies ScenarioEvent;
  });

  return { version: 1, events };
}

export function validateReplayDocument(value: unknown): asserts value is ReplayDocument {
  if (!isRecord(value) || value.version !== 1 || typeof value.tenantId !== "string" || !value.tenantId.trim()
    || typeof value.intervalMs !== "number" || !Number.isInteger(value.intervalMs) || value.intervalMs < 100
    || typeof value.timeScale !== "number" || !Number.isFinite(value.timeScale) || value.timeScale <= 0
    || !Array.isArray(value.frames)) {
    throw new Error("Replay document must contain version 1, tenantId, intervalMs, timeScale and frames");
  }
  validateOptionalSeed(value.seed, "seed");
  validateOptionalSeed(value.networkSeed, "networkSeed");
  if (value.scenario !== undefined && !Array.isArray(value.scenario)) throw new Error("Replay document scenario must be an events array");

  let previousTimestamp = "";
  value.frames.forEach((frame, index) => {
    if (!isRecord(frame) || frame.sequence !== index || typeof frame.timestamp !== "string"
      || Number.isNaN(Date.parse(frame.timestamp)) || !Array.isArray(frame.messages)) {
      throw new Error(`Replay frame at index ${index} is invalid or not contiguous`);
    }
    if (previousTimestamp && frame.timestamp < previousTimestamp) throw new Error(`Replay frame at index ${index} is out of timestamp order`);
    previousTimestamp = frame.timestamp;
    frame.messages.forEach((message, messageIndex) => validateMessage(message, index, messageIndex));
  });
}

function validateMessage(value: unknown, frameIndex: number, messageIndex: number): asserts value is SimulationMessage {
  if (!isRecord(value) || typeof value.topic !== "string" || !value.topic.trim() || !isRecord(value.payload)
    || typeof value.payload.event !== "string" || !value.payload.event.trim()) {
    throw new Error(`Replay message at frame ${frameIndex}, index ${messageIndex} is invalid`);
  }
}

function cloneReplayFrame(frame: ReplayFrame): ReplayFrame {
  return {
    sequence: frame.sequence,
    timestamp: frame.timestamp,
    messages: JSON.parse(JSON.stringify(frame.messages)) as SimulationMessage[],
  };
}

function parseJson(input: string | unknown, name: string): Record<string, unknown> {
  let parsed: unknown = input;
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input);
    } catch (error: unknown) {
      throw new Error(`${name} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!isRecord(parsed)) throw new Error(`${name} must be a JSON object`);
  return parsed;
}

function validateOptionalSeed(value: unknown, field: string): void {
  if (value !== undefined && (!Number.isInteger(value) || typeof value !== "number")) {
    throw new Error(`Replay document ${field} must be an integer`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
