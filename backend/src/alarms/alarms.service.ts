import {
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { Device, DevicesService } from '../devices/devices.service';
import { MqttIngestionService } from '../mqtt/mqtt-ingestion.service';
import { MaintenanceService } from '../maintenance/maintenance.service';

export type AlarmLevel = 'info' | 'warning' | 'critical';
export type AlarmStatus = 'active' | 'acknowledged' | 'closed';

export interface Alarm {
  id: string;
  tenantId: string;
  source: string;
  sourceId: string;
  lineId: string;
  level: AlarmLevel;
  message: string;
  time: string;
  occurredAt: string;
  status: AlarmStatus;
  acknowledgedAt?: string;
  closedAt?: string;
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
export class AlarmsService {
  private readonly alarms = new Map<string, Alarm>();

  constructor(
    private readonly devicesService: DevicesService,
    private readonly mqttIngestionService?: MqttIngestionService,
    @Optional() @Inject(forwardRef(() => MaintenanceService)) private readonly maintenanceService?: MaintenanceService,
  ) {}

  findAll(tenantId: string, filters: AlarmFilters = {}): Alarm[] {
    const normalizedFilters = this.normalizeFilters(filters);
    const current = this.readCurrentAlarms(tenantId);
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
      .filter((alarm) => !normalizedFilters.deviceId || alarm.sourceId === normalizedFilters.deviceId)
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
    const updated = { ...alarm, status: 'acknowledged' as const, acknowledgedAt };
    this.alarms.set(this.alarmKey(tenantId, id), updated);
    return updated;
  }

  close(tenantId: string, id: string): Alarm {
    const alarm = this.findOne(tenantId, id);
    if (alarm.status === 'closed') return alarm;

    const updated = {
      ...alarm,
      status: 'closed' as const,
      closedAt: new Date().toISOString(),
    };
    this.alarms.set(this.alarmKey(tenantId, id), updated);
    return updated;
  }

  /** Opens a deterministic repair work order for an alarm; repeated calls return the same order. */
  createMaintenanceWorkOrder(tenantId: string, id: string) {
    const alarm = this.findOne(tenantId, id);
    if (!this.maintenanceService) throw new NotFoundException('Maintenance service is unavailable');
    return this.maintenanceService.createFromAlarm(tenantId, alarm);
  }

  private syncTenant(tenantId: string): void {
    const current = this.readCurrentAlarms(tenantId);
    const currentKeys = new Set(current.map((alarm) => this.alarmKey(alarm.tenantId, alarm.id)));
    current.forEach((alarm) => this.upsertCurrentAlarm(alarm));
    this.closeMissingAlarms(tenantId, currentKeys);
  }

  private readCurrentAlarms(tenantId: string): Alarm[] {
    const deviceAlarms = this.devicesService
      .findAll(tenantId)
      .filter((device) => this.isAlarmSource(device))
      .map((device) => this.toAlarm(device));
    const simulatorAlarms = this.mqttIngestionService?.listActiveAlarms(tenantId)
      .map((state) => this.toSimulatorAlarm(state)) ?? [];

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

  private toAlarm(device: Device): Alarm {
    const level = this.levelFor(device.status);
    const occurredAt = device.updatedAt;

    return {
      id: `alarm-${device.id}`,
      tenantId: device.tenantId,
      source: device.code,
      sourceId: device.id,
      lineId: device.lineId,
      level,
      message: this.messageFor(device, level),
      time: occurredAt,
      occurredAt,
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

  private toSimulatorAlarm(state: ReturnType<MqttIngestionService['listActiveAlarms']>[number]): Alarm {
    return {
      id: `mqtt-alarm-${state.tenantId}-${state.alarm.id}`,
      tenantId: state.tenantId,
      source: state.alarm.deviceId,
      sourceId: state.alarm.deviceId,
      lineId: state.alarm.lineId,
      level: state.alarm.severity.toLowerCase() as AlarmLevel,
      message: state.alarm.message,
      time: state.alarm.startedAt,
      occurredAt: state.alarm.startedAt,
      status: 'active',
    };
  }
}
