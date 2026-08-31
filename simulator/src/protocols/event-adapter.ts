import { DeviceStatus, FaultType, SimulationMessage } from "../types";

export interface CanonicalDeviceEvent {
  tenantId: string;
  lineId: string;
  deviceId: string;
  timestamp: string;
  status: DeviceStatus;
  temperatureCelsius: number;
  cycleTimeSeconds: number;
  totalCount: number;
  goodCount: number;
  defectCount: number;
  activeFaults: FaultType[];
  profileId?: string;
}

export interface ModbusTelemetryFrame {
  tenantId: string;
  lineId: string;
  deviceId: string;
  timestamp: string;
  registers: {
    status: number;
    temperatureCelsius: number;
    cycleTimeSeconds: number;
    totalCount: number;
    goodCount: number;
    defectCount: number;
    faultCode?: number;
  };
}

export interface OpcUaTelemetryFrame {
  tenantId: string;
  lineId: string;
  deviceId: string;
  timestamp: string;
  values: {
    status: DeviceStatus;
    temperatureCelsius: number;
    cycleTimeSeconds: number;
    totalCount: number;
    goodCount: number;
    defectCount: number;
    activeFaults?: FaultType[];
    profileId?: string;
  };
}

export interface MtConnectTelemetryFrame {
  tenantId: string;
  lineId: string;
  deviceId: string;
  timestamp: string;
  values: OpcUaTelemetryFrame["values"];
}

const MQTT_TELEMETRY_TOPIC = /^mes\/simulator\/([^/]+)\/lines\/([^/]+)\/devices\/([^/]+)\/telemetry$/;
const MODBUS_STATUS: Record<number, DeviceStatus> = {
  1: "RUNNING",
  2: "IDLE",
  3: "WARNING",
  4: "STOPPED",
  5: "FAULT",
  6: "OFFLINE",
};
const MODBUS_FAULTS: Record<number, FaultType> = {
  1: "OVERHEAT",
  2: "JAM",
  3: "COMMUNICATION_LOSS",
  4: "QUALITY_DRIFT",
  5: "EMERGENCY_STOP",
  6: "MATERIAL_SHORTAGE",
  7: "QUALITY_ANOMALY",
};

export function adaptMqttTelemetry(topic: string, payload: string | Record<string, unknown>): SimulationMessage {
  const match = MQTT_TELEMETRY_TOPIC.exec(topic);
  if (!match) throw new Error(`unsupported MQTT telemetry topic: ${topic}`);
  const envelope = parseEnvelope(payload);
  if (envelope.event !== "device.telemetry") throw new Error("MQTT payload event must be device.telemetry");
  const data = canonicalize(envelope.data, { tenantId: match[1], lineId: match[2], deviceId: match[3] });
  return { topic, payload: { event: "device.telemetry", data } };
}

export function adaptHttpEvent(payload: string | Record<string, unknown>): SimulationMessage {
  const envelope = parseEnvelope(payload);
  if (envelope.event !== "device.telemetry") throw new Error("HTTP event must be device.telemetry");
  const data = canonicalize(envelope.data);
  return {
    topic: `mes/http/${data.tenantId}/lines/${data.lineId}/devices/${data.deviceId}/telemetry`,
    payload: { event: "device.telemetry", data },
  };
}

export function adaptModbusTelemetry(frame: ModbusTelemetryFrame): SimulationMessage {
  const status = MODBUS_STATUS[frame.registers.status];
  if (!status) throw new Error(`unsupported Modbus status register: ${frame.registers.status}`);
  const activeFaults = frame.registers.faultCode ? [MODBUS_FAULTS[frame.registers.faultCode]] : [];
  if (activeFaults.some((fault) => !fault)) throw new Error(`unsupported Modbus fault register: ${frame.registers.faultCode}`);
  const data = canonicalize({
    ...frame.registers,
    status,
    activeFaults,
  }, frame);
  return { topic: `mes/modbus/${frame.tenantId}/lines/${frame.lineId}/devices/${frame.deviceId}/telemetry`, payload: { event: "device.telemetry", data } };
}

export function adaptOpcUaTelemetry(frame: OpcUaTelemetryFrame): SimulationMessage {
  const data = canonicalize({ ...frame.values }, frame);
  return { topic: `mes/opcua/${frame.tenantId}/lines/${frame.lineId}/devices/${frame.deviceId}/telemetry`, payload: { event: "device.telemetry", data } };
}

