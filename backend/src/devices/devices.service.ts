import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { CorePersistenceService } from '../database/core-persistence.service';
import { createId, MockEntity, timestamp } from '../common/mock.types';
import { CreateDeviceDto } from './dto/create-device.dto';
import { IngestTelemetryDto } from './dto/ingest-telemetry.dto';
import { UpdateDeviceStatusDto } from './dto/update-device-status.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { ProductionLinesService } from '../production-lines/production-lines.service';
import { AuditService } from '../audit/audit.service';

export interface Device extends MockEntity {
  lineId: string;
  code: string;
  name: string;
  model: string;
  protocol: 'opcua' | 'modbus-tcp' | 'mqtt' | 'simulator';
  status: 'online' | 'offline' | 'maintenance' | 'alarm';
  statusReason: string;
  lastSeenAt: string | null;
  metrics: Record<string, number | string | boolean | null>;
  metadata: Record<string, unknown>;
}

@Injectable()
export class DevicesService implements OnModuleInit {
  private readonly logger = new Logger(DevicesService.name);

  constructor(
    @Optional() private readonly persistence?: CorePersistenceService,
    @Optional() private readonly productionLines?: ProductionLinesService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    const snapshot = await this.persistence?.restore();
    if (this.persistence?.isEnabled?.()) this.devices.clear();
    if (snapshot?.devices.length) {
      this.devices.clear();
      snapshot.devices.forEach((item) => this.devices.set(item.id, {
        ...item,
        model: item.model ?? '', protocol: (item.protocol as Device['protocol']) ?? 'simulator',
        status: item.status as Device['status'], statusReason: item.statusReason ?? '',
        metrics: (item.metrics as Device['metrics']) ?? {}, metadata: (item.metadata as Device['metadata']) ?? {},
      }));
    }
  }
  private readonly devices = new Map<string, Device>([
    ['device-cnc-01', this.createSeed('device-cnc-01', 'line-cnc', 'CNC-001', '立式加工中心 01', 'VMC-850', 'online')],
    ['device-cnc-02', this.createSeed('device-cnc-02', 'line-cnc', 'CNC-002', '立式加工中心 02', 'VMC-850', 'online')],
    ['device-assembly-01', this.createSeed('device-assembly-01', 'line-assembly', 'ASM-001', '六轴装配机器人', 'IRB-1200', 'online')],
    ['device-welding-01', this.createSeed('device-welding-01', 'line-welding', 'WLD-001', '自动焊机 01', 'WeldPro-X', 'maintenance')],
    ['device-vision-01', this.createSeed('device-vision-01', 'line-vision', 'VIS-001', 'AI视觉检测站', 'Vision-AI', 'online')],
  ]);

  findAll(tenantId: string, lineId?: string): Device[] {
    return [...this.devices.values()].filter(
      (device) => device.tenantId === tenantId && (!lineId || device.lineId === lineId),
    );
  }

  findOverview(tenantId: string) {
    const devices = this.findAll(tenantId);
    return {
      total: devices.length,
      online: devices.filter((device) => device.status === 'online').length,
      offline: devices.filter((device) => device.status === 'offline').length,
      maintenance: devices.filter((device) => device.status === 'maintenance').length,
      alarm: devices.filter((device) => device.status === 'alarm').length,
      latestTelemetryAt: devices
        .map((device) => device.lastSeenAt)
        .filter((value): value is string => value !== null)
        .sort()
        .at(-1) ?? null,
    };
  }

  findOne(tenantId: string, id: string): Device {
    const device = this.devices.get(id);
    if (!device || device.tenantId !== tenantId) {
      throw new NotFoundException(`Device ${id} not found`);
    }

    return device;
  }

