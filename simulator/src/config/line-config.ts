import { readFileSync } from "node:fs";
import { LineDefinition } from "../types";

export const LINE_DEFINITIONS: LineDefinition[] = [
  {
    id: "line-cnc",
    code: "L01",
    name: "CNC加工线",
    product: "精密铝合金壳体",
    idealCycleTimeSeconds: 42,
    devices: [
      { id: "cnc-01", name: "CNC-01 加工中心", kind: "CNC", cycleTimeSeconds: 42 },
      { id: "cnc-02", name: "CNC-02 加工中心", kind: "CNC", cycleTimeSeconds: 45 },
      { id: "cnc-03", name: "清洗与上下料单元", kind: "CONVEYOR", cycleTimeSeconds: 18 },
    ],
  },
  {
    id: "line-assembly",
    code: "L02",
    name: "装配线",
    product: "智能控制模块",
    idealCycleTimeSeconds: 35,
    devices: [
      { id: "asm-01", name: "螺钉锁付机器人", kind: "ROBOT", cycleTimeSeconds: 35 },
      { id: "asm-02", name: "压装工作站", kind: "ROBOT", cycleTimeSeconds: 38 },
      { id: "asm-03", name: "装配输送线", kind: "CONVEYOR", cycleTimeSeconds: 20 },
    ],
  },
  {
    id: "line-welding",
    code: "L03",
    name: "焊接线",
    product: "结构件总成",
    idealCycleTimeSeconds: 55,
    devices: [
      { id: "weld-01", name: "六轴焊接机器人", kind: "WELDER", cycleTimeSeconds: 55 },
      { id: "weld-02", name: "焊缝打磨单元", kind: "WELDER", cycleTimeSeconds: 48 },
      { id: "weld-03", name: "焊后输送线", kind: "CONVEYOR", cycleTimeSeconds: 22 },
    ],
  },
  {
    id: "line-vision",
    code: "L04",
    name: "视觉检测线",
    product: "成品外观与尺寸检测",
    idealCycleTimeSeconds: 28,
    devices: [
      { id: "vision-01", name: "2D视觉检测站", kind: "VISION", cycleTimeSeconds: 28 },
      { id: "vision-02", name: "3D尺寸检测站", kind: "VISION", cycleTimeSeconds: 32 },
      { id: "vision-03", name: "分拣输送单元", kind: "CONVEYOR", cycleTimeSeconds: 18 },
    ],
  },
];

export function loadLineDefinitions(filePath?: string): LineDefinition[] {
  if (!filePath) return LINE_DEFINITIONS;

  const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
  const definitions = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.lines)
      ? parsed.lines
      : undefined;

  if (!definitions || definitions.length === 0) {
    throw new Error("Line config must be an array or an object with a non-empty 'lines' array");
  }

  const lineIds = new Set<string>();
  definitions.forEach((definition, index) => {
    validateLineDefinition(definition, index);
    const lineId = (definition as Record<string, unknown>).id as string;
    if (lineIds.has(lineId)) throw new Error(`Duplicate line id '${lineId}'`);
    lineIds.add(lineId);
  });
  return definitions as LineDefinition[];
}

function validateLineDefinition(value: unknown, index: number): void {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.code !== "string" || typeof value.name !== "string"
    || typeof value.product !== "string" || typeof value.idealCycleTimeSeconds !== "number" || value.idealCycleTimeSeconds <= 0 || !Array.isArray(value.devices)
    || value.devices.length === 0) {
    throw new Error(`Invalid line definition at index ${index}`);
  }

  const deviceIds = new Set<string>();
  value.devices.forEach((device, deviceIndex) => {
    if (!isRecord(device) || typeof device.id !== "string" || typeof device.name !== "string"
      || typeof device.kind !== "string" || typeof device.cycleTimeSeconds !== "number" || device.cycleTimeSeconds <= 0) {
      throw new Error(`Invalid device definition at line index ${index}, device index ${deviceIndex}`);
    }
    if (deviceIds.has(device.id)) throw new Error(`Duplicate device id '${device.id}' at line index ${index}`);
    deviceIds.add(device.id);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
