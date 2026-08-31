import {
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { Device, DevicesService } from '../devices/devices.service';
import { MqttIngestionService } from '../mqtt/mqtt-ingestion.service';
import { MaintenanceService } from '../maintenance/maintenance.service';
import { resolveSimulatorIdentity } from '../digital-twin/device-identity';
import { PrismaService } from '../database/prisma.service';
import { timestamp } from '../common/mock.types';

export type AlarmLevel = 'info' | 'warning' | 'critical';
export type AlarmStatus = 'active' | 'acknowledged' | 'closed';
export type AlarmDataSource = 'simulator' | 'mqtt' | 'database' | 'mock';

export interface Alarm {
  id: string;
  tenantId: string;
  source: string;
  sourceId: string;
  /** Canonical MES device identity; sourceId remains the gateway/simulator identity. */
  deviceId: string;
  canonicalDeviceId: string;
  alarmId: string;
  lineId: string;
  level: AlarmLevel;
  message: string;
  time: string;
  occurredAt: string;
  timestamp: string;
  lastUpdatedAt: string;
  metrics: Record<string, number | string | boolean | null>;
  position: { x: number; y: number; z: number } | null;
  snapshotVersion: string;
  dataSource: AlarmDataSource;
  status: AlarmStatus;
  acknowledgedAt?: string;
  closedAt?: string;
  clearedAt?: string;
}

export interface AlarmFilters {
  level?: AlarmLevel;
  lineId?: string;
  deviceId?: string;
  status?: AlarmStatus;
}

export interface AlarmRealtimeMessage {
  data: {
    type: 'snapshot' | 'updated' | 'heartbeat';
    tenantId: string;
    alarms: Alarm[];
    generatedAt: string;
  };
}

/**
 * Provides a tenant-scoped alarm read model over device and simulator state.
 * Lifecycle actions only change this read model; they never issue device commands.
 */
@Injectable()
export class AlarmsService implements OnModuleInit {
  private readonly alarms = new Map<string, Alarm>();
  private readonly snapshotSequences = new Map<string, number>();

  constructor(
    private readonly devicesService: DevicesService,
    private readonly mqttIngestionService?: MqttIngestionService,
    @Optional() @Inject(forwardRef(() => MaintenanceService)) private readonly maintenanceService?: MaintenanceService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.restorePersistedAlarms();
  }

  findAll(tenantId: string, filters: AlarmFilters = {}): Alarm[] {
    const normalizedFilters = this.normalizeFilters(filters);
    const current = this.readCurrentAlarms(tenantId, this.nextSnapshotVersion(tenantId));
    const currentKeys = new Set(current.map((alarm) => this.alarmKey(alarm.tenantId, alarm.id)));

    current.forEach((alarm) => this.upsertCurrentAlarm(alarm));
    this.closeMissingAlarms(tenantId, currentKeys);

    return [...this.alarms.values()]
      .filter((alarm) => alarm.tenantId === tenantId)
      .filter((alarm) => normalizedFilters.status
        ? alarm.status === normalizedFilters.status
        : alarm.status !== 'closed')
      .filter((alarm) => !normalizedFilters.level || alarm.level === normalizedFilters.level)
      .filter((alarm) => !normalizedFilters.lineId || alarm.lineId === normalizedFilters.lineId)
      .filter((alarm) => !normalizedFilters.deviceId
        || [alarm.deviceId, alarm.canonicalDeviceId, alarm.sourceId].includes(normalizedFilters.deviceId))
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  }

  findOne(tenantId: string, id: string): Alarm {
    this.syncTenant(tenantId);
    const alarm = this.alarms.get(this.alarmKey(tenantId, id));
    if (!alarm) throw new NotFoundException(`Alarm ${id} not found`);
    return alarm;
  }

  stream(tenantId: string): Observable<AlarmRealtimeMessage> {
    return new Observable((subscriber) => {
      let closed = false;
      const emit = (type: AlarmRealtimeMessage['data']['type']) => {
        if (closed) return;
        subscriber.next({
          data: {
            type,
            tenantId,
            alarms: this.findAll(tenantId),
            generatedAt: new Date().toISOString(),
          },
        });
      };

      emit('snapshot');
      const unsubscribe = this.mqttIngestionService?.onProjection((changedTenant) => {
        if (changedTenant === tenantId || changedTenant === '*') emit('updated');
      }) ?? (() => undefined);
      const heartbeat = setInterval(() => emit('heartbeat'), 15_000);

      return () => {
        closed = true;
        unsubscribe();
        clearInterval(heartbeat);
      };
    });
  }

  acknowledge(tenantId: string, id: string): Alarm {
    const alarm = this.findOne(tenantId, id);
    if (alarm.status === 'closed') {
      throw new ConflictException({
        code: 'ALARM_ALREADY_CLOSED',
        message: `Alarm ${id} is already closed`,
      });
    }
    if (alarm.status === 'acknowledged') return alarm;

    const acknowledgedAt = new Date().toISOString();
    const updated = {
      ...alarm,
      status: 'acknowledged' as const,
      acknowledgedAt,
      lastUpdatedAt: acknowledgedAt,
      snapshotVersion: this.nextSnapshotVersion(tenantId),
    };
    this.alarms.set(this.alarmKey(tenantId, id), updated);
    void this.persistAlarm(updated);
    return updated;
  }

  close(tenantId: string, id: string): Alarm {
    const alarm = this.findOne(tenantId, id);
    if (alarm.status === 'closed') return alarm;

    const closedAt = new Date().toISOString();
    const updated = {
      ...alarm,
      status: 'closed' as const,
      closedAt,
      clearedAt: closedAt,
      lastUpdatedAt: closedAt,
      snapshotVersion: this.nextSnapshotVersion(tenantId),
    };
    this.alarms.set(this.alarmKey(tenantId, id), updated);
    void this.persistAlarm(updated);
    return updated;
  }

  /** Opens a deterministic repair work order for an alarm; repeated calls return the same order. */
  async createMaintenanceWorkOrder(tenantId: string, id: string) {
    const alarm = this.findOne(tenantId, id);
    if (!this.maintenanceService) throw new NotFoundException('Maintenance service is unavailable');
    const existing = this.maintenanceService.list(tenantId).find((item) => item.alarmId === alarm.id);
    if (existing) return existing;

    // The HTTP command must not acknowledge a work order before its durable
    // write succeeds.  Keep the legacy service method for in-process callers,
    // but use the reliable variant at the API boundary.
    return this.maintenanceService.createReliable(tenantId, {
      alarmId: alarm.id,
      lineId: alarm.lineId,
      deviceId: alarm.sourceId,
      type: 'repair',
      title: `告警维修：${alarm.message}`,
      description: `由告警 ${alarm.id} 自动创建`,
      plannedAt: timestamp(),
    });
  }

  private syncTenant(tenantId: string): void {
    const current = this.readCurrentAlarms(tenantId, this.nextSnapshotVersion(tenantId));
    const currentKeys = new Set(current.map((alarm) => this.alarmKey(alarm.tenantId, alarm.id)));
    current.forEach((alarm) => this.upsertCurrentAlarm(alarm));
    this.closeMissingAlarms(tenantId, currentKeys);
  }

  private readCurrentAlarms(tenantId: string, snapshotVersion: string): Alarm[] {
    const deviceAlarms = this.devicesService
      .findAll(tenantId)
      .filter((device) => this.isAlarmSource(device))
      .map((device) => this.toAlarm(device, snapshotVersion));
    const simulatorAlarms = this.mqttIngestionService?.listActiveAlarms(tenantId)
      .map((state) => this.toSimulatorAlarm(state, snapshotVersion)) ?? [];

    return this.deduplicate(deviceAlarms.concat(simulatorAlarms));
  }

  private upsertCurrentAlarm(alarm: Alarm): void {
    const key = this.alarmKey(alarm.tenantId, alarm.id);
    const previous = this.alarms.get(key);
    const isNewOccurrence = previous && previous.occurredAt !== alarm.occurredAt;

    if (!previous || isNewOccurrence) {
      this.alarms.set(key, { ...alarm, status: 'active' });
      return;
    }

    this.alarms.set(key, {
      ...alarm,
      status: previous.status,
      acknowledgedAt: previous.acknowledgedAt,
      closedAt: previous.closedAt,
    });
  }

  private closeMissingAlarms(tenantId: string, currentKeys: Set<string>): void {
    for (const [key, alarm] of this.alarms.entries()) {
      if (alarm.tenantId !== tenantId || currentKeys.has(key)) continue;
      if (alarm.status === 'closed') continue;
      this.alarms.set(key, {
        ...alarm,
        status: 'closed',
        closedAt: alarm.closedAt ?? new Date().toISOString(),
        clearedAt: alarm.clearedAt ?? alarm.closedAt,
        lastUpdatedAt: alarm.closedAt ?? new Date().toISOString(),
        snapshotVersion: this.nextSnapshotVersion(tenantId),
      });
    }
  }

  private deduplicate(alarms: Alarm[]): Alarm[] {
    const unique = new Map<string, Alarm>();
    alarms.forEach((alarm) => {
      const key = [alarm.tenantId, alarm.lineId, alarm.sourceId, alarm.level, alarm.message].join('|');
      unique.set(key, alarm);
    });
    return [...unique.values()];
  }

  private normalizeFilters(filters: AlarmFilters): AlarmFilters {
    if (filters.level && !['info', 'warning', 'critical'].includes(filters.level)) {
      throw new ConflictException({ code: 'INVALID_ALARM_LEVEL', message: 'level must be info, warning, or critical' });
    }
    if (filters.status && !['active', 'acknowledged', 'closed'].includes(filters.status)) {
      throw new ConflictException({ code: 'INVALID_ALARM_STATUS', message: 'status must be active, acknowledged, or closed' });
    }
    return {
      ...filters,
      lineId: this.normalizeText(filters.lineId),
      deviceId: this.normalizeText(filters.deviceId),
    };
  }

  private normalizeText(value?: string): string | undefined {
    const normalized = value?.trim();
    return normalized || undefined;
  }

  private alarmKey(tenantId: string, id: string): string {
    return `${tenantId}:${id}`;
  }

  private isAlarmSource(device: Device): boolean {
    return device.status === 'alarm' || device.status === 'maintenance' || device.status === 'offline';
  }

  private toAlarm(device: Device, snapshotVersion: string): Alarm {
    const level = this.levelFor(device.status);
    const occurredAt = device.updatedAt;

    return {
      id: `alarm-${device.id}`,
      alarmId: `alarm-${device.id}`,
      tenantId: device.tenantId,
      source: device.code,
      sourceId: device.id,
      deviceId: device.id,
      canonicalDeviceId: device.id,
      lineId: device.lineId,
      level,
      message: this.messageFor(device, level),
      time: occurredAt,
      occurredAt,
      timestamp: occurredAt,
      lastUpdatedAt: occurredAt,
      metrics: { ...device.metrics },
      position: null,
      snapshotVersion,
      dataSource: 'mock',
      status: 'active',
    };
  }

  private levelFor(status: Device['status']): AlarmLevel {
    return status === 'alarm' ? 'critical' : 'warning';
  }

  private messageFor(device: Device, level: AlarmLevel): string {
    if (device.statusReason) return device.statusReason;
    if (level === 'critical') return `${device.name}发生设备告警`;
    if (device.status === 'offline') return `${device.name}已离线`;
    return `${device.name}处于维护状态`;
  }

  private toSimulatorAlarm(
    state: ReturnType<MqttIngestionService['listActiveAlarms']>[number],
    snapshotVersion: string,
  ): Alarm {
    const identity = resolveSimulatorIdentity(state.alarm.lineId, state.alarm.deviceId);
    return {
      id: `mqtt-alarm-${state.tenantId}-${state.alarm.id}`,
      alarmId: state.alarm.id,
      tenantId: state.tenantId,
      source: state.alarm.deviceId,
      sourceId: state.alarm.deviceId,
      deviceId: identity.canonicalId,
      canonicalDeviceId: identity.canonicalId,
      lineId: state.alarm.lineId,
      level: state.alarm.severity.toLowerCase() as AlarmLevel,
      message: state.alarm.message,
      time: state.alarm.startedAt,
      occurredAt: state.alarm.startedAt,
      timestamp: state.alarm.startedAt,
      lastUpdatedAt: state.updatedAt,
      metrics: { severity: state.alarm.severity, faultType: state.alarm.type },
      position: null,
      snapshotVersion,
      dataSource: 'mqtt',
      status: 'active',
    };
  }

  private nextSnapshotVersion(tenantId: string): string {
    const next = (this.snapshotSequences.get(tenantId) ?? 0) + 1;
    this.snapshotSequences.set(tenantId, next);
    return `${tenantId}-${String(next).padStart(6, '0')}`;
  }

  private async restorePersistedAlarms(): Promise<void> {
    if (!this.prisma) return;
    await this.prisma.ensureConnection();
    if (!this.prisma.isReady() || !this.prisma.alarm?.findMany) return;
    try {
      const rows = await this.prisma.alarm.findMany();
      rows.forEach((row) => {
        const alarmId = row.dedupeKey?.startsWith(`${row.tenantId}:`)
          ? `mqtt-alarm-${row.tenantId}-${row.dedupeKey.slice(row.tenantId.length + 1)}`
          : row.id;
        const occurredAt = row.occurredAt.toISOString();
        const lastUpdatedAt = row.updatedAt.toISOString();
        this.alarms.set(this.alarmKey(row.tenantId, alarmId), {
          id: alarmId,
          alarmId: row.dedupeKey?.slice(row.tenantId.length + 1) ?? alarmId,
          tenantId: row.tenantId,
          source: row.code,
          sourceId: row.deviceId ?? row.id,
          deviceId: row.deviceId ?? row.id,
          canonicalDeviceId: row.deviceId ?? row.id,
          lineId: row.lineId ?? '',
          level: row.level.toString().toLowerCase() as AlarmLevel,
          message: row.message,
          time: occurredAt,
          occurredAt,
          timestamp: occurredAt,
          lastUpdatedAt,
          metrics: {},
          position: null,
          snapshotVersion: this.nextSnapshotVersion(row.tenantId),
          dataSource: 'database',
          status: row.status.toString() === 'acknowledged' ? 'acknowledged' : row.status.toString() === 'resolved' ? 'closed' : 'active',
          closedAt: row.resolvedAt?.toISOString(),
          clearedAt: row.resolvedAt?.toISOString(),
        });
      });
    } catch {
      // Database availability is optional; in-memory projections remain authoritative.
    }
  }

  private async persistAlarm(alarm: Alarm): Promise<void> {
    if (!this.prisma) return;
    await this.prisma.ensureConnection();
    if (!this.prisma.isReady() || !this.prisma.alarm?.upsert) return;
    try {
      const databaseId = (alarm.dataSource === 'mqtt'
        ? `mqtt-${alarm.tenantId}-${alarm.alarmId}`
        : alarm.id).slice(0, 40);
      await this.prisma.alarm.upsert({
        where: { id: databaseId },
        create: {
          id: databaseId,
          tenantId: alarm.tenantId,
          lineId: alarm.lineId || null,
          deviceId: alarm.deviceId.startsWith('device-') ? alarm.deviceId : null,
          code: alarm.source,
          level: alarm.level as never,
          status: alarm.status === 'closed' ? 'resolved' as never : alarm.status === 'acknowledged' ? 'acknowledged' as never : 'open' as never,
          message: alarm.message,
          dedupeKey: alarm.dataSource === 'mqtt' ? `${alarm.tenantId}:${alarm.alarmId}` : null,
          occurredAt: new Date(alarm.occurredAt),
          resolvedAt: alarm.closedAt ? new Date(alarm.closedAt) : null,
        },
        update: {
          status: alarm.status === 'closed' ? 'resolved' as never : alarm.status === 'acknowledged' ? 'acknowledged' as never : 'open' as never,
          message: alarm.message,
          resolvedAt: alarm.closedAt ? new Date(alarm.closedAt) : null,
        },
      });
    } catch {
      // Persistence is best effort and must not make lifecycle actions unavailable.
    }
  }
}
