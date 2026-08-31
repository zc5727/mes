import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { createId, timestamp } from '../common/mock.types';
import { DEVICE_CONNECTION_PROBE } from './device-connection.constants';
import type { CreateDeviceConnectionDto, CreateUnifiedDeviceEventDto, UpdateDeviceConnectionDto } from './dto/device-connection.dto';
import type {
  ConnectionHealth,
  DeviceConnection,
  DeviceConnectionProbe,
  DeviceConnectionStatusEvent,
  UnifiedDeviceEvent,
} from './device-connection.types';
import { DeviceProfilesService } from '../device-profiles/device-profiles.service';
import { DeviceConnectionPersistenceService } from './device-connection-persistence.service';

@Injectable()
export class DeviceConnectionsService implements OnModuleInit {
  private readonly connections = new Map<string, DeviceConnection[]>();
  private readonly events = new Map<string, UnifiedDeviceEvent[]>();
  private readonly statusEvents = new Map<string, DeviceConnectionStatusEvent[]>();

  constructor(
    @Inject(DEVICE_CONNECTION_PROBE)
    private readonly probe: DeviceConnectionProbe,
    @Optional() private readonly profiles?: DeviceProfilesService,
    @Optional() private readonly persistence?: DeviceConnectionPersistenceService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.persistence) return;
    const snapshot = await this.persistence.restore();
    for (const connection of snapshot.connections) {
      const validated = this.validateRestoredConnection(connection);
      const tenantConnections = this.connections.get(connection.tenantId) ?? [];
      this.connections.set(connection.tenantId, [...tenantConnections, validated]);
    }
    for (const event of snapshot.statusEvents) {
      const key = this.eventKey(event.tenantId, event.connectionId);
      this.statusEvents.set(key, [...(this.statusEvents.get(key) ?? []), event]);
    }
  }

  list(tenantId: string): DeviceConnection[] {
    return [...(this.connections.get(tenantId) ?? [])].sort((left, right) => left.name.localeCompare(right.name));
  }

  findOne(tenantId: string, id: string): DeviceConnection {
    const connection = this.list(tenantId).find((item) => item.id === id);
    if (!connection) throw new NotFoundException(`Device connection ${id} not found`);
    return connection;
  }

  async create(tenantId: string, dto: CreateDeviceConnectionDto): Promise<DeviceConnection> {
    this.validateEndpoint(dto.type, dto.endpoint);
    this.validateProfile(dto.type, dto.profileKey);
    const duplicate = this.list(tenantId).some((item) => item.deviceId === dto.deviceId.trim() && item.type === dto.type);
    if (duplicate) throw new ConflictException(`A ${dto.type} connection already exists for device ${dto.deviceId}`);
    const now = timestamp();
    const connection: DeviceConnection = {
      id: createId('device-connection'), tenantId, deviceId: dto.deviceId.trim(), name: dto.name.trim(),
      type: dto.type,
      profileKey: dto.profileKey?.trim() || null,
      driverVerification: this.driverVerification(dto.type, dto.profileKey),
      endpoint: dto.endpoint.trim(),
      config: dto.config ?? {},
      capabilities: this.normalizeCapabilities(dto.capabilities),
      enabled: dto.enabled ?? true, status: dto.type === 'mtconnect' ? 'unsupported' : 'stopped', health: dto.type === 'mtconnect' ? { status: 'unsupported', checkedAt: null, latencyMs: null } : this.unknownHealth(), lastError: dto.type === 'mtconnect' ? 'MTConnect adapter is not implemented' : null,
      lastErrorCode: dto.type === 'mtconnect' ? 'PROTOCOL_UNIMPLEMENTED' : null,
      lastEventAt: null, lastHeartbeatAt: null, startedAt: null, createdAt: now, updatedAt: now,
    };
    const createdEvent = this.statusEvent(connection, 'created', { initialStatus: connection.status });
    await this.persistence?.save(connection, createdEvent);
    this.connections.set(tenantId, [...(this.connections.get(tenantId) ?? []), connection]);
    this.appendStatusEvent(createdEvent);
    return connection;
  }

  async update(tenantId: string, id: string, dto: UpdateDeviceConnectionDto): Promise<DeviceConnection> {
    const current = this.findOne(tenantId, id);
    const type = current.type;
    if (dto.endpoint) this.validateEndpoint(type, dto.endpoint);
    const profileKey = dto.profileKey?.trim() ?? current.profileKey;
    this.validateProfile(type, profileKey ?? undefined);
    const updated = {
      ...current,
      name: dto.name?.trim() || current.name,
      profileKey,
      driverVerification: this.driverVerification(type, profileKey ?? undefined),
      endpoint: dto.endpoint?.trim() || current.endpoint,
      config: dto.config ?? current.config,
      capabilities: dto.capabilities ? this.normalizeCapabilities(dto.capabilities) : current.capabilities,
      enabled: dto.enabled ?? current.enabled,
      updatedAt: timestamp(),
    };
    await this.persistence?.save(updated);
    return this.replace(updated);
  }

  async test(tenantId: string, id: string): Promise<{ connection: DeviceConnection; test: { ok: boolean; latencyMs: number; error: string | null } }> {
    const current = this.findOne(tenantId, id);
    const result = current.type === 'mtconnect'
      ? this.unsupportedProbeResult()
      : await this.probe.probe(current);
    const checkedAt = timestamp();
    const health: ConnectionHealth = { status: this.healthStatus(result), checkedAt, latencyMs: result.latencyMs };
    const updated = { ...current, health, lastError: result.ok ? null : result.error ?? 'Connection probe failed', lastErrorCode: result.ok ? null : result.errorCode ?? 'CONNECTION_PROBE_FAILED', lastHeartbeatAt: result.ok ? checkedAt : current.lastHeartbeatAt, updatedAt: checkedAt };
    await this.persistence?.save(updated);
    this.replace(updated);
    return { connection: updated, test: { ok: result.ok, latencyMs: result.latencyMs, error: result.ok ? null : result.error ?? 'Connection probe failed' } };
  }

  async start(tenantId: string, id: string): Promise<DeviceConnection> {
    const current = this.findOne(tenantId, id);
    if (!current.enabled) throw new ConflictException('Disabled device connections cannot be started');
    const starting = { ...current, status: 'starting' as const, lastError: null, updatedAt: timestamp() };
    const result = starting.type === 'mtconnect'
      ? this.unsupportedProbeResult()
      : await this.probe.probe(starting);
    const now = timestamp();
    const health: ConnectionHealth = { status: this.healthStatus(result), checkedAt: now, latencyMs: result.latencyMs };
    const updated = {
      ...starting,
      status: result.ok ? 'running' : this.statusForProbeFailure(result), health,
      lastError: result.ok ? null : result.error ?? 'Connection start failed',
      lastErrorCode: result.ok ? null : result.errorCode ?? 'CONNECTION_START_FAILED',
      lastHeartbeatAt: result.ok ? now : current.lastHeartbeatAt,
      startedAt: result.ok ? now : null, updatedAt: now,
    };
    const updatedEvent = this.statusEvent(updated, updated.status, { error: updated.lastError });
    await this.persistence?.save(updated, updatedEvent);
    this.replace(updated);
    this.appendStatusEvent(updatedEvent);
    return updated;
  }

  async stop(tenantId: string, id: string): Promise<DeviceConnection> {
    const current = this.findOne(tenantId, id);
    const updated = { ...current, status: 'stopped' as const, startedAt: null, updatedAt: timestamp() };
    const stoppedEvent = this.statusEvent(updated, 'stopped');
    await this.persistence?.save(updated, stoppedEvent);
    this.replace(updated);
    this.appendStatusEvent(stoppedEvent);
    return updated;
  }

  health(tenantId: string, id: string): ConnectionHealth {
    return this.findOne(tenantId, id).health;
  }

  profile(tenantId: string, id: string) {
    const connection = this.findOne(tenantId, id);
    if (!connection.profileKey) {
      throw new NotFoundException(`No device profile is bound to connection ${id}`);
    }
    if (!this.profiles) {
      throw new ConflictException('Device profile catalog is unavailable');
    }
    return this.profiles.findOne(connection.profileKey);
  }

  listStatusEvents(tenantId: string, connectionId: string): DeviceConnectionStatusEvent[] {
    this.findOne(tenantId, connectionId);
    return [...(this.statusEvents.get(this.eventKey(tenantId, connectionId)) ?? [])];
  }

  listEvents(tenantId: string, connectionId: string): UnifiedDeviceEvent[] {
    this.findOne(tenantId, connectionId);
    return [...(this.events.get(this.eventKey(tenantId, connectionId)) ?? [])];
  }

  ingestEvent(tenantId: string, connectionId: string, dto: CreateUnifiedDeviceEventDto): UnifiedDeviceEvent {
    const connection = this.findOne(tenantId, connectionId);
    if (connection.status !== 'running') throw new ConflictException('Device connection must be running before receiving events');
    const occurredAt = dto.occurredAt ?? timestamp();
    if (Number.isNaN(Date.parse(occurredAt))) throw new BadRequestException('occurredAt must be an ISO timestamp');
    const receivedAt = timestamp();
    const event: UnifiedDeviceEvent = {
      eventId: dto.eventId?.trim() || createId('device-event'), tenantId, connectionId, deviceId: connection.deviceId,
      type: dto.type, occurredAt, receivedAt, payload: dto.payload,
    };
    const key = this.eventKey(tenantId, connectionId);
    const existing = this.events.get(key) ?? [];
    const duplicate = existing.find((item) => item.eventId === event.eventId);
    if (duplicate) {
      this.replace({ ...connection, lastEventAt: duplicate.receivedAt, lastHeartbeatAt: duplicate.receivedAt, updatedAt: duplicate.receivedAt });
      return duplicate;
    }
    this.events.set(key, [...existing, event]);
    this.replace({ ...connection, lastEventAt: receivedAt, lastHeartbeatAt: receivedAt, updatedAt: receivedAt });
    return event;
  }

  private replace(connection: DeviceConnection): DeviceConnection {
    this.connections.set(connection.tenantId, (this.connections.get(connection.tenantId) ?? []).map((item) => item.id === connection.id ? connection : item));
    return connection;
  }

  private appendStatusEvent(event: DeviceConnectionStatusEvent): void {
    const key = this.eventKey(event.tenantId, event.connectionId);
    this.statusEvents.set(key, [...(this.statusEvents.get(key) ?? []), event]);
  }

  private validateRestoredConnection(connection: DeviceConnection): DeviceConnection {
    try {
      this.validateEndpoint(connection.type, connection.endpoint);
      this.validateProfile(connection.type, connection.profileKey ?? undefined);
      return connection;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ...connection,
        status: connection.status === 'unsupported' ? 'unsupported' : 'error',
        health: connection.status === 'unsupported'
          ? connection.health
          : { status: 'unhealthy', checkedAt: timestamp(), latencyMs: null },
        lastError: `Invalid persisted connection configuration: ${message}`,
        lastErrorCode: 'INVALID_CONNECTION_CONFIG',
        startedAt: null,
        updatedAt: timestamp(),
      };
    }
  }

  private statusEvent(
    connection: DeviceConnection,
    status: DeviceConnectionStatusEvent['status'],
    details: Record<string, unknown> = {},
  ): DeviceConnectionStatusEvent {
    return {
      id: createId('connection-event'),
      tenantId: connection.tenantId,
      connectionId: connection.id,
      status,
      eventTime: connection.updatedAt,
      errorCode: connection.lastErrorCode,
      details,
    };
  }

  private eventKey(tenantId: string, connectionId: string): string {
    return `${tenantId}:${connectionId}`;
  }

  private unknownHealth(): ConnectionHealth {
    return { status: 'unknown', checkedAt: null, latencyMs: null };
  }

  private normalizeCapabilities(capabilities: string[] | undefined): string[] {
    const values = (capabilities ?? []).map((item) => item.trim()).filter(Boolean);
    if (values.some((item) => item.length > 80)) throw new BadRequestException('Connection capability is too long');
    return [...new Set(values)];
  }

  private validateProfile(type: DeviceConnection['type'], profileKey?: string): void {
    if (!profileKey?.trim()) return;
    if (!this.profiles) {
      throw new ConflictException('Device profile catalog is unavailable');
    }
    const profile = this.profiles.findOne(profileKey.trim());
    if (!this.isCompatibleProtocol(profile.protocol, type)) {
      throw new BadRequestException(
        `Profile ${profileKey} does not support ${type} connections`,
      );
    }
  }

  private driverVerification(
    type: DeviceConnection['type'],
    profileKey?: string,
  ): DeviceConnection['driverVerification'] {
    if (type === 'mtconnect') return 'unimplemented';
    if (!profileKey?.trim()) return 'not-verified';
    if (!this.profiles) return 'not-verified';
    return this.profiles.findOne(profileKey.trim()).verified
      ? 'verified'
      : 'not-verified';
  }

  private isCompatibleProtocol(profileProtocol: string, connectionType: DeviceConnection['type']): boolean {
    return profileProtocol === connectionType
      || (profileProtocol === 'opcua' && connectionType === 'opc-ua');
  }

  private healthStatus(result: { ok: boolean; errorCode?: string }): ConnectionHealth['status'] {
    return result.errorCode === 'PROTOCOL_UNIMPLEMENTED' || result.errorCode === 'PROTOCOL_NOT_IMPLEMENTED'
      ? 'unsupported'
      : result.ok ? 'healthy' : 'unhealthy';
  }

  private statusForProbeFailure(
    result: { ok: boolean; errorCode?: string },
  ): DeviceConnection['status'] {
    return this.healthStatus(result) === 'unsupported' ? 'unsupported' : 'error';
  }

  private unsupportedProbeResult(): { ok: false; latencyMs: number; error: string; errorCode: string } {
    return {
      ok: false,
      latencyMs: 0,
      error: 'MTConnect adapter is not implemented',
      errorCode: 'PROTOCOL_UNIMPLEMENTED',
    };
  }

  private validateEndpoint(type: DeviceConnection['type'], endpoint: string): void {
    let url: URL;
    try { url = new URL(endpoint); } catch { throw new BadRequestException('Connection endpoint must be a valid URL'); }
    const allowed = type === 'mqtt' ? ['mqtt:', 'mqtts:', 'ws:', 'wss:'] : type === 'modbus-tcp' ? ['modbus-tcp:'] : type === 'opc-ua' ? ['opc.tcp:'] : ['http:', 'https:'];
    if (!allowed.includes(url.protocol)) throw new BadRequestException(`${type} connection does not support ${url.protocol}`);
  }
}