  create(tenantId: string, dto: CreateDeviceDto, persist = true): Device {
    this.productionLines?.findOne(tenantId, dto.lineId);
    const duplicate = this.findAll(tenantId).some((device) => device.code === dto.code);
    if (duplicate) {
      throw new ConflictException(`Device code ${dto.code} already exists`);
    }

    const now = timestamp();
    const device: Device = {
      id: createId('device'),
      tenantId,
      lineId: dto.lineId,
      code: dto.code,
      name: dto.name,
      model: dto.model ?? '',
      protocol: dto.protocol ?? 'simulator',
      status: 'offline',
      statusReason: '等待采集端连接',
      lastSeenAt: null,
      metrics: {},
      metadata: dto.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    };
    this.devices.set(device.id, device);
    if (persist) this.persist('save device', this.persistence?.saveDevice(device));
    this.audit?.record(tenantId, 'system', {
      action: 'device.created',
      resource: 'device',
      resourceId: device.id,
      after: device as unknown as Record<string, unknown>,
      details: { code: device.code, lineId: device.lineId },
    });
    return device;
  }

  /** Waits for the durable asset write before acknowledging device creation. */
  async createReliable(tenantId: string, dto: CreateDeviceDto): Promise<Device> {
    const device = this.create(tenantId, dto, false);
    try {
      await this.persistence?.saveDevice(device);
      return device;
    } catch (error: unknown) {
      this.devices.delete(device.id);
      throw error;
    }
  }

  update(tenantId: string, id: string, dto: UpdateDeviceDto, persist = true): Device {
    const current = this.findOne(tenantId, id);
    if (dto.lineId && dto.lineId !== current.lineId) {
      this.productionLines?.findOne(tenantId, dto.lineId);
    }
    if (dto.code && dto.code !== current.code) {
      const duplicate = this.findAll(tenantId).some((device) => device.code === dto.code);
      if (duplicate) {
        throw new ConflictException(`Device code ${dto.code} already exists`);
      }
    }

    const updated: Device = { ...current, ...dto, updatedAt: timestamp() };
    this.devices.set(id, updated);
    if (persist) this.persist('save device', this.persistence?.saveDevice(updated));
    this.audit?.record(tenantId, 'system', {
      action: 'device.updated',
      resource: 'device',
      resourceId: id,
      before: current as unknown as Record<string, unknown>,
      after: updated as unknown as Record<string, unknown>,
      details: { code: updated.code, lineId: updated.lineId },
    });
    return updated;
  }

  /** Waits for durable persistence before acknowledging an asset edit. */
  async updateReliable(tenantId: string, id: string, dto: UpdateDeviceDto): Promise<Device> {
    const current = this.findOne(tenantId, id);
    const updated = this.update(tenantId, id, dto, false);
    try {
      await this.persistence?.saveDevice(updated);
      return updated;
    } catch (error: unknown) {
      this.devices.set(id, current);
      throw error;
    }
  }

  updateStatus(tenantId: string, id: string, dto: UpdateDeviceStatusDto, persist = true): Device {
    const current = this.findOne(tenantId, id);
    const updated: Device = {
      ...current,
      status: dto.status,
      statusReason: dto.reason ?? '',
      updatedAt: timestamp(),
    };
    this.devices.set(id, updated);
    if (persist) this.persist('save device', this.persistence?.saveDevice(updated));
    this.audit?.record(tenantId, 'system', {
      action: 'device.status',
      resource: 'device',
      resourceId: id,
      before: current as unknown as Record<string, unknown>,
      after: updated as unknown as Record<string, unknown>,
      details: { from: current.status, to: updated.status, reason: updated.statusReason },
    });
    return updated;
  }

  /** Waits for durable status persistence for operator-facing state changes. */
  async updateStatusReliable(tenantId: string, id: string, dto: UpdateDeviceStatusDto): Promise<Device> {
    const current = this.findOne(tenantId, id);
    const updated = this.updateStatus(tenantId, id, dto, false);
    try {
      await this.persistence?.saveDevice(updated);
      return updated;
    } catch (error: unknown) {
      this.devices.set(id, current);
      throw error;
    }
  }

  ingestTelemetry(tenantId: string, id: string, dto: IngestTelemetryDto): Device {
    const current = this.findOne(tenantId, id);
    const observedAt = dto.timestamp ?? timestamp();
    return this.applyTelemetry(current, observedAt, dto.metrics, 'online', '');
  }

