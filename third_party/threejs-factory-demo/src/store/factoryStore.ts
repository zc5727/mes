import { defineStore } from 'pinia';
import type {
  AGVTelemetry,
  DeviceTelemetry,
  FactoryAlarm,
  FactoryLog,
  FactorySnapshot,
  ProductionLineTelemetry,
  SimulatorState,
} from '@/types/factory';

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'fallback' | 'offline' | 'polling';

interface FactoryState extends FactorySnapshot {
  productionLines: ProductionLineTelemetry[];
  selectedLineId: string | null;
  selectedDeviceId: string | null;
  connected: boolean;
  connectionState: ConnectionState;
  dataSource: 'api' | 'simulator';
}

const SELECTION_STORAGE_KEY = 'mes.factory.selection';

function readSelection(): Pick<FactoryState, 'selectedLineId' | 'selectedDeviceId'> {
  if (typeof window === 'undefined') return { selectedLineId: null, selectedDeviceId: null };
  try {
    const value = JSON.parse(window.sessionStorage.getItem(SELECTION_STORAGE_KEY) ?? 'null') as Partial<Pick<FactoryState, 'selectedLineId' | 'selectedDeviceId'>> | null;
    return {
      selectedLineId: typeof value?.selectedLineId === 'string' ? value.selectedLineId : null,
      selectedDeviceId: typeof value?.selectedDeviceId === 'string' ? value.selectedDeviceId : null,
    };
  } catch {
    return { selectedLineId: null, selectedDeviceId: null };
  }
}

function persistSelection(state: Pick<FactoryState, 'selectedLineId' | 'selectedDeviceId'>): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify({
      selectedLineId: state.selectedLineId,
      selectedDeviceId: state.selectedDeviceId,
    }));
  } catch {
    // Storage can be disabled by browser policy; in-memory selection remains valid.
  }
}

const initialSelection = readSelection();

export const useFactoryStore = defineStore('factory', {
  state: (): FactoryState => ({
    devices: [],
    agvs: [],
    alarms: [],
    logs: [],
    todayTasks: 0,
    powerConsumption: 0,
    temperatureTrend: [],
    productionLines: [],
    ...initialSelection,
    connected: false,
    connectionState: 'idle',
    dataSource: 'api',
  }),
  getters: {
    onlineDeviceCount: (state) => state.devices.filter((device) => device.status !== 'offline').length,
    warningDeviceCount: (state) => state.devices.filter((device) => device.status === 'warning').length,
    errorDeviceCount: (state) => state.devices.filter((device) => device.status === 'error').length,
    onlineRate: (state) => {
      if (!state.devices.length) return 0;
      return Math.round((state.devices.filter((device) => device.status !== 'offline').length / state.devices.length) * 100);
    },
    selectedDevice: (state): DeviceTelemetry | null =>
      state.devices.find((device) => device.id === state.selectedDeviceId) ?? null,
  },
  actions: {
    setConnected(connected: boolean) {
      this.connected = connected;
    },
    setConnectionState(connectionState: ConnectionState) {
      this.connectionState = connectionState;
      this.connected = connectionState === 'connected' || connectionState === 'polling';
    },
    setDataSource(dataSource: FactoryState['dataSource']) {
      this.dataSource = dataSource;
    },
    applySnapshot(snapshot: FactorySnapshot, lines?: ProductionLineTelemetry[]) {
      this.devices = snapshot.devices;
      this.agvs = snapshot.agvs;
      this.alarms = deduplicateAlarms(snapshot.alarms);
      this.logs = snapshot.logs;
      this.todayTasks = snapshot.todayTasks;
      this.powerConsumption = snapshot.powerConsumption;
      this.temperatureTrend = snapshot.temperatureTrend;
      this.productionSummary = snapshot.productionSummary;
      this.simulator = snapshot.simulator;
      this.productionLines = lines ?? snapshot.lines ?? this.productionLines;
    },
    updateDevice(payload: DeviceTelemetry) {
      const index = this.devices.findIndex((device) => device.id === payload.id);
      if (index >= 0) this.devices[index] = payload;
      else this.devices.push(payload);
    },
    updateAgv(payload: AGVTelemetry) {
      const index = this.agvs.findIndex((agv) => agv.id === payload.id);
      if (index >= 0) this.agvs[index] = payload;
      else this.agvs.push(payload);
    },
    pushAlarm(alarm: FactoryAlarm) {
      const key = alarmKey(alarm);
      this.alarms = [alarm, ...this.alarms.filter((item) => item.id !== alarm.id && alarmKey(item) !== key)].slice(0, 8);
    },
    removeAlarm(id: string) {
      this.alarms = this.alarms.filter((alarm) => alarm.id !== id);
    },
    pushLog(log: FactoryLog) {
      this.logs = [log, ...this.logs].slice(0, 12);
    },
    updateLine(line: ProductionLineTelemetry) {
      const index = this.productionLines.findIndex((item) => item.id === line.id);
      if (index >= 0) this.productionLines[index] = { ...this.productionLines[index], ...line };
      else this.productionLines.push(line);
    },
    updateSimulator(simulator: SimulatorState) {
      this.simulator = simulator;
    },
    selectDevice(id: string | null) {
      this.selectedDeviceId = id;
      persistSelection(this);
    },
    selectLine(id: string | null) {
      this.selectedLineId = id;
      persistSelection(this);
    },
  },
});

function deduplicateAlarms(alarms: FactoryAlarm[]): FactoryAlarm[] {
  return [...new Map(alarms.map((alarm) => [alarm.id, alarm])).values()];
}

function alarmKey(alarm: FactoryAlarm): string {
  return `${alarm.source}|${alarm.level}|${alarm.message}`;
}
