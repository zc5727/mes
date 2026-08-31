import { Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';
import { Agv, AgvsService } from '../agvs/agvs.service';
import { Device, DevicesService } from '../devices/devices.service';
import { Alarm, AlarmsService } from '../alarms/alarms.service';
import { ProductionLine, ProductionLinesService } from '../production-lines/production-lines.service';
import { WorkOrdersService } from '../work-orders/work-orders.service';
import { MqttIngestionService } from '../mqtt/mqtt-ingestion.service';
import type { CachedDeviceTelemetry } from '../mqtt/mqtt.types';
import { resolveSimulatorIdentity } from '../digital-twin/device-identity';

type DashboardDataSource = 'simulator' | 'mqtt' | 'database' | 'mock';
type Position = { x: number; y: number; z: number } | null;

export type DashboardDevice = Device & {
  deviceId: string;
  canonicalId: string;
  sourceId: string;
  timestamp: string;
  lastUpdatedAt: string;
  snapshotVersion: string;
  dataSource: DashboardDataSource;
  position: Position;
  positionSource: 'backend' | 'scene-default' | null;
  activeFaults: string[];
};

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
  metrics: Record<string, number | string | boolean | null>;
  source: 'work_orders_and_device_snapshot';
  generatedAt: string;
}

export interface ProductionHistoryPoint {
  timestamp: string;
  lineId: string;
  workOrderId: string;
  quantity: number;
  goodQty: number;
  defectQty: number;
  cumulativeCompletedQty: number;
  completionRate: number;
  source: 'work_order_reports';
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
  deviceIds: string[];
  metrics: Record<string, number | string | boolean | null>;
  position: Position;
  timestamp: string;
  lastUpdatedAt: string;
  snapshotVersion: string;
  dataSource: DashboardDataSource;
}

export interface DashboardOverview {
  timestamp: string;
  lastUpdatedAt: string;
  snapshotVersion: string;
  dataSource: DashboardDataSource;
  metrics: Record<string, number | string | boolean | null>;
  position: Position;
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
  productionHistory: ProductionHistoryPoint[];
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
  private readonly snapshotSequences = new Map<string, number>();

  constructor(
    private readonly productionLinesService: ProductionLinesService,
    private readonly devicesService: DevicesService,
    private readonly workOrdersService: WorkOrdersService,
    private readonly agvsService: AgvsService,
    private readonly alarmsService: AlarmsService,
    private readonly mqttIngestionService?: MqttIngestionService,
  ) {}

  getOverview(tenantId: string): DashboardOverview {
    const snapshotVersion = this.nextSnapshotVersion(tenantId);
    const lines = this.productionLinesService.findOverview(tenantId);
    const lineEntities = this.productionLinesService.findAll(tenantId);
    const devices = this.currentDevices(tenantId, snapshotVersion);
    const workOrders = this.workOrdersService.findOverview(tenantId);
    const agvs = this.agvsService.findAll(tenantId);
    const alarms = this.alarmsService.findAll(tenantId);
    const lineSummaries = lineEntities.map((line) => this.toLineSummary(line, tenantId, devices, snapshotVersion));
    const highestRiskLine = this.highestRiskLine(lineSummaries);
    const deviceSummary = this.summarizeDevices(devices);
    const alarmSummary = this.summarizeAlarms(alarms);
    const productionHistory = this.getProductionHistory(tenantId);

    return {
      timestamp: this.latestTimestamp(
        devices.map((device) => device.timestamp),
        alarms.map((alarm) => alarm.timestamp),
        lineEntities.map((line) => line.updatedAt),
      ) ?? new Date().toISOString(),
      lastUpdatedAt: this.latestTimestamp(
        devices.map((device) => device.lastUpdatedAt),
        alarms.map((alarm) => alarm.lastUpdatedAt),
        lineEntities.map((line) => line.updatedAt),
      ) ?? new Date().toISOString(),
      snapshotVersion,
      dataSource: this.dataSource(devices, alarms),
      metrics: {
        powerConsumptionKw: this.sumMetric(devices, 'power', 'load'),
        oee: this.getProductionMetrics(tenantId, undefined, snapshotVersion).oee,
        todayOutput: workOrders.completedQty,
        activeAlarmCount: alarmSummary.active,
      },
      position: null,
      lines,
      lineSummaries,
      highestRiskLine,
      recentAlarmAt: this.latestAlarmAt(alarms),
      activeAlarmCount: alarmSummary.active,
      deviceOnlineRate: deviceSummary.onlineRate,
      devices: deviceSummary,
      workOrders,
      productionMetrics: this.getProductionMetrics(tenantId, undefined, snapshotVersion),
      agvs: this.summarizeAgvs(agvs),
      alarms: alarmSummary,
      todayTasks: workOrders.inProgress + workOrders.released,
      powerConsumption: this.sumMetric(devices, 'power', 'load'),
      temperatureTrend: this.temperatureTrend(devices),
      productionHistory,
      generatedAt: new Date().toISOString(),
    };
  }

