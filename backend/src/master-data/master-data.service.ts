import { ConflictException, Injectable, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { createId, timestamp } from '../common/mock.types';
import { InventoryPersistenceService } from '../database/inventory-persistence.service';
import { BatchInventoryMovementDto, CreateBatchInventoryDto, CreateBomDto, CreateCalendarDto, CreateOperationDto, CreateProcessDto, CreateProductDto, CreateRoutingDto, CreateShiftDto } from './dto/master-data.dto';

export interface MasterDataRecord { id: string; tenantId: string; code: string; name: string; type: 'product' | 'process' | 'shift' | 'calendar' | 'operation' | 'bom' | 'routing'; data: Record<string, unknown>; createdAt: string; updatedAt: string; }
export interface BatchInventory { id: string; tenantId: string; materialCode: string; batchNo: string; quantity: number; unit: string | null; updatedAt: string; }

@Injectable()
export class MasterDataService implements OnModuleInit {
  private readonly records = new Map<string, MasterDataRecord[]>();
  private readonly batches = new Map<string, BatchInventory>();

  constructor(@Optional() private readonly inventoryPersistence?: InventoryPersistenceService) {}

  async onModuleInit(): Promise<void> {
    const batches = await this.inventoryPersistence?.restore();
    batches?.forEach((batch) => this.batches.set(this.batchKey(batch.tenantId, batch.materialCode, batch.batchNo), batch));
  }
  private readonly batchConsumptionKeys = new Set<string>();
  private readonly batchReturnKeys = new Set<string>();

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
    if (type === 'bom') {
      const bomItems = type === 'bom' ? (dto as CreateBomDto).items : [];
      for (const item of bomItems) {
        const materialCode = item.materialCode ?? item.code;
        const quantity = item.quantity ?? item.qty;
        if (typeof materialCode !== 'string' || typeof quantity !== 'number' || quantity <= 0) throw new ConflictException('BOM items require materialCode/code and positive quantity/qty');
      }
    }
    const now = timestamp(); const record: MasterDataRecord = { id: createId(type), tenantId, code: dto.code.trim(), name: dto.name.trim(), type, data: { ...dto }, createdAt: now, updatedAt: now };
    this.records.set(tenantId, [...(this.records.get(tenantId) ?? []), record]); return record;
  }

  createBatch(tenantId: string, dto: CreateBatchInventoryDto): BatchInventory {
    const key = `${tenantId}:${dto.materialCode.trim()}:${dto.batchNo.trim()}`;
    if (this.batches.has(key)) throw new ConflictException(`Batch ${dto.batchNo} already exists`);
    const batch: BatchInventory = { id: createId('batch'), tenantId, materialCode: dto.materialCode.trim(), batchNo: dto.batchNo.trim(), quantity: dto.quantity, unit: dto.unit?.trim() || null, updatedAt: timestamp() };
    this.batches.set(key, batch);
    void this.inventoryPersistence?.save(batch);
    return batch;
  }
  listBatches(tenantId: string): BatchInventory[] { return [...this.batches.values()].filter((batch) => batch.tenantId === tenantId); }
  consumeBatch(tenantId: string, materialCode: string, batchNo: string, quantity: number): BatchInventory {
    const batch = this.batches.get(`${tenantId}:${materialCode.trim()}:${batchNo.trim()}`);
    if (!batch) throw new ConflictException(`Material batch ${batchNo} not found`);
    if (batch.quantity < quantity) throw new ConflictException(`Insufficient material batch ${batchNo}`);
    const updated = { ...batch, quantity: batch.quantity - quantity, updatedAt: timestamp() };
    this.batches.set(this.batchKey(tenantId, materialCode, batchNo), updated);
    void this.inventoryPersistence?.save(updated);
    return updated;
  }
  consumeBatches(tenantId: string, consumptions: Array<{ materialCode: string; batchNo: string; quantity: number }>, idempotencyKey?: string): void {
    const operationKey = idempotencyKey?.trim() ? `${tenantId}:${idempotencyKey.trim()}` : undefined;
    if (operationKey && this.batchConsumptionKeys.has(operationKey)) return;
    const resolved = consumptions.map((item) => {
      const key = `${tenantId}:${item.materialCode.trim()}:${item.batchNo.trim()}`;
      const batch = this.batches.get(key);
      if (!batch) throw new ConflictException(`Material batch ${item.batchNo} not found`);
      if (batch.quantity < item.quantity) throw new ConflictException(`Insufficient material batch ${item.batchNo}`);
      return { key, batch, quantity: item.quantity };
    });
    resolved.forEach(({ key, batch, quantity }) => {
      const updated = { ...batch, quantity: batch.quantity - quantity, updatedAt: timestamp() };
      this.batches.set(key, updated);
      void this.inventoryPersistence?.save(updated);
    });
    if (operationKey) this.batchConsumptionKeys.add(operationKey);
  }
  returnBatch(tenantId: string, dto: BatchInventoryMovementDto): BatchInventory {
    const operationKey = dto.idempotencyKey?.trim() ? `${tenantId}:${dto.idempotencyKey.trim()}` : undefined;
    if (operationKey && this.batchReturnKeys.has(operationKey)) return this.batches.get(this.batchKey(tenantId, dto.materialCode, dto.batchNo))!;
    const key = this.batchKey(tenantId, dto.materialCode, dto.batchNo);
    const batch = this.batches.get(key);
    if (!batch) throw new ConflictException(`Material batch ${dto.batchNo} not found`);
    const updated = { ...batch, quantity: batch.quantity + dto.quantity, updatedAt: timestamp() };
    this.batches.set(key, updated); void this.inventoryPersistence?.save(updated);
    if (operationKey) this.batchReturnKeys.add(operationKey);
    return updated;
  }
  validateOperation(tenantId: string, routingId: string | undefined, operationCode: string): void {
    const operation = this.list(tenantId, 'operation').find((item) => item.code === operationCode);
    if (!operation) throw new ConflictException(`Unknown operation ${operationCode}`);
    if (routingId) {
      const routing = this.findOne(tenantId, 'routing', routingId);
      const codes = (routing.data.operationCodes as string[]) ?? [];
      if (!codes.includes(operationCode)) throw new ConflictException(`Operation ${operationCode} is not in routing`);
    }
  }

  private batchKey(tenantId: string, materialCode: string, batchNo: string): string {
    return `${tenantId}:${materialCode.trim()}:${batchNo.trim()}`;
  }
}
