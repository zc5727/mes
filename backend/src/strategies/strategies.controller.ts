import { RequireCapability } from '../common/route-capability.decorator';
import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, ServiceUnavailableException } from '@nestjs/common';
import { TenantId } from '../common/tenant.decorator';
import { StrategyEngineService } from './strategy-engine.service';
import { StrategyCallRecord, StrategyGovernanceService } from './strategy-governance.service';
import { StrategyAuthorizationService } from './strategy-authorization.service';
import { StrategyRequestContext, StrategySimulationResult, StrategySnapshot } from './strategy.types';
import {
  StrategyExecutionDto,
  StrategySimulationDto,
} from './strategy-simulation.dto';

@Controller('strategies')
@RequireCapability('control')
export class StrategiesController {
  constructor(
    private readonly strategyEngine: StrategyEngineService,
    private readonly governance?: StrategyGovernanceService,
    private readonly authorization: StrategyAuthorizationService = new StrategyAuthorizationService(),
  ) {}

  @Post('simulate')
  @HttpCode(HttpStatus.OK)
  async simulate(
    @TenantId() tenantIdOrDto: string | StrategySimulationDto,
    @Headers('x-user-id') userId?: string,
    @Headers('x-role') role?: string,
    @Headers('x-factory-id') factoryId?: string,
    @Headers('x-scope') scope?: string,
    @Headers('x-session-id') sessionId?: string,
    @Headers('x-trace-id') traceId?: string,
    @Body() dto?: StrategySimulationDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<{ data: StrategySimulationResult; audit?: StrategyCallRecord }> {
    // The single-argument form remains available for existing in-process callers;
    // HTTP requests use tenant/user headers and the validated body parameter.
    const legacyCall = typeof tenantIdOrDto !== 'string';
    const tenantId = legacyCall ? 'tenant-demo' : tenantIdOrDto;
    const input = legacyCall ? tenantIdOrDto : dto;
    if (!input) throw new Error('strategy simulation snapshot is required');
    const governance = legacyCall ? undefined : this.requireGovernance();
    // The engine receives a snapshot copy. It can only calculate suggestions;
    // this endpoint never writes devices, work orders, or production state.
    const snapshot: StrategySnapshot = {
      timestamp: input.timestamp,
      lines: input.lines.map((line) => ({ ...line })),
      devices: input.devices.map((device) => ({ ...device })),
      workOrders: input.workOrders.map((order) => ({ ...order })),
      materialShortages: input.materialShortages?.map((item) => ({
        materialCode: item.materialCode,
        affectedWorkOrderIds: [...item.affectedWorkOrderIds],
      })),
    };

    let context: StrategyRequestContext | undefined;
    if (!legacyCall) {
      try {
        context = this.authorization.fromHeaders({ userId, role, factoryId, scope, sessionId, traceId });
        this.authorization.assertCanSimulate(context, snapshot);
      } catch (error: unknown) {
        this.governance?.recordDeniedSimulation(
          tenantId,
          userId?.trim() || 'unknown',
          error instanceof Error ? error.message : 'strategy authorization failed',
          traceId?.trim() || 'missing-trace-id',
        );
        throw error;
      }
    }

    const normalizedIdempotencyKey = idempotencyKey?.trim();
    if (normalizedIdempotencyKey && governance) {
      const replay = governance.getIdempotent(
        tenantId,
        normalizedIdempotencyKey,
        governance.fingerprint(snapshot),
      );
      if (replay) return replay;
    }

    const result = this.strategyEngine.simulate(snapshot);
    const requestedBy = context?.userId || userId?.trim() || 'api-user';
    const audit = governance
      ? await governance.recordSimulationReliable(tenantId, requestedBy, snapshot, result, context, normalizedIdempotencyKey)
      : undefined;
    if (audit) {
      const response = { data: result, audit, traceId: audit.traceId };
      if (normalizedIdempotencyKey && governance) {
        governance.rememberIdempotent(tenantId, normalizedIdempotencyKey, snapshot, response);
      }
      return response;
    }
    return { data: result };
  }

  @Post('simulations/:simulationId/rollback')
  @HttpCode(HttpStatus.OK)
  rollbackSimulation(
    @TenantId() tenantId: string,
    @Param('simulationId') simulationId: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-role') role?: string,
    @Headers('x-factory-id') factoryId?: string,
    @Headers('x-scope') scope?: string,
    @Headers('x-session-id') sessionId?: string,
    @Headers('x-trace-id') traceId?: string,
  ) {
    const governance = this.requireGovernance();
    const context = this.authorization.fromHeaders({ userId, role, factoryId, scope, sessionId, traceId });
    this.authorization.assertCanRollback(context);
    const tracked = governance.getSimulation(tenantId, simulationId);
    this.authorization.assertSnapshotAccess(context, tracked.result.snapshot);
    return {
      data: governance.rollbackSimulation(tenantId, simulationId, context.userId, context.traceId), traceId: context.traceId,
      tenantId,
    };
  }

  @Get('simulations/:simulationId')
  getSimulation(
    @TenantId() tenantId: string,
    @Param('simulationId') simulationId: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-role') role?: string,
    @Headers('x-factory-id') factoryId?: string,
    @Headers('x-scope') scope?: string,
    @Headers('x-session-id') sessionId?: string,
    @Headers('x-trace-id') traceId?: string,
  ) {
    const governance = this.requireGovernance();
    const context = this.authorization.fromHeaders({ userId, role, factoryId, scope, sessionId, traceId });
    this.authorization.assertCanRead(context);
    const tracked = governance.getSimulation(tenantId, simulationId);
    this.authorization.assertSnapshotAccess(context, tracked.result.snapshot);
    return { data: tracked, tenantId, traceId: context.traceId };
  }

  @Get('audit-records')
  listAuditRecords(
    @TenantId() tenantId: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-role') role?: string,
    @Headers('x-factory-id') factoryId?: string,
    @Headers('x-scope') scope?: string,
    @Headers('x-session-id') sessionId?: string,
    @Headers('x-trace-id') traceId?: string,
  ) {
    const governance = this.requireGovernance();
    const context = this.authorization.fromHeaders({ userId, role, factoryId, scope, sessionId, traceId });
    this.authorization.assertCanRead(context);
    return { data: governance.listCallsForContext(tenantId, context), tenantId, traceId: context.traceId };
  }

  @Get('history')
  history(
    @TenantId() tenantId: string,
    @Headers('x-user-id') userId?: string, @Headers('x-role') role?: string, @Headers('x-factory-id') factoryId?: string,
    @Headers('x-scope') scope?: string, @Headers('x-session-id') sessionId?: string, @Headers('x-trace-id') traceId?: string,
  ) {
    const context = this.requestContext(userId, role, factoryId, scope, sessionId, traceId);
    this.authorization.assertCanRead(context);
    return { data: this.requireGovernance().listCallsForContext(tenantId, context), tenantId, traceId: context.traceId };
  }

  @Get('simulations/:simulationId/approvals')
  listSimulationApprovals(
    @TenantId() tenantId: string,
    @Param('simulationId') simulationId: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-role') role?: string,
    @Headers('x-factory-id') factoryId?: string,
    @Headers('x-scope') scope?: string,
    @Headers('x-session-id') sessionId?: string,
    @Headers('x-trace-id') traceId?: string,
  ) {
    const governance = this.requireGovernance();
    const context = this.authorization.fromHeaders({ userId, role, factoryId, scope, sessionId, traceId });
    this.authorization.assertCanRead(context);
    const tracked = governance.getSimulation(tenantId, simulationId);
    this.authorization.assertSnapshotAccess(context, tracked.result.snapshot);
    return { data: governance.listApprovalsForSimulation(tenantId, simulationId), tenantId, traceId: context.traceId };
  }

  @Post('simulations/:simulationId/approvals/:approvalId/approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @TenantId() tenantId: string, @Param('simulationId') simulationId: string, @Param('approvalId') approvalId: string,
    @Headers('x-user-id') userId?: string, @Headers('x-role') role?: string, @Headers('x-factory-id') factoryId?: string,
    @Headers('x-scope') scope?: string, @Headers('x-session-id') sessionId?: string, @Headers('x-trace-id') traceId?: string,
  ) {
    const context = this.requestContext(userId, role, factoryId, scope, sessionId, traceId);
    this.authorization.assertCanApprove(context);
    const governance = this.requireGovernance();
    const tracked = governance.getSimulation(tenantId, simulationId);
    this.authorization.assertSnapshotAccess(context, tracked.result.snapshot);
    return { data: governance.decideApproval(tenantId, simulationId, approvalId, 'approved', context.userId, context.traceId), tenantId, traceId: context.traceId };
  }

  @Post('simulations/:simulationId/approvals/:approvalId/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @TenantId() tenantId: string, @Param('simulationId') simulationId: string, @Param('approvalId') approvalId: string,
    @Headers('x-user-id') userId?: string, @Headers('x-role') role?: string, @Headers('x-factory-id') factoryId?: string,
    @Headers('x-scope') scope?: string, @Headers('x-session-id') sessionId?: string, @Headers('x-trace-id') traceId?: string,
  ) {
    const context = this.requestContext(userId, role, factoryId, scope, sessionId, traceId);
    this.authorization.assertCanApprove(context);
    const governance = this.requireGovernance();
    const tracked = governance.getSimulation(tenantId, simulationId);
    this.authorization.assertSnapshotAccess(context, tracked.result.snapshot);
    return { data: governance.decideApproval(tenantId, simulationId, approvalId, 'rejected', context.userId, context.traceId), tenantId, traceId: context.traceId };
  }

  @Post('simulations/:simulationId/revoke')
  @HttpCode(HttpStatus.OK)
  revoke(
    @TenantId() tenantId: string, @Param('simulationId') simulationId: string,
    @Headers('x-user-id') userId?: string, @Headers('x-role') role?: string, @Headers('x-factory-id') factoryId?: string,
    @Headers('x-scope') scope?: string, @Headers('x-session-id') sessionId?: string, @Headers('x-trace-id') traceId?: string,
  ) {
    const context = this.requestContext(userId, role, factoryId, scope, sessionId, traceId);
    this.authorization.assertCanApprove(context);
    const governance = this.requireGovernance();
    const tracked = governance.getSimulation(tenantId, simulationId);
    this.authorization.assertSnapshotAccess(context, tracked.result.snapshot);
    return { data: governance.revokeSimulation(tenantId, simulationId, context.userId, context.traceId), tenantId, traceId: context.traceId };
  }

  @Post('simulations/:simulationId/execute')
  @HttpCode(HttpStatus.OK)
  executeSimulation(
    @TenantId() tenantId: string, @Param('simulationId') simulationId: string,
    @Body() body: StrategyExecutionDto,
    @Headers('x-user-id') userId?: string, @Headers('x-role') role?: string, @Headers('x-factory-id') factoryId?: string,
    @Headers('x-scope') scope?: string, @Headers('x-session-id') sessionId?: string, @Headers('x-trace-id') traceId?: string,
  ) {
    const context = this.requestContext(userId, role, factoryId, scope, sessionId, traceId);
    this.authorization.assertCanExecute(context);
    const governance = this.requireGovernance();
    const tracked = governance.getSimulation(tenantId, simulationId);
    this.authorization.assertSnapshotAccess(context, tracked.result.snapshot);
    return {
      data: governance.executeSimulation(tenantId, simulationId, context.userId, context.traceId, body?.confirmationId, context.sessionId),
      tenantId,
      traceId: context.traceId,
    };
  }

  @Post('simulations/:simulationId/replay')
  @RequireCapability('read')
  @HttpCode(HttpStatus.OK)
  replay(
    @TenantId() tenantId: string, @Param('simulationId') simulationId: string,
    @Headers('x-user-id') userId?: string, @Headers('x-role') role?: string, @Headers('x-factory-id') factoryId?: string,
    @Headers('x-scope') scope?: string, @Headers('x-session-id') sessionId?: string, @Headers('x-trace-id') traceId?: string,
  ) {
    const context = this.requestContext(userId, role, factoryId, scope, sessionId, traceId);
    this.authorization.assertCanRead(context);
    const governance = this.requireGovernance();
    const tracked = governance.getSimulation(tenantId, simulationId);
    this.authorization.assertSnapshotAccess(context, tracked.result.snapshot);
    return { data: governance.replaySimulation(tenantId, simulationId, context.userId, context.traceId), tenantId, traceId: context.traceId };
  }

  @Post('preflight')
  preflight(
    @TenantId() tenantId: string,
    @Body() dto: StrategySimulationDto,
    @Headers('x-user-id') userId?: string,
    @Headers('x-role') role?: string,
    @Headers('x-factory-id') factoryId?: string,
    @Headers('x-scope') scope?: string,
    @Headers('x-session-id') sessionId?: string,
    @Headers('x-trace-id') traceId?: string,
  ) {
    const context = this.requestContext(userId, role, factoryId, scope, sessionId, traceId);
    const snapshot = this.toSnapshot(dto);
    this.authorization.assertCanSimulate(context, snapshot);
    return { data: this.strategyEngine.preflight(snapshot), tenantId, traceId: context.traceId };
  }

  private toSnapshot(input: StrategySimulationDto): StrategySnapshot {
    return {
      timestamp: input.timestamp,
      factoryId: input.factoryId,
      lines: input.lines.map((line) => ({ ...line })),
      devices: input.devices.map((device) => ({ ...device })),
      workOrders: input.workOrders.map((order) => ({ ...order })),
      materialShortages: input.materialShortages?.map((item) => ({
        ...item,
        affectedWorkOrderIds: [...item.affectedWorkOrderIds],
      })),
    };
  }

  private requestContext(userId?: string, role?: string, factoryId?: string, scope?: string, sessionId?: string, traceId?: string): StrategyRequestContext {
    return this.authorization.fromHeaders({ userId, role, factoryId, scope, sessionId, traceId });
  }

  private requireGovernance(): StrategyGovernanceService {
    if (!this.governance) {
      throw new ServiceUnavailableException(
        'STRATEGY_GOVERNANCE_UNAVAILABLE: governed strategy API is disabled',
      );
    }
    return this.governance;
  }
}