  getProductionHistory(tenantId: string, lineId?: string): ProductionHistoryPoint[] {
    const workOrders = this.workOrdersService.findAll(tenantId)
      .filter((order) => !lineId || order.lineId === lineId);
    return workOrders.flatMap((workOrder) => {
      let cumulativeCompletedQty = 0;
      return this.workOrdersService.findReports(tenantId, workOrder.id)
        .sort((left, right) => left.reportedAt.localeCompare(right.reportedAt))
        .map((report) => {
          cumulativeCompletedQty += report.quantity;
          return {
            timestamp: report.reportedAt,
            lineId: workOrder.lineId,
            workOrderId: workOrder.id,
            quantity: report.quantity,
            goodQty: report.goodQty,
            defectQty: report.defectQty,
            cumulativeCompletedQty,
            completionRate: workOrder.plannedQty ? this.percent(cumulativeCompletedQty / workOrder.plannedQty) : 0,
            source: 'work_order_reports' as const,
          };
        });
    }).sort((left, right) => left.timestamp.localeCompare(right.timestamp));
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

  getProductionMetrics(tenantId: string, lineId?: string, snapshotVersion = this.nextSnapshotVersion(tenantId)): ProductionMetrics {
    const workOrders = this.workOrdersService.findAll(tenantId)
      .filter((order) => !lineId || order.lineId === lineId);
    const devices = this.currentDevices(tenantId, snapshotVersion)
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
    const performanceRate = this.performanceRate(devices, lineId);
    const targetOee = targetLines.length
      ? this.round(targetLines.reduce((total, line) => total + line.targetOee, 0) / targetLines.length)
      : null;
    const oee = qualityRate === null
      ? targetOee
      : performanceRate === null
        ? this.round((availabilityRate * qualityRate) / 100)
        : this.round((availabilityRate * performanceRate * qualityRate) / 10000);

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
      performanceRate,
      oee,
      oeeAvailable: qualityRate !== null,
      oeeSource: qualityRate !== null ? 'telemetry' : targetOee === null ? 'unavailable' : 'target',
      metrics: {
        availabilityRate,
        performanceRate,
        qualityRate,
        oee,
        totalCount,
        goodCount,
        defectCount,
      },
      source: 'work_orders_and_device_snapshot',
      generatedAt: new Date().toISOString(),
    };
  }

  getLineOverview(tenantId: string, lineId: string) {
    const line = this.productionLinesService.findOne(tenantId, lineId);
    const snapshotVersion = this.nextSnapshotVersion(tenantId);
    const allDevices = this.currentDevices(tenantId, snapshotVersion);
    const devices = allDevices.filter((device) => device.lineId === lineId);
    const alarms = this.alarmsService.findAll(tenantId, { lineId });
    const workOrders = this.workOrdersService.findAll(tenantId).filter((order) => order.lineId === lineId);
    const productionMetrics = this.getProductionMetrics(tenantId, lineId, snapshotVersion);
    const summary = this.toLineSummary(line, tenantId, allDevices, snapshotVersion);

    return {
      line,
      status: summary.status,
      devices,
      alarms,
      workOrders,
      productionMetrics,
      productionHistory: this.getProductionHistory(tenantId, lineId),
      summary,
      onlineRate: summary.onlineRate,
      activeAlarmCount: summary.activeAlarmCount,
      latestAlarmAt: summary.latestAlarmAt,
      powerConsumption: this.sumMetric(devices, 'power', 'load'),
      generatedAt: new Date().toISOString(),
    };
  }

