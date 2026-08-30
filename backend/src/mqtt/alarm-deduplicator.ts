import { Injectable } from '@nestjs/common';
import { AlarmState, SimulatorAlarm } from './mqtt.types';

export type AlarmDeduplicationResult =
  | { accepted: true; state: AlarmState }
  | { accepted: false; reason: 'duplicate' | 'stale'; state: AlarmState };

@Injectable()
export class AlarmDeduplicator {
  private readonly states = new Map<string, AlarmState>();

  apply(
    tenantId: string,
    event: 'alarm.created' | 'alarm.cleared',
    alarm: SimulatorAlarm,
    updatedAt = new Date().toISOString(),
  ): AlarmDeduplicationResult {
    const key = this.key(tenantId, alarm.id);
    const current = this.states.get(key);
    const eventTimestamp = Date.parse(event === 'alarm.created' ? alarm.startedAt : alarm.clearedAt ?? updatedAt);

    if (event === 'alarm.created') {
      if (current?.active) return { accepted: false, reason: 'duplicate', state: current };
      if (current && eventTimestamp <= this.latestTimestamp(current)) {
        return { accepted: false, reason: 'stale', state: current };
      }

      const state: AlarmState = {
        tenantId,
        alarm: { ...alarm, clearedAt: undefined },
        active: true,
        lastEvent: event,
        updatedAt,
      };
      this.states.set(key, state);
      return { accepted: true, state };
    }

    if (current && !current.active) return { accepted: false, reason: 'duplicate', state: current };
    if (current && eventTimestamp < Date.parse(current.alarm.startedAt)) {
      return { accepted: false, reason: 'stale', state: current };
    }

    const state: AlarmState = {
      tenantId,
      alarm: { ...alarm, clearedAt: alarm.clearedAt ?? updatedAt },
      active: false,
      lastEvent: event,
      updatedAt,
    };
    this.states.set(key, state);
    return { accepted: true, state };
  }

  get(tenantId: string, alarmId: string): AlarmState | undefined {
    return this.states.get(this.key(tenantId, alarmId));
  }

  listActive(tenantId?: string): AlarmState[] {
    return [...this.states.values()].filter((state) => state.active && (!tenantId || state.tenantId === tenantId));
  }

  clear(): void {
    this.states.clear();
  }

  restore(states: AlarmState[]): void {
    for (const state of states) this.states.set(this.key(state.tenantId, state.alarm.id), state);
  }

  private latestTimestamp(state: AlarmState): number {
    const startedAt = Date.parse(state.alarm.startedAt);
    const clearedAt = state.alarm.clearedAt ? Date.parse(state.alarm.clearedAt) : Number.NEGATIVE_INFINITY;
    return Math.max(startedAt, clearedAt);
  }

  private key(tenantId: string, alarmId: string): string {
    return `${tenantId}/${alarmId}`;
  }
}
