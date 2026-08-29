import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MqttIngestionService } from '../src/mqtt/mqtt-ingestion.service';
import { AlarmDeduplicator } from '../src/mqtt/alarm-deduplicator';
import { DeviceTelemetryCache } from '../src/mqtt/device-cache';
import { MqttClientLike, MqttConnectOptions, MqttPayload } from '../src/mqtt/mqtt.types';

interface FixtureMessage {
  topic: string;
  payload: Record<string, unknown>;
}

class FixtureMqttClient extends EventEmitter implements MqttClientLike {
  subscribe(_topic: string): Promise<void> {
    return Promise.resolve();
  }

  end(): void {}
}

describe('phase 6/7 simulator-to-ingestion fixture (e2e)', () => {
  it('replays contract messages through parsing, deduplication and cache recovery', async () => {
    const fixture = JSON.parse(readFileSync(
      resolve(__dirname, 'fixtures/phase6-7-messages.json'),
      'utf8',
    )) as FixtureMessage[];
    const client = new FixtureMqttClient();
    const service = new MqttIngestionService(
      (_url: string, _options: MqttConnectOptions) => client,
      { url: 'mqtt://fixture', enabled: true },
      new DeviceTelemetryCache(),
      new AlarmDeduplicator(),
    );

    service.start();
    client.emit('connect');
    await Promise.resolve();
    for (const message of fixture) {
      client.emit('message', message.topic, JSON.stringify(message.payload) as MqttPayload);
    }

    expect(service.listDevices('tenant-demo')).toHaveLength(2);
    expect(service.getDevice('tenant-demo', 'line-cnc', 'cnc-01')).toEqual(expect.objectContaining({
      status: 'RUNNING',
      totalCount: 10,
      timestamp: '2026-08-28T09:00:00.000Z',
    }));
    expect(service.listActiveAlarms('tenant-demo')).toEqual([]);
    expect(service.listDevices('other-tenant')).toEqual([]);
    service.stop();
  });
});

