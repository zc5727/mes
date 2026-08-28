export type LineStatus = "RUNNING" | "IDLE" | "STOPPED" | "FAULT";

export type DeviceStatus = "RUNNING" | "IDLE" | "STOPPED" | "FAULT";

export type DeviceKind = "CNC" | "ROBOT" | "WELDER" | "VISION" | "CONVEYOR";

export type FaultType =
  | "OVERHEAT"
  | "JAM"
  | "COMMUNICATION_LOSS"
  | "QUALITY_DRIFT"
  | "EMERGENCY_STOP"
  | "MATERIAL_SHORTAGE"
  | "QUALITY_ANOMALY";

export type AlarmSeverity = "INFO" | "WARNING" | "CRITICAL";

export type TwinCommandAction =
  | "START_LINE"
  | "STOP_LINE"
  | "START_DEVICE"
  | "STOP_DEVICE"
  | "INJECT_FAULT"
  | "RESET_FAULT";

export interface DeviceDefinition {
  id: string;
  name: string;
  kind: DeviceKind;
  cycleTimeSeconds: number;
}

export interface LineDefinition {
  id: string;
  code: string;
  name: string;
  product: string;
  idealCycleTimeSeconds: number;
  devices: DeviceDefinition[];
}

export interface DeviceState {
  deviceId: string;
  deviceName: string;
  kind: DeviceKind;
  status: DeviceStatus;
  temperatureCelsius: number;
  cycleTimeSeconds: number;
  totalCount: number;
  goodCount: number;
  defectCount: number;
  activeFaults: FaultType[];
  lastUpdatedAt: string;
}

export interface OeeMetrics {
  availability: number;
  performance: number;
  quality: number;
  oee: number;
  plannedTimeSeconds: number;
  operatingTimeSeconds: number;
  totalCount: number;
  goodCount: number;
  defectCount: number;
}

export interface Alarm {
  id: string;
  lineId: string;
  deviceId: string;
  type: FaultType;
  severity: AlarmSeverity;
  message: string;
  startedAt: string;
  clearedAt?: string;
}

export interface DeviceTelemetry {
  deviceId: string;
  deviceName: string;
  lineId: string;
  status: DeviceStatus;
  temperatureCelsius: number;
  cycleTimeSeconds: number;
  totalCount: number;
  goodCount: number;
  defectCount: number;
  activeFaults: FaultType[];
  timestamp: string;
}

export interface LineSnapshot {
  lineId: string;
  code: string;
  name: string;
  product: string;
  status: LineStatus;
  oee: OeeMetrics;
  devices: DeviceState[];
  activeAlarms: Alarm[];
  timestamp: string;
}

export interface SimulationMessage {
  topic: string;
  payload: Record<string, unknown>;
}

export interface TwinCommand {
  commandId: string;
  action: TwinCommandAction;
  lineId: string;
  deviceId?: string;
  faultType?: FaultType;
  requestedBy?: string;
  timestamp?: string;
}

export interface SimulatorOptions {
  tenantId: string;
  intervalMs: number;
  timeScale?: number;
  seed?: number;
  random?: () => number;
}
