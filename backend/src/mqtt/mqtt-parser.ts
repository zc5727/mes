import {
  AlarmMessage,
  MqttPayload,
  ParsedSimulatorMessage,
  SimulatorAlarm,
  SimulatorAlarmSeverity,
  SimulatorDeviceStatus,
  SimulatorFaultType,
  SimulatorTelemetry,
  TelemetryMessage,
} from './mqtt.types';

const DEVICE_TOPIC = /^mes\/simulator\/([^/]+)\/lines\/([^/]+)\/devices\/([^/]+)\/telemetry$/;
const ALARMS_TOPIC = /^mes\/simulator\/([^/]+)\/alarms$/;
const DEVICE_STATUSES = new Set<SimulatorDeviceStatus>(['RUNNING', 'IDLE', 'STOPPED', 'FAULT']);
const FAULT_TYPES = new Set<SimulatorFaultType>([
  'OVERHEAT',
  'JAM',
  'COMMUNICATION_LOSS',
  'QUALITY_DRIFT',
  'EMERGENCY_STOP',
  'MATERIAL_SHORTAGE',
  'QUALITY_ANOMALY',
]);
const ALARM_SEVERITIES = new Set<SimulatorAlarmSeverity>(['INFO', 'WARNING', 'CRITICAL']);

export function parseSimulatorMessage(topic: string, payload: MqttPayload): ParsedSimulatorMessage | undefined {
  const parsed = parseJsonObject(payload);
  if (!parsed) return undefined;

  const telemetryMatch = DEVICE_TOPIC.exec(topic);
  if (telemetryMatch) return parseTelemetryMessage(topic, telemetryMatch, parsed);

  const alarmMatch = ALARMS_TOPIC.exec(topic);
  if (alarmMatch) return parseAlarmMessage(topic, alarmMatch[1], parsed);

  return undefined;
}

function parseTelemetryMessage(
  topic: string,
  match: RegExpExecArray,
  envelope: Record<string, unknown>,
): TelemetryMessage | undefined {
  if (envelope.event !== 'device.telemetry') return undefined;
  const data = parseTelemetry(envelope.data);
  if (!data || data.lineId !== match[2] || data.deviceId !== match[3]) return undefined;

  return {
    kind: 'telemetry',
    tenantId: match[1],
    lineId: match[2],
    deviceId: match[3],
    topic,
    data,
  };
}

function parseAlarmMessage(
  topic: string,
  tenantId: string,
  envelope: Record<string, unknown>,
): AlarmMessage | undefined {
  if (envelope.event !== 'alarm.created' && envelope.event !== 'alarm.cleared') return undefined;
  const data = parseAlarm(envelope.data);
  if (!data) return undefined;

  return {
    kind: 'alarm',
    tenantId,
    topic,
    event: envelope.event,
    data,
  };
}

function parseTelemetry(value: unknown): SimulatorTelemetry | undefined {
  if (!isRecord(value)
    || !isNonEmptyString(value.deviceId)
    || !isNonEmptyString(value.deviceName)
    || !isNonEmptyString(value.lineId)
    || !isEnum(value.status, DEVICE_STATUSES)
    || !isFiniteNumber(value.temperatureCelsius)
    || !isFiniteNumber(value.cycleTimeSeconds)
    || !isNonNegativeInteger(value.totalCount)
    || !isNonNegativeInteger(value.goodCount)
    || !isNonNegativeInteger(value.defectCount)
    || !Array.isArray(value.activeFaults)
    || !value.activeFaults.every((fault) => isEnum(fault, FAULT_TYPES))
    || !isTimestamp(value.timestamp)) {
    return undefined;
  }

  if (value.goodCount + value.defectCount > value.totalCount) return undefined;

  return {
    deviceId: value.deviceId,
    deviceName: value.deviceName,
    lineId: value.lineId,
    status: value.status,
    temperatureCelsius: value.temperatureCelsius,
    cycleTimeSeconds: value.cycleTimeSeconds,
    totalCount: value.totalCount,
    goodCount: value.goodCount,
    defectCount: value.defectCount,
    activeFaults: [...value.activeFaults],
    timestamp: value.timestamp,
  };
}

function parseAlarm(value: unknown): SimulatorAlarm | undefined {
  if (!isRecord(value)
    || !isNonEmptyString(value.id)
    || !isNonEmptyString(value.lineId)
    || !isNonEmptyString(value.deviceId)
    || !isEnum(value.type, FAULT_TYPES)
    || !isEnum(value.severity, ALARM_SEVERITIES)
    || typeof value.message !== 'string'
    || !isTimestamp(value.startedAt)
    || (value.clearedAt !== undefined && !isTimestamp(value.clearedAt))) {
    return undefined;
  }

  return {
    id: value.id,
    lineId: value.lineId,
    deviceId: value.deviceId,
    type: value.type,
    severity: value.severity,
    message: value.message,
    startedAt: value.startedAt,
    ...(value.clearedAt === undefined ? {} : { clearedAt: value.clearedAt }),
  };
}

function parseJsonObject(payload: MqttPayload): Record<string, unknown> | undefined {
  try {
    const text = typeof payload === 'string' ? payload : new TextDecoder().decode(payload);
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isEnum<T extends string>(value: unknown, values: Set<T>): value is T {
  return typeof value === 'string' && values.has(value as T);
}
