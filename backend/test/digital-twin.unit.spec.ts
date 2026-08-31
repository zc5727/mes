import { EventEmitter } from 'node:events';
import { AlarmDeduplicator } from '../src/mqtt/alarm-deduplicator';
import { DeviceTelemetryCache } from '../src/mqtt/device-cache';
import { MqttIngestionService } from '../src/mqtt/mqtt-ingestion.service';
import { MqttClientLike, MqttClientFactory } from '../src/mqtt/mqtt.types';
import { DevicesService } from '../src/devices/devices.service';
import { ProductionLinesService } from '../src/production-lines/production-lines.service';
import { AgvsService } from '../src/agvs/agvs.service';
import { AlarmsService } from '../src/alarms/alarms.service';
import { DigitalTwinService } from '../src/digital-twin/digital-twin.service';

class FakeMqttClient extends EventEmitter implements MqttClientLike {
  subscribe(): void {}
  end(): void {}
}

describe('digital twin current-state projection', () => {
  it('projects MQTT telemetry and alarms with canonicalId/sourceId identity', () => {
    const client = new FakeMqttClient();
    const factory: MqttClientFactory = () => client;
    const ingestion = new MqttIngestionService(
      factory,
      { enabled: true, url: 'mqtt://test-broker' },
      new DeviceTelemetryCache(),
      new AlarmDeduplicator(),
    );
    ingestion.start();
    client.emit('connect');

    const eventTime = '2026-08-29T09:00:00.000Z';
    client.emit(
      'message',
      'mes/simulator/tenant-demo/lines/line-cnc/devices/cnc-01/telemetry',
      JSON.stringify({
        event: 'device.telemetry',
        data: {
          deviceId: 'cnc-01',
          deviceName: 'CNC-01 加工中心',
          lineId: 'line-cnc',
          status: 'FAULT',
          temperatureCelsius: 96,
          cycleTimeSeconds: 42,
          totalCount: 12,
          goodCount: 10,
          defectCount: 2,
          activeFaults: ['OVERHEAT'],
          timestamp: eventTime,
        },
      }),
    );
    client.emit(
      'message',
      'mes/simulator/tenant-demo/alarms',
      JSON.stringify({
        event: 'alarm.created',
        data: {
          id: 'alarm-cnc-01-overheat',
          lineId: 'line-cnc',
          deviceId: 'cnc-01',
          type: 'OVERHEAT',
          severity: 'CRITICAL',
          message: '温度过高',
          startedAt: eventTime,
        },
      }),
    );
    client.emit(
      'message',
      'mes/simulator/tenant-demo/lines/line-cnc/devices/cnc-02/telemetry',
      JSON.stringify({
        event: 'device.telemetry',
        data: {
          deviceId: 'cnc-02', deviceName: 'CNC-02 加工中心', lineId: 'line-cnc', status: 'STOPPED',
          temperatureCelsius: 42, cycleTimeSeconds: 42, totalCount: 0, goodCount: 0, defectCount: 0,
          activeFaults: [], timestamp: eventTime,
        },
      }),
    );

    const devices = new DevicesService();
    const alarms = new AlarmsService(devices, ingestion);
    const twin = new DigitalTwinService(
      new ProductionLinesService(),
      devices,
      new AgvsService(),
      alarms,
      ingestion,
    );

    const snapshot = twin.getSnapshot('tenant-demo');
    const device = snapshot.devices.find((item) => item.sourceId === 'cnc-01');

    expect(snapshot.lines).toHaveLength(4);
    expect(snapshot.devices).toHaveLength(12);
    expect(snapshot.agvs).toHaveLength(3);
    expect(snapshot.dataTime).toBe(eventTime);
    expect(device).toEqual(expect.objectContaining({
      canonicalId: 'device-cnc-01',
      sourceId: 'cnc-01',
      status: 'alarm',
      source: 'mqtt',
    }));
    expect(snapshot.devices.filter((item) => item.canonicalId === 'device-cnc-01')).toHaveLength(1);
    expect(snapshot.devices.find((item) => item.canonicalId === 'device-cnc-02')).toEqual(expect.objectContaining({
      status: 'offline',
      source: 'mqtt',
    }));
    expect(snapshot.alarms).toEqual([expect.objectContaining({
      canonicalDeviceId: 'device-cnc-01',
      sourceId: 'cnc-01',
      status: 'active',
    })]);
    expect(snapshot.lines.find((line) => line.lineId === 'line-cnc')).toEqual(expect.objectContaining({
      status: 'fault',
      deviceIds: expect.arrayContaining(['device-cnc-01']),
      activeAlarmCount: 1,
      oee: expect.objectContaining({ availability: 0 }),
    }));
    expect(snapshot.connectivity).toEqual(expect.objectContaining({
      mqtt: 'connected',
      telemetryDevices: 2,
      activeAlarms: 1,
    }));
  });
});
