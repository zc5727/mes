import { Injectable, NotFoundException } from '@nestjs/common';
import { Device, DevicesService } from '../devices/devices.service';
import { MqttIngestionService } from '../mqtt/mqtt-ingestion.service';

export type AlarmLevel = 'info' | 'warning' | 'critical';

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
  status: 'active' | 'acknowledged' | 'closed';
  acknowledgedAt?: string;
  closedAt?: string;
}

export interface AlarmFilters {
  level?: AlarmLevel;
  lineId?: string;
  deviceId?: string;
  status?: Alarm['status'];
}

@Injectable()
export class AlarmsService {
  private readonly lifecycle = new Map<string, Pick<Alarm, 'status' | 'acknowledgedAt' | 'closedAt'>>();
  constructor(
    private readonly devicesService: DevicesService,
    private readonly mqttIngestionService?: MqttIngestionService,
  ) {}

  findAll(tenantId: string, filters: AlarmFilters = {}): Alarm[] {
    const deviceAlarms = this.devicesService
      .findAll(tenantId)
      .filter((device) => this.isAlarmSource(device))
      .map((device) => this.toAlarm(device))
    const simulatorAlarms = this.mqttIngestionService?.listActiveAlarms(tenantId).map((state) => this.toSimulatorAlarm(state)) ?? [];

    return [...deviceAlarms, ...simulatorAlarms]
      .filter((alarm) => !filters.level || alarm.level === filters.level)
      .filter((alarm) => !filters.lineId || alarm.lineId === filters.lineId)
      .filter((alarm) => !filters.deviceId || alarm.sourceId === filters.deviceId)
      .filter((alarm) => !filters.status || alarm.status === filters.status)
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  }

  findOne(tenantId: string, id: string): Alarm {
    const alarm = this.findAll(tenantId).find((item) => item.id === id);
    if (!alarm) throw new NotFoundException(`Alarm ${id} not found`);
    return alarm;
  }

  acknowledge(tenantId: string, id: string): Alarm {
    this.findOne(tenantId, id);
    this.lifecycle.set(id, { status: 'acknowledged', acknowledgedAt: new Date().toISOString() });
    return this.findOne(tenantId, id);
  }

  close(tenantId: string, id: string): Alarm {
    this.findOne(tenantId, id);
    this.lifecycle.set(id, { status: 'closed', closedAt: new Date().toISOString() });
    return this.findOne(tenantId, id);
  }

  private isAlarmSource(device: Device): boolean {
    return device.status === 'alarm' || device.status === 'maintenance' || device.status === 'offline';
  }

  private toAlarm(device: Device): Alarm {
    const level = this.levelFor(device.status);
    const occurredAt = device.updatedAt;

    return this.withLifecycle({
      id: `alarm-${device.id}`,
      tenantId: device.tenantId,
      source: device.code,
      sourceId: device.id,
      lineId: device.lineId,
      level,
      message: this.messageFor(device, level),
      time: occurredAt,
      occurredAt,
    });
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
    return this.withLifecycle({
      id: `mqtt-alarm-${state.tenantId}-${state.alarm.id}`,
      tenantId: state.tenantId,
      source: state.alarm.deviceId,
      sourceId: state.alarm.deviceId,
      lineId: state.alarm.lineId,
      level: state.alarm.severity.toLowerCase() as AlarmLevel,
      message: state.alarm.message,
      time: state.alarm.startedAt,
      occurredAt: state.alarm.startedAt,
    });
  }

  private withLifecycle(alarm: Omit<Alarm, 'status' | 'acknowledgedAt' | 'closedAt'>): Alarm {
    return { ...alarm, ...(this.lifecycle.get(alarm.id) ?? { status: 'active' }) };
  }
}
