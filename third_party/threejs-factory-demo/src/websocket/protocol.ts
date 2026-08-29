import type {
  AGVTelemetry,
  DeviceTelemetry,
  FactoryAlarm,
  FactoryLog,
  FactorySnapshot,
  OeeMetrics,
  ProductionLineTelemetry,
  SimulatorState,
} from '@/types/factory';

export type RealtimeMessage =
  | { type: 'snapshot'; payload: FactorySnapshot }
  | { type: 'device:update'; payload: DeviceTelemetry }
  | { type: 'agv:update'; payload: AGVTelemetry }
  | { type: 'alarm'; payload: FactoryAlarm }
  | { type: 'alarm:clear'; payload: { id: string } }
  | { type: 'line:update'; payload: ProductionLineTelemetry }
  | { type: 'simulator:update'; payload: SimulatorState }
  | { type: 'log'; payload: FactoryLog };

const lineIdMap: Record<string, string> = {
  'line-cnc': 'LINE-01',
  'line-assembly': 'LINE-02',
  'line-welding': 'LINE-03',
  'line-vision': 'LINE-04',
};

const deviceIdMap: Record<string, string> = {
  'cnc-01': 'device-cnc-01',
  'cnc-02': 'device-cnc-02',
  'asm-01': 'device-assembly-01',
  'weld-01': 'device-welding-01',
  'vision-01': 'device-vision-01',
};

const devicePositions = [
  { x: -7.8, y: 0, z: -3.6 },
  { x: -4.6, y: 0, z: -3.6 },
  { x: -1.4, y: 0, z: -3.6 },
  { x: 4.8, y: 0, z: -3.6 },
  { x: 7.5, y: 0, z: -2.2 },
  { x: 6.4, y: 0, z: 3.4 },
  { x: 1.8, y: 0, z: 4.4 },
  { x: -5.8, y: 0, z: 4.2 },
];

export function parseRealtimeMessages(input: unknown): RealtimeMessage[] {
  const envelope = asRecord(input);
  if (!envelope) return [];

  const direct = parseDirectMessage(envelope);
  if (direct) return [direct];

  const topic = typeof envelope.topic === 'string' ? envelope.topic : '';
  const payload = asRecord(envelope.payload) ?? envelope;
  const data = asRecord(payload.data);
  const event = typeof payload.event === 'string' ? payload.event : undefined;

  if (event === 'device.telemetry' && data) return [deviceMessage(data)];
  if (event === 'line.snapshot' && data) return lineSnapshotMessages(data);
  if ((event === 'alarm.created' || event === 'alarm.cleared') && data) {
    return event === 'alarm.cleared'
      ? [{ type: 'alarm:clear', payload: { id: stringValue(data.id, topic) } }]
      : [{ type: 'alarm', payload: alarmFromSimulator(data) }];
  }
  if (event === 'simulator.control.applied' && data) {
    return [{ type: 'simulator:update', payload: simulatorState(data, payload.timestamp) }];
  }
  if (topic.includes('/alarms') && data) return [alarmMessageFromUnknown(data, event)];
  return [];
}

function parseDirectMessage(value: Record<string, unknown>): RealtimeMessage | undefined {
  const type = value.type;
  const payload = value.payload;
  if (typeof type !== 'string' || payload === undefined) return undefined;
  if (type === 'snapshot' && isSnapshot(payload)) return { type, payload };
  if (type === 'device:update') return { type, payload: deviceFromUnknown(payload) };
  if (type === 'agv:update') return { type, payload: agvFromUnknown(payload) };
  if (type === 'alarm') {
    const alarm = alarmFromUnknown(payload);
    return asRecord(payload)?.clearedAt
      ? { type: 'alarm:clear', payload: { id: alarm.id } }
      : { type, payload: alarm };
  }
  if (type === 'alarm:clear' && asRecord(payload)?.id) return { type, payload: { id: String(asRecord(payload)!.id) } };
  if (type === 'line:update') return { type, payload: lineFromUnknown(payload) };
  if (type === 'simulator:update') return { type, payload: simulatorState(payload) };
  if (type === 'log') return { type, payload: logFromUnknown(payload) };
  return undefined;
}

