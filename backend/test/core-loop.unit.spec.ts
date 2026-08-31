import { EventEmitter } from 'node:events';
import { AlarmDeduplicator } from '../src/mqtt/alarm-deduplicator';
import { DeviceTelemetryCache } from '../src/mqtt/device-cache';
import { MqttIngestionService } from '../src/mqtt/mqtt-ingestion.service';
import {
  MqttClientFactory,
  MqttClientLike,
  MqttPayload,
} from '../src/mqtt/mqtt.types';
import { DevicesService } from '../src/devices/devices.service';
import { ProductionLinesService } from '../src/production-lines/production-lines.service';
import { OrdersService } from '../src/orders/orders.service';
import { WorkOrdersService } from '../src/work-orders/work-orders.service';
import { AgvsService } from '../src/agvs/agvs.service';
import { AlarmsService } from '../src/alarms/alarms.service';
import { AlarmsController } from '../src/alarms/alarms.controller';
import { DashboardService } from '../src/dashboard/dashboard.service';
import { DashboardController } from '../src/dashboard/dashboard.controller';

const tenantId = 'tenant-demo';
const lineId = 'line-cnc';
const deviceId = 'cnc-01';
const eventTime = '2026-08-28T09:30:00.000Z';

class FakeMqttClient extends EventEmitter implements MqttClientLike {
  readonly subscriptions: string[] = [];
  ended = false;

  subscribe(topic: string): void {
    this.subscriptions.push(topic);
  }

  end(): void {
    this.ended = true;
  }

  emitMessage(topic: string, payload: MqttPayload): void {
    this.emit('message', topic, payload);
  }
}

describe('core production loop smoke', () => {
  it('replays simulator MQTT messages into alarm and dashboard API results', async () => {
    const mqttClient = new FakeMqttClient();
    const clientFactory: MqttClientFactory = () => mqttClient;
    const ingestion = new MqttIngestionService(
      clientFactory,
      { enabled: true, url: 'mqtt://test-broker', clientId: 'core-loop-test' },
      new DeviceTelemetryCache(),
      new AlarmDeduplicator(),
    );

    ingestion.start();
    mqttClient.emit('connect');
    await flushAsyncWork();

    expect(mqttClient.subscriptions).toEqual([
      'mes/+/+/lines/+/devices/+/telemetry',
      'mes/simulator/+/alarms',
    ]);
    expect(ingestion.isConnected()).toBe(true);

    mqttClient.emitMessage(
      `mes/simulator/${tenantId}/lines/${lineId}/devices/${deviceId}/telemetry`,
      JSON.stringify({
        event: 'device.telemetry',
        data: {
          deviceId,
          deviceName: 'CNC-01',
          lineId,
          status: 'FAULT',
          temperatureCelsius: 96,
          cycleTimeSeconds: 42,
          totalCount: 10,
          goodCount: 8,
          defectCount: 2,
          activeFaults: ['OVERHEAT'],
          timestamp: eventTime,
        },
      }),
    );

    const alarmPayload = JSON.stringify({
      event: 'alarm.created',
      data: {
        id: 'alarm-cnc-01-overheat',
        lineId,
        deviceId,
        type: 'OVERHEAT',
        severity: 'CRITICAL',
        message: '设备温度超过安全阈值',
        startedAt: eventTime,
      },
    });
    const alarmTopic = `mes/simulator/${tenantId}/alarms`;
    mqttClient.emitMessage(alarmTopic, alarmPayload);
    mqttClient.emitMessage(alarmTopic, alarmPayload);

    const devicesService = new DevicesService();
    const alarmsService = new AlarmsService(devicesService, ingestion);
    const alarmsController = new AlarmsController(alarmsService);
    const alarmResponse = alarmsController.findAll(tenantId, {
      level: 'critical',
      lineId,
      deviceId,
      status: 'active',
    });

    expect(ingestion.listDevices(tenantId)).toHaveLength(1);
    expect(ingestion.getDevice(tenantId, lineId, deviceId)?.status).toBe('FAULT');
    expect(ingestion.listActiveAlarms(tenantId)).toHaveLength(1);
    expect(alarmResponse.data).toHaveLength(1);
    expect(alarmResponse.data[0].message).toBe('设备温度超过安全阈值');

    const dashboardService = new DashboardService(
      new ProductionLinesService(),
      devicesService,
      new WorkOrdersService(new OrdersService(), new ProductionLinesService()),
      new AgvsService(),
      alarmsService,
      ingestion,
    );
    const dashboardController = new DashboardController(dashboardService);
    const dashboardResponse = dashboardController.overview(tenantId);

    expect(dashboardResponse.data.devices.alarm).toBe(1);
    expect(dashboardResponse.data.alarms.critical).toBe(1);

    mqttClient.emit('close');
    expect(ingestion.isConnected()).toBe(false);
    ingestion.stop();
    expect(mqttClient.ended).toBe(true);
  });
});

async function flushAsyncWork(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
