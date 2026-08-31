/**
 * Read-only tool contract reserved for the local nanobot adapter.
 * The contract intentionally contains no command that can mutate production state.
 */
export const AGENT_READ_ONLY_TOOLS = [
  'get_production_overview',
  'get_line_status',
  'get_device_status',
  'get_active_alarms',
  'get_work_order_progress',
  'get_delay_risk',
  'get_simulation_snapshot',
  'get_strategy_result',
  'get_strategy_history',
  'get_strategy_approval_status',
] as const;

export type AgentReadOnlyTool = (typeof AGENT_READ_ONLY_TOOLS)[number];

export interface AgentToolRequest<TArguments extends Record<string, unknown> = Record<string, unknown>> {
  tool: AgentReadOnlyTool;
  arguments: TArguments;
  tenantId: string;
  requestedBy?: string;
  traceId: string;
  authorization?: AgentAuthorizationContext;
}

export interface AgentAuthorizationContext {
  userId: string;
  role: string;
  factoryId: string;
  scope: string[] | string;
  sessionId: string;
}

export interface ActiveAlarmsArguments {
  lineId?: string;
  deviceId?: string;
  level?: 'info' | 'warning' | 'critical';
}

export interface SimulationSnapshotArguments {
  simulationId?: string;
}

export interface AgentToolResponse<TData = unknown> {
  ok: boolean;
  tool: AgentReadOnlyTool | string;
  traceId: string;
  data?: TData;
  error?: { code: string; message: string };
  audit?: AgentToolAudit;
  meta?: AgentToolMeta;
}

export interface AgentToolMeta {
  source: 'mes' | 'strategy-governance' | 'audit';
  sourceTime: string;
  permission: 'granted' | 'denied';
}

export interface AgentToolAudit {
  calledAt: string;
  requestedBy?: string;
  tenantId: string;
  arguments: Record<string, unknown>;
}

export interface LineStatusArguments { lineId: string }
export interface DeviceStatusArguments { deviceId: string; lineId?: string }
export interface WorkOrderProgressArguments { workOrderId: string }
export interface DelayRiskArguments { workOrderId: string }
export interface StrategyResultArguments { simulationId: string }

export function isReadOnlyAgentTool(value: unknown): value is AgentReadOnlyTool {
  return typeof value === 'string' && (AGENT_READ_ONLY_TOOLS as readonly string[]).includes(value);
}

export function createToolError<TData>(
  tool: AgentReadOnlyTool | string,
  traceId: string,
  code: string,
  message: string,
): AgentToolResponse<TData> {
  return { ok: false, tool, traceId, error: { code, message } };
}
