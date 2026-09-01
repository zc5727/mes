import { BadRequestException, ConflictException, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional, ServiceUnavailableException } from '@nestjs/common';
import { AlarmDeduplicator } from './alarm-deduplicator';
import { MqttStatePersistenceService } from '../database/mqtt-state-persistence.service';
import { DeviceTelemetryCache } from './device-cache';
import { createDefaultMqttClient } from './mqtt-client.factory';
import { parseSimulatorControlProjection, parseSimulatorMessage } from './mqtt-parser';
import { IngestDeviceEventDto } from './dto/ingest-device-event.dto';
import { mapGatewayPoints } from './point-mapping';
import { DevicesService } from '../devices/devices.service';
import { DeviceConnectionsService } from '../device-connections/device-connections.service';
import { resolveSimulatorSourceId } from '../digital-twin/device-identity';
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
  SimulatorRuntimeProjection,
} from './mqtt.types';

/**
 * Persistence is injected at runtime and may be a reduced test or desktop
 * adapter. Keep every persistence operation optional at this boundary so a
 * missing auxiliary method cannot break the MQTT lifecycle callbacks.
 */
type MqttPersistencePort = Partial<Pick<
  MqttStatePersistenceService,
  'restore' | 'saveTelemetry' | 'saveAlarm' | 'recordConnection'