  /**
   * Projects a protocol-neutral telemetry state onto the device ledger.
   * Unknown source IDs are ignored because gateways may report devices before
   * the MES asset catalog has been synchronized; known devices remain tenant
   * and line scoped.
   */
  projectTelemetry(
    tenantId: string,
    lineId: string,
    sourceDeviceId: string,
    input: {
      timestamp: string;
      metrics: Record<string, number | string | boolean | null>;
      status: 'online' | 'offline' | 'alarm';
      statusReason?: string;
    },
  ): Device | undefined {
    const device = this.findAll(tenantId, lineId).find((item) => (
      item.id === sourceDeviceId
      || item.id === `device-${sourceDeviceId}`
      || item.code === sourceDeviceId
      || item.code === sourceDeviceId.toUpperCase()
    ));
    if (!device) return undefined;
    return this.applyTelemetry(
      device,
      input.timestamp,
      input.metrics,
      input.status,
      input.statusReason ?? '',
    );
  }

  remove(tenantId: string, id: string, persist = true): { id: string; deleted: true } {
    const device = this.findOne(tenantId, id);
    this.devices.delete(id);
    if (persist) this.persist('delete device', this.persistence?.deleteDevice(id));
    this.audit?.record(tenantId, 'system', {
      action: 'device.deleted',
      resource: 'device',
      resourceId: id,
      before: device as unknown as Record<string, unknown>,
      details: { code: device.code, lineId: device.lineId },
    });
    return { id, deleted: true };
  }

  /** Deletes an asset only after the durable delete succeeds. */
  async removeReliable(tenantId: string, id: string): Promise<{ id: string; deleted: true }> {
    const current = this.findOne(tenantId, id);
    const result = this.remove(tenantId, id, false);
    try {
      await this.persistence?.deleteDevice(id);
      return result;
    } catch (error: unknown) {
      this.devices.set(id, current);
      throw error;
    }
  }

  private createSeed(
    id: string,
    lineId: string,
    code: string,
    name: string,
    model: string,
    status: Device['status'],
  ): Device {
    return {
      id,
      tenantId: 'tenant-demo',
      lineId,
      code,
      name,
      model,
      protocol: 'simulator',
      status,
      statusReason: status === 'maintenance' ? '计划保养' : '',
      lastSeenAt: status === 'online' ? '2026-08-28T08:00:00.000Z' : null,
      metrics: status === 'online' ? { temperature: 42, load: 68, cycleTime: 31 } : {},
      metadata: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
  }

  private applyTelemetry(
    current: Device,
    observedAt: string,
    metrics: Record<string, number | string | boolean | null>,
    status: Device['status'],
    statusReason: string,
  ): Device {
    if (Number.isNaN(Date.parse(observedAt))) {
      throw new BadRequestException('timestamp must be an ISO timestamp');
    }
    if (current.lastSeenAt) {
      const currentTimestamp = Date.parse(current.lastSeenAt);
      const incomingTimestamp = Date.parse(observedAt);
      if (!Number.isNaN(currentTimestamp) && incomingTimestamp <= currentTimestamp) return current;
    }
    const updated: Device = {
      ...current,
      status,
      statusReason,
      lastSeenAt: observedAt,
      metrics,
      updatedAt: timestamp(),
    };
    this.devices.set(current.id, updated);
    this.persist('save device telemetry projection', this.persistence?.saveDevice(updated));
    if (current.status !== updated.status) {
      this.audit?.record(updated.tenantId, 'system', {
        action: 'device.status',
        resource: 'device',
        resourceId: updated.id,
        before: current as unknown as Record<string, unknown>,
        after: updated as unknown as Record<string, unknown>,
        details: { from: current.status, to: updated.status, reason: updated.statusReason, source: 'telemetry' },
      });
    }
    return updated;
  }

  private persist(operation: string, promise?: Promise<void>): void {
    if (!promise) return;
    void promise.catch((error: unknown) => {
      this.logger.error(`${operation} failed; in-memory device state remains available: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}
