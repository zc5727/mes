import { EventEmitter } from 'node:events';
import { BadRequestException } from '@nestjs/common';
import { AlarmDeduplicator } from '../src/mqtt/alarm-deduplicator';
import { DeviceTelemetryCache } from '../src/mqtt/device-cache';
import { MqttIngestionService } from '../src/mqtt/mqtt-ingestion.service';
import { parseSimulatorMessage } from '../src/mqtt/mqtt-parser';
import { MqttClientLike, MqttConnectOptions, SimulatorAlarm } from '../src/mqtt/mqtt.types';

class FakeMqttClient extends EventEmitter implements MqttClientLike {
  readonly subscriptions: string[] = [];
  ended = false;
  failSubscription = false;
  readonly published: Array<{ topic: string; payload: string }> = [];

  subscribe(topic: string): Promise<void> {
    if (this.failSubscription) return Promise.reject(new Error('subscribe failed'));
    this.subscriptions.push(topic);
    return Promise.resolve();
  }

  publish(topic: string, payload: string): Promise<void> {
    this.published.push({ topic, payload });
    return Promise.resolve();
  }

  end(): void {
    this.ended = true;
  }
}

const telemetry = {
  event: 'device.telemetry',
  data: {
    deviceId: 'cnc-01',
    deviceName: 'CNC-01',
    lineId: 'line-cnc',
    status: 'RUNNING',
    temperatureCelsius: 42,
    cycleTimeSeconds: 42,
    totalCount: 3,
    goodCount: 3,
    defectCount: 0,
    activeFaults: [],
    timestamp: '2026-08-28T09:00:00.000Z',
  },
};

const alarm: SimulatorAlarm = {
  id: 'line-cnc-cnc-01-OVERHEAT',
  lineId: 'line-cnc',
  deviceId: 'cnc-01',
  type: 'OVERHEAT',
  severity: 'CRITICAL',
  message: '设备温度超过安全阈值',
  startedAt: '2026-08-28T09:00:00.000Z',
};

function topic(kind: 'telemetry' | 'alarms'): string {
  return kind === 'telemetry'
    ? 'mes/simulator/demo-tenant/lines/line-cnc/devices/cnc-01/telemetry'
    : 'mes/simulator/demo-tenant/alarms';
}

