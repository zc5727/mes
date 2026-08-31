import { BadRequestException, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional, ServiceUnavailableException } from '@nestjs/common';
import { AlarmDeduplicator } from './alarm-deduplicator';
import { MqttStatePersistenceService } from '../database/mqtt-state-persistence.service';
import { DeviceTelemetryCache } from './device-cache';
import { createDefaultMqttClient } from './mqtt-client.factory';
import { parseSimulatorMessage } from './mqtt-parser';
import { IngestDeviceEventDto } from './dto/ingest-device-event.dto';
import { mapGatewayPoints } from './point-mapping';
import {
  DEFAULT_ALARMS_TOPIC,
  DEFAULT_TELEMETRY_TOPIC,
  MQTT_CLIENT_FACTORY,
  MQTT_INGESTION_OPTIONS,
  MqttClientFactory,
  MqttClientLike,
  MqttIngestionOptions,
  SimulatorControlCommand,
  SimulatorTelemetry,
  MqttIngestionStatus,
} from './mqtt.types';

@Injectable()
export class MqttIngestionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttIngestionService.name);
  private client?: MqttClientLike;
  private started = false;
  private connected = false;
  private subscriptionInFlight = false;
  private state: MqttIngestionStatus['state'] = 'disabled';
  private lastHeartbeatAt: string | null = null;
  private lastError: string | null = null;
  private lastErrorCode: string | null = null;
  private reconnectAttempts = 0;
  private readonly messageCounters = { received: 0, telemetry: 0, alarms: 0, http: 0, accepted: 0, duplicate: 0, stale: 0, malformed: 0 };
  private readonly projectionListeners = new Set<(tenantId: string) => void>();

  constructor(
    @Inject(MQTT_CLIENT_FACTORY) private readonly clientFactory: MqttClientFactory = createDefaultMqttClient,
    @Optional() @Inject(MQTT_INGESTION_OPTIONS) private readonly options: MqttIngestionOptions = {},
    private readonly deviceCache: DeviceTelemetryCache = new DeviceTelemetryCache(),
    private readonly alarmDeduplicator: AlarmDeduplicator = new AlarmDeduplicator(),
    @Optional() private readonly persistence?: MqttStatePersistenceService,
  ) {}

  async onModuleInit(): Promise<void> {
    const restored = await this.persistence?.restore();
    if (restored) {
      this.deviceCache.restore(restored.telemetry);
      this.alarmDeduplicator.restore(restored.alarms);
    }
    this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(): void {
    if (this.started) return;

    const options = this.resolveOptions();
    if (!options.enabled) {
      this.state = 'disabled';
      this.logger.log(`MQTT ingestion disabled (MQTT_ENABLED=false); HTTP-only mode is active`);
      return;
    }
    if (!options.url) {
      this.state = 'error';
      this.setError('MQTT_URL is missing', 'MQTT_URL_MISSING');
      this.logger.error('MQTT ingestion is enabled but MQTT_URL is missing; ingestion remains disabled');
      return;
    }

    this.started = true;
    this.state = 'starting';
    this.logger.log(`Starting MQTT ingestion for broker ${this.displayUrl(options.url)}`);
    try {
      this.client = this.clientFactory(options.url, {
        clientId: options.clientId ?? `mes-ingestion-${process.pid}`,
        reconnectPeriod: options.reconnectPeriodMs ?? 1_000,
      });
      this.registerClientListeners();
    } catch (error: unknown) {
      this.started = false;
      this.state = 'error';
      this.client = undefined;
      this.setError(this.errorMessage(error), 'MQTT_CLIENT_CREATE_FAILED');
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
    this.state = 'disconnected';
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

  getStatus(): MqttIngestionStatus {
    const options = this.resolveOptions();
    return {
      enabled: options.enabled, connected: this.connected, state: this.state,
      brokerUrl: options.url ? this.displayUrl(options.url) : null,
      telemetryTopic: options.telemetryTopic ?? DEFAULT_TELEMETRY_TOPIC,
      alarmsTopic: options.alarmsTopic ?? DEFAULT_ALARMS_TOPIC,
      lastHeartbeatAt: this.lastHeartbeatAt, lastError: this.lastError, lastErrorCode: this.lastErrorCode,
      reconnectAttempts: this.reconnectAttempts, messages: { ...this.messageCounters },
    };
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

  onProjection(listener: (tenantId: string) => void): () => void {
    this.projectionListeners.add(listener);
    return () => this.projectionListeners.delete(listener);
  }

  /**
   * Ingests a normalized HTTP gateway event through the same memory projection
   * as MQTT. This is intentionally telemetry/alarm ingestion only; no device
   * command is reachable from this endpoint.
   */
  ingestHttpEvent(tenantId: string, event: IngestDeviceEventDto): { accepted: boolean; duplicate: boolean; eventId: string } {
    const payload = mapGatewayPoints(event.payload ?? {});
    const eventId = event.eventId ?? event.traceId ?? `${event.deviceId}:${event.eventTime}:${event.eventType}`;
    if (event.eventType !== 'telemetry') {
      throw new BadRequestException('HTTP device-events currently accepts telemetry only; publish alarms via MQTT');
    }
    const status = this.normalizeStatus(event.status ?? payload.status);
    const telemetry = {
      deviceId: event.deviceId,
      deviceName: String(payload.deviceName ?? event.deviceId),
      lineId: event.lineId,
      status,
      temperatureCelsius: this.numberPoint(payload.temperatureCelsius, 0),
      cycleTimeSeconds: this.numberPoint(payload.cycleTimeSeconds, 0),
      totalCount: this.integerPoint(payload.totalCount, 0),
      goodCount: this.integerPoint(payload.goodCount, 0),
      defectCount: this.integerPoint(payload.defectCount, 0),
      activeFaults: [],
      timestamp: event.eventTime,
      eventId,
      traceId: event.traceId,
      gatewayId: event.gatewayId,
      quality: event.quality,
    } satisfies SimulatorTelemetry;
    if (telemetry.goodCount + telemetry.defectCount > telemetry.totalCount) {
      throw new BadRequestException('goodCount + defectCount cannot exceed totalCount');
    }
    const result = this.deviceCache.upsert(tenantId, telemetry, 'http://gateway/device-events');
    if (result.accepted) {
      this.messageCounters.http += 1; this.messageCounters.accepted += 1;
      void this.persistence?.saveTelemetry(result.current);
      this.notifyProjection(tenantId);
    }
    return { accepted: result.accepted, duplicate: !result.accepted, eventId };
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
    try {
      await this.client.publish(topic, payload);
    } catch (error: unknown) {
      this.logger.error(`MQTT simulator control publish failed on ${topic}: ${this.errorMessage(error)}`);
      throw new ServiceUnavailableException(
        `MQTT simulator control publish failed: ${this.errorMessage(error)}`,
      );
    }
    return commandId;
  }

  private registerClientListeners(): void {
    const client = this.client;
    if (!client) return;

    client.on('connect', () => {
      this.connected = true;
      this.state = 'connected'; this.lastHeartbeatAt = new Date().toISOString(); this.lastError = null; this.lastErrorCode = null;
      void this.persistence?.recordConnection(this.connectionTenantId(), 'connected', { broker: this.resolveOptions().url ?? null, gatewayId: this.resolveOptions().gatewayId ?? null });
      const options = this.resolveOptions();
      this.logger.log(
        `MQTT broker connected at ${this.displayUrl(options.url)}; subscribing to telemetry and alarm topics`,
      );
      void this.subscribeAfterConnect();
    });
    client.on('reconnect', () => {
      this.connected = false;
      this.state = 'starting'; this.reconnectAttempts += 1;
      void this.persistence?.recordConnection(this.connectionTenantId(), 'reconnecting', {});
      this.logger.log('MQTT broker reconnecting');
    });
    client.on('close', () => {
      this.connected = false;
      this.state = 'disconnected';
      void this.persistence?.recordConnection(this.connectionTenantId(), 'closed', {});
      this.logger.warn('MQTT broker connection closed; cached state is retained and reconnect will be attempted');
    });
    client.on('offline', () => {
      this.connected = false;
      this.state = 'disconnected'; this.setError('MQTT broker is offline', 'MQTT_OFFLINE');
      void this.persistence?.recordConnection(this.connectionTenantId(), 'offline', {});
      this.logger.warn('MQTT broker is offline; check Mosquitto/process status and MQTT_URL');
    });
    client.on('error', (error) => {
      this.state = 'error'; this.setError(error.message, 'MQTT_BROKER_ERROR');
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
    this.messageCounters.received += 1;
    if (!message) {
      this.messageCounters.malformed += 1; this.setError(`Malformed message on ${topic}`, 'MQTT_MALFORMED_MESSAGE');
      this.logger.warn(`Ignored malformed simulator message on topic ${topic}`);
      return;
    }

    if (message.kind === 'telemetry') {
      this.messageCounters.telemetry += 1; this.lastHeartbeatAt = new Date().toISOString();
      const result = this.deviceCache.upsert(message.tenantId, message.data, message.topic);
      if (result.accepted) {
        this.messageCounters.accepted += 1;
        void this.persistence?.saveTelemetry(result.current);
        this.notifyProjection(message.tenantId);
      }
      else if (result.reason === 'duplicate') this.messageCounters.duplicate += 1;
      else this.messageCounters.stale += 1;
      return;
    }

    this.messageCounters.alarms += 1; this.lastHeartbeatAt = new Date().toISOString();
    const result = this.alarmDeduplicator.apply(message.tenantId, message.event, message.data);
    if (result.accepted) {
      void this.persistence?.saveAlarm(result.state);
      this.notifyProjection(message.tenantId);
    }
    else if (result.reason === 'duplicate') this.messageCounters.duplicate += 1;
    else this.messageCounters.stale += 1;
  }

  private notifyProjection(tenantId: string): void {
    this.projectionListeners.forEach((listener) => listener(tenantId));
  }

  private resolveOptions(): Required<Pick<MqttIngestionOptions, 'enabled'>> & MqttIngestionOptions {
    const url = this.options.url ?? process.env.MQTT_URL;
    const enabled = this.options.enabled ?? process.env.MQTT_ENABLED === 'true';
    return { ...this.options, url, enabled };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private setError(message: string, code: string): void {
    this.lastError = message; this.lastErrorCode = code;
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

  private connectionTenantId(): string {
    return this.resolveOptions().tenantId ?? process.env.MES_TENANT_ID ?? 'tenant-demo';
  }

  private normalizeStatus(value: unknown): SimulatorTelemetry['status'] {
    const normalized = String(value ?? 'IDLE').toUpperCase();
    if (normalized === 'RUNNING' || normalized === 'IDLE' || normalized === 'STOPPED' || normalized === 'FAULT') return normalized;
    throw new BadRequestException(`Unsupported device status: ${normalized}`);
  }

  private numberPoint(value: unknown, fallback: number): number {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new BadRequestException('Numeric device point is invalid');
    return parsed;
  }

  private integerPoint(value: unknown, fallback: number): number {
    const parsed = this.numberPoint(value, fallback);
    if (!Number.isInteger(parsed) || parsed < 0) throw new BadRequestException('Count device point must be a non-negative integer');
    return parsed;
  }
}
