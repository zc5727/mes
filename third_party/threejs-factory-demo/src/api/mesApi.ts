import type {
  AGVTelemetry,
  DeviceTelemetry,
  FactoryAlarm,
  FactorySnapshot,
  OeeMetrics,
  ProductionLineTelemetry,
  ProductionSummary,
} from '@/types/factory';
import { mapLineId } from './identityMap';
import { mapDeviceId } from './identityMap';
import { positionForDevice } from '@/config/devicePositions';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1').replace(/\/$/, '');
const TENANT_ID = import.meta.env.VITE_TENANT_ID ?? 'tenant-demo';
const REQUEST_TIMEOUT_MS = 8_000;

interface ApiLine {
  id: string;
  name: string;
  status: 'active' | 'inactive' | 'maintenance' | 'running' | 'warning' | 'error' | 'idle';
  workshop?: string;
  targetOee?: number;
  oee?: number;
  oeeMetrics?: OeeMetrics;
  completionRate?: number;
  plannedQuantity?: number;
  plannedQty?: number;
  completedQuantity?: number;
  completedQty?: number;
}

interface ApiDevice {
  id: string;
  lineId: string;
  code: string;
  name: string;
  status: 'online' | 'offline' | 'maintenance' | 'alarm';
  statusReason?: string;
  updatedAt?: string;
  metrics: Record<string, number | string | boolean | null>;
  position?: { x: number; y: number; z: number };
}

interface ApiWorkOrderOverview {
  plannedQty: number;
  completedQty: number;
  completionRate: number;
  inProgress: number;
  released: number;
}

interface ApiAgv {
  id: string;
  lineId: string;
  code: string;
  name: string;
  state: AGVTelemetry['state'];
  battery: number;
  speed: number;
  task: string;
  progress: number;
  position: { x: number; y: number; z: number };
}

interface ApiAlarm {
  id: string;
  source?: string;
  sourceId?: string;
  deviceId?: string;
  lineId?: string;
  level?: FactoryAlarm['level'];
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
  message: string;
  time?: string;
  occurredAt?: string;
  startedAt?: string;
}

interface ApiDashboardOverview {
  lines?: { averageTargetOee?: number };
  workOrders?: ApiWorkOrderOverview;
  production?: ProductionSummary;
  generatedAt?: string;
}

interface FetchSnapshotResult {
  snapshot: FactorySnapshot;
  lines: ProductionLineTelemetry[];
  dashboard?: ApiDashboardOverview;
}

const lineIdMap: Record<string, string> = {
  'line-cnc': 'LINE-01',
  'line-assembly': 'LINE-02',
  'line-welding': 'LINE-03',
  'line-vision': 'LINE-04',
};

const lineNameMap: Record<string, string> = {
  'line-cnc': 'CNC加工线',
  'line-assembly': '装配线',
  'line-welding': '焊接线',
  'line-vision': '视觉检测线',
};

export async function fetchFactorySnapshot(): Promise<FetchSnapshotResult> {
  const [apiLines, apiDevices, workOrderOverview, apiAgvs] = await Promise.all([
    get<ApiLine[]>('/production-lines'),
    get<ApiDevice[]>('/devices'),
    get<ApiWorkOrderOverview>('/work-orders/overview'),
    getOptional<ApiAgv[]>('/agvs'),
  ]);

  const [apiAlarms, dashboard] = await Promise.all([
    getOptional<ApiAlarm[]>('/alarms'),
    getOptional<ApiDashboardOverview>('/dashboard/overview'),
  ]);
  const devices = apiDevices.map(toDevice);
  const alarms = apiAlarms?.map(toAlarm) ?? deriveAlarms(apiDevices, devices);
  const lines = apiLines.map((line) => toLine(line, devices));
  const productionSummary = dashboard?.production
    ?? (dashboard?.workOrders ? toProductionSummary(dashboard.workOrders) : toProductionSummary(workOrderOverview));

  return {
    lines,
    dashboard,
    snapshot: {
      devices,
      agvs: (apiAgvs ?? []).map(toAgv),
      alarms: deduplicateAlarms(alarms),
      logs: [{ id: 'api-log-1', time: '刚刚', message: '已接入 MES API，显示后端实时设备台账' }],
      todayTasks: workOrderOverview.inProgress + workOrderOverview.released,
      powerConsumption: devices.reduce((total, device) => total + device.power, 0),
      temperatureTrend: devices.slice(0, 8).map((device) => device.temperature),
      productionSummary,
    },
  };
}

async function get<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      headers: { 'x-tenant-id': TENANT_ID },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`MES API ${response.status}: ${path}`);
    return unwrap<T>(await response.json() as T | { data: T });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function getOptional<T>(path: string): Promise<T | undefined> {
  try {
    return await get<T>(path);
  } catch {
    // 新接口可以在后端逐步启用，旧版服务不可用时继续使用基础台账数据。
    return undefined;
  }
}

