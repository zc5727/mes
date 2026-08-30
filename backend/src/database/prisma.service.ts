import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/** Optional PostgreSQL client. Memory mode remains the default for demos/tests. */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private connected = false;
  private connecting?: Promise<void>;
  readonly enabled = process.env.DATABASE_ENABLED === 'true';

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.log('PostgreSQL persistence disabled (DATABASE_ENABLED=false); memory mode is active');
      return;
    }
    await this.ensureConnection();
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.connected) return;
    await this.$disconnect();
    this.connected = false;
  }

  isReady(): boolean {
    return this.enabled && this.connected;
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
      this.logger.error(`PostgreSQL connection failed; memory mode will continue: ${this.errorMessage(error)}`);
    } finally {
      this.connecting = undefined;
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