>>;

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
  private readonly messageCounters = { received: 0, telemetry: 0, alarms: 0, http: 0, accepted: 0, duplicate: 0, stale: 0, malformed: 0, rejected: 0 };
  private readonly projectionListeners = new Set<(tenantId: string) => void>();
  private readonly simulatorRuntime = new Map<string, SimulatorRuntimeProjection>();

  constructor(
    @Inject(MQTT_CLIENT_FACTORY) private readonly clientFactory: MqttClientFactory = createDefaultMqttClient,
    @Optional() @Inject(MQTT_INGESTION_OPTIONS) private readonly options: MqttIngestionOptions = {},
    private readonly deviceCache: DeviceTelemetryCache = new DeviceTelemetryCache(),
    private readonly alarmDeduplicator: AlarmDeduplicator = new AlarmDeduplicator(),
    @Optional() private readonly persistence?: MqttPersistencePort,
    @Optional() private readonly devicesService?: DevicesService,
    @Optional() private readonly connectionsService?: DeviceConnectionsService,
  ) {}

  async onModuleInit(): Promise<void> {
    const restored = await this.persistence?.restore?.();
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
    this.notifyProjection(this.connectionProjectionTenant());
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

  getSimulatorRuntime(tenantId: string): SimulatorRuntimeProjection | null {
    return this.simulatorRuntime.get(tenantId) ?? null;
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
  ingestHttpEvent(
    tenantId: string,
    event: IngestDeviceEventDto,
  ): { accepted: boolean; duplicate: boolean; eventId: string } {
    const deviceId = this.requiredText(event.deviceId, 'deviceId');
    const lineId = this.requiredText(event.lineId, 'lineId');
    if (Number.isNaN(Date.parse(event.eventTime))) {
      throw new BadRequestException('eventTime must be an ISO timestamp');
    }
    const payload = mapGatewayPoints(event.payload ?? {});
    const eventId = this.normalizedText(event.eventId)
      ?? this.normalizedText(event.traceId)
      ?? `${deviceId}:${event.eventTime}:${event.eventType}`;
    if (event.eventType !== 'telemetry') {
      throw new BadRequestException('HTTP device-events currently accepts telemetry only; publish alarms via MQTT');
    }
    const status = this.normalizeStatus(event.status ?? payload.status);
    const telemetry = {
      deviceId,
      deviceName: String(payload.deviceName ?? deviceId),
      lineId,
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
    this.recordHttpConnectionEvent(tenantId, event.connectionId, eventId, telemetry);
    const result = this.deviceCache.upsert(tenantId, telemetry, 'http://gateway/device-events');
    if (result.accepted) {
      this.projectDeviceTelemetry(tenantId, telemetry);
      this.messageCounters.http += 1; this.messageCounters.accepted += 1;
      this.persistSafely('telemetry', this.persistence?.saveTelemetry?.(result.current));
      this.notifyProjection(tenantId);
    }
    return {
      accepted: result.accepted,
      duplicate: result.accepted ? false : result.reason === 'duplicate',
      eventId,
    };
  }

  async publishSimulatorControl(tenantId: string, command: SimulatorControlCommand): Promise<string> {
    if (!this.client || !this.connected || !this.client.publish) {
      throw new ServiceUnavailableException('MQTT simulator control is unavailable while the broker is disconnected');
    }

    const commandId = command.commandId ?? `sim-control-${Date.now()}-${process.pid}`;
    const simulatorCommand = command.lineId && command.deviceId
      ? { ...command, deviceId: resolveSimulatorSourceId(command.lineId, command.deviceId) }
      : command;
    const payload = JSON.stringify({
      ...simulatorCommand,
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
      this.notifyProjection(this.connectionProjectionTenant());
      this.persistSafely(
        'MQTT connected event',
        this.persistence?.recordConnection?.(this.connectionTenantId(), 'connected', { broker: this.resolveOptions().url ?? null, gatewayId: this.resolveOptions().gatewayId ?? null }),
      );
      const options = this.resolveOptions();
      this.logger.log(
        `MQTT broker connected at ${this.displayUrl(options.url)}; subscribing to telemetry and alarm topics`,
      );
      void this.subscribeAfterConnect();
    });
    client.on('reconnect', () => {
      this.connected = false;
      this.state = 'starting'; this.reconnectAttempts += 1;
      this.notifyProjection(this.connectionProjectionTenant());
      this.persistSafely('MQTT reconnecting event', this.persistence?.recordConnection?.(this.connectionTenantId(), 'reconnecting', {}));
      this.logger.log('MQTT broker reconnecting');
    });
    client.on('close', () => {
      this.connected = false;
      this.state = 'disconnected';
      this.notifyProjection(this.connectionProjectionTenant());
      this.persistSafely('MQTT closed event', this.persistence?.recordConnection?.(this.connectionTenantId(), 'closed', {}));
      this.logger.warn('MQTT broker connection closed; cached state is retained and reconnect will be attempted');
    });
    client.on('offline', () => {
      this.connected = false;
      this.state = 'disconnected'; this.setError('MQTT broker is offline', 'MQTT_OFFLINE');
      this.notifyProjection(this.connectionProjectionTenant());
      this.persistSafely('MQTT offline event', this.persistence?.recordConnection?.(this.connectionTenantId(), 'offline', {}));
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
    const topics = [
      options.telemetryTopic ?? DEFAULT_TELEMETRY_TOPIC,
      options.alarmsTopic ?? DEFAULT_ALARMS_TOPIC,
      'mes/simulator/+/control',
    ];
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
    const controlMatch = /^mes\/simulator\/([^/]+)\/control$/.exec(topic);
    if (controlMatch) {
      this.handleSimulatorControlProjection(controlMatch[1], payload);
      return;
    }
    const message = parseSimulatorMessage(topic, payload);
    this.messageCounters.received += 1;
    if (!message) {
      this.messageCounters.malformed += 1; this.setError(`Malformed message on ${topic}`, 'MQTT_MALFORMED_MESSAGE');
      this.logger.warn(`Ignored malformed simulator message on topic ${topic}`);
      return;
    }

    const configuredTenantId = this.resolveOptions().tenantId;
    if (configuredTenantId && message.tenantId !== configuredTenantId) {
      this.messageCounters.rejected += 1;
      this.setError(`Rejected message for tenant ${message.tenantId}`, 'MQTT_TENANT_MISMATCH');
      this.logger.warn(
        `Rejected MQTT message on ${topic}: tenant ${message.tenantId} does not match configured tenant ${configuredTenantId}`,
      );
      return;
    }

    if (message.kind === 'telemetry') {
      this.messageCounters.telemetry += 1; this.lastHeartbeatAt = new Date().toISOString();
      const result = this.deviceCache.upsert(message.tenantId, message.data, message.topic);
      if (result.accepted) {
        this.projectDeviceTelemetry(message.tenantId, message.data);
        this.messageCounters.accepted += 1;
        this.persistSafely('telemetry', this.persistence?.saveTelemetry?.(result.current));
        this.notifyProjection(message.tenantId);
      }
      else if (result.reason === 'duplicate') this.messageCounters.duplicate += 1;
      else this.messageCounters.stale += 1;
      return;
    }

    this.messageCounters.alarms += 1; this.lastHeartbeatAt = new Date().toISOString();
    const result = this.alarmDeduplicator.apply(message.tenantId, message.event, message.data);
    if (result.accepted) {
      this.persistSafely('alarm', this.persistence?.saveAlarm?.(result.state));
      this.notifyProjection(message.tenantId);
    }
    else if (result.reason === 'duplicate') this.messageCounters.duplicate += 1;
    else this.messageCounters.stale += 1;
  }

  private handleSimulatorControlProjection(tenantId: string, payload: string | Uint8Array): void {
    const message = parseSimulatorControlProjection(payload);
    if (!message) {
      this.messageCounters.malformed += 1;
      this.setError('Malformed simulator control acknowledgement', 'MQTT_MALFORMED_CONTROL');
      return;
    }
    const current = this.simulatorRuntime.get(tenantId);
    const data = message.data;
    const status = data?.status;
    const paused = data?.paused;
    const timeScale = data?.timeScale;
    const currentTime = message.timestamp ?? new Date().toISOString();
    if (status !== 'RUNNING' && status !== 'PAUSED' && status !== 'STOPPED') {
      if (!current || (message.event !== 'simulator.snapshot' && message.event !== 'simulator.export')) return;
      this.simulatorRuntime.set(tenantId, {
        ...current,
        currentTime,
        lastCommand: message.action as SimulatorRuntimeProjection['lastCommand'],
        lastCommandId: message.commandId ?? null,
        lastCommandAt: currentTime,
      });
      this.notifyProjection(tenantId);
      return;
    }
    if (typeof paused !== 'boolean' || typeof timeScale !== 'number' || !Number.isFinite(timeScale) || timeScale <= 0) return;
    this.simulatorRuntime.set(tenantId, {
      status,
      paused,
      timeScale,
      currentTime,
      lastCommand: message.action as SimulatorRuntimeProjection['lastCommand'],
      lastCommandId: message.commandId ?? null,
      lastCommandAt: currentTime,
      dataSource: 'mqtt',
    });
    this.notifyProjection(tenantId);
  }

  private notifyProjection(tenantId: string): void {
    this.projectionListeners.forEach((listener) => {
      try {
        listener(tenantId);
      } catch (error: unknown) {
        this.logger.error(`Realtime projection listener failed: ${this.errorMessage(error)}`);
      }
    });
  }

  private resolveOptions(): Required<Pick<MqttIngestionOptions, 'enabled'>> & MqttIngestionOptions {
    const url = this.options.url ?? process.env.MQTT_URL;
    const enabled = this.options.enabled ?? process.env.MQTT_ENABLED === 'true';
    const tenantId = this.options.tenantId ?? process.env.MES_TENANT_ID;
    return { ...this.options, url, enabled, tenantId };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private setError(message: string, code: string): void {
    this.lastError = message; this.lastErrorCode = code;
  }

  private persistSafely(operation: string, promise?: Promise<void>): void {
    if (!promise) return;
    void promise.catch((error: unknown) => {
      const detail = this.errorMessage(error);
      this.setError(`MQTT ${operation} persistence failed: ${detail}`, 'MQTT_PERSISTENCE_FAILED');
      this.logger.error(`MQTT ${operation} persistence failed: ${detail}`);
    });
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

  /** Broadcast lifecycle changes when no single tenant is configured. */
  private connectionProjectionTenant(): string {
    return this.resolveOptions().tenantId ?? '*';
  }

  private normalizeStatus(value: unknown): SimulatorTelemetry['status'] {
    const normalized = String(value ?? 'IDLE').toUpperCase();
    if (normalized === 'RUNNING' || normalized === 'IDLE' || normalized === 'WARNING'
      || normalized === 'STOPPED' || normalized === 'FAULT' || normalized === 'OFFLINE') return normalized;
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

  private projectDeviceTelemetry(tenantId: string, telemetry: SimulatorTelemetry): void {
    if (!this.devicesService) return;
    const status = telemetry.status === 'FAULT' || telemetry.status === 'WARNING'
      ? 'alarm'
      : telemetry.status === 'STOPPED' || telemetry.status === 'OFFLINE' ? 'offline' : 'online';
    this.devicesService.projectTelemetry(tenantId, telemetry.lineId, telemetry.deviceId, {
      timestamp: telemetry.timestamp,
      metrics: {
        temperatureCelsius: telemetry.temperatureCelsius,
        cycleTimeSeconds: telemetry.cycleTimeSeconds,
        totalCount: telemetry.totalCount,
        goodCount: telemetry.goodCount,
        defectCount: telemetry.defectCount,
      },
      status,
      statusReason: telemetry.activeFaults.join(', '),
    });
  }

  private recordHttpConnectionEvent(
    tenantId: string,
    connectionId: string | undefined,
    eventId: string,
    telemetry: SimulatorTelemetry,
  ): void {
    if (!connectionId) return;
    if (!this.connectionsService) {
      throw new ServiceUnavailableException('HTTP connection registry is unavailable');
    }
    const connection = this.connectionsService.findOne(tenantId, connectionId);
    if (connection.type !== 'http' && connection.type !== 'webhook') {
      throw new BadRequestException('connectionId must reference an HTTP or webhook connection');
    }
    if (connection.status !== 'running') {
      throw new ConflictException('HTTP device connection must be running before receiving events');
    }
    if (!this.sameDevice(connection.deviceId, telemetry.deviceId)) {
      throw new BadRequestException('HTTP event deviceId does not match the managed connection');
    }
    this.connectionsService.ingestEvent(tenantId, connectionId, {
      eventId,
      type: 'telemetry',
      occurredAt: telemetry.timestamp,
      payload: { ...telemetry },
    });
  }

  private sameDevice(configuredId: string, sourceId: string): boolean {
    return configuredId === sourceId
      || configuredId === `device-${sourceId}`
      || sourceId === `device-${configuredId}`;
  }

  private requiredText(value: string, field: string): string {
    const normalized = this.normalizedText(value);
    if (!normalized) throw new BadRequestException(`${field} is required`);
    return normalized;
  }

  private normalizedText(value: string | undefined): string | undefined {
    const normalized = value?.trim();
    return normalized || undefined;
  }
}