  private toLineSummary(
    line: ProductionLine,
    tenantId: string,
    devices: DashboardDevice[],
    snapshotVersion: string,
  ): DashboardLineSummary {
    const lineDevices = devices.filter((device) => device.lineId === line.id);
    const alarms = this.alarmsService.findAll(tenantId, { lineId: line.id });
    const metrics = this.getProductionMetrics(tenantId, line.id, snapshotVersion);
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
      deviceIds: lineDevices.map((device) => device.canonicalId),
      metrics: {
        ...metrics.metrics,
        plannedQty: metrics.plannedQty,
        completedQty: metrics.completedQty,
        remainingQty: metrics.remainingQty,
      },
      position: null,
      timestamp: this.latestTimestamp(
        lineDevices.map((device) => device.timestamp),
        alarms.map((alarm) => alarm.timestamp),
        [line.updatedAt],
      ) ?? line.updatedAt,
      lastUpdatedAt: this.latestTimestamp(
        lineDevices.map((device) => device.lastUpdatedAt),
        alarms.map((alarm) => alarm.lastUpdatedAt),
        [line.updatedAt],
      ) ?? line.updatedAt,
      snapshotVersion,
      dataSource: this.dataSource(lineDevices, alarms),
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

  private latestTimestamp(...groups: string[][]): string | null {
    return groups.flat().sort().at(-1) ?? null;
  }

  private dataSource(
    devices: Array<{ dataSource: DashboardDataSource }>,
    alarms: Array<{ dataSource: DashboardDataSource }>,
  ): DashboardDataSource {
    if (devices.some((device) => device.dataSource === 'mqtt')
      || alarms.some((alarm) => alarm.dataSource === 'mqtt')) return 'mqtt';
    return 'mock';
  }

  private performanceRate(devices: Device[], lineId?: string): number | null {
    const cycleTimes = devices
      .map((device) => device.metrics.cycleTimeSeconds ?? device.metrics.cycleTime)
      .map((value) => typeof value === 'number' ? value : Number(value))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (!cycleTimes.length) return null;

    const idealCycleTime: Record<string, number> = {
      'line-cnc': 42,
      'line-assembly': 35,
      'line-welding': 55,
      'line-vision': 28,
    };
    const ideal = lineId ? idealCycleTime[lineId] : undefined;
    if (!ideal) return 100;
    const average = cycleTimes.reduce((total, value) => total + value, 0) / cycleTimes.length;
    return this.percent(Math.min(1, ideal / average));
  }

  private nextSnapshotVersion(tenantId: string): string {
    const next = (this.snapshotSequences.get(tenantId) ?? 0) + 1;
    this.snapshotSequences.set(tenantId, next);
    return `${tenantId}-${String(next).padStart(6, '0')}`;
  }

  private currentDevices(tenantId: string, snapshotVersion = this.nextSnapshotVersion(tenantId)): DashboardDevice[] {
    const baseDevices = this.devicesService.findAll(tenantId)
      .map((device) => this.toDashboardDevice(device, snapshotVersion));
    const liveDevices = this.mqttIngestionService?.listDevices(tenantId) ?? [];
    if (!liveDevices.length) return baseDevices;

    // MQTT telemetry can be partial; replace only the devices represented by
    // the live snapshot instead of dropping every base device on that line.
    const liveCanonicalIds = new Set(liveDevices.map((device) => this.canonicalDeviceId(
      device.tenantId,
      device.lineId,
      device.deviceId,
    )));
    return [
      ...baseDevices.filter((device) => !liveCanonicalIds.has(device.id)),
      ...liveDevices.map((device) => this.toDevice(device, snapshotVersion)),
    ];
  }

  private toDevice(device: CachedDeviceTelemetry, snapshotVersion: string): DashboardDevice {
    const canonicalId = this.canonicalDeviceId(device.tenantId, device.lineId, device.deviceId);
    const status: Device['status'] = device.status === 'FAULT' || device.status === 'WARNING'
      ? 'alarm'
      : device.status === 'STOPPED' || device.status === 'OFFLINE'
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
      deviceId: canonicalId,
      canonicalId,
      sourceId: device.deviceId,
      timestamp: device.timestamp,
      lastUpdatedAt: device.receivedAt,
      snapshotVersion,
      dataSource: 'mqtt',
      position: null,
      positionSource: null,
      activeFaults: [...device.activeFaults],
    };
  }

  private toDashboardDevice(device: Device, snapshotVersion: string): DashboardDevice {
    return {
      ...device,
      deviceId: device.id,
      canonicalId: device.id,
      sourceId: device.id,
      timestamp: device.updatedAt,
      lastUpdatedAt: device.updatedAt,
      snapshotVersion,
      dataSource: 'mock',
      position: null,
      positionSource: null,
      activeFaults: device.statusReason ? [device.statusReason] : [],
    };
  }

  private canonicalDeviceId(tenantId: string, lineId: string, sourceId: string): string {
    const known = this.devicesService.findAll(tenantId).find((device) => device.lineId === lineId
      && (device.id === sourceId || device.code === sourceId));
    if (known) return known.id;
    return resolveSimulatorIdentity(lineId, sourceId).canonicalId;
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
