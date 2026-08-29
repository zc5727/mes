import { Module } from '@nestjs/common';
import { AlarmDeduplicator } from './alarm-deduplicator';
import { DeviceTelemetryCache } from './device-cache';
import { createDefaultMqttClient } from './mqtt-client.factory';
import { MqttIngestionService } from './mqtt-ingestion.service';
import { SimulatorControlController } from './simulator-control.controller';
import { MQTT_CLIENT_FACTORY, MQTT_INGESTION_OPTIONS } from './mqtt.types';

@Module({
  providers: [
    DeviceTelemetryCache,
    AlarmDeduplicator,
    { provide: MQTT_CLIENT_FACTORY, useValue: createDefaultMqttClient },
    {
      provide: MQTT_INGESTION_OPTIONS,
      useFactory: () => ({
        url: process.env.MQTT_URL?.trim() || undefined,
        enabled: process.env.MQTT_ENABLED === 'true',
        clientId: process.env.MQTT_CLIENT_ID?.trim() || undefined,
        reconnectPeriodMs: readPositiveInteger(process.env.MQTT_RECONNECT_PERIOD_MS),
        telemetryTopic: process.env.MQTT_TELEMETRY_TOPIC?.trim() || undefined,
        alarmsTopic: process.env.MQTT_ALARMS_TOPIC?.trim() || undefined,
      }),
    },
    MqttIngestionService,
  ],
  controllers: [SimulatorControlController],
  exports: [MqttIngestionService, DeviceTelemetryCache, AlarmDeduplicator],
})
export class MqttModule {}

function readPositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
