import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import {
  StrategyRequestContext,
  StrategyAction,
  StrategySnapshot,
  StrategySimulationResult,
} from './strategy.types';

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
}

export interface TrackedStrategySimulation {
  result: StrategySimulationResult;
  audit: StrategyCallRecord;
}

@Injectable()
export class StrategyGovernanceService {
  private readonly simulations = new Map<string, TrackedStrategySimulation>();

  constructor(private readonly auditService: AuditService) {}

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
    };
    this.simulations.set(this.key(tenantId, result.simulationId), { result, audit: record });
    return record;
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

  listCalls(tenantId: string): StrategyCallRecord[] {
    return [...this.simulations.values()]
      .filter((tracked) => tracked.audit.tenantId === tenantId)
      .map((tracked) => tracked.audit);
  }

  private createHighRiskApprovals(tenantId: string, result: StrategySimulationResult): string[] {
    return result.candidates
      .filter((candidate) => candidate.risk === 'high')
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
}
