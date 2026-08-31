import { ConflictException, Injectable, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Approval, AuditService, GovernedAuditEntry } from '../audit/audit.service';
import {
  StrategyRequestContext,
  StrategyAction,
  StrategySnapshot,
  StrategySimulationResult,
  StrategyRollbackState,
  StrategyLifecycleStatus,
} from './strategy.types';
import { StrategyPersistenceService } from './strategy-persistence.service';

export interface StrategyCallRecord {
  callId: string;
  simulationId: string;
  tenantId: string;
  requestedBy: string;
  operator: string;
  object: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  reason: string;
  traceId: string;
  result: 'success' | 'denied';
  status: 'completed' | 'denied';
  createdAt: string;
  snapshotTimestamp: string;
  factoryId?: string;
  role?: string;
  scope?: string[];
  sessionId?: string;
  lineIds: string[];
  candidateCount: number;
  recommendedAction: StrategyAction | null;
  requiresApproval: true;
  executionAllowed: false;
  approvalIds: string[];
  riskLevels: Array<'low' | 'medium' | 'high'>;
  recommendedRisk: 'low' | 'medium' | 'high' | null;
  rollback: StrategyRollbackState;
  lifecycleStatus: StrategyLifecycleStatus;
}

export interface TrackedStrategySimulation {
  result: StrategySimulationResult;
  audit: StrategyCallRecord;
}

export interface StrategyReplayResult {
  replayId: string;
  sourceSimulationId: string;
  strategyVersion: string;
  deterministic: true;
  sourceTimestamp: string;
  result: StrategySimulationResult;
}

@Injectable()
export class StrategyGovernanceService implements OnModuleInit {
  private readonly simulations = new Map<string, TrackedStrategySimulation>();
  private readonly idempotency = new Map<string, { fingerprint: string; response: { data: StrategySimulationResult; audit: StrategyCallRecord } }>();

  constructor(
    private readonly auditService: AuditService,
    @Optional() private readonly persistence?: StrategyPersistenceService,
  ) {}

  async onModuleInit(): Promise<void> {
    const runs = await this.persistence?.restore() ?? [];
    runs.forEach((run) => {
      this.simulations.set(this.key(run.tenantId, run.result.simulationId), { result: run.result, audit: run.audit });
      this.auditService.restore(this.toAuditEntry(run.audit));
      run.approvals.forEach((approval) => this.auditService.restoreApproval(approval));
    });
  }

  recordSimulation(
    tenantId: string,
    requestedBy: string,
    snapshot: StrategySnapshot,
    result: StrategySimulationResult,
    context?: StrategyRequestContext,
  ): StrategyCallRecord {
    const lineIds = snapshot.lines.map((line) => line.id);
    const auditEntry = this.auditService.record(tenantId, requestedBy, {
      action: 'STRATEGY_SIMULATE',
      resource: 'strategy-simulation',
      resourceId: result.simulationId,
      operator: context?.userId ?? requestedBy,
      object: `strategy-simulation:${result.simulationId}`,
      before: { snapshotTimestamp: snapshot.timestamp, lineIds },
      after: {
        candidateCount: result.candidates.length,
        recommendedAction: result.recommended?.action ?? null,
        requiresApproval: true,
        executionAllowed: false,
      },
      reason: '生成只读策略建议，不改变生产状态',
      traceId: context?.traceId ?? `strategy-${result.simulationId}`,
      result: 'success',
      details: {
        factoryId: context?.factoryId,
        role: context?.role,
        scope: context?.scope,
        sessionId: context?.sessionId,
        snapshotTimestamp: snapshot.timestamp,
        candidateCount: result.candidates.length,
        recommendedAction: result.recommended?.action ?? null,
        requiresApproval: true,
        executionAllowed: false,
      },
    });
    const approvalIds = this.createHighRiskApprovals(tenantId, result);
    const record: StrategyCallRecord = {
      callId: auditEntry.id,
      simulationId: result.simulationId,
      tenantId,
      requestedBy,
      operator: auditEntry.operator,
      object: auditEntry.object,
      before: auditEntry.before ?? {},
      after: auditEntry.after ?? {},
      reason: auditEntry.reason,
      traceId: auditEntry.traceId,
      result: 'success',
      status: 'completed',
      createdAt: auditEntry.createdAt,
      snapshotTimestamp: snapshot.timestamp,
      factoryId: context?.factoryId,
      role: context?.role,
      scope: context?.scope,
      sessionId: context?.sessionId,
      lineIds,
      candidateCount: result.candidates.length,
      recommendedAction: result.recommended?.action ?? null,
      requiresApproval: true,
      executionAllowed: false,
      approvalIds,
      riskLevels: [...new Set(result.candidates.map((candidate) => candidate.risk))],
      recommendedRisk: result.recommended?.risk ?? null,
      rollback: { supported: true, action: 'discard_simulation', status: 'available', executionAllowed: false },
      lifecycleStatus: 'pending_approval',
    };
    this.simulations.set(this.key(tenantId, result.simulationId), { result, audit: record });
    void this.persistence?.save(tenantId, result, record, this.auditService.listApprovals(tenantId));
    return record;
  }

