import { FaultType, NetworkSimulationOptions, SimulatorOptions } from "./types";
import { ProtocolKind, parseProtocolEndpoint } from "./protocols/protocol-bridge";

const DEFAULT_TENANT_ID = "demo-tenant";
const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_TIME_SCALE = 1;

export interface CliOptions extends SimulatorOptions {
  mqttUrl?: string;
  lineConfigPath?: string;
  once: boolean;
  faults: FaultCommand[];
  clearFaults: FaultCommand[];
  paused: boolean;
  emitAgvTelemetry: boolean;
  network?: NetworkSimulationOptions;
  protocol?: ProtocolKind;
  protocolHost?: string;
  protocolPort?: number;
}

export interface FaultCommand {
  lineId: string;
  deviceId: string;
  type: FaultCommandType;
}

type FaultCommandType = FaultType;

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
  const timeScale = Number(getValue("--time-scale") ?? env.SIMULATOR_TIME_SCALE ?? DEFAULT_TIME_SCALE);
  if (!Number.isFinite(timeScale) || timeScale <= 0) throw new Error("--time-scale must be greater than 0");
  const seedValue = getValue("--seed") ?? env.SIMULATOR_SEED;
  const seed = seedValue === undefined ? undefined : Number(seedValue);
  if (seed !== undefined && !Number.isInteger(seed)) throw new Error("--seed must be an integer");

  const parseFaultCommands = (flag: string): FaultCommand[] => args
    .flatMap((arg, index) => arg === flag && args[index + 1] ? [parseFaultCommand(args[index + 1])] : []);

  const networkLatency = parseOptionalNumber(getValue("--network-latency-ms") ?? env.SIMULATOR_NETWORK_LATENCY_MS, "--network-latency-ms", 0);
  const networkDuplicateRate = parseOptionalRate(getValue("--network-duplicate-rate") ?? env.SIMULATOR_NETWORK_DUPLICATE_RATE, "--network-duplicate-rate");
  const networkDropRate = parseOptionalRate(getValue("--network-drop-rate") ?? env.SIMULATOR_NETWORK_DROP_RATE, "--network-drop-rate");
  const networkSeedValue = getValue("--network-seed") ?? env.SIMULATOR_NETWORK_SEED;
  const networkSeed = networkSeedValue === undefined ? undefined : Number(networkSeedValue);
  if (networkSeed !== undefined && !Number.isInteger(networkSeed)) throw new Error("--network-seed must be an integer");
  const network = networkLatency !== undefined || networkDuplicateRate !== undefined || networkDropRate !== undefined || networkSeed !== undefined
    ? { latencyMs: networkLatency, duplicateRate: networkDuplicateRate, dropRate: networkDropRate, seed: networkSeed }
    : undefined;
  const protocolValue = getValue("--protocol") ?? env.SIMULATOR_PROTOCOL;
  const protocol = protocolValue === undefined ? undefined : parseProtocolEndpoint({ protocol: protocolValue as ProtocolKind, host: getValue("--protocol-host") ?? env.SIMULATOR_PROTOCOL_HOST ?? "127.0.0.1", port: Number(getValue("--protocol-port") ?? env.SIMULATOR_PROTOCOL_PORT ?? defaultProtocolPort(protocolValue)) }).protocol;
  const protocolHost = protocol === undefined ? undefined : getValue("--protocol-host") ?? env.SIMULATOR_PROTOCOL_HOST ?? "127.0.0.1";
  const protocolPort = protocol === undefined ? undefined : Number(getValue("--protocol-port") ?? env.SIMULATOR_PROTOCOL_PORT ?? defaultProtocolPort(protocol));

  return {
    tenantId: getValue("--tenant") ?? env.MES_TENANT_ID ?? DEFAULT_TENANT_ID,
    intervalMs,
    mqttUrl: getValue("--mqtt") ?? env.MQTT_URL,
    lineConfigPath: getValue("--config") ?? env.SIMULATOR_LINE_CONFIG,
    once: args.includes("--once"),
    faults: parseFaultCommands("--fault"),
    clearFaults: parseFaultCommands("--clear-fault"),
    timeScale,
    seed,
    paused: args.includes("--pause"),
    emitAgvTelemetry: args.includes("--agv-telemetry"),
    network,
    protocol,
    protocolHost,
    protocolPort,
  };
}

function defaultProtocolPort(protocol: string): number {
  return protocol === "opc-ua" ? 4841 : protocol === "mtconnect" ? 5000 : 1502;
}

function parseOptionalNumber(value: string | undefined, flag: string, minimum: number): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum) throw new Error(`${flag} must be a number greater than or equal to ${minimum}`);
  return parsed;
}

function parseOptionalRate(value: string | undefined, flag: string): number | undefined {
  const parsed = parseOptionalNumber(value, flag, 0);
  if (parsed !== undefined && parsed > 1) throw new Error(`${flag} must be between 0 and 1`);
  return parsed;
}

function parseFaultCommand(value: string): FaultCommand {
  const [lineId, deviceId, type, ...extra] = value.split(":");
  if (!lineId || !deviceId || !type || extra.length > 0 || !isFaultType(type)) {
    throw new Error("Fault format must be lineId:deviceId:OVERHEAT|JAM|COMMUNICATION_LOSS|QUALITY_DRIFT|EMERGENCY_STOP|MATERIAL_SHORTAGE|QUALITY_ANOMALY");
  }
  return { lineId, deviceId, type };
}

function isFaultType(value: string): value is FaultCommandType {
  return ["OVERHEAT", "JAM", "COMMUNICATION_LOSS", "QUALITY_DRIFT", "EMERGENCY_STOP", "MATERIAL_SHORTAGE", "QUALITY_ANOMALY"].includes(value);
}
