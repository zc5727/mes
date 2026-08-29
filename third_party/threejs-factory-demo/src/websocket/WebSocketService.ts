import type {
  AGVTelemetry,
  DeviceStatus,
  DeviceTelemetry,
  FactoryAlarm,
  FactoryLog,
  FactorySnapshot,
  ProductionLineTelemetry,
  SimulatorState,
} from '@/types/factory';
import { createId, formatClock } from '@/utils/time';
import { parseRealtimeMessages, type RealtimeMessage } from './protocol';

export type RealtimeConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'fallback' | 'offline' | 'polling';

export interface RealtimeConnectionChange {
  state: RealtimeConnectionState;
  attempt: number;
  remote: boolean;
}

export interface ConnectOptions {
  mode?: 'auto' | 'local' | 'remote';
  seed?: FactorySnapshot;
  emitSnapshot?: boolean;
}

type MessageHandler = (message: RealtimeMessage) => void;
type ConnectionHandler = (change: RealtimeConnectionChange) => void;

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

const statusPool: DeviceStatus[] = ['running', 'running', 'running', 'warning', 'error', 'offline'];
const agvStatePool: AGVTelemetry['state'][] = ['moving', 'moving', 'moving', 'loading', 'charging', 'idle'];
const realtimeUrl = (import.meta.env.VITE_REALTIME_URL as string | undefined)?.trim();
const dataMode = import.meta.env.VITE_DATA_MODE === 'local' ? 'local' : 'api';

export class WebSocketService {
  private readonly handlers = new Set<MessageHandler>();
  private readonly connectionHandlers = new Set<ConnectionHandler>();
  private localTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private connectTimeout: number | null = null;
  private socket: WebSocket | null = null;
  private devices: DeviceTelemetry[] = [];
  private agvs: AGVTelemetry[] = [];
  private alarms: FactoryAlarm[] = [];
  private logs: FactoryLog[] = [];
  private tick = 0;
  private reconnectAttempt = 0;
  private localSimulationTime = new Date('2026-08-28T08:00:00.000Z');
  private currentState: RealtimeConnectionState = 'idle';
  private shouldReconnect = false;
  private remoteEnabled = false;

  connect(options: ConnectOptions = {}): void {
    this.disconnect(false);
    this.shouldReconnect = true;
    this.remoteEnabled = options.mode !== 'local' && Boolean(realtimeUrl);
    if (options.seed) this.seed(options.seed);

    if (options.mode === 'local' && dataMode === 'local') {
      this.startLocal(options.emitSnapshot !== false);
      return;
    }
    if (!this.remoteEnabled) {
      this.setConnectionState('offline');
      return;
    }
    this.connectRemote(options);
  }

  disconnect(notify = true): void {
    this.shouldReconnect = false;
    this.clearTimers();
    this.localTimer = null;
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    if (notify) this.setConnectionState('offline');
  }

  seed(snapshot: FactorySnapshot): void {
    this.devices = [...snapshot.devices];
    this.agvs = [...snapshot.agvs];
    this.alarms = [...snapshot.alarms];
    this.logs = [...snapshot.logs];
    const currentTime = snapshot.simulator?.currentTime;
    if (currentTime) {
      const parsed = new Date(currentTime);
      if (!Number.isNaN(parsed.getTime())) this.localSimulationTime = parsed;
    }
  }

