import { BadRequestException, Injectable } from '@nestjs/common';
import { CachedDeviceTelemetry, SimulatorTelemetry } from './mqtt.types';

export type DeviceCacheUpsertResult =
  | { accepted: true; current: CachedDeviceTelemetry }
  | { accepted: false; reason: 'duplicate' | 'stale'; current: CachedDeviceTelemetry };

@Injectable()
export class DeviceTelemetryCache {
  private readonly records = new Map<string, CachedDeviceTelemetry>();

  upsert(
    tenantId: string,
    telemetry: SimulatorTelemetry,
    sourceTopic: string,
    receivedAt = new Date().toISOString(),
  ): DeviceCacheUpsertResult {
    const nextTimestamp = Date.parse(telemetry.timestamp);
    if (Number.isNaN(nextTimestamp)) {
      throw new BadRequestException('telemetry.timestamp must be an ISO timestamp');
    }

    const key = this.key(tenantId, telemetry.lineId, telemetry.deviceId);
    const current = this.records.get(key);
    const incomingIdentity = telemetry.eventId ?? telemetry.traceId;
    const currentIdentity = current?.eventId ?? current?.traceId;
    const currentTimestamp = current ? Date.parse(current.timestamp) : undefined;

    if (current && incomingIdentity && currentIdentity === incomingIdentity) {
      return { accepted: false, reason: 'duplicate', current };
    }

    if (current && currentTimestamp !== undefined && nextTimestamp <= currentTimestamp) {
      return {
        accepted: false,
        reason: nextTimestamp === currentTimestamp ? 'duplicate' : 'stale',
        current,
      };
    }

    const next: CachedDeviceTelemetry = {
      ...telemetry,
      tenantId,
      sourceTopic,
      receivedAt,
    };
    this.records.set(key, next);
    return { accepted: true, current: next };
  }

  get(tenantId: string, lineId: string, deviceId: string): CachedDeviceTelemetry | undefined {
    return this.records.get(this.key(tenantId, lineId, deviceId));
  }

  list(tenantId?: string): CachedDeviceTelemetry[] {
    return [...this.records.values()].filter((record) => !tenantId || record.tenantId === tenantId);
  }

  clear(): void {
    this.records.clear();
  }

  restore(records: CachedDeviceTelemetry[]): void {
    for (const record of records) {
      if (Number.isNaN(Date.parse(record.timestamp))) {
        throw new Error(`Persisted telemetry for ${record.deviceId} has an invalid timestamp`);
      }
      this.records.set(this.key(record.tenantId, record.lineId, record.deviceId), record);
    }
  }

  private key(tenantId: string, lineId: string, deviceId: string): string {
    return `${tenantId}/${lineId}/${deviceId}`;
  }
}
