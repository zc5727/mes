import { ConflictException, Injectable, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { FoundationPersistenceService } from '../database/foundation-persistence.service';
import { createId, timestamp } from '../common/mock.types';
import { CreateLocationDto, CreateMaterialDto, ListInventoryQuery, MaterialIssueDto, StockCountDto, StockReceiptDto } from './dto/inventory.dto';

type Material = { id: string; tenantId: string; factoryId: string; code: string; name: string; unit: string; createdAt: string };
type Location = { id: string; tenantId: string; factoryId: string; warehouseCode: string; locationCode: string; createdAt: string };
type Balance = { id: string; tenantId: string; factoryId: string; materialCode: string; batchNo: string; locationCode: string; quantity: number; updatedAt: string };
type Ledger = { id: string; tenantId: string; factoryId: string; type: 'receipt' | 'issue' | 'return' | 'count'; materialCode: string; batchNo: string; locationCode: string; quantity: number; delta: number; workOrderId: string | null; traceId: string; idempotencyKey: string; createdAt: string };
type CountVariance = Ledger & { type: 'count'; countedQuantity: number; variance: number };

@Injectable()
export class InventoryService implements OnModuleInit {
  private readonly materials = new Map<string, Material>();
  private readonly locations = new Map<string, Location>();
  private readonly balances = new Map<string, Balance>();
  private readonly ledger: Ledger[] = [];
  private readonly idempotency = new Map<string, Ledger>();
  private readonly factoryId = 'factory-demo';

  constructor(@Optional() private readonly persistence?: FoundationPersistenceService) {}

  async onModuleInit(): Promise<void> {
    const records = await this.persistence?.restoreAux('inventory-domain');
    records?.forEach((record) => {
      const payload = record.payload as { kind: string; value: Material | Location | Balance | Ledger };
      if (payload.kind === 'material') this.materials.set(`${record.tenantId}:${(payload.value as Material).code}`, payload.value as Material);
      if (payload.kind === 'location') this.locations.set(`${record.tenantId}:${(payload.value as Location).locationCode}`, payload.value as Location);
      if (payload.kind === 'balance') { const value = payload.value as Balance; this.balances.set(this.balanceKey(value.tenantId, value.materialCode, value.batchNo, value.locationCode), value); }
      if (payload.kind === 'ledger') { const value = payload.value as Ledger; this.ledger.push(value); this.idempotency.set(`${value.tenantId}:${value.idempotencyKey}`, value); }
    });
  }

  createMaterial(tenantId: string, factoryId: string, dto: CreateMaterialDto): Material { const key = `${tenantId}:${dto.code.trim()}`; if (this.materials.has(key)) throw new ConflictException('Material code already exists'); const value = { id: createId('material'), tenantId, factoryId: factoryId.trim(), code: dto.code.trim(), name: dto.name.trim(), unit: dto.unit.trim(), createdAt: timestamp() }; this.materials.set(key, value); this.save('material', value); return value; }
  listMaterials(tenantId: string, factoryId: string): Material[] { return [...this.materials.values()].filter((item) => item.tenantId === tenantId && item.factoryId === factoryId); }
  createLocation(tenantId: string, factoryId: string, dto: CreateLocationDto): Location { const key = `${tenantId}:${dto.locationCode.trim()}`; if (this.locations.has(key)) throw new ConflictException('Location code already exists'); const value = { id: createId('location'), tenantId, factoryId: factoryId.trim(), warehouseCode: dto.warehouseCode.trim(), locationCode: dto.locationCode.trim(), createdAt: timestamp() }; this.locations.set(key, value); this.save('location', value); return value; }
  listLocations(tenantId: string, factoryId: string): Location[] { return [...this.locations.values()].filter((item) => item.tenantId === tenantId && item.factoryId === factoryId); }

  receipt(tenantId: string, factoryId: string, dto: StockReceiptDto): Ledger { return this.mutate(tenantId, factoryId, dto, 'receipt', dto.quantity, null); }
  issue(tenantId: string, factoryId: string, dto: MaterialIssueDto): Ledger { return this.mutate(tenantId, factoryId, dto, 'issue', -dto.quantity, dto.workOrderId ?? null); }
  returnMaterial(tenantId: string, factoryId: string, dto: MaterialIssueDto): Ledger { return this.mutate(tenantId, factoryId, dto, 'return', dto.quantity, dto.workOrderId ?? null); }

  listBalances(tenantId: string, factoryId: string, query: ListInventoryQuery): Balance[] { return [...this.balances.values()].filter((item) => item.tenantId === tenantId && item.factoryId === factoryId && (!query.materialCode || item.materialCode === query.materialCode) && (!query.batchNo || item.batchNo === query.batchNo)); }
  count(tenantId: string, factoryId: string, dto: StockCountDto): CountVariance { const key = `${tenantId}:${dto.idempotencyKey?.trim() || createId('count')}`; const previous = this.idempotency.get(key); if (previous) return previous as CountVariance; const balance = this.getBalance(tenantId, factoryId, dto.materialCode, dto.batchNo, dto.locationCode); const variance = dto.countedQuantity - balance.quantity; const value = { id: createId('count'), tenantId, factoryId, type: 'count' as const, materialCode: dto.materialCode.trim(), batchNo: dto.batchNo.trim(), locationCode: dto.locationCode.trim(), quantity: balance.quantity, delta: variance, countedQuantity: dto.countedQuantity, variance, workOrderId: null, traceId: dto.idempotencyKey?.trim() || createId('trace'), idempotencyKey: dto.idempotencyKey?.trim() || createId('count-key'), createdAt: timestamp() }; this.ledger.push(value); this.idempotency.set(key, value); this.save('ledger', value); return value; }
  listLedger(tenantId: string, factoryId: string): Ledger[] { return this.ledger.filter((item) => item.tenantId === tenantId && item.factoryId === factoryId); }

  private mutate(tenantId: string, factoryId: string, dto: StockReceiptDto, type: Ledger['type'], delta: number, workOrderId: string | null): Ledger { const idempotencyKey = dto.idempotencyKey?.trim() || dto.traceId?.trim(); if (!idempotencyKey) throw new ConflictException('idempotencyKey or traceId is required'); const key = `${tenantId}:${idempotencyKey}`; const previous = this.idempotency.get(key); if (previous) return previous; this.materials.get(`${tenantId}:${dto.materialCode.trim()}`) || (() => { throw new NotFoundException(`Material ${dto.materialCode} not found`); })(); this.locations.get(`${tenantId}:${dto.locationCode.trim()}`) || (() => { throw new NotFoundException(`Location ${dto.locationCode} not found`); })(); const balance = this.getBalance(tenantId, factoryId, dto.materialCode, dto.batchNo, dto.locationCode); if (balance.quantity + delta < 0) throw new ConflictException('Negative inventory is not allowed'); const updated = { ...balance, quantity: balance.quantity + delta, updatedAt: timestamp() }; this.balances.set(this.balanceKey(tenantId, updated.materialCode, updated.batchNo, updated.locationCode), updated); const value: Ledger = { id: createId('movement'), tenantId, factoryId, type, materialCode: updated.materialCode, batchNo: updated.batchNo, locationCode: updated.locationCode, quantity: dto.quantity, delta, workOrderId, traceId: dto.traceId?.trim() || idempotencyKey, idempotencyKey, createdAt: timestamp() }; this.ledger.push(value); this.idempotency.set(key, value); this.save('balance', updated); this.save('ledger', value); return value; }
  private getBalance(tenantId: string, factoryId: string, materialCode: string, batchNo: string, locationCode: string): Balance { const key = this.balanceKey(tenantId, materialCode, batchNo, locationCode); const existing = this.balances.get(key); if (existing) return existing; return { id: createId('balance'), tenantId, factoryId, materialCode: materialCode.trim(), batchNo: batchNo.trim(), locationCode: locationCode.trim(), quantity: 0, updatedAt: timestamp() }; }
  private balanceKey(tenantId: string, materialCode: string, batchNo: string, locationCode: string): string { return `${tenantId}:${materialCode.trim()}:${batchNo.trim()}:${locationCode.trim()}`; }
  private save(kind: string, value: object): void { const item = value as { id: string; tenantId: string; createdAt?: string; updatedAt?: string }; void this.persistence?.saveAux({ id: `inventory:${kind}:${item.id}`, tenantId: item.tenantId, domain: 'inventory-domain', payload: { kind, value } as unknown as Record<string, unknown>, createdAt: item.createdAt ?? item.updatedAt ?? timestamp(), updatedAt: item.updatedAt ?? item.createdAt ?? timestamp() }); }
}
