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
    if (!this.prisma.isReady()) return { telemetry: [], alarms: [] };
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
      return { telemetry: [], alarms: [] };
    }
  }

  async saveTelemetry(record: CachedDeviceTelemetry): Promise<void> {
    await this.prisma.ensureConnection();
    if (!this.prisma.isReady()) return;
    try {
      await this.prisma.mqttDeviceState.upsert({
        where: { tenantId_lineId_deviceId: { tenantId: record.tenantId, lineId: record.lineId, deviceId: record.deviceId } },
        create: { tenantId: record.tenantId, lineId: record.lineId, deviceId: record.deviceId, eventTime: new Date(record.timestamp), payload: record as object },
        update: { eventTime: new Date(record.timestamp), payload: record as object },
      });
      await this.prisma.currentState.upsert({
        where: { tenantId_lineId_deviceId: { tenantId: record.tenantId, lineId: record.lineId, deviceId: record.deviceId } },
        create: { tenantId: record.tenantId, lineId: record.lineId, deviceId: record.deviceId, status: record.status, eventTime: new Date(record.timestamp), payload: record as object },
        update: { status: record.status, eventTime: new Date(record.timestamp), payload: record as object },
      });
      const eventId = this.telemetryEventId(record);
      await this.prisma.deviceEvent.upsert({
        where: { id: eventId },
        create: { id: eventId, tenantId: record.tenantId, lineId: record.lineId, deviceId: record.deviceId, eventType: 'telemetry', traceId: record.traceId, quality: record.quality, eventTime: new Date(record.timestamp), payload: record as object },
        update: { eventTime: new Date(record.timestamp), traceId: record.traceId, quality: record.quality, payload: record as object },
      });
    } catch (error: unknown) {
      this.logFailure('persist telemetry', error);
    }
  }

  async saveAlarm(state: AlarmState): Promise<void> {
    await this.prisma.ensureConnection();
    if (!this.prisma.isReady()) return;
    try {
      await this.prisma.mqttAlarmState.upsert({
        where: { tenantId_alarmId: { tenantId: state.tenantId, alarmId: state.alarm.id } },
        create: { tenantId: state.tenantId, alarmId: state.alarm.id, eventTime: new Date(state.alarm.clearedAt ?? state.alarm.startedAt), active: state.active, payload: state as object },
        update: { eventTime: new Date(state.alarm.clearedAt ?? state.alarm.startedAt), active: state.active, payload: state as object },
      });
      const id = `alarm:${state.tenantId}:${state.alarm.id}:${state.lastEvent}`;
      await this.prisma.deviceEvent.upsert({
        where: { id },
        create: { id, tenantId: state.tenantId, lineId: state.alarm.lineId, deviceId: state.alarm.deviceId, eventType: state.lastEvent, eventTime: new Date(state.alarm.clearedAt ?? state.alarm.startedAt), payload: state as object },
        update: { eventTime: new Date(state.alarm.clearedAt ?? state.alarm.startedAt), payload: state as object },
      });
    } catch (error: unknown) {
      this.logFailure('persist alarm', error);
    }
  }

  async recordConnection(tenantId: string, status: string, details: Record<string, unknown>): Promise<void> {
    await this.prisma.ensureConnection();
    if (!this.prisma.isReady()) return;
    try {
      const eventTime = new Date();
      await this.prisma.connectionEvent.create({
        data: { id: `connection:${tenantId}:${status}:${eventTime.toISOString()}`, tenantId, status, eventTime, details: details as Prisma.InputJsonValue },
      });
    } catch (error: unknown) {
      this.logFailure('persist connection event', error);
    }
  }

  private logFailure(operation: string, error: unknown): void {
    this.logger.error(`${operation} failed; memory projection remains available: ${error instanceof Error ? error.message : String(error)}`);
  }

  private telemetryEventId(record: CachedDeviceTelemetry): string {
    const source = record.eventId ?? record.traceId ?? record.timestamp;
    const digest = createHash('sha256')
      .update(`${record.tenantId}:${record.lineId}:${record.deviceId}:${source}`)
      .digest('hex');
    return `telemetry:${digest}`;
  }
}
