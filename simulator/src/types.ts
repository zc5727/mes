export type LineStatus = "RUNNING" | "IDLE" | "WARNING" | "STOPPED" | "FAULT" | "OFFLINE";

export type DeviceStatus = "RUNNING" | "IDLE" | "WARNING" | "STOPPED" | "FAULT" | "OFFLINE";

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

/** Commands that control the simulator process rather than a production line. */
export type SimulatorControlAction =
  | "start"
  | "stop"
  | "pause"
  | "resume"
  | "speed"
  | "fault"
  | "reset"
  | "snapshot"
  | "export"
  | "replay";

export type SimulatorRuntimeStatus = "RUNNING" | "PAUSED" | "STOPPED";

export type AgvStatus = "IDLE" | "MOVING" | "LOADING" | "UNLOADING" | "CHARGING" | "WARNING" | "FAULT" | "OFFLINE";

export interface DeviceDefinition {
  id: string;
  name: string;
  kind: DeviceKind;
  cycleTimeSeconds: number;
  profileId?: string;
}

export interface LineDefinition {
  id: string;
  code: string;
  name: string;
  product: string;
  idealCycleTimeSeconds: number;
  devices: DeviceDefinition[];
}

export interface AgvDefinition {
  id: string;
  name: string;
  lineId: string;
  capacity: number;
  speedMetersPerSecond: number;
}

export interface AgvState {
  agvId: string;
  name: string;
  lineId: string;
  status: AgvStatus;
  batteryPercent: number;
  loadPercent: number;
  distanceMeters: number;
  activeFaults: FaultType[];
  lastUpdatedAt: string;
}

export type AgvTelemetry = AgvState & { timestamp: string };

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
  profileId?: string;
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
  profileId?: string;
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
  agvs?: AgvState[];
  activeAlarms: Alarm[];
  timestamp: string;
}

export interface StrategyInputSnapshot {
  timestamp: string;
  runtime: SimulatorControlState;
  lines: LineSnapshot[];
  agvs: AgvState[];
  activeAlarms: Alarm[];
}

export interface ScenarioEvent {
  atSeconds: number;
  command: SimulatorControlCommand;
}

export interface ScenarioDocument {
  version: 1;
  events: ScenarioEvent[];
}

export interface NetworkSimulationOptions {
  latencyMs?: number;
  duplicateRate?: number;
  dropRate?: number;
  seed?: number;
}

export interface ReplayFrame {
  sequence: number;
  timestamp: string;
  messages: SimulationMessage[];
}

export interface ReplayDocument {
  version: 1;
  tenantId: string;
  intervalMs: number;
  timeScale: number;
  scenario?: ScenarioEvent[];
  frames: ReplayFrame[];
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

export interface SimulatorControlCommand {
  action: SimulatorControlAction;
  commandId?: string;
  lineId?: string;
  deviceId?: string;
  faultType?: FaultType;
  speed?: number;
  requestedBy?: string;
  timestamp?: string;
}

export interface SimulatorControlState {
  status: SimulatorRuntimeStatus;
  paused: boolean;
  timeScale: number;
}

export interface SimulatorOptions {
  tenantId: string;
  intervalMs: number;
  timeScale?: number;
  seed?: number;
  random?: () => number;
}
