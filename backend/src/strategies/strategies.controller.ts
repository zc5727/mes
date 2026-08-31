import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { TenantId } from '../common/tenant.decorator';
import { StrategyEngineService } from './strategy-engine.service';
import { StrategyGovernanceService } from './strategy-governance.service';
import { StrategyAuthorizationService } from './strategy-authorization.service';
import { StrategyRequestContext, StrategySimulationResult, StrategySnapshot } from './strategy.types';
import { StrategySimulationDto } from './strategy-simulation.dto';

@Controller('strategies')
export class StrategiesController {
  constructor(
    private readonly strategyEngine: StrategyEngineService,
    private readonly governance?: StrategyGovernanceService,
    private readonly authorization: StrategyAuthorizationService = new StrategyAuthorizationService(),
  ) {}

  @Post('simulate')
  @HttpCode(HttpStatus.OK)
  simulate(
    @TenantId() tenantIdOrDto: string | StrategySimulationDto,
    @Headers('x-user-id') userId?: string,
    @Headers('x-role') role?: string,
    @Headers('x-factory-id') factoryId?: string,
    @Headers('x-scope') scope?: string,
    @Headers('x-session-id') sessionId?: string,
    @Headers('x-trace-id') traceId?: string,
    @Body() dto?: StrategySimulationDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): { data: StrategySimulationResult; audit?: ReturnType<StrategyGovernanceService['recordSimulation']> } {
    // The single-argument form remains available for existing in-process callers;
    // HTTP requests use tenant/user headers and the validated body parameter.
    const legacyCall = typeof tenantIdOrDto !== 'string';
    const tenantId = legacyCall ? 'tenant-demo' : tenantIdOrDto;
    const input = legacyCall ? tenantIdOrDto : dto;
    if (!input) throw new Error('strategy simulation snapshot is required');
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
    if (!legacyCall && normalizedIdempotencyKey && this.governance) {
      const replay = this.governance.getIdempotent(
        tenantId,
        normalizedIdempotencyKey,
        this.governance.fingerprint(snapshot),
      );
      if (replay) return replay;
    }

    const result = this.strategyEngine.simulate(snapshot);
    const requestedBy = context?.userId || userId?.trim() || 'api-user';
    const audit = this.governance?.recordSimulation(tenantId, requestedBy, snapshot, result, context);
    if (audit) {
      const response = { data: result, audit };
      if (normalizedIdempotencyKey && this.governance) {
        this.governance.rememberIdempotent(tenantId, normalizedIdempotencyKey, snapshot, response);
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
    if (!this.governance) return { data: null, tenantId };
    const context = this.authorization.fromHeaders({ userId, role, factoryId, scope, sessionId, traceId });
    this.authorization.assertCanRollback(context);
    const tracked = this.governance.getSimulation(tenantId, simulationId);
    this.authorization.assertSnapshotAccess(context, tracked.result.snapshot);
    return {
      data: this.governance.rollbackSimulation(tenantId, simulationId, context.userId, context.traceId),
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
    if (!this.governance) return { data: null, tenantId };
    const context = this.authorization.fromHeaders({ userId, role, factoryId, scope, sessionId, traceId });
    this.authorization.assertCanRead(context);
    const tracked = this.governance.getSimulation(tenantId, simulationId);
    this.authorization.assertSnapshotAccess(context, tracked.result.snapshot);
    return { data: tracked, tenantId };
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
    const context = this.authorization.fromHeaders({ userId, role, factoryId, scope, sessionId, traceId });
    this.authorization.assertCanRead(context);
    return { data: this.governance?.listCallsForContext(tenantId, context) ?? [], tenantId };
  }

  @Get('history')
  history(
    @TenantId() tenantId: string,
    @Headers('x-user-id') userId?: string, @Headers('x-role') role?: string, @Headers('x-factory-id') factoryId?: string,
    @Headers('x-scope') scope?: string, @Headers('x-session-id') sessionId?: string, @Headers('x-trace-id') traceId?: string,
  ) {
    const context = this.requestContext(userId, role, factoryId, scope, sessionId, traceId);
    this.authorization.assertCanRead(context);
    return { data: this.governance?.listCallsForContext(tenantId, context) ?? [], tenantId };
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
    if (!this.governance) return { data: [], tenantId };
    const context = this.authorization.fromHeaders({ userId, role, factoryId, scope, sessionId, traceId });
    this.authorization.assertCanRead(context);
    const tracked = this.governance.getSimulation(tenantId, simulationId);
    this.authorization.assertSnapshotAccess(context, tracked.result.snapshot);
    return { data: this.governance.listApprovalsForSimulation(tenantId, simulationId), tenantId };
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
    const tracked = this.governance?.getSimulation(tenantId, simulationId);
    if (!tracked) return { data: null, tenantId };
    this.authorization.assertSnapshotAccess(context, tracked.result.snapshot);
    return { data: this.governance?.decideApproval(tenantId, simulationId, approvalId, 'approved', context.userId, context.traceId), tenantId };
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
    const tracked = this.governance?.getSimulation(tenantId, simulationId);
    if (!tracked) return { data: null, tenantId };
    this.authorization.assertSnapshotAccess(context, tracked.result.snapshot);
    return { data: this.governance?.decideApproval(tenantId, simulationId, approvalId, 'rejected', context.userId, context.traceId), tenantId };
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
    const tracked = this.governance?.getSimulation(tenantId, simulationId);
    if (!tracked) return { data: null, tenantId };
    this.authorization.assertSnapshotAccess(context, tracked.result.snapshot);
    return { data: this.governance?.revokeSimulation(tenantId, simulationId, context.userId, context.traceId), tenantId };
  }

  @Post('simulations/:simulationId/execute')
  @HttpCode(HttpStatus.OK)
  executeSimulation(
    @TenantId() tenantId: string, @Param('simulationId') simulationId: string,
    @Headers('x-user-id') userId?: string, @Headers('x-role') role?: string, @Headers('x-factory-id') factoryId?: string,
    @Headers('x-scope') scope?: string, @Headers('x-session-id') sessionId?: string, @Headers('x-trace-id') traceId?: string,
  ) {
    const context = this.requestContext(userId, role, factoryId, scope, sessionId, traceId);
    this.authorization.assertCanExecute(context);
    const tracked = this.governance?.getSimulation(tenantId, simulationId);
    if (!tracked) return { data: null, tenantId };
    this.authorization.assertSnapshotAccess(context, tracked.result.snapshot);
    return { data: this.governance?.executeSimulation(tenantId, simulationId, context.userId, context.traceId), tenantId };
  }

  @Post('simulations/:simulationId/replay')
  @HttpCode(HttpStatus.OK)
  replay(
    @TenantId() tenantId: string, @Param('simulationId') simulationId: string,
    @Headers('x-user-id') userId?: string, @Headers('x-role') role?: string, @Headers('x-factory-id') factoryId?: string,
    @Headers('x-scope') scope?: string, @Headers('x-session-id') sessionId?: string, @Headers('x-trace-id') traceId?: string,
  ) {
    const context = this.requestContext(userId, role, factoryId, scope, sessionId, traceId);
    this.authorization.assertCanRead(context);
    const tracked = this.governance?.getSimulation(tenantId, simulationId);
    if (!tracked) return { data: null, tenantId };
    this.authorization.assertSnapshotAccess(context, tracked.result.snapshot);
    return { data: this.governance?.replaySimulation(tenantId, simulationId, context.userId, context.traceId), tenantId };
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
    return { data: this.strategyEngine.preflight(snapshot), tenantId };
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
}