export function adaptMtConnectTelemetry(frame: MtConnectTelemetryFrame): SimulationMessage {
  const data = canonicalize({ ...frame.values }, frame);
  return { topic: `mes/mtconnect/${frame.tenantId}/lines/${frame.lineId}/devices/${frame.deviceId}/telemetry`, payload: { event: "device.telemetry", data } };
}

function parseEnvelope(payload: string | Record<string, unknown>): { event: unknown; data: Record<string, unknown> } {
  const parsed: unknown = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!isRecord(parsed) || !isRecord(parsed.data)) throw new Error("event payload must contain an object data field");
  return { event: parsed.event, data: parsed.data };
}

function canonicalize(
  value: Record<string, unknown>,
  identity: Partial<Pick<CanonicalDeviceEvent, "tenantId" | "lineId" | "deviceId" | "timestamp">> = {},
): CanonicalDeviceEvent {
  const tenantId = stringValue(identity.tenantId ?? value.tenantId, "tenantId");
  const lineId = stringValue(identity.lineId ?? value.lineId, "lineId");
  const deviceId = stringValue(identity.deviceId ?? value.deviceId, "deviceId");
  const timestamp = stringValue(identity.timestamp ?? value.timestamp, "timestamp");
  validateIdentity(value, identity, { tenantId, lineId, deviceId, timestamp });
  if (Number.isNaN(Date.parse(timestamp))) throw new Error("timestamp must be a valid ISO date");
  const status = value.status;
  if (!isDeviceStatus(status)) throw new Error(`unsupported device status: ${String(status)}`);
  const activeFaults = value.activeFaults ?? [];
  if (!Array.isArray(activeFaults) || !activeFaults.every(isFaultType)) throw new Error("activeFaults contains an unsupported fault type");
  const totalCount = nonNegativeInteger(value.totalCount, "totalCount");
  const goodCount = nonNegativeInteger(value.goodCount, "goodCount");
  const defectCount = nonNegativeInteger(value.defectCount, "defectCount");
  if (goodCount + defectCount !== totalCount) throw new Error("goodCount plus defectCount must equal totalCount");
  const telemetry: CanonicalDeviceEvent = {
    tenantId,
    lineId,
    deviceId,
    timestamp,
    status,
    temperatureCelsius: finiteNumber(value.temperatureCelsius, "temperatureCelsius"),
    cycleTimeSeconds: finiteNumber(value.cycleTimeSeconds, "cycleTimeSeconds"),
    totalCount,
    goodCount,
    defectCount,
    activeFaults: [...activeFaults],
  };
  if (typeof value.profileId === "string" && value.profileId.trim()) {
    telemetry.profileId = value.profileId;
  }
  return telemetry;
}

function validateIdentity(
  value: Record<string, unknown>,
  identity: Partial<Pick<CanonicalDeviceEvent, "tenantId" | "lineId" | "deviceId" | "timestamp">>,
  resolved: Pick<CanonicalDeviceEvent, "tenantId" | "lineId" | "deviceId" | "timestamp">,
): void {
  for (const field of ["tenantId", "lineId", "deviceId", "timestamp"] as const) {
    if (identity[field] !== undefined && value[field] !== undefined && value[field] !== resolved[field]) {
      throw new Error(`${field} does not match protocol identity`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function stringValue(value: unknown, field: string): string { if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`); return value; }
function finiteNumber(value: unknown, field: string): number { if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${field} must be finite`); return value; }
function nonNegativeInteger(value: unknown, field: string): number { const number = finiteNumber(value, field); if (!Number.isInteger(number) || number < 0) throw new Error(`${field} must be a non-negative integer`); return number; }
function isDeviceStatus(value: unknown): value is DeviceStatus { return typeof value === "string" && ["RUNNING", "IDLE", "WARNING", "STOPPED", "FAULT", "OFFLINE"].includes(value); }
function isFaultType(value: unknown): value is FaultType { return typeof value === "string" && ["OVERHEAT", "JAM", "COMMUNICATION_LOSS", "QUALITY_DRIFT", "EMERGENCY_STOP", "MATERIAL_SHORTAGE", "QUALITY_ANOMALY"].includes(value); }