  subscribe(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onConnectionChange(handler: ConnectionHandler): () => void {
    this.connectionHandlers.add(handler);
    return () => this.connectionHandlers.delete(handler);
  }

  /**
   * Inject a fault into the local fallback stream.
   * Remote mode deliberately rejects this operation: the demo must never turn
   * a visualisation control into a real equipment command.
   */
  injectLocalFault(deviceId: string, message = '演示故障：设备需要检修'): boolean {
    if (this.remoteEnabled) return false;
    const current = this.devices.find((device) => device.id === deviceId);
    if (!current) return false;
    const device: DeviceTelemetry = {
      ...current,
      status: 'error',
      warning: message,
      observedAt: this.localSimulationTime.toISOString(),
    };
    this.devices = this.devices.map((item) => item.id === deviceId ? device : item);
    this.emit({ type: 'device:update', payload: device });
    const alarm = this.createAlarm('critical', device.id, `${device.name}${message}`, device.lineId);
    this.alarms = [alarm, ...this.alarms.filter((item) => item.source !== device.id)].slice(0, 12);
    this.emit({ type: 'alarm', payload: alarm });
    this.emit({ type: 'simulator:update', payload: this.currentSimulatorState() });
    return true;
  }

  /** Recover a device in local mode without issuing a remote control command. */
  recoverLocalDevice(deviceId: string): boolean {
    if (this.remoteEnabled) return false;
    const current = this.devices.find((device) => device.id === deviceId);
    if (!current) return false;
    const device: DeviceTelemetry = {
      ...current,
      status: 'running',
      warning: null,
      observedAt: this.localSimulationTime.toISOString(),
    };
    this.devices = this.devices.map((item) => item.id === deviceId ? device : item);
    this.emit({ type: 'device:update', payload: device });
    this.emit({ type: 'simulator:update', payload: this.currentSimulatorState() });
    return true;
  }

  private connectRemote(options: ConnectOptions): void {
    if (!realtimeUrl || typeof WebSocket === 'undefined') {
      this.startLocal(options.emitSnapshot !== false);
      return;
    }
    this.setConnectionState(this.reconnectAttempt ? 'reconnecting' : 'connecting');
    try {
      const url = new URL(realtimeUrl, window.location.origin);
      url.searchParams.set('tenantId', import.meta.env.VITE_TENANT_ID ?? 'tenant-demo');
      this.socket = new WebSocket(url);
      this.connectTimeout = window.setTimeout(() => {
        if (this.socket?.readyState === WebSocket.CONNECTING) this.socket.close();
      }, 6_000);
      this.socket.addEventListener('open', () => {
        this.clearConnectTimeout();
        this.reconnectAttempt = 0;
        this.setConnectionState('connected');
      });
      this.socket.addEventListener('message', (event) => {
        const raw = typeof event.data === 'string' ? this.parseJson(event.data) : event.data;
        parseRealtimeMessages(raw).forEach((message) => this.emit(message));
      });
      this.socket.addEventListener('error', () => {
        this.setConnectionState('offline');
      });
      this.socket.addEventListener('close', () => {
        this.clearConnectTimeout();
        this.socket = null;
        if (this.shouldReconnect) this.scheduleReconnect();
      });
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectTimer !== null) return;
    this.reconnectAttempt += 1;
    this.setConnectionState('reconnecting');
    const delay = Math.min(10_000, 500 * 2 ** Math.min(this.reconnectAttempt - 1, 4));
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect({ mode: 'remote', emitSnapshot: false });
    }, delay);
  }

  private startLocal(emitSnapshot: boolean): void {
    this.setConnectionState('fallback');
    if (!this.devices.length) {
      this.devices = this.createDevices();
      this.agvs = this.createAgvs();
      this.alarms = [
        this.createAlarm('warning', 'CAM-04', '仓储区摄像头出现短时抖动', 'LINE-04'),
        this.createAlarm('info', 'AGV-02', '机器人完成 A-17 物料转运任务', 'LINE-02'),
      ];
      this.logs = [
        this.createLog('后端不可用，已切换本地仿真数据'),
        this.createLog('产线节拍监测模块启动'),
      ];
    }
    if (emitSnapshot) this.emit({ type: 'snapshot', payload: this.createSnapshot() });
    this.localTimer = window.setInterval(() => this.simulateTick(), 1_400);
  }

  private simulateTick(): void {
    if (!this.devices.length) return;
    this.tick += 1;
    this.localSimulationTime = new Date(this.localSimulationTime.getTime() + 60_000);
    const deviceIndex = Math.floor(Math.random() * this.devices.length);
    const current = this.devices[deviceIndex];
    const drift = Math.random() * 4 - 1.5;
    const status = Math.random() > 0.82 ? this.randomStatus() : current.status;
    const warning = status === 'warning' ? '温度接近阈值' : status === 'error' ? '驱动模块异常' : null;
    const device: DeviceTelemetry = {
      ...current,
      status,
      warning,
      observedAt: this.localSimulationTime.toISOString(),
      temperature: Math.max(22, Math.min(92, Number((current.temperature + drift).toFixed(1)))),
      power: Math.max(0, Number((current.power + Math.random() * 12 - 4).toFixed(1))),
    };
    this.devices[deviceIndex] = device;
    this.emit({ type: 'device:update', payload: device });

    this.agvs = this.agvs.map((agv, index) => {
      const state = agv.state !== 'moving'
        ? 'moving'
        : Math.random() > 0.94
          ? agvStatePool[Math.floor(Math.random() * agvStatePool.length)]
          : 'moving';
      const batteryDelta = state === 'charging' ? 2.8 : -0.8 - Math.random() * 0.7;
      const next: AGVTelemetry = {
        ...agv,
        state,
        battery: Math.max(8, Math.min(100, Number((agv.battery + batteryDelta).toFixed(1)))),
        progress: (agv.progress + 4 + index * 1.2) % 100,
      };
      this.emit({ type: 'agv:update', payload: next });
      return next;
    });

    if (device.warning && Math.random() > 0.45) {
      const alarm = this.createAlarm(device.status === 'error' ? 'critical' : 'warning', device.id, `${device.name}${device.warning}`);
      this.alarms = [alarm, ...this.alarms.filter((item) => this.alarmKey(item) !== this.alarmKey(alarm))].slice(0, 8);
      this.emit({ type: 'alarm', payload: alarm });
    }
    this.emit({
      type: 'simulator:update',
      payload: {
        status: 'RUNNING',
        paused: false,
        timeScale: 1,
        currentTime: this.localSimulationTime.toISOString(),
      },
    });

    if (this.tick % 2 === 0) {
      const log = this.createLog(`${device.name} 数据刷新：${device.temperature.toFixed(1)}℃ / ${device.power.toFixed(1)}kW`);
      this.logs = [log, ...this.logs].slice(0, 12);
      this.emit({ type: 'log', payload: log });
    }
  }

  private createSnapshot(): FactorySnapshot {
    return {
      devices: this.devices,
      agvs: this.agvs,
      alarms: this.alarms,
      logs: this.logs,
      todayTasks: 126 + Math.floor(Math.random() * 18),
      powerConsumption: 2480 + Math.floor(Math.random() * 120),
      temperatureTrend: Array.from({ length: 8 }, (_, index) => 40 + index + Math.round(Math.random() * 5)),
      simulator: this.currentSimulatorState(),
    };
  }

  private currentSimulatorState(): NonNullable<FactorySnapshot['simulator']> {
    return {
      status: 'RUNNING',
      paused: false,
      timeScale: 1,
      currentTime: this.localSimulationTime.toISOString(),
    };
  }

  private createDevices(): DeviceTelemetry[] {
    const names = ['CNC 加工中心 A1', '刀具检测台', '装配机器人 R7', '螺栓拧紧机 A2', '焊接工作站', '焊缝检测台', '视觉检测台', '边缘视觉网关'];
    const zones = ['CNC 加工区', 'CNC 加工区', '装配区', '装配区', '焊接区', '焊接区', '视觉检测区', '视觉检测区'];
    const lineIds = ['LINE-01', 'LINE-01', 'LINE-02', 'LINE-02', 'LINE-03', 'LINE-03', 'LINE-04', 'LINE-04'];
    return names.map((name, index) => ({
      id: `DEV-${String(index + 1).padStart(2, '0')}`,
      name,
      lineId: lineIds[index],
      zone: zones[index],
      status: index === 4 ? 'error' : index === 5 ? 'warning' : index === 7 ? 'offline' : 'running',
      temperature: 38 + index * 3 + Math.random() * 3,
      power: 38 + index * 7 + Math.random() * 5,
      warning: index === 4 ? '焊接电流异常' : index === 5 ? '焊缝质量需要复检' : null,
      position: devicePositions[index],
    }));
  }

  private createAgvs(): AGVTelemetry[] {
    return ['AGV-01', 'AGV-02', 'AGV-03'].map((id, index) => ({
      id,
      name: `运输机器人 ${index + 1}`,
      lineId: ['LINE-01', 'LINE-02', 'LINE-03'][index],
      state: 'moving',
      battery: 86 - index * 13,
      speed: 0.34 + index * 0.04,
      task: index === 0 ? '原料配送' : index === 1 ? '成品入库' : '工装回收',
      progress: index * 30,
      position: { x: 0, y: 0, z: 0 },
    }));
  }

  private randomStatus(): DeviceStatus {
    return statusPool[Math.floor(Math.random() * statusPool.length)];
  }

  private createAlarm(level: FactoryAlarm['level'], source: string, message: string, lineId?: string): FactoryAlarm {
    const sourceDevice = this.devices.find((device) => device.id === source);
    return {
      id: createId('alarm'),
      level,
      source,
      lineId: lineId ?? sourceDevice?.lineId,
      message,
      time: formatClock(),
    };
  }

  private createLog(message: string): FactoryLog {
    return { id: createId('log'), time: formatClock(), message };
  }

  private emit(message: RealtimeMessage): void {
    this.handlers.forEach((handler) => handler(message));
  }

  private setConnectionState(state: RealtimeConnectionState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    const change = { state, attempt: this.reconnectAttempt, remote: this.remoteEnabled };
    this.connectionHandlers.forEach((handler) => handler(change));
  }

  private clearTimers(): void {
    window.clearInterval(this.localTimer ?? undefined);
    window.clearTimeout(this.reconnectTimer ?? undefined);
    this.clearConnectTimeout();
    this.reconnectTimer = null;
  }

  private clearConnectTimeout(): void {
    window.clearTimeout(this.connectTimeout ?? undefined);
    this.connectTimeout = null;
  }

  private parseJson(value: string): unknown {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  }

  private alarmKey(alarm: FactoryAlarm): string {
    return `${alarm.source}|${alarm.level}|${alarm.message}`;
  }
}

export const websocketService = new WebSocketService();
