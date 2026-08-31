import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { Approval } from '../audit/audit.service';
import type { StrategyCallRecord } from './strategy-governance.service';
import { StrategySimulationResult } from './strategy.types';

export interface PersistedStrategyRun {
  tenantId: string;
  result: StrategySimulationResult;
  audit: StrategyCallRecord;
  approvals: Approval[];
}

/** Durable repository for strategy history and its approval/audit projection. */
@Injectable()
export class StrategyPersistenceService {
  private readonly logger = new Logger(StrategyPersistenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async save(tenantId: string, result: StrategySimulationResult, audit: StrategyCallRecord, approvals: Approval[]): Promise<void> {
    try {
      await this.persist(tenantId, result, audit, approvals);
    } catch (error: unknown) {
      this.logger.error(`persist strategy run failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Persists a governed simulation synchronously at an HTTP command boundary. */
  async saveReliable(tenantId: string, result: StrategySimulationResult, audit: StrategyCallRecord, approvals: Approval[]): Promise<void> {
    await this.persist(tenantId, result, audit, approvals);
  }

  /** Fails before the governance projection is acknowledged when PostgreSQL is required. */
  async assertWritable(): Promise<void> {
    await this.prisma.ensureConnection();
    if (!this.prisma.isReady() && this.prisma.required) {
      throw new Error('PostgreSQL is required; strategy governance cannot continue');
    }
  }

  async restore(): Promise<PersistedStrategyRun[]> {
    await this.prisma.ensureConnection();
    if (!this.prisma.isReady()) return [];
    try {
      const rows = await this.prisma.strategyRun.findMany({ where: { governance: { not: Prisma.JsonNull } } });
      return rows.flatMap((row) => this.fromJson(row.tenantId, row.governance));
    } catch (error: unknown) {
      this.logger.error(`restore strategy runs failed: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  private fromJson(tenantId: string, value: unknown): PersistedStrategyRun[] {
    if (!value || typeof value !== 'object') return [];
    const item = value as { result?: StrategySimulationResult; audit?: StrategyCallRecord; approvals?: Approval[] };
    return item.result && item.audit ? [{ tenantId, result: item.result, audit: item.audit, approvals: item.approvals ?? [] }] : [];
  }

  private json(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
  }

  private async persist(tenantId: string, result: StrategySimulationResult, audit: StrategyCallRecord, approvals: Approval[]): Promise<void> {
    await this.prisma.ensureConnection();
    if (!this.prisma.isReady()) {
      if (this.prisma.required) throw new Error('PostgreSQL is required; strategy governance cannot continue');
      return;
    }
    const governance = this.json({ audit, approvals, result });
    await this.prisma.strategyRun.upsert({
      where: { tenantId_simulationId: { tenantId, simulationId: result.simulationId } },
      create: {
        id: result.simulationId,
        tenantId,
        simulationId: result.simulationId,
        snapshotAt: new Date(result.snapshot.timestamp),
        generatedAt: new Date(result.generatedAt),
        snapshot: this.json(result.snapshot),
        risks: this.json(result.risks),
        governance,
        candidates: { create: result.candidates.map((candidate) => ({
          id: candidate.id,
          action: candidate.action,
          risk: candidate.risk,
          affectedOrders: this.json(candidate.affectedOrders),
          fromLine: candidate.fromLine,
          toLine: candidate.toLine,
          expectedFinishTime: new Date(candidate.expectedFinishTime),
          expectedImpact: candidate.expectedImpact,
          reason: candidate.reason,
          requiresApproval: true,
          score: candidate.score,
        })) },
      },
      update: {
        snapshotAt: new Date(result.snapshot.timestamp),
        generatedAt: new Date(result.generatedAt),
        snapshot: this.json(result.snapshot),
        risks: this.json(result.risks),
        governance,
      },
    });
  }
}
