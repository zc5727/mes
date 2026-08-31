import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/** Optional PostgreSQL client. Memory mode remains the default for demos/tests. */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private connected = false;
  private connecting?: Promise<void>;
  readonly enabled = process.env.DATABASE_ENABLED === 'true';
  readonly required = process.env.DATABASE_REQUIRED === 'true';
  private readonly requiredTables = [
    'factories', 'production_lines', 'devices', 'production_orders', 'work_orders',
    'work_order_reports', 'alarms', 'device_events', 'current_states', 'connection_events',
    'quality_records', 'maintenance_work_orders', 'document_records', 'batch_inventories',
  ];

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.log('PostgreSQL persistence disabled (DATABASE_ENABLED=false); memory mode is active');
      if (this.required) throw new Error('DATABASE_REQUIRED=true requires DATABASE_ENABLED=true');
      return;
    }
    await this.ensureConnection();
    if (this.required) {
      const state = await this.readiness();
      if (state.status !== 'ready') throw new Error('PostgreSQL is required but unavailable or not migrated; run npm run verify:postgres');
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.connected) return;
    await this.$disconnect();
    this.connected = false;
  }

  isReady(): boolean {
    return this.enabled && this.connected;
  }

  async readiness(): Promise<{ enabled: boolean; status: 'disabled' | 'ready' | 'unavailable' }> {
    await this.ensureConnection();
    if (!this.enabled) return { enabled: false, status: 'disabled' };
    if (!this.connected) return { enabled: true, status: 'unavailable' };
    try {
      const rows = await this.$queryRaw<Array<{ table_name: string }>>`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN (${Prisma.join(this.requiredTables)})`;
      const actual = new Set(rows.map((row) => row.table_name));
      return { enabled: true, status: this.requiredTables.every((table) => actual.has(table)) ? 'ready' : 'unavailable' };
    } catch {
      return { enabled: true, status: 'unavailable' };
    }
  }

  async ensureConnection(): Promise<void> {
    if (!this.enabled || this.connected) return;
    this.connecting ??= this.connectInternal();
    await this.connecting;
  }

  private async connectInternal(): Promise<void> {
    try {
      await this.$connect();
      this.connected = true;
      this.logger.log('PostgreSQL persistence connected');
    } catch (error: unknown) {
      this.logger.error(`PostgreSQL connection failed${this.required ? '; startup will fail because DATABASE_REQUIRED=true' : '; memory demo mode remains available'}: ${this.errorMessage(error)}`);
    } finally {
      this.connecting = undefined;
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
