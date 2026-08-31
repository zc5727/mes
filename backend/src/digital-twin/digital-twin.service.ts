import { Injectable } from '@nestjs/common';
import { AlarmsService } from '../alarms/alarms.service';
import { Agv, AgvsService } from '../agvs/agvs.service';
import { Device, DevicesService } from '../devices/devices.service';
import { MqttIngestionService } from '../mqtt/mqtt-ingestion.service';
import type { AlarmState, CachedDeviceTelemetry } from '../mqtt/mqtt.types';
import { ProductionLine, ProductionLinesService } from '../production-lines/production-lines.service';
import { resolveLedgerIdentity, resolveSimulatorIdentity, SIMULATOR_DEVICE_CATALOG } from './device-identity';

export interface DigitalTwinDeviceState {
  deviceId: string;
  canonicalId: string;
  sourceId: string;
  lineId: string;
  name: string;
  status: Device['status'];
  lastSeenAt: string | null;
  observedAt: string | null;
  metrics: Record<string, number | string | boolean | null>;
  position: { x: number; y: number; z: number } | null;
  timestamp: string;
  lastUpdatedAt: string;
  snapshotVersion: string;
  dataSource: 'simulator' | 'mqtt' | 'database' | 'mock';
  positionSource: 'backend' | 'scene-default' | null;
  activeFaults: string[];
  source: 'ledger' | 'mqtt' | 'catalog';
  sourceTopic?: string;
}

export interface DigitalTwinLineState {
  lineId: string;
  code: string;
  name: string;
  status: ProductionLine['status'] | 'fault' | 'offline';
  deviceIds: string[];
  activeAlarmCount: number;
  oee: OeeState;
  metrics: Record<string, number | string | boolean | null>;
  position: null;
  timestamp: string;
  lastUpdatedAt: string;
  snapshotVersion: string;
  dataSource: 'simulator' | 'mqtt' | 'database' | 'mock';
}

export interface OeeState {
  availability: number;
  performance: number;
  quality: number;
  oee: number;
  totalCount: number;
  goodCount: number;
  defectCount: number;
}

export interface DigitalTwinAlarmState {
  alarmId: string;
  id: string;
  sourceId: string;
  canonicalDeviceId: string;
  lineId: string;
  level: string;
  message: string;
  status: 'active';
  occurredAt: string;
  timestamp: string;
  lastUpdatedAt: string;
  metrics: Record<string, number | string | boolean | null>;
  position: { x: number; y: number; z: number } | null;
  snapshotVersion: string;
  dataSource: 'simulator' | 'mqtt' | 'database' | 'mock';
}

export interface DigitalTwinSnapshot {
  tenantId: string;
  generatedAt: string;
  dataTime: string | null;
  state: 'current';
  timestamp: string;
  lastUpdatedAt: string;
  snapshotVersion: string;
  dataSource: 'simulator' | 'mqtt' | 'database' | 'mock';
  metrics: Record<string, number | string | boolean | null>;
  connectivity: {
    mqtt: 'connected' | 'disconnected';
    telemetryDevices: number;
    activeAlarms: number;
  };
  lines: DigitalTwinLineState[];
  devices: DigitalTwinDeviceState[];
  alarms: DigitalTwinAlarmState[];
  agvs: Agv[];
}

@Injectable()
export class DigitalTwinService {
  private readonly snapshotSequences = new Map<string, number>();

  constructor(
    private readonly productionLinesService: ProductionLinesService,
    private readonly devicesService: DevicesService,
    private readonly agvsService: AgvsService,
    private readonly alarmsService: AlarmsService,
    private readonly mqttIngestionService: MqttIngestionService,
  ) {}

  getSnapshot(tenantId: string): DigitalTwinSnapshot {
    const liveDevices = this.mqttIngestionService.listDevices(tenantId);
    const snapshotVersion = this.nextSnapshotVersion(tenantId);
    const devices = this.mergeDevices(this.devicesService.findAll(tenantId), liveDevices, snapshotVersion);
    const alarms = this.mqttIngestionService
      .listActiveAlarms(tenantId)
      .map((state) => this.toAlarmState(state, snapshotVersion));
    const alarmsByLine = new Map<string, number>();
    alarms.forEach((alarm) => alarmsByLine.set(alarm.lineId, (alarmsByLine.get(alarm.lineId) ?? 0) + 1));

    const lines = this.productionLinesService.findAll(tenantId).map((line) => {
      const lineDevices = devices.filter((device) => device.lineId === line.id);
      const activeAlarmCount = alarmsByLine.get(line.id) ?? 0;
      return {
        lineId: line.id,
        code: line.code,
        name: line.name,
        status: this.resolveLineStatus(line.status, lineDevices, activeAlarmCount),
        deviceIds: lineDevices.map((device) => device.canonicalId),
        activeAlarmCount,
        oee: this.calculateOee(line.id, lineDevices),
        metrics: this.lineMetrics(this.calculateOee(line.id, lineDevices)),
        position: null,
        timestamp: this.latestDataTime(lineDevices, []) ?? line.updatedAt,
        lastUpdatedAt: this.latestAcceptedTime(lineDevices, []) ?? line.updatedAt,
        snapshotVersion,
        dataSource: this.lineSource(lineDevices),
      };
    });

    const dataTime = this.latestDataTime(devices, alarms);
    const generatedAt = new Date().toISOString();
    const oee = this.aggregateOee(lines.map((line) => line.oee));

    return {
      tenantId,
      generatedAt,
      dataTime,
      state: 'current',
      timestamp: dataTime ?? generatedAt,
      lastUpdatedAt: generatedAt,
      snapshotVersion,
      dataSource: liveDevices.length || alarms.length ? 'mqtt' : 'mock',
      metrics: this.lineMetrics(oee),
      connectivity: {
        mqtt: this.mqttIngestionService.isConnected() ? 'connected' : 'disconnected',
        telemetryDevices: liveDevices.length,
        activeAlarms: alarms.length,
      },
      lines,
      devices,
      alarms,
      agvs: this.agvsService.findAll(tenantId),
    };
  }

