import { FaultType, TwinCommand, TwinCommandAction } from "../types";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
