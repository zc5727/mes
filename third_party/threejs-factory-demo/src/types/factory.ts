import type * as THREE from 'three';

export type AGVState = 'idle' | 'moving' | 'loading' | 'charging' | 'error';
export type DeviceStatus = 'running' | 'warning' | 'error' | 'offline';
export type ProductionLineStatus = 'running' | 'warning' | 'error' | 'idle';

export interface ProductionLineTelemetry {
  id: string;
  name: string;
  workshop: string;
  status: ProductionLineStatus;
  completionRate: number;
  plannedQuantity: number;
  completedQuantity: number;
  oee: number;
  oeeMetrics?: OeeMetrics;
  deviceOnline: string;
  risk: string;
}

export interface VectorPoint {
  x: number;
  y: number;
  z: number;
}

export interface AGVTelemetry {
  id: string;
  name: string;
  lineId: string;
  state: AGVState;
  battery: number;
  speed: number;
  task: string;
  progress: number;
  position: VectorPoint;
}

export interface DeviceTelemetry {
  id: string;
  name: string;
  lineId: string;
  zone: string;
  status: DeviceStatus;
  temperature: number;
  power: number;
  warning: string | null;
  position: VectorPoint;
  observedAt?: string;
}

export interface FactoryAlarm {
  id: string;
  level: 'info' | 'warning' | 'critical';
  source: string;
  sourceId?: string;
  lineId?: string;
  message: string;
  time: string;
}

export interface FactoryLog {
  id: string;
  time: string;
  message: string;
}

export interface ProductionSummary {
  plannedQuantity: number;
  completedQuantity: number;
  completionRate: number;
}

export interface OeeMetrics {
  availability: number;
  performance: number;
  quality: number;
  oee: number;
  totalCount?: number;
  goodCount?: number;
  defectCount?: number;
}

export interface SimulatorState {
  status: 'RUNNING' | 'PAUSED' | 'STOPPED';
  paused: boolean;
  timeScale: number;
  currentTime: string;
}

export interface FactorySnapshot {
  devices: DeviceTelemetry[];
  agvs: AGVTelemetry[];
  alarms: FactoryAlarm[];
  logs: FactoryLog[];
  todayTasks: number;
  powerConsumption: number;
  temperatureTrend: number[];
  productionSummary?: ProductionSummary;
  simulator?: SimulatorState;
  lines?: ProductionLineTelemetry[];
}

export interface SceneDeviceBinding {
  mesh: THREE.Object3D;
  telemetry: DeviceTelemetry;
}
