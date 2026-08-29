import { Injectable, NotFoundException } from '@nestjs/common';
import { Agv, AgvsService } from '../agvs/agvs.service';
import { Device, DevicesService } from '../devices/devices.service';
import { Alarm, AlarmsService } from '../alarms/alarms.service';
import { ProductionLinesService } from '../production-lines/production-lines.service';
import { WorkOrdersService } from '../work-orders/work-orders.service';
import { MqttIngestionService } from '../mqtt/mqtt-ingestion.service';
import type { CachedDeviceTelemetry } from '../mqtt/mqtt.types';

export interface DashboardOverview {
  lines: {
    total: number;
    active: number;
    inactive: number;
    maintenance: number;
    averageTargetOee: number;
  };
  devices: {
    total: number;
    online: number;
    offline: number;
    maintenance: number;
    alarm: number;
    onlineRate: number;
  };
  workOrders: ReturnType<WorkOrdersService['findOverview']>;
  agvs: {
    total: number;
    idle: number;
    moving: number;
    loading: number;
    charging: number;
    error: number;
    averageBattery: number;
  };
  alarms: {
    total: number;
    info: number;
    warning: number;
    critical: number;
  };
  todayTasks: number;
  powerConsumption: number;
  temperatureTrend: number[];
  generatedAt: string;
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly productionLinesService: ProductionLinesService,
    private readonly devicesService: DevicesService,
    private readonly workOrdersService: WorkOrdersService,
    private readonly agvsService: AgvsService,
    private readonly alarmsService: AlarmsService,
    private readonly mqttIngestionService?: MqttIngestionService,
  ) {}

  getOverview(tenantId: string): DashboardOverview {
    const lines = this.productionLinesService.findOverview(tenantId);
    const devices = this.currentDevices(tenantId);
    const workOrders = this.workOrdersService.findOverview(tenantId);
    const agvs = this.agvsService.findAll(tenantId);
    const alarms = this.alarmsService.findAll(tenantId);

    return {
      lines,
      devices: this.summarizeDevices(devices),
      workOrders,
      agvs: this.summarizeAgvs(agvs),
      alarms: this.summarizeAlarms(alarms),
      todayTasks: workOrders.inProgress + workOrders.released,
      powerConsumption: this.sumMetric(devices, 'power', 'load'),
      temperatureTrend: this.temperatureTrend(devices),
      generatedAt: new Date().toISOString(),
    };
  }

  getLineOverview(tenantId: string, lineId: string) {
    const line = this.productionLinesService.findOne(tenantId, lineId);
    const devices = this.currentDevices(tenantId).filter((device) => device.lineId === lineId);
    const alarms = this.alarmsService.findAll(tenantId, { lineId });
    const workOrders = this.workOrdersService.findAll(tenantId).filter((order) => order.lineId === lineId);
    if (!line) throw new NotFoundException(`Production line ${lineId} not found`);
    return {
      line,
      devices,
      alarms,
      workOrders,
      onlineRate: devices.length ? Math.round((devices.filter((device) => device.status === 'online').length / devices.length) * 1000) / 10 : 0,
      powerConsumption: this.sumMetric(devices, 'power', 'load'),
      generatedAt: new Date().toISOString(),
    };
  }

  private currentDevices(tenantId: string): Device[] {
    const baseDevices = this.devicesService.findAll(tenantId);
    const liveDevices = this.mqttIngestionService?.listDevices(tenantId) ?? [];
    if (!liveDevices.length) return baseDevices;

    const liveLines = new Set(liveDevices.map((device) => device.lineId));
    return [
      ...baseDevices.filter((device) => !liveLines.has(device.lineId)),
      ...liveDevices.map((device) => this.toDevice(device)),
    ];
  }

  private toDevice(device: CachedDeviceTelemetry): Device {
    const status: Device['status'] = device.status === 'FAULT'
      ? 'alarm'
      : device.status === 'STOPPED'
        ? 'offline'
        : 'online';
    return {
      id: device.deviceId,
      tenantId: device.tenantId,
      lineId: device.lineId,
      code: device.deviceId,
      name: device.deviceName,
      model: 'SIMULATOR',
      protocol: 'simulator',
      status,
      statusReason: device.activeFaults.join(', '),
      lastSeenAt: device.timestamp,
      metrics: {
        temperature: device.temperatureCelsius,
        cycleTime: device.cycleTimeSeconds,
        totalCount: device.totalCount,
        goodCount: device.goodCount,
        defectCount: device.defectCount,
      },
      metadata: { activeFaults: device.activeFaults },
      createdAt: device.timestamp,
      updatedAt: device.timestamp,
    };
  }

  private summarizeDevices(devices: Device[]): DashboardOverview['devices'] {
    const online = devices.filter((device) => device.status === 'online').length;

    return {
      total: devices.length,
      online,
      offline: devices.filter((device) => device.status === 'offline').length,
      maintenance: devices.filter((device) => device.status === 'maintenance').length,
      alarm: devices.filter((device) => device.status === 'alarm').length,
      onlineRate: devices.length ? Math.round((online / devices.length) * 1000) / 10 : 0,
    };
  }

  private summarizeAgvs(agvs: Agv[]): DashboardOverview['agvs'] {
    const averageBattery = agvs.length
      ? Math.round((agvs.reduce((total, agv) => total + agv.battery, 0) / agvs.length) * 10) / 10
      : 0;

    return {
      total: agvs.length,
      idle: agvs.filter((agv) => agv.state === 'idle').length,
      moving: agvs.filter((agv) => agv.state === 'moving').length,
      loading: agvs.filter((agv) => agv.state === 'loading').length,
      charging: agvs.filter((agv) => agv.state === 'charging').length,
      error: agvs.filter((agv) => agv.state === 'error').length,
      averageBattery,
    };
  }

  private summarizeAlarms(alarms: Alarm[]): DashboardOverview['alarms'] {
    return {
      total: alarms.length,
      info: alarms.filter((alarm) => alarm.level === 'info').length,
      warning: alarms.filter((alarm) => alarm.level === 'warning').length,
      critical: alarms.filter((alarm) => alarm.level === 'critical').length,
    };
  }

  private sumMetric(devices: Device[], primaryKey: string, fallbackKey: string): number {
    return Math.round(devices.reduce((total, device) => {
      const value = device.metrics[primaryKey] ?? device.metrics[fallbackKey] ?? 0;
      return total + (typeof value === 'number' ? value : Number(value) || 0);
    }, 0) * 10) / 10;
  }

  private temperatureTrend(devices: Device[]): number[] {
    const trend = devices
      .map((device) => device.metrics.temperature)
      .filter((value): value is number => typeof value === 'number');

    return trend.length ? trend : [36, 37, 38];
  }
}
