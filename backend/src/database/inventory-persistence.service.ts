import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import type { BatchInventory } from '../master-data/master-data.service';

/** Durable repository for material batch inventory; the service keeps memory as an explicit demo adapter. */
@Injectable()
export class InventoryPersistenceService {
  private readonly logger = new Logger(InventoryPersistenceService.name);
  private writeChain: Promise<void> = Promise.resolve();
  private pendingError?: Error;

  constructor(private readonly prisma: PrismaService) {}

  /** Returns whether the application selected the PostgreSQL adapter. */
  isEnabled(): boolean {
    return this.prisma.enabled;
  }

  async restore(): Promise<BatchInventory[]> {
    await this.prisma.ensureConnection();
    if (!this.prisma.isReady()) {
      this.failIfRequired('restore batch inventory');
      return [];
    }
    try {
      const rows = await this.prisma.batchInventory.findMany();
      return rows.map((row) => ({
        id: row.id, tenantId: row.tenantId, materialCode: row.materialCode, batchNo: row.batchNo,
        quantity: Number(row.quantity), unit: row.unit, updatedAt: row.updatedAt.toISOString(),
      }));
    } catch (error: unknown) {
      this.failure('restore batch inventory', error);
      this.failIfRequired('restore batch inventory', error);
      return [];
    }
  }

  async save(batch: BatchInventory): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      await this.prisma.ensureConnection();
      if (!this.prisma.isReady()) {
        this.failIfRequired('persist batch inventory');
        return;
      }
      await this.prisma.batchInventory.upsert({
        where: { id: batch.id },
        create: this.data(batch),
        update: { materialCode: batch.materialCode, batchNo: batch.batchNo, quantity: new Prisma.Decimal(batch.quantity), unit: batch.unit, updatedAt: new Date(batch.updatedAt) },
      });
    }).catch((error: unknown) => { this.pendingError ??= this.toError(error); });
  }

  async saveMany(batches: BatchInventory[]): Promise<void> {
    if (batches.length === 0) return;
    this.writeChain = this.writeChain.then(async () => {
      await this.prisma.ensureConnection();
      if (!this.prisma.isReady()) {
        this.failIfRequired('persist batch inventory transaction');
        return;
      }
      const writes = batches.map((batch) => this.prisma.batchInventory.upsert({
        where: { id: batch.id },
        create: this.data(batch),
        update: { materialCode: batch.materialCode, batchNo: batch.batchNo, quantity: new Prisma.Decimal(batch.quantity), unit: batch.unit, updatedAt: new Date(batch.updatedAt) },
      }));
      await this.prisma.$transaction(writes);
    }).catch((error: unknown) => { this.pendingError ??= this.toError(error); });
  }

  /** Flush queued writes and fail closed when PostgreSQL is required. */
  async flush(): Promise<void> {
    const chain = this.writeChain;
    await chain;
    if (chain !== this.writeChain) {
      await this.flush();
      return;
    }
    const error = this.pendingError;
    this.pendingError = undefined;
    if (!error) return;
    this.failure('flush batch inventory persistence', error);
    this.failIfRequired('flush batch inventory persistence', error);
  }

  private data(batch: BatchInventory) {
    return {
      id: batch.id, tenantId: batch.tenantId, materialCode: batch.materialCode, batchNo: batch.batchNo,
      quantity: new Prisma.Decimal(batch.quantity), unit: batch.unit, updatedAt: new Date(batch.updatedAt),
    };
  }

  private failIfRequired(operation: string, error?: unknown): void {
    if (!this.prisma.required) return;
    const detail = error instanceof Error ? `: ${error.message}` : error ? `: ${String(error)}` : '';
    throw new Error(`PostgreSQL is required; ${operation} cannot continue${detail}`);
  }

  private failure(operation: string, error: unknown): void {
    this.logger.error(`${operation} failed; memory mode remains available: ${error instanceof Error ? error.message : String(error)}`);
  }

  private toError(error: unknown): Error { return error instanceof Error ? error : new Error(String(error)); }
}