function lineSnapshotMessages(data: Record<string, unknown>): RealtimeMessage[] {
  const line = lineFromUnknown(data);
  const devices = Array.isArray(data.devices)
    ? data.devices.filter((item): item is Record<string, unknown> => Boolean(asRecord(item))).map(deviceFromSimulatorState)
    : [];
  return [
    { type: 'line:update', payload: line },
    ...devices.map((payload) => ({ type: 'device:update' as const, payload })),
    {
      type: 'simulator:update',
      payload: simulatorState({ status: 'RUNNING', paused: false, timeScale: 1 }, data.timestamp),
    },
  ];
}

function deviceMessage(data: Record<string, unknown>): RealtimeMessage {
  return { type: 'device:update', payload: deviceFromUnknown(data) };
}

function deviceFromUnknown(value: unknown): DeviceTelemetry {
  const data = asRecord(value) ?? {};
  const id = stringValue(data.id, stringValue(data.deviceId, 'unknown-device'));
  const lineId = mapLineId(stringValue(data.lineId, ''));
  const statusValue = stringValue(data.status, 'IDLE').toUpperCase();
  const status: DeviceTelemetry['status'] = statusValue === 'FAULT' || statusValue === 'ERROR'
    ? 'error'
    : statusValue === 'IDLE' || statusValue === 'WARNING'
      ? 'warning'
      : statusValue === 'STOPPED' || statusValue === 'OFFLINE'
        ? 'offline'
        : 'running';
  const temperature = numberValue(data.temperature, numberValue(data.temperatureCelsius, 36));
  return {
    id: deviceIdMap[id] ?? id,
    name: stringValue(data.name, stringValue(data.deviceName, id)),
    lineId,
    zone: stringValue(data.zone, lineId),
    status,
    temperature,
    power: numberValue(data.power, 0),
    warning: stringValue(data.warning, stringValue(data.statusReason, status === 'error' ? '设备故障' : undefined)),
    position: positionFor(id),
    observedAt: stringValue(data.timestamp, stringValue(data.lastUpdatedAt, undefined)),
  };
}

function deviceFromSimulatorState(data: Record<string, unknown>): DeviceTelemetry {
  return deviceFromUnknown({
    ...data,
    id: data.deviceId,
    name: data.deviceName,
    temperatureCelsius: data.temperatureCelsius,
    timestamp: data.lastUpdatedAt,
    warning: Array.isArray(data.activeFaults) && data.activeFaults.length ? String(data.activeFaults[0]) : undefined,
  });
}

function lineFromUnknown(value: unknown): ProductionLineTelemetry {
  const data = asRecord(value) ?? {};
  const id = mapLineId(stringValue(data.id, stringValue(data.lineId, 'unknown-line')));
  const statusValue = stringValue(data.status, 'IDLE').toUpperCase();
  const status: ProductionLineTelemetry['status'] = statusValue === 'FAULT' || statusValue === 'STOPPED'
    ? 'error'
    : statusValue === 'IDLE'
      ? 'idle'
      : statusValue === 'WARNING'
        ? 'warning'
        : 'running';
  const oee = asRecord(data.oee);
  const oeeMetrics = oee ? oeeFromUnknown(oee) : undefined;
  return {
    id,
    name: stringValue(data.name, id),
    workshop: id === 'LINE-01' || id === 'LINE-02' ? '一车间' : '二车间',
    status,
    completionRate: 0,
    plannedQuantity: 0,
    completedQuantity: numberValue(oee?.goodCount, 0),
    oee: oeeMetrics?.oee ?? 0,
    oeeMetrics,
    deviceOnline: `${Array.isArray(data.devices) ? data.devices.length : 0}`,
    risk: status === 'error' ? '设备故障' : status === 'warning' ? '需要关注' : '低风险',
  };
}

function oeeFromUnknown(data: Record<string, unknown>): OeeMetrics {
  return {
    availability: numberValue(data.availability, 0),
    performance: numberValue(data.performance, 0),
    quality: numberValue(data.quality, 0),
    oee: numberValue(data.oee, 0),
    totalCount: numberValue(data.totalCount, 0),
    goodCount: numberValue(data.goodCount, 0),
    defectCount: numberValue(data.defectCount, 0),
  };
}