function createService(client: FakeMqttClient, options: MqttConnectOptions = { clientId: 'test', reconnectPeriod: 1 }) {
  const factory = jest.fn((_url: string, _options: MqttConnectOptions) => client);
  const service = new MqttIngestionService(
    factory,
    { url: 'mqtt://broker', enabled: true },
    new DeviceTelemetryCache(),
    new AlarmDeduplicator(),
  );
  service.start();
  return { factory, service };
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('simulator MQTT ingestion', () => {
  it('parses the simulator envelope and validates topic identity', () => {
    const parsed = parseSimulatorMessage(topic('telemetry'), JSON.stringify(telemetry));

    expect(parsed).toMatchObject({
      kind: 'telemetry',
      tenantId: 'demo-tenant',
      lineId: 'line-cnc',
      deviceId: 'cnc-01',
      data: telemetry.data,
    });
    expect(parseSimulatorMessage(topic('telemetry'), '{bad json')).toBeUndefined();
    expect(parseSimulatorMessage(topic('telemetry'), JSON.stringify({ ...telemetry, data: { ...telemetry.data, deviceId: 'other' } }))).toBeUndefined();
  });

  it('caches the newest telemetry and ignores duplicate or late messages', () => {
    const cache = new DeviceTelemetryCache();
    const message = parseSimulatorMessage(topic('telemetry'), JSON.stringify(telemetry));
    if (!message || message.kind !== 'telemetry') throw new Error('test fixture did not parse');

    expect(cache.upsert(message.tenantId, message.data, message.topic).accepted).toBe(true);
    expect(cache.upsert(message.tenantId, message.data, message.topic)).toMatchObject({ accepted: false, reason: 'duplicate' });
    expect(cache.upsert(message.tenantId, { ...message.data, totalCount: 1, timestamp: '2026-08-28T08:59:59.000Z' }, message.topic)).toMatchObject({ accepted: false, reason: 'stale' });
    expect(cache.get('demo-tenant', 'line-cnc', 'cnc-01')?.totalCount).toBe(3);
  });

  it('deduplicates alarm create/clear and allows a later re-open', () => {
    const deduplicator = new AlarmDeduplicator();
    expect(deduplicator.apply('demo-tenant', 'alarm.created', alarm).accepted).toBe(true);
    expect(deduplicator.apply('demo-tenant', 'alarm.created', alarm)).toMatchObject({ accepted: false, reason: 'duplicate' });

    const cleared = { ...alarm, clearedAt: '2026-08-28T09:01:00.000Z' };
    expect(deduplicator.apply('demo-tenant', 'alarm.cleared', cleared).accepted).toBe(true);
    expect(deduplicator.apply('demo-tenant', 'alarm.cleared', cleared)).toMatchObject({ accepted: false, reason: 'duplicate' });
    expect(deduplicator.apply('demo-tenant', 'alarm.created', { ...alarm, startedAt: '2026-08-28T09:02:00.000Z' }).accepted).toBe(true);
    expect(deduplicator.listActive('demo-tenant')).toHaveLength(1);
  });

  it('applies parsed alarm events through the ingestion service', () => {
    const client = new FakeMqttClient();
    const { service } = createService(client);
    client.emit('connect');
    client.emit('message', topic('alarms'), JSON.stringify({ event: 'alarm.created', data: alarm }));
    client.emit('message', topic('alarms'), JSON.stringify({ event: 'alarm.created', data: alarm }));

    expect(service.listActiveAlarms('demo-tenant')).toHaveLength(1);

    client.emit('message', topic('alarms'), JSON.stringify({
      event: 'alarm.cleared',
      data: { ...alarm, clearedAt: '2026-08-28T09:01:00.000Z' },
    }));
    expect(service.listActiveAlarms('demo-tenant')).toHaveLength(0);
  });

  it('publishes simulator control only while connected', async () => {
    const client = new FakeMqttClient();
    const { service } = createService(client);

    await expect(service.publishSimulatorControl('demo-tenant', { action: 'pause' }))
      .rejects.toThrow('broker is disconnected');

    client.emit('connect');
    await service.publishSimulatorControl('demo-tenant', {
      action: 'fault',
      lineId: 'line-cnc',
      deviceId: 'cnc-01',
      faultType: 'OVERHEAT',
      commandId: 'cmd-1',
    });
    expect(client.published).toEqual([{
      topic: 'mes/control/demo-tenant/simulator/command',
      payload: JSON.stringify({
        action: 'fault',
        lineId: 'line-cnc',
        deviceId: 'cnc-01',
        faultType: 'OVERHEAT',
        commandId: 'cmd-1',
      }),
    }]);
  });

  it('accepts a normalized HTTP gateway event and maps common point aliases', () => {
    const client = new FakeMqttClient();
    const { service } = createService(client);
    const result = service.ingestHttpEvent('demo-tenant', {
      deviceId: 'cnc-01', lineId: 'line-cnc', eventType: 'telemetry',
      eventTime: '2026-08-28T09:05:00.000Z', traceId: 'trace-1',
      payload: { temp: 45, total_count: 10, good_count: 9, defect_count: 1 },
      status: 'RUNNING', quality: 'GOOD',
    });

    expect(result).toEqual({ accepted: true, duplicate: false, eventId: 'trace-1' });
    expect(service.getDevice('demo-tenant', 'line-cnc', 'cnc-01')).toMatchObject({
      temperatureCelsius: 45, totalCount: 10, goodCount: 9, defectCount: 1,
      traceId: 'trace-1', quality: 'GOOD',
    });
    expect(service.ingestHttpEvent('demo-tenant', {
      deviceId: 'cnc-01', lineId: 'line-cnc', eventType: 'telemetry',
      eventTime: '2026-08-28T09:05:00.000Z', traceId: 'trace-1', payload: {}, status: 'RUNNING',
    })).toMatchObject({ accepted: false, duplicate: true });
  });

  it('distinguishes stale HTTP replays from duplicate events and validates service input', () => {
    const client = new FakeMqttClient();
    const { service } = createService(client);
    const event = {
      deviceId: 'cnc-01', lineId: 'line-cnc', eventType: 'telemetry' as const,
      eventTime: '2026-08-28T09:05:00.000Z', traceId: 'trace-stale', payload: {}, status: 'RUNNING',
    };

    expect(service.ingestHttpEvent('demo-tenant', event)).toMatchObject({
      accepted: true, duplicate: false,
    });
    expect(service.ingestHttpEvent('demo-tenant', {
      ...event, traceId: 'trace-late', eventTime: '2026-08-28T09:04:00.000Z',
    })).toMatchObject({ accepted: false, duplicate: false });
    expect(() => service.ingestHttpEvent('demo-tenant', {
      ...event, eventTime: 'not-a-timestamp',
    })).toThrow(BadRequestException);
  });

  it('returns a diagnosable 503 when the broker rejects a control publish', async () => {
    const client = new FakeMqttClient();
    const { service } = createService(client);
    client.emit('connect');
    client.publish = jest.fn().mockRejectedValue(new Error('socket closed'));

    await expect(service.publishSimulatorControl('demo-tenant', { action: 'reset' }))
      .rejects.toMatchObject({ status: 503, message: 'MQTT simulator control publish failed: socket closed' });
  });

  it('re-subscribes after reconnect without duplicating message handlers or clearing state', async () => {
    const client = new FakeMqttClient();
    const { factory, service } = createService(client);
    client.emit('connect');
    await flushPromises();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(client.subscriptions).toEqual([
      'mes/simulator/+/lines/+/devices/+/telemetry',
      'mes/simulator/+/alarms',
    ]);

    client.emit('message', topic('telemetry'), Buffer.from(JSON.stringify(telemetry)));
    expect(service.listDevices('demo-tenant')).toHaveLength(1);
    client.emit('close');
    client.emit('reconnect');
    client.emit('connect');
    await flushPromises();
    expect(client.subscriptions).toHaveLength(4);
    client.emit('message', topic('telemetry'), JSON.stringify(telemetry));
    expect(service.listDevices('demo-tenant')).toHaveLength(1);

    service.stop();
    expect(client.ended).toBe(true);
  });

  it('keeps cached state when a reconnect subscription attempt fails', async () => {
    const client = new FakeMqttClient();
    const { service } = createService(client);
    client.emit('connect');
    await flushPromises();
    client.failSubscription = true;
    client.emit('connect');
    await flushPromises();
    expect(service.isConnected()).toBe(true);
    expect(service.listDevices()).toHaveLength(0);
  });
});
