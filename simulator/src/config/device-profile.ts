import { DeviceKind, FaultType } from "../types";

export type DeviceProtocol = "MQTT" | "OPC_UA" | "MODBUS_TCP" | "MTCONNECT";
export type ProfileAccess = "READ" | "WRITE" | "READ_WRITE";

export interface ProfileDataPoint {
  key: string;
  dataType: "BOOLEAN" | "INTEGER" | "NUMBER" | "STRING";
  access: ProfileAccess;
  /** Synthetic address used only by the simulator contract; never a vendor NodeID. */
  address: string;
  unit?: string;
}

export interface DeviceProfile {
  id: string;
  mechanicalType: string;
  controller: string;
  deviceKinds: DeviceKind[];
  protocol: DeviceProtocol;
  sampleIntervalMs: number;
  modelKey: string;
  dataPoints: ProfileDataPoint[];
  controls: string[];
  faultTypes: FaultType[];
  compatibility: "SIMULATED_CONTRACT_ONLY";
}

const COMMON_POINTS: ProfileDataPoint[] = [
  { key: "status", dataType: "STRING", access: "READ", address: "sim/status" },
  { key: "temperatureCelsius", dataType: "NUMBER", access: "READ", address: "sim/temperatureCelsius", unit: "°C" },
  { key: "cycleTimeSeconds", dataType: "NUMBER", access: "READ", address: "sim/cycleTimeSeconds", unit: "s" },
  { key: "totalCount", dataType: "INTEGER", access: "READ", address: "sim/totalCount" },
  { key: "goodCount", dataType: "INTEGER", access: "READ", address: "sim/goodCount" },
  { key: "defectCount", dataType: "INTEGER", access: "READ", address: "sim/defectCount" },
];

const COMMON_FAULTS: FaultType[] = [
  "OVERHEAT", "JAM", "COMMUNICATION_LOSS", "QUALITY_DRIFT", "EMERGENCY_STOP", "MATERIAL_SHORTAGE", "QUALITY_ANOMALY",
];

function profile(
  id: string,
  mechanicalType: string,
  controller: string,
  protocol: DeviceProtocol,
  modelKey: string,
  deviceKinds: DeviceKind[],
): DeviceProfile {
  return {
    id,
    mechanicalType,
    controller,
    deviceKinds,
    protocol,
    sampleIntervalMs: 1000,
    modelKey,
    dataPoints: COMMON_POINTS.map((point) => ({ ...point, address: `${id}/${point.address}` })),
    controls: ["Start", "Stop", "Pause", "Resume", "Reset", "EmergencyStop"],
    faultTypes: [...COMMON_FAULTS],
    compatibility: "SIMULATED_CONTRACT_ONLY",
  };
}

/** Built-in profiles use synthetic addresses and make no real vendor compatibility claim. */
export const DEVICE_PROFILES: DeviceProfile[] = [
  profile("generic-cnc-opcua", "三轴铣床", "Generic Controller", "OPC_UA", "machine.cnc.generic", ["CNC"]),
  profile("siemens-sinumerik-opcua", "五轴加工中心", "SINUMERIK (simulated label)", "OPC_UA", "machine.cnc.5axis", ["CNC"]),
  profile("fanuc-cnc-mtconnect", "数控车床", "FANUC (simulated label)", "MTCONNECT", "machine.cnc.lathe", ["CNC"]),
  profile("generic-cnc-modbus", "通用数控机床", "Generic Controller", "MODBUS_TCP", "machine.cnc.generic", ["CNC"]),
  profile("generic-machine-mqtt", "通用生产设备", "Generic Controller", "MQTT", "machine.generic", ["ROBOT", "WELDER", "VISION", "CONVEYOR"]),
];

export function getDeviceProfile(profileId: string): DeviceProfile {
  const found = DEVICE_PROFILES.find((item) => item.id === profileId);
  if (!found) throw new Error(`Unknown device profile '${profileId}'`);
  return found;
}

export function validateDeviceProfile(value: unknown, index = 0): asserts value is DeviceProfile {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.mechanicalType !== "string"
    || typeof value.controller !== "string" || !isProtocol(value.protocol) || !Array.isArray(value.deviceKinds)
    || value.deviceKinds.length === 0 || typeof value.sampleIntervalMs !== "number"
    || !Number.isInteger(value.sampleIntervalMs) || value.sampleIntervalMs < 100
    || typeof value.modelKey !== "string" || !Array.isArray(value.dataPoints) || !Array.isArray(value.controls)
    || !Array.isArray(value.faultTypes) || value.compatibility !== "SIMULATED_CONTRACT_ONLY") {
    throw new Error(`Invalid device profile at index ${index}`);
  }
  const keys = new Set<string>();
  value.dataPoints.forEach((point, pointIndex) => {
    if (!isRecord(point) || typeof point.key !== "string" || typeof point.address !== "string"
      || !isDataType(point.dataType) || !isAccess(point.access)) {
      throw new Error(`Invalid data point at profile index ${index}, point index ${pointIndex}`);
    }
    if (keys.has(point.key)) throw new Error(`Duplicate data point '${point.key}' in profile '${value.id}'`);
    keys.add(point.key);
  });
}

function isProtocol(value: unknown): value is DeviceProtocol {
  return ["MQTT", "OPC_UA", "MODBUS_TCP", "MTCONNECT"].includes(value as string);
}
function isDataType(value: unknown): value is ProfileDataPoint["dataType"] {
  return ["BOOLEAN", "INTEGER", "NUMBER", "STRING"].includes(value as string);
}
function isAccess(value: unknown): value is ProfileAccess {
  return ["READ", "WRITE", "READ_WRITE"].includes(value as string);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