  private mergeDevices(
    baseDevices: Device[],
    liveDevices: CachedDeviceTelemetry[],
    snapshotVersion: string,
  ): DigitalTwinDeviceState[] {
    const live = liveDevices.map((device) => this.toLiveDevice(device, snapshotVersion));
    const existing = new Map<string, DigitalTwinDeviceState>();
    baseDevices
      .map((device) => this.toLedgerDevice(device, snapshotVersion))
      .forEach((device) => existing.set(device.canonicalId, device));
    live.forEach((device) => existing.set(device.canonicalId, device));

    SIMULATOR_DEVICE_CATALOG.forEach((entry) => {
      if (existing.has(entry.canonicalId)) return;
        existing.set(entry.canonicalId, {
        deviceId: entry.canonicalId,
        canonicalId: entry.canonicalId,
        sourceId: entry.sourceId,
        lineId: entry.lineId,
        name: entry.name,
        status: 'offline',
        lastSeenAt: null,
        observedAt: null,
        metrics: {},
        position: null,
        timestamp: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        snapshotVersion,
        dataSource: 'mock',
        positionSource: null,
        activeFaults: [],
        source: 'catalog',
      });
    });
    return [...existing.values()];
  }

  private toLiveDevice(device: CachedDeviceTelemetry, snapshotVersion: string): DigitalTwinDeviceState {
    const identity = resolveSimulatorIdentity(device.lineId, device.deviceId);
    return {
      deviceId: identity.canonicalId,
      canonicalId: identity.canonicalId,
      sourceId: identity.sourceId,
      lineId: device.lineId,
      name: device.deviceName,
      status: device.status === 'FAULT' || device.status === 'WARNING'
        ? 'alarm'
        : device.status === 'STOPPED' || device.status === 'OFFLINE' ? 'offline' : 'online',
      lastSeenAt: device.timestamp,
      observedAt: device.timestamp,
      metrics: {
        temperatureCelsius: device.temperatureCelsius,
        cycleTimeSeconds: device.cycleTimeSeconds,
        totalCount: device.totalCount,
        goodCount: device.goodCount,
        defectCount: device.defectCount,
      },
      position: null,
      timestamp: device.timestamp,
      lastUpdatedAt: device.receivedAt,
      snapshotVersion,
      dataSource: 'mqtt',
      positionSource: null,
      activeFaults: [...device.activeFaults],
      source: 'mqtt',
      sourceTopic: device.sourceTopic,
    };
  }

  private toLedgerDevice(device: Device, snapshotVersion: string): DigitalTwinDeviceState {
    const identity = resolveLedgerIdentity(device);
    return {
      deviceId: identity.canonicalId,
      canonicalId: identity.canonicalId,
      sourceId: identity.sourceId,
      lineId: device.lineId,
      name: device.name,
      status: device.status,
      lastSeenAt: device.lastSeenAt,
      observedAt: device.updatedAt,
      metrics: device.metrics,
      position: null,
      timestamp: device.updatedAt,
      lastUpdatedAt: device.updatedAt,
      snapshotVersion,
      dataSource: 'mock',
      positionSource: null,
      activeFaults: device.statusReason ? [device.statusReason] : [],
      source: 'ledger',
    };
  }

  private toAlarmState(state: AlarmState, snapshotVersion: string): DigitalTwinAlarmState {
    const identity = resolveSimulatorIdentity(state.alarm.lineId, state.alarm.deviceId);
    return {
      alarmId: state.alarm.id,
      id: state.alarm.id,
      sourceId: identity.sourceId,
      canonicalDeviceId: identity.canonicalId,
      lineId: state.alarm.lineId,
      level: state.alarm.severity.toLowerCase(),
      message: state.alarm.message,
      status: 'active',
      occurredAt: state.alarm.startedAt,
      timestamp: state.alarm.startedAt,
      lastUpdatedAt: state.updatedAt,
      metrics: { severity: state.alarm.severity, faultType: state.alarm.type },
      position: null,
      snapshotVersion,
      dataSource: 'mqtt',
    };
  }

