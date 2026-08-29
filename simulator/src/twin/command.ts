import {
  FaultType,
  SimulatorControlAction,
  SimulatorControlCommand,
  TwinCommand,
  TwinCommandAction,
} from "../types";

const ACTIONS: TwinCommandAction[] = [
  "START_LINE",
  "STOP_LINE",
  "START_DEVICE",
  "STOP_DEVICE",
  "INJECT_FAULT",
  "RESET_FAULT",
];

const FAULT_TYPES: FaultType[] = [
  "OVERHEAT",
  "JAM",
  "COMMUNICATION_LOSS",
  "QUALITY_DRIFT",
  "EMERGENCY_STOP",
];

const CONTROL_ACTIONS: SimulatorControlAction[] = [
  "start",
  "stop",
  "pause",
  "resume",
  "speed",
  "fault",
  "reset",
  "snapshot",
  "export",
  "replay",
];

export function parseTwinCommand(payload: string): TwinCommand {
  const value: unknown = JSON.parse(payload);
  if (!isRecord(value) || typeof value.commandId !== "string" || typeof value.lineId !== "string"
    || typeof value.action !== "string" || !ACTIONS.includes(value.action as TwinCommandAction)) {
    throw new Error("Twin command requires commandId, lineId and a supported action");
  }

  if (["START_DEVICE", "STOP_DEVICE"].includes(value.action) && typeof value.deviceId !== "string") {
    throw new Error(`${value.action} requires deviceId`);
  }
  if (value.action === "INJECT_FAULT" && (typeof value.deviceId !== "string" || typeof value.faultType !== "string"
    || !FAULT_TYPES.includes(value.faultType as FaultType))) {
    throw new Error("INJECT_FAULT requires deviceId and a supported faultType");
  }

  return {
    commandId: value.commandId,
    action: value.action as TwinCommandAction,
    lineId: value.lineId,
    deviceId: typeof value.deviceId === "string" ? value.deviceId : undefined,
    faultType: typeof value.faultType === "string" ? value.faultType as FaultType : undefined,
    requestedBy: typeof value.requestedBy === "string" ? value.requestedBy : undefined,
    timestamp: typeof value.timestamp === "string" ? value.timestamp : undefined,
  };
}

/**
 * Parse the simulator control protocol used by MQTT and other adapters.
 *
 * The protocol deliberately uses lower-case actions so it remains distinct
 * from the existing line/device twin command contract.
 */
export function parseSimulatorControlCommand(payload: string): SimulatorControlCommand {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    throw new Error("Simulator control command must be valid JSON");
  }

  if (!isRecord(value) || typeof value.action !== "string"
    || !CONTROL_ACTIONS.includes(value.action as SimulatorControlAction)) {
    throw new Error(`Simulator control action must be one of: ${CONTROL_ACTIONS.join(", ")}`);
  }

  const action = value.action as SimulatorControlAction;
  const speedValue = value.speed ?? value.value;
  const faultValue = value.faultType ?? value.type;
  const command: SimulatorControlCommand = {
    action,
    commandId: optionalString(value.commandId, "commandId"),
    lineId: optionalString(value.lineId, "lineId"),
    deviceId: optionalString(value.deviceId, "deviceId"),
    faultType: optionalFaultType(faultValue),
    speed: optionalPositiveNumber(speedValue, "speed"),
    requestedBy: optionalString(value.requestedBy, "requestedBy"),
    timestamp: optionalString(value.timestamp, "timestamp"),
  };

  validateControlArguments(command);
  return command;
}

export const parseControlCommand = parseSimulatorControlCommand;

export function parseConsoleControlCommand(input: string): SimulatorControlCommand {
  const [actionValue, ...args] = input.trim().split(/\s+/).filter(Boolean);
  const action = actionValue as SimulatorControlAction | undefined;
  if (!action || !CONTROL_ACTIONS.includes(action)) {
    throw new Error(`Unknown command. Use ${CONTROL_ACTIONS.join(", ")}.`);
  }

  if (action === "speed") {
    if (args.length !== 1) throw new Error("speed requires a positive number");
    const speed = Number(args[0]);
    if (!Number.isFinite(speed) || speed <= 0) throw new Error("speed requires a positive number");
    return { action, speed };
  }

  if (action === "fault") {
    const [lineId, deviceId, faultType, ...extra] = args.length === 1 ? args[0].split(":") : args;
    if (!lineId || !deviceId || !faultType || extra.length > 0 || !isFaultType(faultType)) {
      throw new Error("fault format must be lineId:deviceId:FAULT_TYPE or lineId deviceId FAULT_TYPE");
    }
    return { action, lineId, deviceId, faultType: faultType as FaultType | undefined };
  }

  if (action === "reset" && args.length > 0) {
    const [lineId, deviceId, faultType, ...extra] = args.length === 1 ? args[0].split(":") : args;
    if (!lineId || extra.length > 0 || (faultType && !isFaultType(faultType))) {
      throw new Error("reset format must be reset, lineId, lineId:deviceId or lineId:deviceId:FAULT_TYPE");
    }
    return { action, lineId, deviceId, faultType: faultType as FaultType | undefined };
  }

  if (args.length > 0) throw new Error(`${action} does not accept arguments`);
  return { action };
}

function validateControlArguments(command: SimulatorControlCommand): void {
  if (command.action === "fault") {
    if (!command.lineId || !command.deviceId || !command.faultType) {
      throw new Error("fault requires lineId, deviceId and faultType");
    }
    return;
  }
  if (command.action === "speed" && command.speed === undefined) {
    throw new Error("speed requires a positive speed");
  }
  if (command.action !== "speed" && command.speed !== undefined) {
    throw new Error(`${command.action} does not accept speed`);
  }
  if (command.action === "reset") {
    if (command.deviceId !== undefined && command.lineId === undefined) {
      throw new Error("reset deviceId requires lineId");
    }
    if (command.faultType !== undefined && command.deviceId === undefined) {
      throw new Error("reset faultType requires deviceId");
    }
    return;
  }
  if (command.lineId !== undefined || command.deviceId !== undefined || command.faultType !== undefined) {
    throw new Error(`${command.action} does not accept line, device or fault arguments`);
  }
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) throw new Error(`${field} must be a non-empty string`);
  return value;
}

function optionalPositiveNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be a positive number`);
  }
  return value;
}

function optionalFaultType(value: unknown): FaultType | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !isFaultType(value)) throw new Error("faultType is not supported");
  return value;
}

function isFaultType(value: string): value is FaultType {
  return [
    "OVERHEAT",
    "JAM",
    "COMMUNICATION_LOSS",
    "QUALITY_DRIFT",
    "EMERGENCY_STOP",
    "MATERIAL_SHORTAGE",
    "QUALITY_ANOMALY",
  ].includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
