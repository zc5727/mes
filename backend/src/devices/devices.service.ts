import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createId, MockEntity, timestamp } from '../common/mock.types';
import { CreateDeviceDto } from './dto/create-device.dto';
import { IngestTelemetryDto } from './dto/ingest-telemetry.dto';
import { UpdateDeviceStatusDto } from './dto/update-device-status.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';

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
export class DevicesService {
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

  create(tenantId: string, dto: CreateDeviceDto): Device {
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
    return device;
  }

  update(tenantId: string, id: string, dto: UpdateDeviceDto): Device {
    const current = this.findOne(tenantId, id);
    if (dto.code && dto.code !== current.code) {
      const duplicate = this.findAll(tenantId).some((device) => device.code === dto.code);
      if (duplicate) {
        throw new ConflictException(`Device code ${dto.code} already exists`);
      }
    }

    const updated: Device = { ...current, ...dto, updatedAt: timestamp() };
    this.devices.set(id, updated);
    return updated;
  }

  updateStatus(tenantId: string, id: string, dto: UpdateDeviceStatusDto): Device {
    const current = this.findOne(tenantId, id);
    const updated: Device = {
      ...current,
      status: dto.status,
      statusReason: dto.reason ?? '',
      updatedAt: timestamp(),
    };
    this.devices.set(id, updated);
    return updated;
  }

  ingestTelemetry(tenantId: string, id: string, dto: IngestTelemetryDto): Device {
    const current = this.findOne(tenantId, id);
    const observedAt = dto.timestamp ?? timestamp();
    const updated: Device = {
      ...current,
      status: 'online',
      statusReason: '',
      lastSeenAt: observedAt,
      metrics: dto.metrics,
      updatedAt: timestamp(),
    };
    this.devices.set(id, updated);
    return updated;
  }

  remove(tenantId: string, id: string): { id: string; deleted: true } {
    this.findOne(tenantId, id);
    this.devices.delete(id);
    return { id, deleted: true };
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
}