function alarmFromSimulator(data: Record<string, unknown>): FactoryAlarm {
  const sourceId = stringValue(data.deviceId, stringValue(data.sourceId, undefined));
  return {
    id: stringValue(data.id, `alarm-${Date.now()}`),
    level: severityToLevel(stringValue(data.severity, 'INFO')),
    source: stringValue(data.deviceId, stringValue(data.source, '未知来源')),
    sourceId,
    lineId: mapLineId(stringValue(data.lineId, '')),
    message: stringValue(data.message, '实时告警'),
    time: stringValue(data.startedAt, new Date().toISOString()),
  };
}

function alarmFromUnknown(value: unknown): FactoryAlarm {
  const data = asRecord(value) ?? {};
  const sourceId = stringValue(data.sourceId, stringValue(data.deviceId, undefined));
  return {
    id: stringValue(data.id, `alarm-${Date.now()}`),
    level: stringValue(data.level, '').toLowerCase() as FactoryAlarm['level'] || severityToLevel(stringValue(data.severity, 'INFO')),
    source: stringValue(data.source, stringValue(data.deviceId, '未知来源')),
    sourceId,
    lineId: data.lineId ? mapLineId(String(data.lineId)) : undefined,
    message: stringValue(data.message, '实时告警'),
    time: stringValue(data.time, stringValue(data.occurredAt, new Date().toISOString())),
  };
}

function alarmMessageFromUnknown(data: Record<string, unknown>, event?: string): RealtimeMessage {
  if (event === 'alarm.cleared' || data.clearedAt) return { type: 'alarm:clear', payload: { id: stringValue(data.id, '') } };
  return { type: 'alarm', payload: alarmFromUnknown(data) };
}

function agvFromUnknown(value: unknown): AGVTelemetry {
  const data = asRecord(value) ?? {};
  return {
    id: stringValue(data.id, stringValue(data.code, 'unknown-agv')),
    name: stringValue(data.name, 'AGV'),
    lineId: mapLineId(stringValue(data.lineId, '')),
    state: stringValue(data.state, 'idle').toLowerCase() as AGVTelemetry['state'],
    battery: numberValue(data.battery, 0),
    speed: numberValue(data.speed, 0),
    task: stringValue(data.task, '待命'),
    progress: numberValue(data.progress, 0),
    position: pointFromUnknown(data.position),
  };
}

function logFromUnknown(value: unknown): FactoryLog {
  const data = asRecord(value) ?? {};
  return {
    id: stringValue(data.id, `log-${Date.now()}`),
    time: stringValue(data.time, new Date().toISOString()),
    message: stringValue(data.message, '实时状态已更新'),
  };
}

function simulatorState(value: unknown, timestamp?: unknown): SimulatorState {
  const data = asRecord(value) ?? {};
  return {
    status: stringValue(data.status, 'RUNNING').toUpperCase() as SimulatorState['status'],
    paused: Boolean(data.paused),
    timeScale: numberValue(data.timeScale, 1),
    currentTime: stringValue(data.currentTime, stringValue(timestamp, new Date().toISOString())),
  };
}

function isSnapshot(value: unknown): value is FactorySnapshot {
  const data = asRecord(value);
  return Boolean(data && Array.isArray(data.devices) && Array.isArray(data.agvs) && Array.isArray(data.alarms));
}

function mapLineId(value: string): string {
  return lineIdMap[value] ?? value;
}

function positionFor(id: string): { x: number; y: number; z: number } {
  const hash = [...id].reduce((total, character) => total + character.charCodeAt(0), 0);
  return devicePositions[hash % devicePositions.length];
}

function pointFromUnknown(value: unknown): { x: number; y: number; z: number } {
  const data = asRecord(value) ?? {};
  return { x: numberValue(data.x, 0), y: numberValue(data.y, 0), z: numberValue(data.z, 0) };
}

function severityToLevel(value: string): FactoryAlarm['level'] {
  if (value.toUpperCase() === 'CRITICAL') return 'critical';
  if (value.toUpperCase() === 'WARNING') return 'warning';
  return 'info';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown, fallback: string | undefined): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback ?? '';
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