  private calculateOee(lineId: string, devices: DigitalTwinDeviceState[]): OeeState {
    const lineDevices = devices.filter((device) => device.lineId === lineId);
    const totalCount = this.sumMetric(lineDevices, 'totalCount');
    const goodCount = this.sumMetric(lineDevices, 'goodCount');
    const defectCount = this.sumMetric(lineDevices, 'defectCount');
    const availability = lineDevices.length
      ? this.roundPercent(lineDevices.filter((device) => device.status === 'online').length / lineDevices.length)
      : 0;
    const cycleTimes = lineDevices
      .map((device) => this.numberMetric(device.metrics.cycleTimeSeconds ?? device.metrics.cycleTime))
      .filter((value) => value > 0);
    const averageCycle = cycleTimes.length
      ? cycleTimes.reduce((sum, value) => sum + value, 0) / cycleTimes.length
      : 0;
    const idealCycle = { 'line-cnc': 42, 'line-assembly': 35, 'line-welding': 55, 'line-vision': 28 }[lineId] ?? averageCycle;
    const performance = averageCycle > 0 ? this.roundPercent(Math.min(1, idealCycle / averageCycle)) : 0;
    const quality = totalCount > 0 ? this.roundPercent(goodCount / totalCount) : 0;
    return {
      availability,
      performance,
      quality,
      oee: this.roundPercent((availability / 100) * (performance / 100) * (quality / 100)),
      totalCount,
      goodCount,
      defectCount,
    };
  }

  private resolveLineStatus(
    ledgerStatus: ProductionLine['status'],
    devices: DigitalTwinDeviceState[],
    activeAlarmCount: number,
  ): DigitalTwinLineState['status'] {
    if (activeAlarmCount > 0 || devices.some((device) => device.status === 'alarm')) return 'fault';
    if (devices.length > 0 && devices.every((device) => device.status === 'offline')) return 'offline';
    return ledgerStatus;
  }

  private latestDataTime(devices: DigitalTwinDeviceState[], alarms: DigitalTwinAlarmState[]): string | null {
    const values = [
      ...devices.map((device) => device.observedAt),
      ...alarms.map((alarm) => alarm.occurredAt),
    ].filter((value): value is string => value !== null);
    return values.sort().at(-1) ?? null;
  }

  private latestAcceptedTime(devices: DigitalTwinDeviceState[], alarms: DigitalTwinAlarmState[]): string | null {
    const values = [
      ...devices.map((device) => device.lastUpdatedAt),
      ...alarms.map((alarm) => alarm.lastUpdatedAt),
    ];
    return values.sort().at(-1) ?? null;
  }

  private nextSnapshotVersion(tenantId: string): string {
    const next = (this.snapshotSequences.get(tenantId) ?? 0) + 1;
    this.snapshotSequences.set(tenantId, next);
    return `${tenantId}-${String(next).padStart(6, '0')}`;
  }

  private lineMetrics(oee: OeeState): Record<string, number> {
    return {
      availability: oee.availability,
      performance: oee.performance,
      quality: oee.quality,
      oee: oee.oee,
      totalCount: oee.totalCount,
      goodCount: oee.goodCount,
      defectCount: oee.defectCount,
    };
  }

  private aggregateOee(values: OeeState[]): OeeState {
    const totals = values.reduce((result, value) => ({
      availability: result.availability + value.availability,
      performance: result.performance + value.performance,
      quality: result.quality + value.quality,
      oee: result.oee + value.oee,
      totalCount: result.totalCount + value.totalCount,
      goodCount: result.goodCount + value.goodCount,
      defectCount: result.defectCount + value.defectCount,
    }), { availability: 0, performance: 0, quality: 0, oee: 0, totalCount: 0, goodCount: 0, defectCount: 0 });
    const count = values.length || 1;
    return {
      availability: Math.round((totals.availability / count) * 10) / 10,
      performance: Math.round((totals.performance / count) * 10) / 10,
      quality: Math.round((totals.quality / count) * 10) / 10,
      oee: Math.round((totals.oee / count) * 10) / 10,
      totalCount: totals.totalCount,
      goodCount: totals.goodCount,
      defectCount: totals.defectCount,
    };
  }

  private lineSource(devices: DigitalTwinDeviceState[]): DigitalTwinLineState['dataSource'] {
    return devices.some((device) => device.dataSource === 'mqtt') ? 'mqtt' : 'mock';
  }

  private sumMetric(devices: DigitalTwinDeviceState[], key: string): number {
    return devices.reduce((sum, device) => sum + this.numberMetric(device.metrics[key]), 0);
  }

  private numberMetric(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  private roundPercent(value: number): number {
    return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 10;
  }
}