function unwrap<T>(body: T | { data: T }): T {
  return typeof body === 'object' && body !== null && 'data' in body
    ? body.data
    : body as T;
}

function toStatus(status: ApiDevice['status']): DeviceTelemetry['status'] {
  if (status === 'alarm') return 'error';
  if (status === 'maintenance') return 'warning';
  return status === 'online' ? 'running' : 'offline';
}

function toDevice(device: ApiDevice): DeviceTelemetry {
  const lineId = mapLineId(device.lineId);
  const temperature = numberMetric(device.metrics.temperature ?? device.metrics.temperatureCelsius);
  const power = numberMetric(device.metrics.power ?? device.metrics.load);
  const status = toStatus(device.status);
  return {
    id: mapDeviceId(device.id),
    name: device.name,
    lineId,
    zone: lineNameMap[device.lineId] ?? lineId,
    status,
    temperature,
    power,
    warning: device.statusReason || (status === 'error' ? '设备告警' : status === 'warning' ? '需要关注' : null),
    position: positionForDevice(mapDeviceId(device.id), device.position),
    observedAt: device.updatedAt,
  };
}

function toAgv(agv: ApiAgv): AGVTelemetry {
  return {
    id: agv.code || agv.id,
    name: agv.name,
    lineId: mapLineId(agv.lineId),
    state: agv.state,
    battery: agv.battery,
    speed: agv.speed,
    task: agv.task,
    progress: agv.progress,
    position: agv.position,
  };
}

function toLine(line: ApiLine, devices: DeviceTelemetry[]): ProductionLineTelemetry {
  const id = mapLineId(line.id);
  const lineDevices = devices.filter((device) => device.lineId === id);
  const hasError = lineDevices.some((device) => device.status === 'error');
  const hasWarning = lineDevices.some((device) => device.status === 'warning' || device.status === 'offline');
  const status: ProductionLineTelemetry['status'] = hasError || line.status === 'maintenance' || line.status === 'error'
    ? 'error'
    : hasWarning || line.status === 'inactive' || line.status === 'warning'
      ? 'warning'
      : line.status === 'idle'
        ? 'idle'
        : 'running';
  const plannedQuantity = line.plannedQuantity ?? line.plannedQty ?? 0;
  const completedQuantity = line.completedQuantity ?? line.completedQty ?? 0;
  const oeeMetrics = line.oeeMetrics;
  // targetOee is a target, not an observed KPI; never display it as actual OEE.
  const oee = oeeMetrics?.oee ?? line.oee ?? 0;
  return {
    id,
    name: line.name,
    workshop: line.workshop ?? '未配置车间',
    status,
    completionRate: line.completionRate ?? (plannedQuantity > 0 ? Math.round((completedQuantity / plannedQuantity) * 100) : 0),
    plannedQuantity,
    completedQuantity,
    oee,
    oeeMetrics,
    deviceOnline: `${lineDevices.filter((device) => device.status !== 'offline').length}/${lineDevices.length}`,
    risk: status === 'error' ? '设备故障' : status === 'warning' ? '需要关注' : '低风险',
  };
}

function toAlarm(alarm: ApiAlarm): FactoryAlarm {
  const level = alarm.level ?? severityToLevel(alarm.severity);
  return {
    id: alarm.id,
    level,
    source: alarm.source ?? alarm.deviceId ?? alarm.sourceId ?? '未知来源',
    sourceId: alarm.sourceId ?? alarm.deviceId,
    lineId: alarm.lineId ? mapLineId(alarm.lineId) : undefined,
    message: alarm.message,
    time: alarm.time ?? alarm.occurredAt ?? alarm.startedAt ?? new Date().toISOString(),
  };
}

function deriveAlarms(apiDevices: ApiDevice[], devices: DeviceTelemetry[]): FactoryAlarm[] {
  return apiDevices
    .map((device, index) => ({ device, view: devices[index] }))
    .filter(({ view }) => view.status !== 'running')
    .map(({ device, view }) => ({
      id: `api-alarm-${device.id}`,
      level: view.status === 'error' ? 'critical' as const : 'warning' as const,
      source: device.code || device.id,
      lineId: view.lineId,
      message: view.warning ?? `${device.name}需要关注`,
      time: device.updatedAt ?? new Date().toISOString(),
    }));
}

function severityToLevel(severity?: ApiAlarm['severity']): FactoryAlarm['level'] {
  if (severity === 'CRITICAL') return 'critical';
  if (severity === 'WARNING') return 'warning';
  return 'info';
}

function deduplicateAlarms(alarms: FactoryAlarm[]): FactoryAlarm[] {
  return [...new Map(alarms.map((alarm) => [alarm.id, alarm])).values()];
}

function toProductionSummary(overview: ApiWorkOrderOverview): ProductionSummary {
  return {
    plannedQuantity: overview.plannedQty,
    completedQuantity: overview.completedQty,
    completionRate: overview.completionRate,
  };
}

function numberMetric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
