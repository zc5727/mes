import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createId, timestamp } from '../common/mock.types';
import { DEVICE_CONNECTION_PROBE } from './device-connection.constants';
import type { CreateDeviceConnectionDto, CreateUnifiedDeviceEventDto, UpdateDeviceConnectionDto } from './dto/device-connection.dto';
import type {
  ConnectionHealth,
  DeviceConnection,
  DeviceConnectionProbe,
  UnifiedDeviceEvent,
} from './device-connection.types';

@Injectable()
export class DeviceConnectionsService {
  private readonly connections = new Map<string, DeviceConnection[]>();
  private readonly events = new Map<string, UnifiedDeviceEvent[]>();

  constructor(@Inject(DEVICE_CONNECTION_PROBE) private readonly probe: DeviceConnectionProbe) {}

  list(tenantId: string): DeviceConnection[] {
    return [...(this.connections.get(tenantId) ?? [])].sort((left, right) => left.name.localeCompare(right.name));
  }

  findOne(tenantId: string, id: string): DeviceConnection {
    const connection = this.list(tenantId).find((item) => item.id === id);
    if (!connection) throw new NotFoundException(`Device connection ${id} not found`);
    return connection;
  }

  create(tenantId: string, dto: CreateDeviceConnectionDto): DeviceConnection {
    this.validateEndpoint(dto.type, dto.endpoint);
    const duplicate = this.list(tenantId).some((item) => item.deviceId === dto.deviceId.trim() && item.type === dto.type);
    if (duplicate) throw new ConflictException(`A ${dto.type} connection already exists for device ${dto.deviceId}`);
    const now = timestamp();
    const connection: DeviceConnection = {
      id: createId('device-connection'), tenantId, deviceId: dto.deviceId.trim(), name: dto.name.trim(),
      type: dto.type, endpoint: dto.endpoint.trim(), config: dto.config ?? {}, capabilities: this.normalizeCapabilities(dto.capabilities),
      enabled: dto.enabled ?? true, status: 'stopped', health: this.unknownHealth(), lastError: null,
      lastEventAt: null, startedAt: null, createdAt: now, updatedAt: now,
    };
    this.connections.set(tenantId, [...(this.connections.get(tenantId) ?? []), connection]);
    return connection;
  }

  update(tenantId: string, id: string, dto: UpdateDeviceConnectionDto): DeviceConnection {
    const current = this.findOne(tenantId, id);
    const type = current.type;
    if (dto.endpoint) this.validateEndpoint(type, dto.endpoint);
    const updated = {
      ...current,
      name: dto.name?.trim() || current.name,
      endpoint: dto.endpoint?.trim() || current.endpoint,
      config: dto.config ?? current.config,
      capabilities: dto.capabilities ? this.normalizeCapabilities(dto.capabilities) : current.capabilities,
      enabled: dto.enabled ?? current.enabled,
      updatedAt: timestamp(),
    };
    return this.replace(updated);
  }

  async test(tenantId: string, id: string): Promise<{ connection: DeviceConnection; test: { ok: boolean; latencyMs: number; error: string | null } }> {
    const current = this.findOne(tenantId, id);
    const result = await this.probe.probe(current);
    const checkedAt = timestamp();
    const health: ConnectionHealth = { status: result.ok ? 'healthy' : 'unhealthy', checkedAt, latencyMs: result.latencyMs };
    const updated = this.replace({ ...current, health, lastError: result.ok ? null : result.error ?? 'Connection probe failed', updatedAt: checkedAt });
    return { connection: updated, test: { ok: result.ok, latencyMs: result.latencyMs, error: result.ok ? null : result.error ?? 'Connection probe failed' } };
  }

  async start(tenantId: string, id: string): Promise<DeviceConnection> {
    const current = this.findOne(tenantId, id);
    if (!current.enabled) throw new ConflictException('Disabled device connections cannot be started');
    const starting = this.replace({ ...current, status: 'starting', lastError: null, updatedAt: timestamp() });
    const result = await this.probe.probe(starting);
    const now = timestamp();
    const health: ConnectionHealth = { status: result.ok ? 'healthy' : 'unhealthy', checkedAt: now, latencyMs: result.latencyMs };
    return this.replace({
      ...starting,
      status: result.ok ? 'running' : 'error', health, lastError: result.ok ? null : result.error ?? 'Connection start failed',
      startedAt: result.ok ? now : null, updatedAt: now,
    });
  }

  stop(tenantId: string, id: string): DeviceConnection {
    const current = this.findOne(tenantId, id);
    return this.replace({ ...current, status: 'stopped', startedAt: null, updatedAt: timestamp() });
  }

  health(tenantId: string, id: string): ConnectionHealth {
    return this.findOne(tenantId, id).health;
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
    if (existing.some((item) => item.eventId === event.eventId)) throw new ConflictException(`Device event ${event.eventId} already exists`);
    this.events.set(key, [...existing, event]);
    this.replace({ ...connection, lastEventAt: receivedAt, updatedAt: receivedAt });
    return event;
  }

  private replace(connection: DeviceConnection): DeviceConnection {
    this.connections.set(connection.tenantId, (this.connections.get(connection.tenantId) ?? []).map((item) => item.id === connection.id ? connection : item));
    return connection;
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

  private validateEndpoint(type: DeviceConnection['type'], endpoint: string): void {
    let url: URL;
    try { url = new URL(endpoint); } catch { throw new BadRequestException('Connection endpoint must be a valid URL'); }
    const allowed = type === 'mqtt' ? ['mqtt:', 'mqtts:', 'ws:', 'wss:'] : ['http:', 'https:'];
    if (!allowed.includes(url.protocol)) throw new BadRequestException(`${type} connection does not support ${url.protocol}`);
  }
}