  fingerprint(snapshot: StrategySnapshot): string {
    return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  }

  getIdempotent(
    tenantId: string,
    idempotencyKey: string,
    fingerprint: string,
  ): { data: StrategySimulationResult; audit: StrategyCallRecord } | undefined {
    const key = this.idempotencyKey(tenantId, idempotencyKey);
    const stored = this.idempotency.get(key);
    if (!stored) return undefined;
    if (stored.fingerprint !== fingerprint) {
      throw new ConflictException('IDEMPOTENCY_KEY_REUSED: request payload differs from the original request');
    }
    return stored.response;
  }

  rememberIdempotent(
    tenantId: string,
    idempotencyKey: string,
    snapshot: StrategySnapshot,
    response: { data: StrategySimulationResult; audit: StrategyCallRecord },
  ): void {
    const key = this.idempotencyKey(tenantId, idempotencyKey);
    const existing = this.idempotency.get(key);
    const fingerprint = this.fingerprint(snapshot);
    if (existing && existing.fingerprint !== fingerprint) {
      throw new ConflictException('IDEMPOTENCY_KEY_REUSED: request payload differs from the original request');
    }
    this.idempotency.set(key, { fingerprint, response });
  }

  rollbackSimulation(
    tenantId: string,
    simulationId: string,
    requestedBy: string,
    traceId: string,
  ): TrackedStrategySimulation {
    const key = this.key(tenantId, simulationId);
    const tracked = this.simulations.get(key);
    if (!tracked) throw new NotFoundException(`Simulation ${simulationId} not found`);
    if (tracked.audit.rollback.status === 'discarded') return tracked;

    const discardedAt = new Date().toISOString();
    const auditEntry = this.auditService.record(tenantId, requestedBy, {
      action: 'STRATEGY_SIMULATION_ROLLBACK',
      resource: 'strategy-simulation',
      resourceId: simulationId,
      operator: requestedBy,
      object: `strategy-simulation:${simulationId}`,
      before: { simulationStatus: 'completed' },
      after: { simulationStatus: 'discarded', executionAllowed: false },
      reason: '丢弃仿真建议，不回写工单、产线或设备状态',
      traceId,
      result: 'success',
      details: { executionAllowed: false, rollbackOnly: true },
    });
    const updated: TrackedStrategySimulation = {
      result: tracked.result,
      audit: {
        ...tracked.audit,
        rollback: { ...tracked.audit.rollback, status: 'discarded', discardedAt, discardedBy: requestedBy },
      },
    };
    this.simulations.set(key, updated);
    void this.persistence?.save(tenantId, updated.result, updated.audit, this.auditService.listApprovals(tenantId));
    // Keep the original result and audit record addressable for traceability.
    void auditEntry;
    return updated;
  }

