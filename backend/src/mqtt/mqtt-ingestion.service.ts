import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional, ServiceUnavailableException } from '@nestjs/common';
import { AlarmDeduplicator } from './alarm-deduplicator';
import { DeviceTelemetryCache } from './device-cache';
import { createDefaultMqttClient } from './mqtt-client.factory';
import { parseSimulatorMessage } from './mqtt-parser';
import {
  DEFAULT_ALARMS_TOPIC,
  DEFAULT_TELEMETRY_TOPIC,
  MQTT_CLIENT_FACTORY,
  MQTT_INGESTION_OPTIONS,
  MqttClientFactory,
  MqttClientLike,
  MqttIngestionOptions,
  SimulatorControlCommand,
} from './mqtt.types';

@Injectable()
export class MqttIngestionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttIngestionService.name);
  private client?: MqttClientLike;
  private started = false;
  private connected = false;
  private subscriptionInFlight = false;

  constructor(
    @Inject(MQTT_CLIENT_FACTORY) private readonly clientFactory: MqttClientFactory = createDefaultMqttClient,
    @Optional() @Inject(MQTT_INGESTION_OPTIONS) private readonly options: MqttIngestionOptions = {},
    private readonly deviceCache: DeviceTelemetryCache = new DeviceTelemetryCache(),
    private readonly alarmDeduplicator: AlarmDeduplicator = new AlarmDeduplicator(),
  ) {}

  onModuleInit(): void {
    this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(): void {
    if (this.started) return;

    const options = this.resolveOptions();
    if (!options.enabled) {
      this.logger.log(`MQTT ingestion disabled (MQTT_ENABLED=false); HTTP-only mode is active`);
      return;
    }
    if (!options.url) {
      this.logger.error('MQTT ingestion is enabled but MQTT_URL is missing; ingestion remains disabled');
      return;
    }

    this.started = true;
    this.logger.log(`Starting MQTT ingestion for broker ${this.displayUrl(options.url)}`);
    try {
      this.client = this.clientFactory(options.url, {
        clientId: options.clientId ?? `mes-ingestion-${process.pid}`,
        reconnectPeriod: options.reconnectPeriodMs ?? 1_000,
      });
      this.registerClientListeners();
    } catch (error: unknown) {
      this.started = false;
      this.client = undefined;
      this.logger.error(
        `MQTT client creation failed for ${this.displayUrl(options.url)}: ${this.errorMessage(error)}. `
        + 'Check MQTT_URL, broker availability and network access',
      );
    }
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.connected = false;
    const client = this.client;
    this.client = undefined;
    if (!client) return;

    try {
      const result = client.end(true);
      if (result instanceof Promise) void result.catch((error: unknown) => {
        this.logger.warn(`MQTT client close failed: ${this.errorMessage(error)}`);
      });
    } catch (error: unknown) {
      this.logger.warn(`MQTT client close failed: ${this.errorMessage(error)}`);
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  getDevice(tenantId: string, lineId: string, deviceId: string) {
    return this.deviceCache.get(tenantId, lineId, deviceId);
  }

  listDevices(tenantId?: string) {
    return this.deviceCache.list(tenantId);
  }

  listActiveAlarms(tenantId?: string) {
    return this.alarmDeduplicator.listActive(tenantId);
  }

  async publishSimulatorControl(tenantId: string, command: SimulatorControlCommand): Promise<string> {
    if (!this.client || !this.connected || !this.client.publish) {
      throw new ServiceUnavailableException('MQTT simulator control is unavailable while the broker is disconnected');
    }

    const commandId = command.commandId ?? `sim-control-${Date.now()}-${process.pid}`;
    const payload = JSON.stringify({
      ...command,
      commandId,
    });
    const topic = `mes/control/${tenantId}/simulator/command`;
    await this.client.publish(topic, payload);
    return commandId;
  }

  private registerClientListeners(): void {
    const client = this.client;
    if (!client) return;

    client.on('connect', () => {
      this.connected = true;
      const options = this.resolveOptions();
      this.logger.log(
        `MQTT broker connected at ${this.displayUrl(options.url)}; subscribing to telemetry and alarm topics`,
      );
      void this.subscribeAfterConnect();
    });
    client.on('reconnect', () => {
      this.connected = false;
      this.logger.log('MQTT broker reconnecting');
    });
    client.on('close', () => {
      this.connected = false;
      this.logger.warn('MQTT broker connection closed; cached state is retained and reconnect will be attempted');
    });
    client.on('offline', () => {
      this.connected = false;
      this.logger.warn('MQTT broker is offline; check Mosquitto/process status and MQTT_URL');
    });
    client.on('error', (error) => {
      this.logger.error(
        `MQTT broker error: ${error.message}. `
        + 'Verify the broker is listening, credentials are valid and the configured URL is reachable',
      );
    });
    client.on('message', (topic, payload) => {
      this.handleMessage(topic, payload);
    });
  }

  private async subscribeAfterConnect(): Promise<void> {
    const client = this.client;
    if (!client || !this.started || this.subscriptionInFlight) return;

    const options = this.resolveOptions();
    const topics = [options.telemetryTopic ?? DEFAULT_TELEMETRY_TOPIC, options.alarmsTopic ?? DEFAULT_ALARMS_TOPIC];
    this.subscriptionInFlight = true;
    try {
      for (const topic of topics) {
        await client.subscribe(topic);
      }
      this.logger.log(`Subscribed to ${topics.join(', ')}`);
    } catch (error: unknown) {
      // Do not tear down the client: mqtt will emit connect again after a
      // reconnect, which retries both subscriptions without duplicate handlers.
      this.logger.error(
        `MQTT subscription failed for [${topics.join(', ')}]: ${this.errorMessage(error)}. `
        + 'The client will retry subscriptions after the next broker reconnect',
      );
    } finally {
      this.subscriptionInFlight = false;
    }
  }

  private handleMessage(topic: string, payload: string | Uint8Array): void {
    const message = parseSimulatorMessage(topic, payload);
    if (!message) {
      this.logger.warn(`Ignored malformed simulator message on topic ${topic}`);
      return;
    }

    if (message.kind === 'telemetry') {
      this.deviceCache.upsert(message.tenantId, message.data, message.topic);
      return;
    }

    this.alarmDeduplicator.apply(message.tenantId, message.event, message.data);
  }

  private resolveOptions(): Required<Pick<MqttIngestionOptions, 'enabled'>> & MqttIngestionOptions {
    const url = this.options.url ?? process.env.MQTT_URL;
    const enabled = this.options.enabled ?? process.env.MQTT_ENABLED === 'true';
    return { ...this.options, url, enabled };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private displayUrl(url: string | undefined): string {
    if (!url) return '<missing MQTT_URL>';
    try {
      const parsed = new URL(url);
      parsed.username = '';
      parsed.password = '';
      return parsed.toString();
    } catch {
      return '<invalid MQTT_URL>';
    }
  }
}
