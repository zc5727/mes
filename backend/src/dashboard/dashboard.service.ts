import { Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';
import { Agv, AgvsService } from '../agvs/agvs.service';
import { Device, DevicesService } from '../devices/devices.service';
import { Alarm, AlarmsService } from '../alarms/alarms.service';
import { ProductionLine, ProductionLinesService } from '../production-lines/production-lines.service';
import { WorkOrdersService } from '../work-orders/work-orders.service';
import { MqttIngestionService } from '../mqtt/mqtt-ingestion.service';
import type { CachedDeviceTelemetry } from '../mqtt/mqtt.types';

export interface ProductionMetrics {
  plannedQty: number;
  completedQty: number;
  todayOutput: number;
  remainingQty: number;
  completionRate: number;
  totalCount: number;
  goodCount: number;
  defectCount: number;
  qualityRate: number | null;
  availabilityRate: number;
  performanceRate: number | null;
  oee: number | null;
  oeeAvailable: boolean;
  oeeSource: 'telemetry' | 'target' | 'unavailable';
  source: 'work_orders_and_device_snapshot';
  generatedAt: string;
}

export interface DashboardLineSummary {
  lineId: string;
  code: string;
  name: string;
  status: 'running' | 'idle' | 'maintenance' | 'warning' | 'error';
  baseStatus: ProductionLine['status'];
  targetOee: number;
  oee: number | null;
  deviceCount: number;
  onlineDeviceCount: number;
  onlineRate: number;
  activeAlarmCount: number;
  plannedQty: number;
  completedQty: number;
  todayOutput: number;
  remainingQty: number;
  completionRate: number;
  latestAlarmAt: string | null;
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface DashboardOverview {
  lines: {
    total: number;
    active: number;
    inactive: number;
    maintenance: number;
    averageTargetOee: number;
  };
  lineSummaries: DashboardLineSummary[];
  highestRiskLine: Pick<DashboardLineSummary, 'lineId' | 'code' | 'name' | 'riskScore' | 'riskLevel'> | null;
  recentAlarmAt: string | null;
  activeAlarmCount: number;
  deviceOnlineRate: number;
  devices: {
    total: number;
    online: number;
    offline: number;
    maintenance: number;
    alarm: number;
    onlineRate: number;
  };
  workOrders: ReturnType<WorkOrdersService['findOverview']>;
  productionMetrics: ProductionMetrics;
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
    active: number;
    info: number;
    warning: number;
    critical: number;
  };
  todayTasks: number;
  powerConsumption: number;
  temperatureTrend: number[];
  generatedAt: string;
}

export interface DashboardRealtimeMessage {
  data: {
    type: 'snapshot' | 'updated' | 'heartbeat';
    tenantId: string;
    overview: DashboardOverview;
    generatedAt: string;
  };
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
    const lineEntities = this.productionLinesService.findAll(tenantId);
    const devices = this.currentDevices(tenantId);
    const workOrders = this.workOrdersService.findOverview(tenantId);
    const agvs = this.agvsService.findAll(tenantId);
    const alarms = this.alarmsService.findAll(tenantId);
    const lineSummaries = lineEntities.map((line) => this.toLineSummary(line, tenantId, devices));
    const highestRiskLine = this.highestRiskLine(lineSummaries);
    const deviceSummary = this.summarizeDevices(devices);
    const alarmSummary = this.summarizeAlarms(alarms);

    return {
      lines,
      lineSummaries,
      highestRiskLine,
      recentAlarmAt: this.latestAlarmAt(alarms),
      activeAlarmCount: alarmSummary.active,
      deviceOnlineRate: deviceSummary.onlineRate,
      devices: deviceSummary,
      workOrders,
      productionMetrics: this.getProductionMetrics(tenantId),
      agvs: this.summarizeAgvs(agvs),
      alarms: alarmSummary,
      todayTasks: workOrders.inProgress + workOrders.released,
      powerConsumption: this.sumMetric(devices, 'power', 'load'),
      temperatureTrend: this.temperatureTrend(devices),
      generatedAt: new Date().toISOString(),
    };
  }

  stream(tenantId: string): Observable<DashboardRealtimeMessage> {
    return new Observable((subscriber) => {
      let closed = false;
      const emit = (type: DashboardRealtimeMessage['data']['type']) => {
        if (closed) return;
        subscriber.next({
          data: {
            type,
            tenantId,
            overview: this.getOverview(tenantId),
            generatedAt: new Date().toISOString(),
          },
        });
      };

      emit('snapshot');
      const unsubscribe = this.mqttIngestionService?.onProjection((changedTenant) => {
        if (changedTenant === tenantId) emit('updated');
      }) ?? (() => undefined);
      const heartbeat = setInterval(() => emit('heartbeat'), 15_000);

      return () => {
        closed = true;
        unsubscribe();
        clearInterval(heartbeat);
      };
    });
  }

  getProductionMetrics(tenantId: string, lineId?: string): ProductionMetrics {
    const workOrders = this.workOrdersService.findAll(tenantId)
      .filter((order) => !lineId || order.lineId === lineId);
    const devices = this.currentDevices(tenantId)
      .filter((device) => !lineId || device.lineId === lineId);
    const targetLines = this.productionLinesService.findAll(tenantId)
      .filter((line) => !lineId || line.id === lineId);
    const plannedQty = workOrders.reduce((total, order) => total + order.plannedQty, 0);
    const completedQty = workOrders.reduce((total, order) => total + order.completedQty, 0);
    const totalCount = this.sumMetric(devices, 'totalCount', 'total_count');
    const goodCount = this.sumMetric(devices, 'goodCount', 'good_count');
    const defectCount = Math.max(0, totalCount - goodCount);
    const hasCountTelemetry = devices.some((device) => typeof device.metrics.totalCount === 'number');
    const qualityRate = hasCountTelemetry && totalCount > 0 ? this.percent(goodCount / totalCount) : null;
    const onlineDeviceCount = devices.filter((device) => device.status === 'online').length;
    const availabilityRate = devices.length ? this.percent(onlineDeviceCount / devices.length) : 0;
    const targetOee = targetLines.length
      ? this.round(targetLines.reduce((total, line) => total + line.targetOee, 0) / targetLines.length)
      : null;
    const oee = qualityRate === null
      ? targetOee
      : this.round((availabilityRate * qualityRate) / 100);

    return {
      plannedQty,
      completedQty,
      todayOutput: completedQty,
      remainingQty: Math.max(0, plannedQty - completedQty),
      completionRate: plannedQty ? this.percent(completedQty / plannedQty) : 0,
      totalCount,
      goodCount,
      defectCount,
      qualityRate,
      availabilityRate,
      performanceRate: qualityRate === null ? null : 100,
      oee,
      oeeAvailable: qualityRate !== null,
      oeeSource: qualityRate !== null ? 'telemetry' : targetOee === null ? 'unavailable' : 'target',
      source: 'work_orders_and_device_snapshot',
      generatedAt: new Date().toISOString(),
    };
  }

  getLineOverview(tenantId: string, lineId: string) {
    const line = this.productionLinesService.findOne(tenantId, lineId);
    const allDevices = this.currentDevices(tenantId);
    const devices = allDevices.filter((device) => device.lineId === lineId);
    const alarms = this.alarmsService.findAll(tenantId, { lineId });
    const workOrders = this.workOrdersService.findAll(tenantId).filter((order) => order.lineId === lineId);
    const productionMetrics = this.getProductionMetrics(tenantId, lineId);
    const summary = this.toLineSummary(line, tenantId, allDevices);

    return {
      line,
      status: summary.status,
      devices,
      alarms,
      workOrders,
      productionMetrics,
      summary,
      onlineRate: summary.onlineRate,
      activeAlarmCount: summary.activeAlarmCount,
      latestAlarmAt: summary.latestAlarmAt,
      powerConsumption: this.sumMetric(devices, 'power', 'load'),
      generatedAt: new Date().toISOString(),
    };
  }

  private toLineSummary(line: ProductionLine, tenantId: string, devices: Device[]): DashboardLineSummary {
    const lineDevices = devices.filter((device) => device.lineId === line.id);
    const alarms = this.alarmsService.findAll(tenantId, { lineId: line.id });
    const metrics = this.getProductionMetrics(tenantId, line.id);
    const onlineDeviceCount = lineDevices.filter((device) => device.status === 'online').length;
    const onlineRate = lineDevices.length ? this.percent(onlineDeviceCount / lineDevices.length) : 0;
    const riskScore = this.calculateRiskScore(line, lineDevices, alarms);

    return {
      lineId: line.id,
      code: line.code,
      name: line.name,
      status: this.runtimeStatus(line, lineDevices, alarms),
      baseStatus: line.status,
      targetOee: line.targetOee,
      oee: metrics.oee,
      deviceCount: lineDevices.length,
      onlineDeviceCount,
      onlineRate,
      activeAlarmCount: alarms.length,
      plannedQty: metrics.plannedQty,
      completedQty: metrics.completedQty,
      todayOutput: metrics.todayOutput,
      remainingQty: metrics.remainingQty,
      completionRate: metrics.completionRate,
      latestAlarmAt: this.latestAlarmAt(alarms),
      riskScore,
      riskLevel: this.riskLevel(riskScore),
    };
  }

  private runtimeStatus(
    line: ProductionLine,
    devices: Device[],
    alarms: Alarm[],
  ): DashboardLineSummary['status'] {
    if (alarms.some((alarm) => alarm.level === 'critical') || devices.some((device) => device.status === 'alarm')) {
      return 'error';
    }
    if (line.status === 'maintenance') return 'maintenance';
    if (line.status === 'inactive') return 'idle';
    if (alarms.length || devices.some((device) => device.status !== 'online')) return 'warning';
    return 'running';
  }

  private calculateRiskScore(line: ProductionLine, devices: Device[], alarms: Alarm[]): number {
    const criticalAlarms = alarms.filter((alarm) => alarm.level === 'critical').length;
    const warningAlarms = alarms.filter((alarm) => alarm.level === 'warning').length;
    const unavailableDevices = devices.filter((device) => device.status !== 'online').length;
    return Math.min(100, criticalAlarms * 50 + warningAlarms * 25 + unavailableDevices * 15
      + (line.status === 'maintenance' ? 20 : 0) + (line.status === 'inactive' ? 10 : 0));
  }

  private riskLevel(score: number): DashboardLineSummary['riskLevel'] {
    if (score >= 75) return 'critical';
    if (score >= 45) return 'high';
    if (score >= 20) return 'medium';
    return 'low';
  }

  private highestRiskLine(lines: DashboardLineSummary[]): DashboardOverview['highestRiskLine'] {
    const line = [...lines].sort((left, right) => right.riskScore - left.riskScore
      || right.activeAlarmCount - left.activeAlarmCount)[0];
    if (!line) return null;
    return {
      lineId: line.lineId,
      code: line.code,
      name: line.name,
      riskScore: line.riskScore,
      riskLevel: line.riskLevel,
    };
  }

  private latestAlarmAt(alarms: Alarm[]): string | null {
    return alarms.map((alarm) => alarm.occurredAt).sort().at(-1) ?? null;
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
      onlineRate: devices.length ? this.percent(online / devices.length) : 0,
    };
  }

  private summarizeAgvs(agvs: Agv[]): DashboardOverview['agvs'] {
    const averageBattery = agvs.length
      ? this.round(agvs.reduce((total, agv) => total + agv.battery, 0) / agvs.length)
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
      active: alarms.filter((alarm) => alarm.status === 'active' || alarm.status === 'acknowledged').length,
      info: alarms.filter((alarm) => alarm.level === 'info').length,
      warning: alarms.filter((alarm) => alarm.level === 'warning').length,
      critical: alarms.filter((alarm) => alarm.level === 'critical').length,
    };
  }

  private sumMetric(devices: Device[], primaryKey: string, fallbackKey: string): number {
    return this.round(devices.reduce((total, device) => {
      const value = device.metrics[primaryKey] ?? device.metrics[fallbackKey] ?? 0;
      return total + (typeof value === 'number' ? value : Number(value) || 0);
    }, 0));
  }

  private temperatureTrend(devices: Device[]): number[] {
    const trend = devices
      .map((device) => device.metrics.temperature)
      .filter((value): value is number => typeof value === 'number');

    return trend.length ? trend : [36, 37, 38];
  }

  private percent(value: number): number {
    return this.round(Math.max(0, Math.min(1, value)) * 100);
  }

  private round(value: number): number {
    return Math.round(value * 10) / 10;
  }
}