  recordDeniedSimulation(
    tenantId: string,
    requestedBy: string,
    reason: string,
    traceId: string,
  ): void {
    this.auditService.record(tenantId, requestedBy, {
      action: 'STRATEGY_SIMULATE',
      resource: 'strategy-simulation',
      operator: requestedBy,
      object: 'strategy-simulation',
      before: {},
      after: {},
      reason,
      traceId,
      result: 'denied',
      details: { requiresApproval: true, executionAllowed: false },
    });
  }

  getSimulation(tenantId: string, simulationId: string): TrackedStrategySimulation {
    const tracked = this.simulations.get(this.key(tenantId, simulationId));
    if (!tracked) throw new NotFoundException(`Simulation ${simulationId} not found`);
    return tracked;
  }

  replaySimulation(tenantId: string, simulationId: string, actor: string, traceId: string): StrategyReplayResult {
    const tracked = this.getSimulation(tenantId, simulationId);
    const replayId = `${simulationId}:replay`;
    this.auditService.record(tenantId, actor, {
      action: 'STRATEGY_REPLAY', resource: 'strategy-simulation', resourceId: simulationId,
      operator: actor, object: `strategy-simulation:${simulationId}`, before: {},
      after: { replayId, strategyVersion: tracked.result.strategyVersion, executionAllowed: false },
      reason: '按原始快照和策略版本重放仿真，不写入生产状态', traceId, result: 'success',
      details: { replayId, deterministic: true, strategyVersion: tracked.result.strategyVersion, executionAllowed: false },
    });
    return {
      replayId,
      sourceSimulationId: simulationId,
      strategyVersion: tracked.result.strategyVersion,
      deterministic: true,
      sourceTimestamp: tracked.result.snapshot.timestamp,
      result: tracked.result,
    };
  }

  listCalls(tenantId: string): StrategyCallRecord[] {
    return [...this.simulations.values()]
      .filter((tracked) => tracked.audit.tenantId === tenantId)
      .map((tracked) => tracked.audit);
  }

  listCallsForContext(tenantId: string, context: StrategyRequestContext): StrategyCallRecord[] {
    return this.listCalls(tenantId).filter((record) => {
      if (record.factoryId && record.factoryId !== context.factoryId) return false;
      if (context.role === 'system_admin' || context.role === 'plant_manager') return true;
      const scope = new Set(context.scope);
      return record.lineIds.every((lineId) => scope.has('*') || scope.has(lineId) || scope.has(`line:${lineId}`));
    });
  }

  listApprovalsForSimulation(tenantId: string, simulationId: string): Approval[] {
    const tracked = this.getSimulation(tenantId, simulationId);
    const approvalIds = new Set(tracked.audit.approvalIds);
    return this.auditService.listApprovals(tenantId).filter((approval) => approvalIds.has(approval.id));
  }

  decideApproval(tenantId: string, simulationId: string, approvalId: string, status: 'approved' | 'rejected', actor: string, traceId: string): TrackedStrategySimulation {
    const tracked = this.getSimulation(tenantId, simulationId);
    if (!tracked.audit.approvalIds.includes(approvalId)) throw new NotFoundException(`Approval ${approvalId} not found for simulation ${simulationId}`);
    this.auditService.decide(tenantId, approvalId, status);
    const lifecycleStatus = status === 'rejected' ? 'rejected' : this.lifecycleFor(tenantId, simulationId);
    return this.updateLifecycle(tenantId, simulationId, lifecycleStatus, actor, traceId, `策略建议审批${status === 'approved' ? '通过' : '拒绝'}`);
  }

  revokeSimulation(tenantId: string, simulationId: string, actor: string, traceId: string): TrackedStrategySimulation {
    const tracked = this.getSimulation(tenantId, simulationId);
    const lifecycle = this.lifecycleFor(tenantId, simulationId);
    if (lifecycle === 'revoked' || lifecycle === 'rejected' || lifecycle === 'simulated_execution') {
      throw new ConflictException(`STRATEGY_NOT_REVOCABLE: strategy is already ${lifecycle}`);
    }
    const approvals = this.listApprovalsForSimulation(tenantId, simulationId);
    approvals.filter((approval) => approval.status === 'pending' || approval.status === 'approved')
      .forEach((approval) => this.auditService.revoke(tenantId, approval.id));
    return this.updateLifecycle(tenantId, simulationId, 'revoked', actor, traceId, '撤销策略建议，不执行任何生产写入');
  }

