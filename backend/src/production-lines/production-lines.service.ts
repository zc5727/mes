import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createId, MockEntity, timestamp } from '../common/mock.types';
import { CreateProductionLineDto } from './dto/create-production-line.dto';
import { UpdateLineStatusDto } from './dto/update-line-status.dto';
import { UpdateProductionLineDto } from './dto/update-production-line.dto';

export interface ProductionLine extends MockEntity {
  factoryId: string;
  code: string;
  name: string;
  type: string;
  targetOee: number;
  status: 'active' | 'inactive' | 'maintenance';
  statusReason: string;
}

@Injectable()
export class ProductionLinesService {
  private readonly lines = new Map<string, ProductionLine>([
    ['line-cnc', this.createSeed('line-cnc', 'tenant-demo', 'L001', 'CNC加工线', '机加工', 85, 'active')],
    ['line-assembly', this.createSeed('line-assembly', 'tenant-demo', 'L002', '精密装配线', '装配', 88, 'active')],
    ['line-welding', this.createSeed('line-welding', 'tenant-demo', 'L003', '自动焊接线', '焊接', 82, 'maintenance')],
    ['line-vision', this.createSeed('line-vision', 'tenant-demo', 'L004', '视觉检测线', '检测', 92, 'active')],
  ]);

  findAll(tenantId: string, factoryId?: string): ProductionLine[] {
    return [...this.lines.values()].filter(
      (line) => line.tenantId === tenantId && (!factoryId || line.factoryId === factoryId),
    );
  }

  findOverview(tenantId: string) {
    const lines = this.findAll(tenantId);
    return {
      total: lines.length,
      active: lines.filter((line) => line.status === 'active').length,
      inactive: lines.filter((line) => line.status === 'inactive').length,
      maintenance: lines.filter((line) => line.status === 'maintenance').length,
      averageTargetOee: lines.length
        ? Math.round((lines.reduce((total, line) => total + line.targetOee, 0) / lines.length) * 10) / 10
        : 0,
    };
  }

  findOne(tenantId: string, id: string): ProductionLine {
    const line = this.lines.get(id);
    if (!line || line.tenantId !== tenantId) {
      throw new NotFoundException(`Production line ${id} not found`);
    }

    return line;
  }

  create(tenantId: string, dto: CreateProductionLineDto): ProductionLine {
    const duplicate = this.findAll(tenantId).some((line) => line.code === dto.code);
    if (duplicate) {
      throw new ConflictException(`Production line code ${dto.code} already exists`);
    }

    const now = timestamp();
    const line: ProductionLine = {
      id: createId('line'),
      tenantId,
      factoryId: dto.factoryId,
      code: dto.code,
      name: dto.name,
      type: dto.type,
      targetOee: dto.targetOee ?? 85,
      status: dto.status ?? 'active',
      statusReason: '',
      createdAt: now,
      updatedAt: now,
    };
    this.lines.set(line.id, line);
    return line;
  }

  update(tenantId: string, id: string, dto: UpdateProductionLineDto): ProductionLine {
    const current = this.findOne(tenantId, id);
    if (dto.code && dto.code !== current.code) {
      const duplicate = this.findAll(tenantId).some((line) => line.code === dto.code);
      if (duplicate) {
        throw new ConflictException(`Production line code ${dto.code} already exists`);
      }
    }

    const updated: ProductionLine = { ...current, ...dto, updatedAt: timestamp() };
    this.lines.set(id, updated);
    return updated;
  }

  updateStatus(tenantId: string, id: string, dto: UpdateLineStatusDto): ProductionLine {
    const current = this.findOne(tenantId, id);
    const updated: ProductionLine = {
      ...current,
      status: dto.status,
      statusReason: dto.reason ?? '',
      updatedAt: timestamp(),
    };
    this.lines.set(id, updated);
    return updated;
  }

  remove(tenantId: string, id: string): { id: string; deleted: true } {
    this.findOne(tenantId, id);
    this.lines.delete(id);
    return { id, deleted: true };
  }

  private createSeed(
    id: string,
    tenantId: string,
    code: string,
    name: string,
    type: string,
    targetOee: number,
    status: ProductionLine['status'],
  ): ProductionLine {
    return {
      id,
      tenantId,
      factoryId: 'factory-demo',
      code,
      name,
      type,
      targetOee,
      status,
      statusReason: status === 'maintenance' ? '计划保养' : '',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
  }
}
