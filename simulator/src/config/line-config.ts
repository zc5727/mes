import { readFileSync } from "node:fs";
import { DEVICE_PROFILES, validateDeviceProfile, type DeviceProfile } from "./device-profile";
import { AgvDefinition, DeviceKind, LineDefinition } from "../types";

export interface SimulatorConfig {
  lines: LineDefinition[];
  profiles: DeviceProfile[];
  agvs: AgvDefinition[];
}

export const AGV_DEFINITIONS: AgvDefinition[] = [
  { id: "agv-01", name: "一号物流 AGV", lineId: "line-cnc", capacity: 100, speedMetersPerSecond: 1.2 },
  { id: "agv-02", name: "二号物流 AGV", lineId: "line-assembly", capacity: 100, speedMetersPerSecond: 1.0 },
  { id: "agv-03", name: "三号物流 AGV", lineId: "line-welding", capacity: 120, speedMetersPerSecond: 0.9 },
  { id: "agv-04", name: "四号物流 AGV", lineId: "line-vision", capacity: 80, speedMetersPerSecond: 1.1 },
];

export const LINE_DEFINITIONS: LineDefinition[] = [
  {
    id: "line-cnc",
    code: "L01",
    name: "CNC加工线",
    product: "精密铝合金壳体",
    idealCycleTimeSeconds: 42,
    devices: [
      { id: "cnc-01", name: "CNC-01 加工中心", kind: "CNC", cycleTimeSeconds: 42, profileId: "generic-cnc-opcua" },
      { id: "cnc-02", name: "CNC-02 加工中心", kind: "CNC", cycleTimeSeconds: 45, profileId: "siemens-sinumerik-opcua" },
      { id: "cnc-03", name: "清洗与上下料单元", kind: "CONVEYOR", cycleTimeSeconds: 18, profileId: "generic-machine-mqtt" },
    ],
  },
  {
    id: "line-assembly",
    code: "L02",
    name: "装配线",
    product: "智能控制模块",
    idealCycleTimeSeconds: 35,
    devices: [
      { id: "asm-01", name: "螺钉锁付机器人", kind: "ROBOT", cycleTimeSeconds: 35, profileId: "generic-machine-mqtt" },
      { id: "asm-02", name: "压装工作站", kind: "ROBOT", cycleTimeSeconds: 38, profileId: "generic-machine-mqtt" },
      { id: "asm-03", name: "装配输送线", kind: "CONVEYOR", cycleTimeSeconds: 20, profileId: "generic-machine-mqtt" },
    ],
  },
  {
    id: "line-welding",
    code: "L03",
    name: "焊接线",
    product: "结构件总成",
    idealCycleTimeSeconds: 55,
    devices: [
      { id: "weld-01", name: "六轴焊接机器人", kind: "WELDER", cycleTimeSeconds: 55, profileId: "generic-machine-mqtt" },
      { id: "weld-02", name: "焊缝打磨单元", kind: "WELDER", cycleTimeSeconds: 48, profileId: "generic-machine-mqtt" },
      { id: "weld-03", name: "焊后输送线", kind: "CONVEYOR", cycleTimeSeconds: 22, profileId: "generic-machine-mqtt" },
    ],
  },
  {
    id: "line-vision",
    code: "L04",
    name: "视觉检测线",
    product: "成品外观与尺寸检测",
    idealCycleTimeSeconds: 28,
    devices: [
      { id: "vision-01", name: "2D视觉检测站", kind: "VISION", cycleTimeSeconds: 28, profileId: "generic-machine-mqtt" },
      { id: "vision-02", name: "3D尺寸检测站", kind: "VISION", cycleTimeSeconds: 32, profileId: "generic-machine-mqtt" },
      { id: "vision-03", name: "分拣输送单元", kind: "CONVEYOR", cycleTimeSeconds: 18, profileId: "generic-machine-mqtt" },
    ],
  },
];

