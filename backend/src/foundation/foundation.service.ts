import { Injectable, NotFoundException } from '@nestjs/common';
import { createId, timestamp } from '../common/mock.types';

export interface FoundationRecord {
  id: string;
  tenantId: string;
  type: string;
  status: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class FoundationService {
  private readonly records = new Map<string, FoundationRecord[]>();

  list(tenantId: string, type: string): FoundationRecord[] {
    return this.records.get(tenantId)?.filter((record) => record.type === type) ?? [];
  }

  create(tenantId: string, type: string, data: Record<string, unknown>): FoundationRecord {
    const now = timestamp();
    const record: FoundationRecord = { id: createId(type), tenantId, type, status: 'draft', data, createdAt: now, updatedAt: now };
    this.records.set(tenantId, [...(this.records.get(tenantId) ?? []), record]);
    return record;
  }

  updateStatus(tenantId: string, type: string, id: string, status: string): FoundationRecord {
    const current = this.list(tenantId, type).find((record) => record.id === id);
    if (!current) throw new NotFoundException(`${type} ${id} not found`);
    const updated = { ...current, status, updatedAt: timestamp() };
    this.records.set(tenantId, this.list(tenantId, type).map((record) => record.id === id ? updated : record));
    return updated;
  }
}
