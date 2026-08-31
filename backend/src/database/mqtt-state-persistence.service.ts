import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { AlarmState, CachedDeviceTelemetry } from '../mqtt/mqtt.types';
import { PrismaService } from './prisma.service';

/** Persists MQTT projections without making ingestion depend on PostgreSQL availability. */
@Injectable()
export class MqttStatePersistenceService {
  private readonly logger = new Logger(MqttStatePersistenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async restore(): Promise<{ telemetry: CachedDeviceTelemetry[]; alarms: AlarmState[] }> {
    await this.prisma.ensureConnection();
    if (!this.prisma.isReady()) {
      this.failIfRequired('restore MQTT state');
      return { telemetry: [], alarms: [] };
    }
    try {
      const [telemetry, alarms] = await Promise.all([
        this.prisma.mqttDeviceState.findMany(),
        this.prisma.mqttAlarmState.findMany(),
      ]);
      const telemetryRecords = telemetry as Array<{ payload: unknown }>;
      const alarmRecords = alarms as Array<{ payload: unknown }>;
      return {
        telemetry: telemetryRecords.map((item) => item.payload as CachedDeviceTelemetry),
        alarms: alarmRecords.map((item) => item.payload as AlarmState),
      };
    } catch (error: unknown) {
      this.logFailure('restore MQTT state', error);
      this.failIfRequired('restore MQTT state', error);
      return { telemetry: [], alarms: [] };
    }
  }

  async saveTelemetry(record: CachedDeviceTelemetry): Promise<void> {
    const eventTime = this.requireDate(record.timestamp, 'telemetry timestamp');
    await this.prisma.ensureConnection();
    if (!this.prisma.isReady()) {
      // Ingestion is an always-on projection. A transient database outage must
      // not crash NestJS; the in-memory projection remains authoritative until
      // the next event/reconnect and the failure is surfaced in logs/readiness.
      this.failIfRequired('persist MQTT telemetry');
      return;
    }
    try {
      const stateKey = { tenantId: record.tenantId, lineId: record.lineId, deviceId: record.deviceId };
      const [storedDeviceState, storedCurrentState] = await Promise.all([
        this.findState(this.prisma.mqttDeviceState, stateKey),
        this.findState(this.prisma.currentState, stateKey),
      ]);
      const operations: Array<Promise<unknown>> = [];
      if (this.isNewer(eventTime, storedDeviceState?.eventTime)) {
        operations.push(this.prisma.mqttDeviceState.upsert({
          where: { tenantId_lineId_deviceId: stateKey },
          create: { ...stateKey, eventTime, payload: record as object },
          update: { eventTime, payload: record as object },
        }));
      }
      if (this.isNewer(eventTime, storedCurrentState?.eventTime)) {
        operations.push(this.prisma.currentState.upsert({
          where: { tenantId_lineId_deviceId: stateKey },
          create: { ...stateKey, status: record.status, eventTime, payload: record as object },
          update: { status: record.status, eventTime, payload: record as object },
        }));
      }
      if (this.prisma.device?.updateMany) operations.push(this.prisma.device.updateMany({
        where: {
          tenantId: record.tenantId,
          lineId: record.lineId,
          AND: [
            { OR: [{ id: record.deviceId }, { id: `device-${record.deviceId}` }, { code: record.deviceId }, { code: record.deviceId.toUpperCase() }] },
            { OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: eventTime } }] },
          ],
        },
        data: {
          status: this.deviceStatus(record.status) as never,
          statusReason: record.quality ? `采集质量码: ${record.quality}` : null,
          lastSeenAt: eventTime,
          metrics: record as object,
        },
      }));
      const eventId = this.telemetryEventId(record);
      operations.push(this.prisma.deviceEvent.upsert({
        where: { id: eventId },
        create: { id: eventId, tenantId: record.tenantId, lineId: record.lineId, deviceId: record.deviceId, eventType: 'telemetry', traceId: record.traceId, quality: record.quality, eventTime, payload: record as object },
        update: { eventTime, traceId: record.traceId, quality: record.quality, payload: record as object },
      }));
      await this.transaction(operations);
    } catch (error: unknown) {
      this.logFailure('persist telemetry', error);
      this.failIfRequired('persist MQTT telemetry', error);
    }
  }

  async saveAlarm(state: AlarmState): Promise<void> {
    const startedAt = this.requireDate(state.alarm.startedAt, 'alarm start timestamp');
    const eventTime = this.requireDate(
      state.alarm.clearedAt ?? state.alarm.startedAt,
      'alarm event timestamp',
    );
    await this.prisma.ensureConnection();
    if (!this.prisma.isReady()) {
      this.failIfRequired('persist MQTT alarm');
      return;
    }
    try {
      const operations: Array<Promise<unknown>> = [this.prisma.mqttAlarmState.upsert({
        where: { tenantId_alarmId: { tenantId: state.tenantId, alarmId: state.alarm.id } },
        create: { tenantId: state.tenantId, alarmId: state.alarm.id, eventTime, active: state.active, payload: state as object },
        update: { eventTime, active: state.active, payload: state as object },
      })];
      if (this.prisma.alarm?.upsert) operations.push(this.prisma.alarm.upsert({
        where: { id: this.alarmId(state) },
        create: {
          id: this.alarmId(state), tenantId: state.tenantId,
          lineId: state.alarm.lineId.startsWith('line-') ? state.alarm.lineId : null,
          deviceId: state.alarm.deviceId.startsWith('device-') ? state.alarm.deviceId : null,
          code: state.alarm.type, level: this.alarmLevel(state.alarm.severity) as never,
          status: state.active ? 'open' as never : 'resolved' as never,
          message: state.alarm.message, dedupeKey: `${state.tenantId}:${state.alarm.id}`,
          occurredAt: startedAt,
        },
        update: {
          status: state.active ? 'open' as never : 'resolved' as never,
          message: state.alarm.message, resolvedAt: state.active ? null : eventTime,
          occurredAt: startedAt,
        },
      }));
      const id = `alarm:${state.tenantId}:${state.alarm.id}:${state.lastEvent}`;
      operations.push(this.prisma.deviceEvent.upsert({
        where: { id },
        create: { id, tenantId: state.tenantId, lineId: state.alarm.lineId, deviceId: state.alarm.deviceId, eventType: state.lastEvent, eventTime, payload: state as object },
        update: { eventTime, payload: state as object },
      }));
      await this.transaction(operations);
    } catch (error: unknown) {
      this.logFailure('persist alarm', error);
      this.failIfRequired('persist MQTT alarm', error);
    }
  }

  async recordConnection(tenantId: string, status: string, details: Record<string, unknown>): Promise<void> {
    await this.prisma.ensureConnection();
    if (!this.prisma.isReady()) {
      this.failIfRequired('persist MQTT connection event');
      return;
    }
    try {
      const eventTime = new Date();
      await this.prisma.connectionEvent.create({
        data: { id: `connection:${tenantId}:${status}:${eventTime.toISOString()}`, tenantId, status, eventTime, details: details as Prisma.InputJsonValue },
      });
    } catch (error: unknown) {
      this.logFailure('persist connection event', error);
      this.failIfRequired('persist MQTT connection event', error);
    }
  }

  private logFailure(operation: string, error: unknown): void {
    this.logger.error(`${operation} failed; memory projection remains available: ${error instanceof Error ? error.message : String(error)}`);
  }

  private failIfRequired(operation: string, error?: unknown): void {
    if (!this.prisma.required) return;
    const detail = error instanceof Error ? `: ${error.message}` : error ? `: ${String(error)}` : '';
    throw new Error(`PostgreSQL is required; ${operation} cannot continue${detail}`);
  }

  private telemetryEventId(record: CachedDeviceTelemetry): string {
    const source = record.eventId ?? record.traceId ?? record.timestamp;
    const digest = createHash('sha256')
      .update(`${record.tenantId}:${record.lineId}:${record.deviceId}:${source}`)
      .digest('hex');
    return `telemetry:${digest}`;
  }

  private deviceStatus(status: CachedDeviceTelemetry['status']): 'online' | 'offline' | 'alarm' {
    if (status === 'FAULT' || status === 'WARNING') return 'alarm';
    if (status === 'STOPPED' || status === 'OFFLINE') return 'offline';
    return 'online';
  }

  private alarmLevel(severity: AlarmState['alarm']['severity']): 'info' | 'warning' | 'critical' {
    return severity.toLowerCase() as 'info' | 'warning' | 'critical';
  }

  private alarmId(state: AlarmState): string {
    return `mqtt-${state.tenantId}-${state.alarm.id}`.slice(0, 40);
  }

  private async findState(
    delegate: unknown,
    key: { tenantId: string; lineId: string; deviceId: string },
  ): Promise<{ eventTime: Date } | undefined> {
    if (!delegate || typeof delegate !== 'object') return undefined;
    const findUnique = (delegate as {
      findUnique?: (args: { where: { tenantId_lineId_deviceId: typeof key } }) => Promise<{ eventTime: Date } | null>;
    }).findUnique;
    if (typeof findUnique !== 'function') return undefined;
    return (await findUnique.call(delegate, { where: { tenantId_lineId_deviceId: key } })) ?? undefined;
  }

  private isNewer(eventTime: Date, storedEventTime: Date | undefined): boolean {
    return !storedEventTime || eventTime.getTime() > storedEventTime.getTime();
  }

  private requireDate(value: string, label: string): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new Error(`${label} must be an ISO timestamp`);
    return parsed;
  }

  private async transaction(operations: Array<Promise<unknown>>): Promise<void> {
    const client = this.prisma as PrismaService & { $transaction?: (operations: Array<Promise<unknown>>) => Promise<unknown> };
    if (client.$transaction) {
      await client.$transaction(operations);
      return;
    }
    await Promise.all(operations);
  }
}
