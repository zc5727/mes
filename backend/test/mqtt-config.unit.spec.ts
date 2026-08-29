import { AlarmDeduplicator } from '../src/mqtt/alarm-deduplicator';
import { DeviceTelemetryCache } from '../src/mqtt/device-cache';
import { MqttIngestionService } from '../src/mqtt/mqtt-ingestion.service';
import { MqttClientFactory } from '../src/mqtt/mqtt.types';

describe('MQTT startup configuration', () => {
  it('keeps HTTP-only development clean when MQTT is disabled', () => {
    const clientFactory: MqttClientFactory = jest.fn();
    const service = new MqttIngestionService(
      clientFactory,
      { enabled: false, url: 'mqtt://localhost:1883' },
      new DeviceTelemetryCache(),
      new AlarmDeduplicator(),
    );

    service.start();

    expect(clientFactory).not.toHaveBeenCalled();
    expect(service.isConnected()).toBe(false);
  });

  it('does not create a client when MQTT is enabled without a broker URL', () => {
    const clientFactory: MqttClientFactory = jest.fn();
    const service = new MqttIngestionService(
      clientFactory,
      { enabled: true },
      new DeviceTelemetryCache(),
      new AlarmDeduplicator(),
    );

    service.start();

    expect(clientFactory).not.toHaveBeenCalled();
    expect(service.isConnected()).toBe(false);
  });
});
