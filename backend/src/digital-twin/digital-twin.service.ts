import { Injectable } from '@nestjs/common';
import { AlarmsService } from '../alarms/alarms.service';
import { Agv, AgvsService } from '../agvs/agvs.service';
import { Device, DevicesService } from '../devices/devices.service';
import { MqttIngestionService } from '../mqtt/mqtt-ingestion.service';
import type { AlarmState, CachedDeviceTelemetry } from '../mqtt/mqtt.types';
import { ProductionLine, ProductionLinesService } from '../production-lines/production-lines.service';
import { resolveLedgerIdentity, resolveSimulatorIdentity, SIMULATOR_DEVICE_CATALOG } from './device-identity';

export interface DigitalTwinDeviceState {
  canonicalId: string;
  sourceId: string;
  lineId: string;
  name: string;
  status: Device['status'];
  lastSeenAt: string | null;
  observedAt: string | null;
  metrics: Record<string, number | string | boolean | null>;
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
  id: string;
  sourceId: string;
  canonicalDeviceId: string;
  lineId: string;
  level: string;
  message: string;
  status: 'active';
  occurredAt: string;
}

export interface DigitalTwinSnapshot {
  tenantId: string;
  generatedAt: string;
  dataTime: string | null;
  state: 'current';
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
  constructor(
    private readonly productionLinesService: ProductionLinesService,
    private readonly devicesService: DevicesService,
    private readonly agvsService: AgvsService,
    private readonly alarmsService: AlarmsService,
    private readonly mqttIngestionService: MqttIngestionService,
  ) {}

  getSnapshot(tenantId: string): DigitalTwinSnapshot {
    const liveDevices = this.mqttIngestionService.listDevices(tenantId);
    const devices = this.mergeDevices(this.devicesService.findAll(tenantId), liveDevices);
    const alarms = this.mqttIngestionService.listActiveAlarms(tenantId).map((state) => this.toAlarmState(state));
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
        oee: this.calculateOee(line.id, liveDevices),
      };
    });

    const dataTime = this.latestDataTime(devices, alarms);

    return {
      tenantId,
      generatedAt: new Date().toISOString(),
      dataTime,
      state: 'current',
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

  private mergeDevices(baseDevices: Device[], liveDevices: CachedDeviceTelemetry[]): DigitalTwinDeviceState[] {
    const live = liveDevices.map((device) => this.toLiveDevice(device));
    const existing = new Map<string, DigitalTwinDeviceState>();
    baseDevices
      .map((device) => this.toLedgerDevice(device))
      .forEach((device) => existing.set(device.canonicalId, device));
    live.forEach((device) => existing.set(device.canonicalId, device));

    SIMULATOR_DEVICE_CATALOG.forEach((entry) => {
      if (existing.has(entry.canonicalId)) return;
      existing.set(entry.canonicalId, {
        canonicalId: entry.canonicalId,
        sourceId: entry.sourceId,
        lineId: entry.lineId,
        name: entry.name,
        status: 'offline',
        lastSeenAt: null,
        observedAt: null,
        metrics: {},
        activeFaults: [],
        source: 'catalog',
      });
    });
    return [...existing.values()];
  }

  private toLiveDevice(device: CachedDeviceTelemetry): DigitalTwinDeviceState {
    const identity = resolveSimulatorIdentity(device.lineId, device.deviceId);
    return {
      canonicalId: identity.canonicalId,
      sourceId: identity.sourceId,
      lineId: device.lineId,
      name: device.deviceName,
      status: device.status === 'FAULT' ? 'alarm' : device.status === 'STOPPED' ? 'offline' : 'online',
      lastSeenAt: device.timestamp,
      observedAt: device.timestamp,
      metrics: {
        temperature: device.temperatureCelsius,
        cycleTime: device.cycleTimeSeconds,
        totalCount: device.totalCount,
        goodCount: device.goodCount,
        defectCount: device.defectCount,
      },
      activeFaults: [...device.activeFaults],
      source: 'mqtt',
      sourceTopic: device.sourceTopic,
    };
  }

  private toLedgerDevice(device: Device): DigitalTwinDeviceState {
    const identity = resolveLedgerIdentity(device);
    return {
      canonicalId: identity.canonicalId,
      sourceId: identity.sourceId,
      lineId: device.lineId,
      name: device.name,
      status: device.status,
      lastSeenAt: device.lastSeenAt,
      observedAt: device.updatedAt,
      metrics: device.metrics,
      activeFaults: device.statusReason ? [device.statusReason] : [],
      source: 'ledger',
    };
  }

  private toAlarmState(state: AlarmState): DigitalTwinAlarmState {
    const identity = resolveSimulatorIdentity(state.alarm.lineId, state.alarm.deviceId);
    return {
      id: state.alarm.id,
      sourceId: identity.sourceId,
      canonicalDeviceId: identity.canonicalId,
      lineId: state.alarm.lineId,
      level: state.alarm.severity.toLowerCase(),
      message: state.alarm.message,
      status: 'active',
      occurredAt: state.alarm.startedAt,
    };
  }

  private calculateOee(lineId: string, liveDevices: CachedDeviceTelemetry[]): OeeState {
    const devices = liveDevices.filter((device) => device.lineId === lineId);
    const totalCount = devices.reduce((sum, device) => sum + device.totalCount, 0);
    const goodCount = devices.reduce((sum, device) => sum + device.goodCount, 0);
    const defectCount = devices.reduce((sum, device) => sum + device.defectCount, 0);
    const availability = devices.length
      ? this.roundPercent(devices.filter((device) => device.status !== 'STOPPED' && device.status !== 'FAULT').length / devices.length)
      : 0;
    const averageCycle = devices.length
      ? devices.reduce((sum, device) => sum + device.cycleTimeSeconds, 0) / devices.length
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

  private roundPercent(value: number): number {
    return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 10;
  }
}
