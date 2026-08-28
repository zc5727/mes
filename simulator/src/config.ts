import { SimulatorOptions } from "./types";

const DEFAULT_TENANT_ID = "demo-tenant";
const DEFAULT_INTERVAL_MS = 1000;

export interface CliOptions extends SimulatorOptions {
  mqttUrl?: string;
  lineConfigPath?: string;
  once: boolean;
  faults: FaultCommand[];
  clearFaults: FaultCommand[];
}

export interface FaultCommand {
  lineId: string;
  deviceId: string;
  type: FaultCommandType;
}

type FaultCommandType = "OVERHEAT" | "JAM" | "COMMUNICATION_LOSS" | "QUALITY_DRIFT" | "EMERGENCY_STOP";

export function parseCliArgs(args: string[], env: NodeJS.ProcessEnv = process.env): CliOptions {
  const getValue = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };

  const intervalValue = getValue("--interval-ms") ?? env.SIMULATOR_INTERVAL_MS;
  const intervalMs = intervalValue === undefined ? DEFAULT_INTERVAL_MS : Number(intervalValue);
  if (!Number.isFinite(intervalMs) || intervalMs < 100) {
    throw new Error("--interval-ms must be a number greater than or equal to 100");
  }

  const parseFaultCommands = (flag: string): FaultCommand[] => args
    .flatMap((arg, index) => arg === flag && args[index + 1] ? [parseFaultCommand(args[index + 1])] : []);

  return {
    tenantId: getValue("--tenant") ?? env.MES_TENANT_ID ?? DEFAULT_TENANT_ID,
    intervalMs,
    mqttUrl: getValue("--mqtt") ?? env.MQTT_URL,
    lineConfigPath: getValue("--config") ?? env.SIMULATOR_LINE_CONFIG,
    once: args.includes("--once"),
    faults: parseFaultCommands("--fault"),
    clearFaults: parseFaultCommands("--clear-fault"),
  };
}

function parseFaultCommand(value: string): FaultCommand {
  const [lineId, deviceId, type, ...extra] = value.split(":");
  if (!lineId || !deviceId || !type || extra.length > 0 || !isFaultType(type)) {
    throw new Error("Fault format must be lineId:deviceId:OVERHEAT|JAM|COMMUNICATION_LOSS|QUALITY_DRIFT|EMERGENCY_STOP");
  }
  return { lineId, deviceId, type };
}

function isFaultType(value: string): value is FaultCommandType {
  return ["OVERHEAT", "JAM", "COMMUNICATION_LOSS", "QUALITY_DRIFT", "EMERGENCY_STOP"].includes(value);
}
