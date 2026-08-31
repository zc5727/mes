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

// 浏览器只访问 NestJS facade；OpenMES 的地址和认证由 facade 管理，前端不直连生产系统。
const API_BASE_URL = (import.meta.env.VITE_MES_FACADE_URL ?? import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1').replace(/\/$/, '');
const TENANT_ID = import.meta.env.VITE_TENANT_ID ?? 'tenant-demo';
const API_KEY = import.meta.env.VITE_API_KEY ?? '';
const REQUEST_TIMEOUT_MS = 8_000;

interface ApiLine {
  id: string;
  factoryId?: string;
  code?: string;
  type?: string;
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

export interface SimulatorControlCommand {
  action: 'fault' | 'reset' | 'recover';
  lineId?: string;
  deviceId?: string;
  faultType?: 'OVERHEAT' | 'JAM' | 'COMMUNICATION_LOSS' | 'QUALITY_DRIFT' | 'EMERGENCY_STOP' | 'MATERIAL_SHORTAGE' | 'QUALITY_ANOMALY';
  requestedBy?: string;
}

export interface CreateProductionLineInput {
  factoryId: string;
  code: string;
  name: string;
  type: string;
  targetOee?: number;
  status?: 'active' | 'inactive' | 'maintenance';
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

export function controlSimulator(command: SimulatorControlCommand) {
  return post<{ accepted: boolean; commandId: string }>('/simulator/control', command);
}

export function createProductionLine(input: CreateProductionLineInput) {
  return post<ApiLine>('/production-lines', input);
}

export function updateProductionLine(id: string, input: Partial<CreateProductionLineInput>) {
  return request<ApiLine>(`/production-lines/${encodeURIComponent(id)}`, 'PATCH', input);
}

export function deleteProductionLine(id: string) {
  return request<{ id: string; deleted: true }>(`/production-lines/${encodeURIComponent(id)}`, 'DELETE');
}

export interface CreateWorkOrderInput {
  orderNo: string;
  productCode: string;
  productName: string;
  lineId: string;
  plannedQty: number;
  dueAt: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
}

export function createWorkOrder(input: CreateWorkOrderInput) {
  return post<Record<string, unknown>>('/work-orders', input);
}

export interface CreateDeviceInput {
  lineId: string;
  code: string;
  name: string;
  model?: string;
  protocol?: 'opcua' | 'modbus-tcp' | 'mqtt' | 'simulator';
}

export function createDevice(input: CreateDeviceInput) {
  return post<Record<string, unknown>>('/devices', input);
}

export function createDocument(data: Record<string, unknown>) {
  return post<Record<string, unknown>>('/foundation/documents', { data });
}

export interface CreateQualityRecordInput {
  formKey?: string;
  formVersion?: string;
  workOrderId?: string;
  batchNo: string;
  lineId: string;
  deviceId?: string;
  operatorId: string;
  values: Record<string, unknown>;
}

export function createQualityRecord(input: CreateQualityRecordInput) {
  return post<Record<string, unknown>>('/foundation/quality-records', input);
}

export function uploadDocument(file: File, input: { documentKey: string; uploadedBy: string; lineId?: string; productCode?: string }) {
  const body = new FormData();
  body.append('file', file);
  Object.entries(input).forEach(([key, value]) => { if (value) body.append(key, value); });
  return requestFormData<Record<string, unknown>>('/foundation/documents/upload', body);
}

export function saveDocumentAnalysisDraft(id: string, analysisDraft: Record<string, unknown>, actorId: string) {
  return post<Record<string, unknown>>(`/foundation/documents/${encodeURIComponent(id)}/analysis-draft`, { analysisDraft, actorId });
}

export function confirmDocumentAnalysis(id: string, reviewerId: string, analysis?: Record<string, unknown>) {
  return post<Record<string, unknown>>(`/foundation/documents/${encodeURIComponent(id)}/analysis/confirm`, { reviewerId, analysis });
}

export function simulateStrategy(data: Record<string, unknown>) {
  return post<Record<string, unknown>>('/strategies/simulate', data);
}

export function createApproval(resource: string, resourceId: string, comment?: string) {
  return post<Record<string, unknown>>('/audit/approvals', { resource, resourceId, comment });
}

export function acknowledgeAlarm(id: string) { return request<Record<string, unknown>>(`/alarms/${encodeURIComponent(id)}/acknowledge`, 'PATCH'); }
export function closeAlarm(id: string) { return request<Record<string, unknown>>(`/alarms/${encodeURIComponent(id)}/close`, 'PATCH'); }

export interface CreateMaintenanceInput {
  lineId: string;
  deviceId: string;
  type: 'inspection' | 'preventive' | 'repair';
  title: string;
  description?: string;
  plannedAt: string;
}

export function createMaintenance(input: CreateMaintenanceInput) { return post<Record<string, unknown>>('/maintenance/work-orders', input); }

export interface FoundationRecord { id: string; status?: string; createdAt?: string; updatedAt?: string; [key: string]: unknown }
export function listDocuments() { return get<FoundationRecord[]>('/foundation/documents'); }
export function listQualityRecords() { return get<FoundationRecord[]>('/foundation/quality-records'); }
export function listMaintenanceWorkOrders() { return get<FoundationRecord[]>('/maintenance/work-orders'); }
export function documentContentUrl(id: string) { return `${API_BASE_URL}/foundation/documents/${encodeURIComponent(id)}/content`; }
export function updateDocumentStatus(id: string, status: string, actorId = 'digital-twin-ui') { return request<Record<string, unknown>>(`/foundation/documents/${encodeURIComponent(id)}/status`, 'PATCH', { status, actorId }); }
export function submitQualityRecord(id: string, actorId = 'digital-twin-ui') { return post<Record<string, unknown>>(`/foundation/quality-records/${encodeURIComponent(id)}/submit`, { actorId }); }
export function confirmQualityRecord(id: string, actorId = 'digital-twin-ui') { return post<Record<string, unknown>>(`/foundation/quality-records/${encodeURIComponent(id)}/confirm`, { actorId }); }
export function rejectQualityRecord(id: string, actorId = 'digital-twin-ui') { return post<Record<string, unknown>>(`/foundation/quality-records/${encodeURIComponent(id)}/reject`, { actorId }); }
export function updateMaintenanceStatus(id: string, status: 'assigned' | 'in_progress' | 'completed' | 'cancelled', reason?: string) { return request<Record<string, unknown>>(`/maintenance/work-orders/${encodeURIComponent(id)}/status`, 'PATCH', { status, reason }); }

async function get<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      headers: {
        'x-tenant-id': TENANT_ID,
        ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`MES API ${response.status}: ${path}`);
    return unwrap<T>(await response.json() as T | { data: T });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, 'POST', body);
}

async function request<T>(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        'x-tenant-id': TENANT_ID,
        'content-type': 'application/json',
        ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`MES API ${response.status}: ${path}`);
    return unwrap<T>(await response.json() as T | { data: T });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function requestFormData<T>(path: string, body: FormData): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'x-tenant-id': TENANT_ID,
        ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      },
      body,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`MES API ${response.status}: ${path}`);
    return unwrap<T>(await response.json() as T | { data: T });
  } finally { window.clearTimeout(timeout); }
}

async function getOptional<T>(path: string): Promise<T | undefined> {
  try {
    return await get<T>(path);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes(' 404: ')) {
      return undefined;
    }
    console.warn(`Optional MES API request failed: ${path}`, error);
    throw error;
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
    factoryId: line.factoryId,
    code: line.code,
    type: line.type,
    targetOee: line.targetOee,
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
