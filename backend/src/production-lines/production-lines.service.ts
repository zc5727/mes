import { ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { createId, MockEntity, timestamp } from '../common/mock.types';
import { CreateProductionLineDto } from './dto/create-production-line.dto';
import { UpdateLineStatusDto } from './dto/update-line-status.dto';
import { UpdateProductionLineDto } from './dto/update-production-line.dto';
import { FactoriesService } from '../factories/factories.service';

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
  private readonly workOrderReferences = new Map<string, number>();

  constructor(@Optional() private readonly factoriesService: FactoriesService = new FactoriesService()) {}

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
    this.factoriesService.findOne(tenantId, dto.factoryId);
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
    if (dto.factoryId && dto.factoryId !== current.factoryId) {
      this.factoriesService.findOne(tenantId, dto.factoryId);
    }
    if (dto.code && dto.code !== current.code) {
      const duplicate = this.findAll(tenantId).some((line) => line.code === dto.code);
      if (duplicate) {
        throw new ConflictException(`Production line code ${dto.code} already exists`);
      }
    }
    if (dto.status && dto.status !== 'active' && !dto.reason?.trim()) {
      throw new ConflictException(`A reason is required when line is ${dto.status}`);
    }
    const updated: ProductionLine = {
      ...current,
      ...dto,
      statusReason: dto.status ? (dto.status === 'active' ? '' : dto.reason!.trim()) : current.statusReason,
      updatedAt: timestamp(),
    };
    this.lines.set(id, updated);
    return updated;
  }

  updateStatus(tenantId: string, id: string, dto: UpdateLineStatusDto): ProductionLine {
    const current = this.findOne(tenantId, id);
    if (dto.status !== 'active' && !dto.reason?.trim()) {
      throw new ConflictException(`A reason is required when line is ${dto.status}`);
    }
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
    const line = this.findOne(tenantId, id);
    if (line.status !== 'inactive') {
      throw new ConflictException('Only inactive production lines can be deleted');
    }
    if ((this.workOrderReferences.get(this.referenceKey(tenantId, id)) ?? 0) > 0) {
      throw new ConflictException('Production lines with work orders cannot be deleted');
    }
    this.lines.delete(id);
    return { id, deleted: true };
  }

  registerWorkOrder(tenantId: string, lineId: string): void {
    this.findOne(tenantId, lineId);
    const key = this.referenceKey(tenantId, lineId);
    this.workOrderReferences.set(key, (this.workOrderReferences.get(key) ?? 0) + 1);
  }

  unregisterWorkOrder(tenantId: string, lineId: string): void {
    const key = this.referenceKey(tenantId, lineId);
    const remaining = (this.workOrderReferences.get(key) ?? 0) - 1;
    if (remaining > 0) this.workOrderReferences.set(key, remaining);
    else this.workOrderReferences.delete(key);
  }

  private referenceKey(tenantId: string, lineId: string): string {
    return `${tenantId}:${lineId}`;
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
