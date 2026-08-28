import type { DeviceTelemetry, FactoryAlarm, FactoryLog, FactorySnapshot, ProductionLineTelemetry } from '@/types/factory';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1').replace(/\/$/, '');
const TENANT_ID = import.meta.env.VITE_TENANT_ID ?? 'tenant-demo';

interface ApiLine {
  id: string;
  name: string;
  status: 'active' | 'inactive' | 'maintenance';
  targetOee: number;
}

interface ApiDevice {
  id: string;
  lineId: string;
  code: string;
  name: string;
  status: 'online' | 'offline' | 'maintenance' | 'alarm';
  metrics: Record<string, number | string | boolean | null>;
}

const lineIdMap: Record<string, string> = {
  'line-cnc': 'LINE-01',
  'line-assembly': 'LINE-02',
  'line-welding': 'LINE-03',
  'line-vision': 'LINE-04'
};

const lineNameMap: Record<string, string> = {
  'line-cnc': 'CNC加工线',
  'line-assembly': '装配线',
  'line-welding': '焊接线',
  'line-vision': '视觉检测线'
};

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'x-tenant-id': TENANT_ID }
  });
  if (!response.ok) throw new Error(`MES API ${response.status}: ${path}`);
  const body = await response.json() as T | { data: T };
  return typeof body === 'object' && body !== null && 'data' in body
    ? body.data
    : body as T;
}

function toStatus(status: ApiDevice['status']): DeviceTelemetry['status'] {
  if (status === 'alarm') return 'error';
  if (status === 'maintenance') return 'warning';
  return status === 'online' ? 'running' : 'offline';
}

function toDevice(device: ApiDevice, index: number): DeviceTelemetry {
  const lineId = lineIdMap[device.lineId] ?? device.lineId;
  const temperature = Number(device.metrics.temperature ?? 36 + index);
  const power = Number(device.metrics.power ?? device.metrics.load ?? 30 + index * 4);
  const status = toStatus(device.status);
  return {
    id: device.id,
    name: device.name,
    lineId,
    zone: lineNameMap[device.lineId] ?? '生产区域',
    status,
    temperature,
    power,
    warning: status === 'error' ? '设备告警' : status === 'warning' ? '计划维护' : null,
    position: { x: -7 + (index % 4) * 4.5, y: 0, z: index < 4 ? -3.6 : 3.6 }
  };
}

function toLine(line: ApiLine, devices: DeviceTelemetry[]): ProductionLineTelemetry {
  const id = lineIdMap[line.id] ?? line.id;
  const lineDevices = devices.filter((device) => device.lineId === id);
  const hasError = lineDevices.some((device) => device.status === 'error');
  const hasWarning = lineDevices.some((device) => device.status === 'warning' || device.status === 'offline');
  const status: ProductionLineTelemetry['status'] = hasError || line.status === 'maintenance'
    ? 'error'
    : hasWarning || line.status === 'inactive'
      ? 'warning'
      : 'running';
  const completedQuantity = Math.max(0, 100 + lineDevices.filter((device) => device.status === 'running').length * 20);
  return {
    id,
    name: line.name.replace('精密', '').replace('自动', ''),
    workshop: id === 'LINE-01' || id === 'LINE-02' ? '一车间' : '二车间',
    status,
    completionRate: Math.min(98, 62 + completedQuantity / 5),
    plannedQuantity: 420,
    completedQuantity,
    oee: line.targetOee,
    deviceOnline: `${lineDevices.filter((device) => device.status !== 'offline').length}/${lineDevices.length}`,
    risk: status === 'error' ? '设备故障' : status === 'warning' ? '需要关注' : '低风险'
  };
}

export async function fetchFactorySnapshot(): Promise<{ snapshot: FactorySnapshot; lines: ProductionLineTelemetry[] }> {
  const [apiLines, apiDevices] = await Promise.all([
    get<ApiLine[]>('/production-lines'),
    get<ApiDevice[]>('/devices')
  ]);
  const devices = apiDevices.map(toDevice);
  const lines = apiLines.map((line) => toLine(line, devices));
  const alarms: FactoryAlarm[] = devices
    .filter((device) => device.status === 'error' || device.status === 'warning')
    .map((device, index) => ({
      id: `api-alarm-${device.id}`,
      level: device.status === 'error' ? 'critical' : 'warning',
      source: device.id,
      lineId: device.lineId,
      message: `${device.name}${device.warning ?? '需要关注'}`,
      time: `${index + 1}分钟前`
    }));
  const logs: FactoryLog[] = [{ id: 'api-log-1', time: '刚刚', message: '已接入 MES API，显示后端实时设备台账' }];
  return {
    lines,
    snapshot: {
      devices,
      agvs: [],
      alarms,
      logs,
      todayTasks: 126,
      powerConsumption: devices.reduce((total, device) => total + device.power, 0),
      temperatureTrend: devices.length ? devices.slice(0, 8).map((device) => device.temperature) : [36, 37, 38]
    }
  };
}