  executeSimulation(tenantId: string, simulationId: string, actor: string, traceId: string): TrackedStrategySimulation {
    const tracked = this.getSimulation(tenantId, simulationId);
    if (this.lifecycleFor(tenantId, simulationId) !== 'approved') throw new ConflictException('STRATEGY_NOT_APPROVED: strategy must be approved before simulated execution');
    return this.updateLifecycle(tenantId, simulationId, 'simulated_execution', actor, traceId, '仅执行仿真副本，不控制真实设备或修改工单');
  }

  private createHighRiskApprovals(tenantId: string, result: StrategySimulationResult): string[] {
    return result.candidates
      .filter((candidate) => candidate.requiresApproval)
      .map((candidate) => {
        const existing = this.auditService.listApprovals(tenantId)
          .find((approval) => approval.resource === 'strategy-candidate' && approval.resourceId === candidate.id && approval.status === 'pending');
        return existing?.id ?? this.auditService.createApproval(tenantId, {
          resource: 'strategy-candidate',
          resourceId: candidate.id,
          comment: '高风险策略候选，执行前必须由授权审批人审批',
        }).id;
      });
  }

  private key(tenantId: string, simulationId: string): string {
    return `${tenantId}:${simulationId}`;
  }

  private idempotencyKey(tenantId: string, idempotencyKey: string): string {
    const normalized = idempotencyKey.trim();
    if (!normalized) throw new ConflictException('IDEMPOTENCY_KEY_INVALID: key must not be empty');
    return `${tenantId}:${normalized}`;
  }

  private lifecycleFor(tenantId: string, simulationId: string): StrategyLifecycleStatus {
    const tracked = this.simulations.get(this.key(tenantId, simulationId));
    if (tracked?.audit.lifecycleStatus === 'revoked' || tracked?.audit.lifecycleStatus === 'rejected') {
      return tracked.audit.lifecycleStatus;
    }
    const approvals = this.listApprovalsForSimulation(tenantId, simulationId);
    if (approvals.some((approval) => approval.status === 'revoked')) return 'revoked';
    if (approvals.some((approval) => approval.status === 'rejected')) return 'rejected';
    if (approvals.length === 0 || approvals.some((approval) => approval.status === 'pending')) return 'pending_approval';
    return 'approved';
  }

  private updateLifecycle(tenantId: string, simulationId: string, status: StrategyLifecycleStatus, actor: string, traceId: string, reason: string): TrackedStrategySimulation {
    const tracked = this.getSimulation(tenantId, simulationId);
    this.auditService.record(tenantId, actor, {
      action: `STRATEGY_${status.toUpperCase()}`,
      resource: 'strategy-simulation', resourceId: simulationId, operator: actor,
      object: `strategy-simulation:${simulationId}`, before: { lifecycleStatus: tracked.audit.lifecycleStatus },
      after: { lifecycleStatus: status, executionAllowed: false }, reason, traceId, result: 'success',
      details: { lifecycleStatus: status, executionAllowed: false },
    });
    const updated = { result: tracked.result, audit: { ...tracked.audit, lifecycleStatus: status } };
    this.simulations.set(this.key(tenantId, simulationId), updated);
    void this.persistence?.save(tenantId, updated.result, updated.audit, this.auditService.listApprovals(tenantId));
    return updated;
  }

  private toAuditEntry(record: StrategyCallRecord): GovernedAuditEntry {
    return {
      id: record.callId,
      tenantId: record.tenantId,
      actor: record.requestedBy,
      action: 'STRATEGY_SIMULATE',
      resource: 'strategy-simulation',
      resourceId: record.simulationId,
      details: { ...record.after, rollback: record.rollback },
      createdAt: record.createdAt,
      operator: record.operator,
      object: record.object,
      before: record.before,
      after: record.after,
      reason: record.reason,
      traceId: record.traceId,
      result: record.result,
    };
  }
}