export function loadLineDefinitions(filePath?: string): LineDefinition[] {
  return loadSimulatorConfig(filePath).lines;
}

export function loadSimulatorConfig(filePath?: string): SimulatorConfig {
  if (!filePath) return { lines: LINE_DEFINITIONS, profiles: DEVICE_PROFILES, agvs: AGV_DEFINITIONS };

  const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
  const definitions = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.lines)
      ? parsed.lines
      : undefined;

  if (!definitions || definitions.length === 0) {
    throw new Error("Line config must be an array or an object with a non-empty 'lines' array");
  }

  const profiles = isRecord(parsed) && Array.isArray(parsed.profiles) ? parsed.profiles : DEVICE_PROFILES;
  const profileIds = new Set<string>();
  profiles.forEach((profile, index) => {
    validateDeviceProfile(profile, index);
    if (profileIds.has(profile.id)) throw new Error(`Duplicate device profile '${profile.id}'`);
    profileIds.add(profile.id);
  });

  const lineIds = new Set<string>();
  definitions.forEach((definition, index) => {
    validateLineDefinition(definition, index, profiles);
    const lineId = (definition as Record<string, unknown>).id as string;
    if (lineIds.has(lineId)) throw new Error(`Duplicate line id '${lineId}'`);
    lineIds.add(lineId);
  });
  const lines = (definitions as LineDefinition[]).map((line) => ({
    ...line,
    devices: line.devices.map((device) => ({
      ...device,
      profileId: device.profileId ?? defaultProfileId(device.kind, profiles),
    })),
  }));
  const agvs = isRecord(parsed) && Array.isArray(parsed.agvs) ? parsed.agvs as AgvDefinition[] : AGV_DEFINITIONS;
  return { lines, profiles, agvs };
}

function validateLineDefinition(value: unknown, index: number, profiles: DeviceProfile[] = DEVICE_PROFILES): void {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.code !== "string" || typeof value.name !== "string"
    || typeof value.product !== "string" || typeof value.idealCycleTimeSeconds !== "number" || value.idealCycleTimeSeconds <= 0 || !Array.isArray(value.devices)
    || value.devices.length === 0) {
    throw new Error(`Invalid line definition at index ${index}`);
  }

  const deviceIds = new Set<string>();
  value.devices.forEach((device, deviceIndex) => {
    if (!isRecord(device) || typeof device.id !== "string" || typeof device.name !== "string"
      || !isDeviceKind(device.kind) || typeof device.cycleTimeSeconds !== "number" || device.cycleTimeSeconds <= 0) {
      throw new Error(`Invalid device definition at line index ${index}, device index ${deviceIndex}`);
    }
    if (deviceIds.has(device.id)) throw new Error(`Duplicate device id '${device.id}' at line index ${index}`);
    if (device.profileId !== undefined) {
      const profile = profiles.find((item) => item.id === device.profileId);
      if (!profile) throw new Error(`Unknown device profile '${device.profileId}' at line index ${index}`);
      if (!profile.deviceKinds.includes(device.kind)) {
        throw new Error(`Device '${device.id}' kind '${device.kind}' is not supported by profile '${device.profileId}'`);
      }
    }
    deviceIds.add(device.id);
  });
}

function defaultProfileId(kind: LineDefinition["devices"][number]["kind"], profiles: DeviceProfile[]): string {
  const preferred = kind === "CNC" ? "generic-cnc-opcua" : "generic-machine-mqtt";
  if (profiles.some((profile) => profile.id === preferred)) return preferred;
  const compatible = profiles.find((profile) => profile.deviceKinds.includes(kind));
  if (!compatible) throw new Error(`No device profile supports kind '${kind}'`);
  return compatible.id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDeviceKind(value: unknown): value is DeviceKind {
  return ["CNC", "ROBOT", "WELDER", "VISION", "CONVEYOR"].includes(value as string);
}
