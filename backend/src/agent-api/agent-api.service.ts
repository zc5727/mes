import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { AlarmsService, AlarmFilters } from '../alarms/alarms.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { DevicesService } from '../devices/devices.service';
import { MqttIngestionService } from '../mqtt/mqtt-ingestion.service';
import { ProductionLinesService } from '../production-lines/production-lines.service';
import { StrategyEngineService } from '../strategies/strategy-engine.service';
import { StrategyGovernanceService } from '../strategies/strategy-governance.service';
import { StrategySnapshot, StrategySimulationResult } from '../strategies/strategy.types';
import { WorkOrdersService } from '../work-orders/work-orders.service';
import {
  AGENT_READ_ONLY_TOOLS,
  AgentReadOnlyTool,
  AgentToolAudit,
  AgentToolRequest,
  AgentToolResponse,
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
  ) {}

  execute(request: RawAgentRequest): AgentToolResponse {
    const traceId = this.normalizeTraceId(request.traceId);
    const args = this.normalizeArguments(request.arguments);
    const tenantId = typeof request.tenantId === 'string' && request.tenantId.trim() ? request.tenantId.trim() : 'unknown';
    const audit = this.audit(tenantId, request.requestedBy, args);

    if (!isReadOnlyAgentTool(request.tool)) {
      return this.failure(String(request.tool ?? ''), traceId, 'UNKNOWN_TOOL', '工具不存在或不在只读工具白名单中', audit);
    }
    if (tenantId === 'unknown') return this.failure(request.tool, traceId, 'INVALID_REQUEST', '参数 tenantId 不能为空', audit);

    try {
      const data = this.dispatch(request.tool, tenantId, args);
      return { ok: true, tool: request.tool, traceId, data, audit };
    } catch (error: unknown) {
      return this.failure(request.tool, traceId, this.errorCode(error), this.errorMessage(error), audit);
    }
  }

  listTools() {
    return AGENT_READ_ONLY_TOOLS.map((name) => ({ name, readOnly: true }));
  }

  private dispatch(tool: AgentReadOnlyTool, tenantId: string, args: Record<string, unknown>): unknown {
    switch (tool) {
      case 'get_production_overview':
        return this.dashboardService.getOverview(tenantId);
      case 'get_line_status':
        return this.dashboardService.getLineOverview(tenantId, this.requiredArg(args, 'lineId'));
      case 'get_device_status':
        return this.deviceStatus(tenantId, args);
      case 'get_active_alarms':
        return this.activeAlarms(tenantId, args);
      case 'get_work_order_progress':
        return this.workOrderProgress(tenantId, this.requiredArg(args, 'workOrderId'));
      case 'get_delay_risk':
        return this.delayRisk(tenantId, this.requiredArg(args, 'workOrderId'));
      case 'get_simulation_snapshot':
        return this.simulationSnapshot(tenantId, args);
    case 'get_strategy_result':
        return this.strategyResult(tenantId, this.requiredArg(args, 'simulationId'));
      case 'get_strategy_history':
        return this.governance?.listCalls(tenantId) ?? [];
      case 'get_strategy_approval_status':
        return this.governance?.listApprovalsForSimulation(tenantId, this.requiredArg(args, 'simulationId')) ?? [];
    }
  }

  private deviceStatus(tenantId: string, args: Record<string, unknown>) {
    const deviceId = this.requiredArg(args, 'deviceId');
    const device = this.devicesService.findOne(tenantId, deviceId);
    const lineId = typeof args.lineId === 'string' ? args.lineId : device.lineId;
    if (lineId !== device.lineId) throw new NotFoundException(`Device ${deviceId} not found on line ${lineId}`);
    return this.mqttIngestionService.getDevice(tenantId, device.lineId, deviceId) ?? device;
  }

  private activeAlarms(tenantId: string, args: Record<string, unknown>) {
    const filters: AlarmFilters = { status: 'active' };
    if (typeof args.lineId === 'string') filters.lineId = args.lineId;
    if (typeof args.deviceId === 'string') filters.deviceId = args.deviceId;
    if (args.level === 'info' || args.level === 'warning' || args.level === 'critical') filters.level = args.level;
    return this.alarmsService.findAll(tenantId, filters);
  }

  private workOrderProgress(tenantId: string, workOrderId: string) {
    const order = this.workOrdersService.findOne(tenantId, workOrderId);
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

  private delayRisk(tenantId: string, workOrderId: string) {
    const order = this.workOrdersService.findOne(tenantId, workOrderId);
    const remainingQty = Math.max(0, order.plannedQty - order.completedQty);
    const hoursUntilDue = (Date.parse(order.dueAt) - Date.now()) / 3_600_000;
    const estimatedHours = remainingQty / 10;
    const risk = order.status === 'completed' ? 'low' : hoursUntilDue < estimatedHours ? 'high' : hoursUntilDue < estimatedHours * 1.25 ? 'medium' : 'low';
    return { workOrderId: order.id, risk, hoursUntilDue: this.round(hoursUntilDue), estimatedHours: this.round(estimatedHours), remainingQty, dueAt: order.dueAt };
  }

  private simulationSnapshot(tenantId: string, args: Record<string, unknown>) {
    const requestedId = typeof args.simulationId === 'string' ? args.simulationId : undefined;
    if (requestedId) {
      const governed = this.governance?.getSimulation(tenantId, requestedId);
      if (governed) return { simulationId: requestedId, ...governed.result.snapshot };
      const snapshot = this.snapshots.get(requestedId);
      if (!snapshot) throw new NotFoundException(`Simulation ${requestedId} not found`);
      return { simulationId: requestedId, ...snapshot };
    }
    const snapshot = this.buildSnapshot(tenantId);
    const result = this.strategyEngine.simulate(snapshot);
    this.governance?.recordSimulation(tenantId, 'nanobot', snapshot, result);
    this.snapshots.set(result.simulationId, snapshot);
    this.simulations.set(result.simulationId, result);
    this.simulationTenants.set(result.simulationId, tenantId);
    return { simulationId: result.simulationId, ...snapshot };
  }

  private strategyResult(tenantId: string, simulationId: string) {
    const governed = this.governance?.getSimulation(tenantId, simulationId);
    if (governed) return governed.result;
    const cached = this.simulations.get(simulationId);
    if (cached && this.simulationTenants.get(simulationId) === tenantId) return cached;
    const result = this.strategyEngine.simulate(this.buildSnapshot(tenantId));
    if (result.simulationId !== simulationId) throw new NotFoundException(`Simulation ${simulationId} not found`);
    this.simulations.set(result.simulationId, result);
    this.simulationTenants.set(result.simulationId, tenantId);
    return result;
  }

  private buildSnapshot(tenantId: string): StrategySnapshot {
    const lines = this.productionLinesService.findAll(tenantId);
    const devices = this.devicesService.findAll(tenantId);
    const workOrders = this.workOrdersService.findAll(tenantId);
    return {
      timestamp: new Date().toISOString(),
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
    return { calledAt: new Date().toISOString(), requestedBy, tenantId, arguments: { ...args } };
  }

  private failure(tool: AgentReadOnlyTool | string, traceId: string, code: string, message: string, audit: AgentToolAudit): AgentToolResponse {
    const response = createToolError(tool, traceId, code, message);
    return { ...response, audit };
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
    return 'TOOL_EXECUTION_ERROR';
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : '工具执行失败';
  }

  private round(value: number): number {
    return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
  }
}
