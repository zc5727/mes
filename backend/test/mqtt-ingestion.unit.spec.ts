import { EventEmitter } from 'node:events';
import { BadRequestException } from '@nestjs/common';
import { AlarmDeduplicator } from '../src/mqtt/alarm-deduplicator';
import { DeviceTelemetryCache } from '../src/mqtt/device-cache';
import { MqttIngestionService } from '../src/mqtt/mqtt-ingestion.service';
import { DeviceConnectionsService } from '../src/device-connections/device-connections.service';
import { DeviceProfilesService } from '../src/device-profiles/device-profiles.service';
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

  it('accepts allow-listed protocol bridge topics and warning/offline statuses', () => {
    const protocolTelemetry = {
      ...telemetry,
      data: { ...telemetry.data, status: 'WARNING', activeFaults: ['QUALITY_DRIFT'] },
    };

    expect(parseSimulatorMessage(
      'mes/modbus/demo-tenant/lines/line-cnc/devices/cnc-01/telemetry',
      JSON.stringify(protocolTelemetry),
    )).toMatchObject({
      kind: 'telemetry', tenantId: 'demo-tenant', lineId: 'line-cnc', deviceId: 'cnc-01',
      data: { status: 'WARNING' },
    });
    expect(parseSimulatorMessage(
      'mes/vendor/demo-tenant/lines/line-cnc/devices/cnc-01/telemetry',
      JSON.stringify(telemetry),
    )).toBeUndefined();
  });

  it('caches the newest telemetry and ignores duplicate or late messages', () => {
    const cache = new DeviceTelemetryCache();
    const message = parseSimulatorMessage(topic('telemetry'), JSON.stringify(telemetry));
    if (!message || message.kind !== 'telemetry') throw new Error('test fixture did not parse');

    const first = { ...message.data, eventId: 'event-1' };
    expect(cache.upsert(message.tenantId, first, message.topic).accepted).toBe(true);
    expect(cache.upsert(message.tenantId, first, message.topic)).toMatchObject({ accepted: false, reason: 'duplicate' });
    expect(cache.upsert(message.tenantId, {
      ...message.data, eventId: 'event-1', timestamp: '2026-08-28T09:01:00.000Z',
    }, message.topic)).toMatchObject({ accepted: false, reason: 'duplicate' });
    expect(cache.upsert(message.tenantId, { ...message.data, totalCount: 1, timestamp: '2026-08-28T08:59:59.000Z' }, message.topic)).toMatchObject({ accepted: false, reason: 'stale' });
    expect(cache.get('demo-tenant', 'line-cnc', 'cnc-01')?.totalCount).toBe(3);
  });

  it('rejects telemetry with an invalid timestamp before it reaches the cache', () => {
    const cache = new DeviceTelemetryCache();
    const message = parseSimulatorMessage(topic('telemetry'), JSON.stringify(telemetry));
    if (!message || message.kind !== 'telemetry') throw new Error('test fixture did not parse');

    expect(() => cache.upsert('demo-tenant', {
      ...message.data,
      timestamp: 'not-a-timestamp',
    }, message.topic)).toThrow(BadRequestException);
  });

  it('keeps telemetry and alarm projections isolated by tenant', () => {
    const cache = new DeviceTelemetryCache();
    const message = parseSimulatorMessage(topic('telemetry'), JSON.stringify(telemetry));
    if (!message || message.kind !== 'telemetry') throw new Error('test fixture did not parse');

    expect(cache.upsert('tenant-a', message.data, message.topic).accepted).toBe(true);
    expect(cache.upsert('tenant-b', message.data, message.topic).accepted).toBe(true);
    expect(cache.list('tenant-a')).toHaveLength(1);
    expect(cache.list('tenant-b')).toHaveLength(1);

    const deduplicator = new AlarmDeduplicator();
    expect(deduplicator.apply('tenant-a', 'alarm.created', alarm).accepted).toBe(true);
    expect(deduplicator.apply('tenant-b', 'alarm.created', alarm).accepted).toBe(true);
    expect(deduplicator.listActive('tenant-a')).toHaveLength(1);
    expect(deduplicator.listActive('tenant-b')).toHaveLength(1);
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

  it('publishes broker lifecycle changes to realtime subscribers without letting one listener break ingestion', () => {
    const client = new FakeMqttClient();
    const { service } = createService(client);
    const failingListener = jest.fn(() => { throw new Error('subscriber failed'); });
    const healthyListener = jest.fn();
    service.onProjection(failingListener);
    service.onProjection(healthyListener);

    expect(() => client.emit('connect')).not.toThrow();
    expect(() => client.emit('close')).not.toThrow();
    expect(healthyListener).toHaveBeenCalledWith('*');
    expect(healthyListener.mock.calls.length).toBeGreaterThanOrEqual(2);
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

  it('maps HTTP warning and offline statuses to the device state contract', () => {
    const client = new FakeMqttClient();
    const { service } = createService(client);

    expect(service.ingestHttpEvent('demo-tenant', {
      deviceId: 'cnc-01', lineId: 'line-cnc', eventType: 'telemetry',
      eventTime: '2026-08-28T09:06:00.000Z', status: 'WARNING', payload: {},
    })).toMatchObject({ accepted: true });
    expect(service.getDevice('demo-tenant', 'line-cnc', 'cnc-01')?.status).toBe('WARNING');

    expect(service.ingestHttpEvent('demo-tenant', {
      deviceId: 'cnc-01', lineId: 'line-cnc', eventType: 'telemetry',
      eventTime: '2026-08-28T09:07:00.000Z', status: 'OFFLINE', payload: {},
    })).toMatchObject({ accepted: true });
    expect(service.getDevice('demo-tenant', 'line-cnc', 'cnc-01')?.status).toBe('OFFLINE');
  });

  it('binds HTTP telemetry to a running tenant-scoped connection and updates its heartbeat', async () => {
    const client = new FakeMqttClient();
    const probe = { probe: jest.fn().mockResolvedValue({ ok: true, latencyMs: 1 }) };
    const connections = new DeviceConnectionsService(probe, new DeviceProfilesService());
    const connection = await connections.create('demo-tenant', {
      deviceId: 'cnc-01', name: '边缘 HTTP 网关', type: 'webhook', endpoint: 'http://localhost:3100/events',
    });
    await connections.start('demo-tenant', connection.id);
    const service = new MqttIngestionService(
      jest.fn(() => client),
      { url: 'mqtt://broker', enabled: false },
      new DeviceTelemetryCache(),
      new AlarmDeduplicator(),
      undefined,
      undefined,
      connections,
    );

    expect(service.ingestHttpEvent('demo-tenant', {
      connectionId: connection.id, deviceId: 'cnc-01', lineId: 'line-cnc', eventType: 'telemetry',
      eventTime: '2026-08-28T09:05:00.000Z', payload: { temp: 45 }, status: 'RUNNING',
    })).toEqual(expect.objectContaining({ accepted: true, duplicate: false }));
    expect(connections.findOne('demo-tenant', connection.id)).toEqual(expect.objectContaining({
      status: 'running', lastHeartbeatAt: expect.any(String), lastEventAt: expect.any(String),
    }));
    expect(connections.listEvents('demo-tenant', connection.id)).toHaveLength(1);
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

  it('surfaces asynchronous persistence failures through ingestion status without an unhandled rejection', async () => {
    const client = new FakeMqttClient();
    const persistence = { saveTelemetry: jest.fn().mockRejectedValue(new Error('database unavailable')) };
    const service = new MqttIngestionService(
      jest.fn(() => client),
      { url: 'mqtt://broker', enabled: true },
      new DeviceTelemetryCache(),
      new AlarmDeduplicator(),
      persistence as never,
    );
    service.start();
    client.emit('connect');
    client.emit('message', topic('telemetry'), JSON.stringify(telemetry));
    await flushPromises();

    expect(service.getStatus()).toEqual(expect.objectContaining({
      lastErrorCode: 'MQTT_PERSISTENCE_FAILED',
      lastError: 'MQTT telemetry persistence failed: database unavailable',
    }));
  });

  it('re-subscribes after reconnect without duplicating message handlers or clearing state', async () => {
    const client = new FakeMqttClient();
    const { factory, service } = createService(client);
    client.emit('connect');
    await flushPromises();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(client.subscriptions).toEqual([
      'mes/+/+/lines/+/devices/+/telemetry',
      'mes/simulator/+/alarms',
      'mes/simulator/+/control',
    ]);

    client.emit('message', topic('telemetry'), Buffer.from(JSON.stringify(telemetry)));
    expect(service.listDevices('demo-tenant')).toHaveLength(1);
    client.emit('close');
    client.emit('reconnect');
    client.emit('connect');
    await flushPromises();
    expect(client.subscriptions).toHaveLength(6);
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

  it('rejects MQTT messages outside the configured tenant boundary', () => {
    const client = new FakeMqttClient();
    const factory = jest.fn(() => client);
    const service = new MqttIngestionService(
      factory,
      { url: 'mqtt://broker', enabled: true, tenantId: 'tenant-allowed' },
      new DeviceTelemetryCache(),
      new AlarmDeduplicator(),
    );
    service.start();
    client.emit('connect');
    client.emit('message', topic('telemetry'), JSON.stringify(telemetry));

    expect(service.listDevices()).toHaveLength(0);
    expect(service.getStatus()).toEqual(expect.objectContaining({
      lastErrorCode: 'MQTT_TENANT_MISMATCH',
      messages: expect.objectContaining({ received: 1, rejected: 1, accepted: 0 }),
    }));
  });
});
