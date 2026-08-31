export type MqttPayload = string | Uint8Array;

export type MqttClientEvent = 'connect' | 'reconnect' | 'close' | 'offline' | 'error' | 'message';

export interface MqttClientLike {
  on(event: 'connect' | 'reconnect' | 'close' | 'offline', listener: () => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'message', listener: (topic: string, payload: MqttPayload) => void): this;
  publish?(topic: string, payload: string): Promise<void> | void;
  subscribe(topic: string): Promise<void> | void;
  end(force?: boolean): Promise<void> | void;
}

export interface MqttConnectOptions {
  clientId: string;
  reconnectPeriod: number;
}

export type MqttClientFactory = (url: string, options: MqttConnectOptions) => MqttClientLike;

/** Status values emitted by the simulator and protocol bridges. */
export type SimulatorDeviceStatus = 'RUNNING' | 'IDLE' | 'WARNING' | 'STOPPED' | 'FAULT' | 'OFFLINE';
export type SimulatorFaultType =
  | 'OVERHEAT'
  | 'JAM'
  | 'COMMUNICATION_LOSS'
  | 'QUALITY_DRIFT'
  | 'EMERGENCY_STOP'
  | 'MATERIAL_SHORTAGE'
  | 'QUALITY_ANOMALY';
export type SimulatorAlarmSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface SimulatorTelemetry {
  deviceId: string;
  deviceName: string;
  lineId: string;
  status: SimulatorDeviceStatus;
  temperatureCelsius: number;
  cycleTimeSeconds: number;
  totalCount: number;
  goodCount: number;
  defectCount: number;
  activeFaults: SimulatorFaultType[];
  timestamp: string;
  /** Optional protocol metadata used for tracing and idempotent persistence. */
  traceId?: string;
  gatewayId?: string;
  quality?: string;
  eventId?: string;
}

export interface SimulatorAlarm {
  id: string;
  lineId: string;
  deviceId: string;
  type: SimulatorFaultType;
  severity: SimulatorAlarmSeverity;
  message: string;
  startedAt: string;
  clearedAt?: string;
}

export interface TelemetryMessage {
  kind: 'telemetry';
  tenantId: string;
  lineId: string;
  deviceId: string;
  topic: string;
  data: SimulatorTelemetry;
}

export interface AlarmMessage {
  kind: 'alarm';
  tenantId: string;
  topic: string;
  event: 'alarm.created' | 'alarm.cleared';
  data: SimulatorAlarm;
}

export type ParsedSimulatorMessage = TelemetryMessage | AlarmMessage;

export interface CachedDeviceTelemetry extends SimulatorTelemetry {
  tenantId: string;
  sourceTopic: string;
  receivedAt: string;
}

export interface AlarmState {
  tenantId: string;
  alarm: SimulatorAlarm;
  active: boolean;
  lastEvent: 'alarm.created' | 'alarm.cleared';
  updatedAt: string;
}

export interface MqttIngestionOptions {
  url?: string;
  enabled?: boolean;
  clientId?: string;
  reconnectPeriodMs?: number;
  telemetryTopic?: string;
  alarmsTopic?: string;
  tenantId?: string;
  gatewayId?: string;
}

export interface MqttIngestionStatus {
  enabled: boolean;
  connected: boolean;
  state: 'disabled' | 'starting' | 'connected' | 'disconnected' | 'error';
  brokerUrl: string | null;
  telemetryTopic: string;
  alarmsTopic: string;
  lastHeartbeatAt: string | null;
  lastError: string | null;
  lastErrorCode: string | null;
  reconnectAttempts: number;
  messages: { received: number; telemetry: number; alarms: number; http: number; accepted: number; duplicate: number; stale: number; malformed: number; rejected: number };
}

export type SimulatorControlAction =
  | 'start'
  | 'stop'
  | 'pause'
  | 'resume'
  | 'speed'
  | 'fault'
  | 'reset'
  /** API alias for reset; normalized before publishing to the simulator. */
  | 'recover'
  | 'snapshot'
  | 'export';

export interface SimulatorControlCommand {
  action: SimulatorControlAction;
  commandId?: string;
  lineId?: string;
  deviceId?: string;
  faultType?: SimulatorFaultType;
  speed?: number;
  requestedBy?: string;
  timestamp?: string;
}

export const MQTT_CLIENT_FACTORY = Symbol('MQTT_CLIENT_FACTORY');
export const MQTT_INGESTION_OPTIONS = Symbol('MQTT_INGESTION_OPTIONS');

/**
 * Protocol bridges publish the same canonical envelope under a protocol
 * namespace. The parser still allow-lists the namespace; this wildcard is
 * not a claim that every MQTT publisher is a supported driver.
 */
export const DEFAULT_TELEMETRY_TOPIC = 'mes/+/+/lines/+/devices/+/telemetry';
export const DEFAULT_ALARMS_TOPIC = 'mes/simulator/+/alarms';
