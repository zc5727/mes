import { AgvsService } from '../src/agvs/agvs.service';
import { AgentApiService } from '../src/agent-api/agent-api.service';
import { AlarmsService } from '../src/alarms/alarms.service';
import { DashboardService } from '../src/dashboard/dashboard.service';
import { DevicesService } from '../src/devices/devices.service';
import { MqttIngestionService } from '../src/mqtt/mqtt-ingestion.service';
import { ProductionLinesService } from '../src/production-lines/production-lines.service';
import { StrategyEngineService } from '../src/strategies/strategy-engine.service';
import { StrategyGovernanceService } from '../src/strategies/strategy-governance.service';
import { StrategyAuthorizationService } from '../src/strategies/strategy-authorization.service';
import { AuditService } from '../src/audit/audit.service';
import { WorkOrdersService } from '../src/work-orders/work-orders.service';

function createService(): AgentApiService {
  const lines = new ProductionLinesService();
  const devices = new DevicesService();
  const mqtt = new MqttIngestionService();
  const alarms = new AlarmsService(devices, mqtt);
  const workOrders = new WorkOrdersService();
  const dashboard = new DashboardService(lines, devices, workOrders, new AgvsService(), alarms, mqtt);
  return new AgentApiService(dashboard, lines, devices, alarms, workOrders, mqtt, new StrategyEngineService());
}

function createGovernedService(): AgentApiService {
  const lines = new ProductionLinesService();
  const devices = new DevicesService();
  const mqtt = new MqttIngestionService();
  const alarms = new AlarmsService(devices, mqtt);
  const workOrders = new WorkOrdersService();
  const dashboard = new DashboardService(lines, devices, workOrders, new AgvsService(), alarms, mqtt);
  return new AgentApiService(
    dashboard, lines, devices, alarms, workOrders, mqtt, new StrategyEngineService(),
    new StrategyGovernanceService(new AuditService()), new StrategyAuthorizationService(),
  );
}

describe('AgentApiService', () => {
  it('executes read-only production queries and includes audit metadata', () => {
    const service = createService();
    const response = service.execute({
      tool: 'get_production_overview',
      arguments: {},
      tenantId: 'tenant-demo',
      requestedBy: 'nanobot',
      traceId: 'trace-001',
    });

    expect(response.ok).toBe(true);
    expect(response.traceId).toBe('trace-001');
    expect(response.meta).toEqual(expect.objectContaining({
      source: 'mes', sourceTime: expect.any(String), permission: 'granted',
      sourceTimestamp: expect.any(String), permissionDecision: 'granted', requiresApproval: false,
    }));
    expect(response.audit).toEqual(expect.objectContaining({
      tenantId: 'tenant-demo',
      traceId: 'trace-001',
      requestedBy: 'nanobot',
      arguments: {},
    }));
    expect((response.data as { lines: { total: number } }).lines.total).toBe(4);
  });

  it('redacts sensitive Agent arguments and records session context', () => {
    const service = createService();
    const response = service.execute({
      tool: 'get_production_overview', arguments: { token: 'secret-value', nested: { password: 'hidden' } },
      tenantId: 'tenant-demo', requestedBy: 'nanobot', traceId: 'trace-redact',
      authorization: { userId: 'viewer', role: 'viewer', factoryId: 'factory-demo', scope: '*', sessionId: 'session-redact' },
    });
    expect(response.audit).toEqual(expect.objectContaining({ traceId: 'trace-redact', sessionId: 'session-redact' }));
    expect(response.audit?.arguments).toEqual({ token: '[REDACTED]', nested: { password: '[REDACTED]' } });
  });

  it('returns structured errors without exposing exceptions', () => {
    const response = createService().execute({
      tool: 'stop_line',
      arguments: { lineId: 'line-cnc' },
      tenantId: 'tenant-demo',
      traceId: 'trace-002',
    });

    expect(response).toEqual(expect.objectContaining({
      ok: false,
      tool: 'stop_line',
      traceId: 'trace-002',
      error: { code: 'UNKNOWN_TOOL', message: expect.any(String) },
      meta: expect.objectContaining({ permission: 'denied', sourceTime: expect.any(String), source: 'mes', permissionDecision: 'denied' }),
    }));
    expect(JSON.stringify(response)).not.toContain('stack');
  });

  it('keeps simulation snapshots and strategy results read-only and tenant-scoped', () => {
    const service = createService();
    const snapshotResponse = service.execute({
      tool: 'get_simulation_snapshot',
      arguments: {},
      tenantId: 'tenant-demo',
      traceId: 'trace-003',
    });
    const simulationId = (snapshotResponse.data as { simulationId: string }).simulationId;
    const resultResponse = service.execute({
      tool: 'get_strategy_result',
      arguments: { simulationId },
      tenantId: 'tenant-demo',
      traceId: 'trace-004',
    });

    expect(snapshotResponse.ok).toBe(true);
    expect(resultResponse.ok).toBe(true);
    expect((resultResponse.data as { simulationId: string }).simulationId).toBe(simulationId);
    expect(service.execute({
      tool: 'get_strategy_result',
      arguments: { simulationId },
      tenantId: 'other-tenant',
      traceId: 'trace-005',
    }).ok).toBe(false);
  });

  it('requires unified authorization and exposes governed history through read-only tools', () => {
    const service = createGovernedService();
    const denied = service.execute({
      tool: 'get_production_overview', arguments: {}, tenantId: 'tenant-demo', traceId: 'trace-auth-1',
    });
    expect(denied).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'AUTH_REQUIRED' }) }));

    const authorization = {
      userId: 'manager-1', role: 'plant_manager', factoryId: 'factory-demo', scope: '*', sessionId: 'session-1',
    };
    const snapshot = service.execute({
      tool: 'get_simulation_snapshot', arguments: {}, tenantId: 'tenant-demo', traceId: 'trace-auth-2', authorization,
    });
    expect(snapshot.ok).toBe(true);
    const history = service.execute({
      tool: 'get_strategy_history', arguments: {}, tenantId: 'tenant-demo', traceId: 'trace-auth-3', authorization,
    });
    expect(history.ok).toBe(true);
    expect((history.data as unknown[]).length).toBe(1);

    const outOfScope = service.execute({
      tool: 'get_line_status', arguments: { lineId: 'line-cnc' }, tenantId: 'tenant-demo',
      traceId: 'trace-auth-4', authorization: { ...authorization, role: 'production_supervisor', scope: 'line-not-allowed' },
    });
    expect(outOfScope).toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ code: 'AUTHORIZATION_DENIED', message: expect.stringContaining('RESOURCE_SCOPE_DENIED') }),
    }));
  });

  it('fails closed when a governed Agent call omits the required service account', () => {
    const previous = process.env.MES_AGENT_REQUIRE_SERVICE_ACCOUNT;
    process.env.MES_AGENT_REQUIRE_SERVICE_ACCOUNT = 'true';
    try {
      const response = createGovernedService().execute({
        tool: 'get_production_overview',
        arguments: {},
        tenantId: 'tenant-demo',
        traceId: 'trace-service-account',
        authorization: {
          userId: 'auditor-1',
          role: 'auditor',
          factoryId: 'factory-demo',
          scope: '*',
          sessionId: 'session-service-account',
        },
      });

      expect(response).toEqual(expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: 'AUTH_REQUIRED' }),
      }));
    } finally {
      if (previous === undefined) delete process.env.MES_AGENT_REQUIRE_SERVICE_ACCOUNT;
      else process.env.MES_AGENT_REQUIRE_SERVICE_ACCOUNT = previous;
    }
  });
});
