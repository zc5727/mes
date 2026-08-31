import { ForbiddenException, Injectable, NotFoundException, Optional, UnauthorizedException } from '@nestjs/common';
import { AlarmsService, AlarmFilters } from '../alarms/alarms.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { DevicesService } from '../devices/devices.service';
import { MqttIngestionService } from '../mqtt/mqtt-ingestion.service';
import { ProductionLinesService } from '../production-lines/production-lines.service';
import { StrategyEngineService } from '../strategies/strategy-engine.service';
import { StrategyGovernanceService } from '../strategies/strategy-governance.service';
import { StrategyAuthorizationService } from '../strategies/strategy-authorization.service';
import { StrategyRequestContext, StrategySnapshot, StrategySimulationResult } from '../strategies/strategy.types';
import { AuditService } from '../audit/audit.service';
import { WorkOrdersService } from '../work-orders/work-orders.service';
import {
  AGENT_READ_ONLY_TOOLS,
  AgentReadOnlyTool,
  AgentToolAudit,
  AgentToolRequest,
  AgentToolResponse,
  AgentAuthorizationContext,
  ActiveAlarmsArguments,
  createToolError,
  isReadOnlyAgentTool,
} from './tool-contract';

type RawAgentRequest = Omit<AgentToolRequest, 'tool'> & { tool: unknown };

@Injectable()
export class AgentApiService {
  private readonly simulations = new Map<string, StrategySimulationResult>();
  private readonly snapshots = new Map<string, StrategySnapshot>();
  private readonly simulationTenants = new Map<string, string>();

