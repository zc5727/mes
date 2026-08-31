import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createId, timestamp } from '../common/mock.types';
import { CreateBomDto, CreateCalendarDto, CreateOperationDto, CreateProcessDto, CreateProductDto, CreateRoutingDto, CreateShiftDto } from './dto/master-data.dto';

export interface MasterDataRecord { id: string; tenantId: string; code: string; name: string; type: 'product' | 'process' | 'shift' | 'calendar' | 'operation' | 'bom' | 'routing'; data: Record<string, unknown>; createdAt: string; updatedAt: string; }

@Injectable()
export class MasterDataService {
  private readonly records = new Map<string, MasterDataRecord[]>();

  list(tenantId: string, type: MasterDataRecord['type']): MasterDataRecord[] { return (this.records.get(tenantId) ?? []).filter((record) => record.type === type); }
  findOne(tenantId: string, type: MasterDataRecord['type'], id: string): MasterDataRecord { const record = this.list(tenantId, type).find((item) => item.id === id); if (!record) throw new NotFoundException(`${type} ${id} not found`); return record; }
  create(tenantId: string, type: MasterDataRecord['type'], dto: CreateProductDto | CreateProcessDto | CreateShiftDto | CreateCalendarDto | CreateOperationDto | CreateBomDto | CreateRoutingDto): MasterDataRecord {
    if (this.list(tenantId, type).some((record) => record.code === dto.code)) throw new ConflictException(`${type} code ${dto.code} already exists`);
    if (type === 'bom' || type === 'routing') {
      const operationCodes = 'operationCodes' in dto ? dto.operationCodes ?? [] : [];
      const knownCodes = new Set(this.list(tenantId, 'operation').map((operation) => operation.code));
      const missing = operationCodes.filter((code) => !knownCodes.has(code));
      if (missing.length) throw new ConflictException(`Unknown operation codes: ${missing.join(', ')}`);
    }
    const now = timestamp(); const record: MasterDataRecord = { id: createId(type), tenantId, code: dto.code, name: dto.name, type, data: { ...dto }, createdAt: now, updatedAt: now };
    this.records.set(tenantId, [...(this.records.get(tenantId) ?? []), record]); return record;
  }
}