  constructor(
    private readonly dashboardService: DashboardService,
    private readonly productionLinesService: ProductionLinesService,
    private readonly devicesService: DevicesService,
    private readonly alarmsService: AlarmsService,
    private readonly workOrdersService: WorkOrdersService,
    private readonly mqttIngestionService: MqttIngestionService,
    private readonly strategyEngine: StrategyEngineService,
    @Optional() private readonly governance?: StrategyGovernanceService,
    @Optional() private readonly authorization?: StrategyAuthorizationService,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  execute(request: RawAgentRequest): AgentToolResponse {
    const traceId = this.normalizeTraceId(request.traceId);
    const args = this.normalizeArguments(request.arguments);
    const tenantId = typeof request.tenantId === 'string' && request.tenantId.trim() ? request.tenantId.trim() : 'unknown';
    const audit = this.audit(tenantId, request.requestedBy, args);

    if (!isReadOnlyAgentTool(request.tool)) {
      this.recordToolAudit(tenantId, request.requestedBy, String(request.tool ?? ''), traceId, 'denied', 'UNKNOWN_TOOL');
      return this.failure(String(request.tool ?? ''), traceId, 'UNKNOWN_TOOL', '工具不存在或不在只读工具白名单中', audit);
    }
    if (tenantId === 'unknown') {
      this.recordToolAudit(tenantId, request.requestedBy, request.tool, traceId, 'denied', 'INVALID_REQUEST');
      return this.failure(request.tool, traceId, 'INVALID_REQUEST', '参数 tenantId 不能为空', audit);
    }

    try {
      const context = this.authorize(request.authorization, tenantId, traceId);
      const data = this.dispatch(request.tool, tenantId, args, context);
      this.recordToolAudit(tenantId, context?.userId ?? request.requestedBy, request.tool, traceId, 'success');
      return {
        ok: true,
        tool: request.tool,
        traceId,
        data,
        audit,
        meta: this.toolMeta(request.tool, this.sourceTime(data, audit.calledAt), 'granted'),
      };
    } catch (error: unknown) {
      this.recordToolAudit(tenantId, request.requestedBy, request.tool, traceId, 'denied', this.errorCode(error));
      return this.failure(request.tool, traceId, this.errorCode(error), this.errorMessage(error), audit);
    }
  }

  listTools() {
    return AGENT_READ_ONLY_TOOLS.map((name) => ({ name, readOnly: true }));
  }

  private dispatch(tool: AgentReadOnlyTool, tenantId: string, args: Record<string, unknown>, context?: StrategyRequestContext): unknown {
    switch (tool) {
      case 'get_production_overview':
        this.assertFactoryOverviewAccess(tenantId, context);
        return this.dashboardService.getOverview(tenantId);
      case 'get_line_status':
        return this.lineStatus(tenantId, this.requiredArg(args, 'lineId'), context);
      case 'get_device_status':
        return this.deviceStatus(tenantId, args, context);
      case 'get_active_alarms':
        return this.activeAlarms(tenantId, args, context);
      case 'get_work_order_progress':
        return this.workOrderProgress(tenantId, this.requiredArg(args, 'workOrderId'), context);
      case 'get_delay_risk':
        return this.delayRisk(tenantId, this.requiredArg(args, 'workOrderId'), context);
      case 'get_simulation_snapshot':
        return this.simulationSnapshot(tenantId, args, context);
      case 'get_strategy_result':
        return this.strategyResult(tenantId, this.requiredArg(args, 'simulationId'), context);
      case 'get_strategy_history':
        return this.governance && context ? this.governance.listCallsForContext(tenantId, context) : [];
      case 'get_strategy_approval_status':
        return this.strategyApprovals(tenantId, this.requiredArg(args, 'simulationId'), context);
    }
  }

  private lineStatus(tenantId: string, lineId: string, context?: StrategyRequestContext) {
    this.assertResource(context, 'line', lineId);
    return this.dashboardService.getLineOverview(tenantId, lineId);
  }

  private deviceStatus(tenantId: string, args: Record<string, unknown>, context?: StrategyRequestContext) {
    const deviceId = this.requiredArg(args, 'deviceId');
    const device = this.devicesService.findOne(tenantId, deviceId);
    this.assertResource(context, 'device', deviceId, device.lineId);
    const lineId = typeof args.lineId === 'string' ? args.lineId : device.lineId;
    if (lineId !== device.lineId) throw new NotFoundException(`Device ${deviceId} not found on line ${lineId}`);
    return this.mqttIngestionService.getDevice(tenantId, device.lineId, deviceId) ?? device;
  }

  private activeAlarms(tenantId: string, args: Record<string, unknown>, context?: StrategyRequestContext) {
    if (typeof args.lineId === 'string') this.assertResource(context, 'line', args.lineId);
    if (typeof args.deviceId === 'string') this.assertResource(context, 'device', args.deviceId, typeof args.lineId === 'string' ? args.lineId : undefined);
    const filters: AlarmFilters = { status: 'active' };
    if (typeof args.lineId === 'string') filters.lineId = args.lineId;
    if (typeof args.deviceId === 'string') filters.deviceId = args.deviceId;
    if (args.level === 'info' || args.level === 'warning' || args.level === 'critical') filters.level = args.level;
    return this.alarmsService.findAll(tenantId, filters)
      .filter((alarm) => !context || this.canReadAlarm(context, alarm.lineId, alarm.sourceId));
  }

  private workOrderProgress(tenantId: string, workOrderId: string, context?: StrategyRequestContext) {
    const order = this.workOrdersService.findOne(tenantId, workOrderId);
    this.assertResource(context, 'workOrder', workOrderId, order.lineId);
    const remainingQty = Math.max(0, order.plannedQty - order.completedQty);
    return {
      workOrderId: order.id,
      orderNo: order.orderNo,
      lineId: order.lineId,
      productName: order.productName,
      status: order.status,
      plannedQty: order.plannedQty,
      completedQty: order.completedQty,
      remainingQty,
      completionRate: order.plannedQty ? Math.round((order.completedQty / order.plannedQty) * 1000) / 10 : 0,
      dueAt: order.dueAt,
    };
  }

  private authorize(input: AgentAuthorizationContext | undefined, tenantId: string, traceId: string): StrategyRequestContext | undefined {
    if (!this.governance || !this.authorization) return undefined;
    if (!input) throw new UnauthorizedException('AUTH_REQUIRED: Agent authorization context is required');
    const context = this.authorization.fromHeaders({
      userId: input.userId,
      role: input.role,
      factoryId: input.factoryId,
      scope: Array.isArray(input.scope) ? input.scope.join(',') : input.scope,
      sessionId: input.sessionId,
      traceId,
    });
    this.assertServiceAccountMinimumPrivilege(input, context.role);
    this.authorization.assertCanRead(context);
    return context;
  }

  private assertServiceAccountMinimumPrivilege(input: AgentAuthorizationContext, role: string): void {
    if (!input.serviceAccountId || process.env.MES_AGENT_REQUIRE_SERVICE_ACCOUNT !== 'true') return;
    const allowedRoles = (process.env.MES_AGENT_ALLOWED_ROLES ?? 'auditor')
      .split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
    if (!allowedRoles.includes(role)) {
      throw new ForbiddenException('SERVICE_ACCOUNT_ROLE_DENIED: Agent service accounts are limited to read-only roles');
    }
  }

  private assertResource(context: StrategyRequestContext | undefined, kind: string, id: string, lineId?: string): void {
    if (!context || !this.authorization) return;
    this.authorization.assertResourceAccess(context, kind, id, lineId);
  }

  private assertFactoryOverviewAccess(tenantId: string, context?: StrategyRequestContext): void {
    if (!context || !this.authorization) return;
    this.productionLinesService.findAll(tenantId).forEach((line) => {
      this.authorization?.assertResourceAccess(context, 'line', line.id);
    });
  }

  private canReadAlarm(context: StrategyRequestContext, lineId: string, deviceId: string): boolean {
    try {
      this.authorization?.assertResourceAccess(context, 'line', lineId);
      return true;
    } catch (error: unknown) {
      if (!(error instanceof ForbiddenException)) throw error;
      try {
        this.authorization?.assertResourceAccess(context, 'device', deviceId, lineId);
        return true;
      } catch (deviceError: unknown) {
        if (deviceError instanceof ForbiddenException) return false;
        throw deviceError;
      }
    }
  }

  private delayRisk(tenantId: string, workOrderId: string, context?: StrategyRequestContext) {
    const order = this.workOrdersService.findOne(tenantId, workOrderId);
    this.assertResource(context, 'workOrder', workOrderId, order.lineId);
    const remainingQty = Math.max(0, order.plannedQty - order.completedQty);
    const hoursUntilDue = (Date.parse(order.dueAt) - Date.now()) / 3_600_000;
    const estimatedHours = remainingQty / 10;
    const risk = order.status === 'completed' ? 'low' : hoursUntilDue < estimatedHours ? 'high' : hoursUntilDue < estimatedHours * 1.25 ? 'medium' : 'low';
    return { workOrderId: order.id, risk, hoursUntilDue: this.round(hoursUntilDue), estimatedHours: this.round(estimatedHours), remainingQty, dueAt: order.dueAt };
  }

  private simulationSnapshot(tenantId: string, args: Record<string, unknown>, context?: StrategyRequestContext) {
    const requestedId = typeof args.simulationId === 'string' ? args.simulationId : undefined;
    if (requestedId) {
      const governed = this.governance?.getSimulation(tenantId, requestedId);
      if (governed) {
        if (context && this.authorization) this.authorization.assertSnapshotAccess(context, governed.result.snapshot);
        return { simulationId: requestedId, ...governed.result.snapshot };
      }
      const snapshot = this.snapshots.get(requestedId);
      if (!snapshot) throw new NotFoundException(`Simulation ${requestedId} not found`);
      return { simulationId: requestedId, ...snapshot };
    }
    const snapshot = this.buildSnapshot(tenantId, context);
    if (context && this.authorization) this.authorization.assertSnapshotAccess(context, snapshot);
    const result = this.strategyEngine.simulate(snapshot);
    this.governance?.recordSimulation(tenantId, context?.userId ?? 'nanobot', snapshot, result, context);
    this.snapshots.set(result.simulationId, snapshot);
    this.simulations.set(result.simulationId, result);
    this.simulationTenants.set(result.simulationId, tenantId);
    return { simulationId: result.simulationId, ...snapshot };
  }

  private strategyResult(tenantId: string, simulationId: string, context?: StrategyRequestContext) {
    const governed = this.governance?.getSimulation(tenantId, simulationId);
    if (governed) {
      if (context && this.authorization) this.authorization.assertSnapshotAccess(context, governed.result.snapshot);
      return governed.result;
    }
    const cached = this.simulations.get(simulationId);
    if (cached && this.simulationTenants.get(simulationId) === tenantId) return cached;
    const result = this.strategyEngine.simulate(this.buildSnapshot(tenantId, context));
    if (result.simulationId !== simulationId) throw new NotFoundException(`Simulation ${simulationId} not found`);
    this.simulations.set(result.simulationId, result);
    this.simulationTenants.set(result.simulationId, tenantId);
    return result;
  }

  private strategyApprovals(tenantId: string, simulationId: string, context?: StrategyRequestContext) {
    if (!this.governance) return [];
    const tracked = this.governance.getSimulation(tenantId, simulationId);
    if (context && this.authorization) this.authorization.assertSnapshotAccess(context, tracked.result.snapshot);
    return this.governance.listApprovalsForSimulation(tenantId, simulationId);
  }

  private buildSnapshot(tenantId: string, context?: StrategyRequestContext): StrategySnapshot {
    const lines = this.productionLinesService.findAll(tenantId);
    const devices = this.devicesService.findAll(tenantId);
    const workOrders = this.workOrdersService.findAll(tenantId);
    return {
      timestamp: new Date().toISOString(),
      factoryId: context?.factoryId,
      lines: lines.map((line) => ({ id: line.id, name: line.name, capacityPerHour: 10, active: line.status === 'active' })),
      devices: devices.map((device) => ({ id: device.id, lineId: device.lineId, status: device.status, capacityPerHour: 10 })),
      workOrders: workOrders.map((order) => ({
        id: order.id,
        lineId: order.lineId,
        remainingQty: Math.max(0, order.plannedQty - order.completedQty),
        dueAt: order.dueAt,
        priority: order.priority === 'urgent' ? 4 : order.priority === 'high' ? 3 : order.priority === 'normal' ? 2 : 1,
        status: order.status === 'in_progress' ? 'running' : order.status === 'paused' ? 'paused' : 'released',
      })),
    };
  }

  private audit(tenantId: string, requestedBy: string | undefined, args: Record<string, unknown>): AgentToolAudit {
    return { calledAt: new Date().toISOString(), requestedBy, tenantId, arguments: this.maskSensitive(args) };
  }

  private maskSensitive(value: Record<string, unknown>): Record<string, unknown> {
    const configured = (process.env.MES_SENSITIVE_FIELDS ?? 'password,token,secret,apiKey,authorization')
      .split(',').map((field) => field.trim().toLowerCase()).filter(Boolean);
    const mask = (item: unknown): unknown => {
      if (Array.isArray(item)) return item.map(mask);
      if (!item || typeof item !== 'object') return item;
      return Object.fromEntries(Object.entries(item as Record<string, unknown>).map(([key, child]) => [
        key, configured.includes(key.toLowerCase()) ? '[REDACTED]' : mask(child),
      ]));
    };
    return mask(value) as Record<string, unknown>;
  }

  private failure(tool: AgentReadOnlyTool | string, traceId: string, code: string, message: string, audit: AgentToolAudit): AgentToolResponse {
    const response = createToolError(tool, traceId, code, message);
    return { ...response, audit, meta: this.toolMeta(tool, audit.calledAt, 'denied') };
  }

  private toolMeta(tool: AgentReadOnlyTool | string, sourceTimestamp: string, permissionDecision: 'granted' | 'denied') {
    return {
      source: this.sourceFor(tool), sourceTime: sourceTimestamp, permission: permissionDecision,
      sourceTimestamp, permissionDecision,
      requiresApproval: tool === 'get_strategy_result',
    } as const;
  }

  private sourceFor(tool: AgentReadOnlyTool | string): 'mes' | 'strategy-governance' | 'audit' {
    if (tool === 'get_strategy_history' || tool === 'get_strategy_result' || tool === 'get_simulation_snapshot' || tool === 'get_strategy_approval_status') {
      return 'strategy-governance';
    }
    return 'mes';
  }

  private sourceTime(data: unknown, fallback: string): string {
    if (Array.isArray(data)) {
      const first = data[0];
      if (first && typeof first === 'object') {
        const record = first as Record<string, unknown>;
        for (const field of ['createdAt', 'snapshotTimestamp', 'timestamp']) {
          if (typeof record[field] === 'string' && !Number.isNaN(Date.parse(record[field]))) return record[field];
        }
      }
      return fallback;
    }
    if (!data || typeof data !== 'object') return fallback;
    const record = data as Record<string, unknown>;
    for (const field of ['timestamp', 'generatedAt', 'occurredAt', 'updatedAt', 'dueAt']) {
      if (typeof record[field] === 'string' && !Number.isNaN(Date.parse(record[field]))) return record[field];
    }
    return fallback;
  }

  private recordToolAudit(
    tenantId: string,
    actor: string | undefined,
    tool: string,
    traceId: string,
    result: 'success' | 'denied',
    errorCode?: string,
  ): void {
    this.auditService?.record(tenantId, actor?.trim() || 'agent-gateway', {
      action: 'AGENT_TOOL_EXECUTE',
      resource: 'agent-tool',
      resourceId: traceId,
      traceId,
      result,
      reason: result === 'success' ? '受控只读工具调用' : `受控工具调用被拒绝: ${errorCode ?? 'TOOL_EXECUTION_ERROR'}`,
      details: { tool, permission: result === 'success' ? 'granted' : 'denied', errorCode },
    });
  }

  private requiredArg(args: Record<string, unknown>, name: string): string {
    const value = args[name];
    if (typeof value !== 'string' || !value.trim()) throw new Error(`参数 ${name} 不能为空`);
    return value.trim();
  }

  private normalizeArguments(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
  }

  private normalizeTraceId(value: unknown): string {
    return typeof value === 'string' && value.trim() ? value.trim() : `nanobot-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  private errorCode(error: unknown): string {
    if (error instanceof NotFoundException) return 'NOT_FOUND';
    if (error instanceof UnauthorizedException) return 'AUTH_REQUIRED';
    if (error instanceof ForbiddenException) return 'AUTHORIZATION_DENIED';
    return 'TOOL_EXECUTION_ERROR';
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : '工具执行失败';
  }

  private round(value: number): number {
    return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
  }
}
