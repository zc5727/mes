import { AgvsService } from '../src/agvs/agvs.service';
import { AgentApiService } from '../src/agent-api/agent-api.service';
import { AlarmsService } from '../src/alarms/alarms.service';
import { DashboardService } from '../src/dashboard/dashboard.service';
import { DevicesService } from '../src/devices/devices.service';
import { MqttIngestionService } from '../src/mqtt/mqtt-ingestion.service';
import { ProductionLinesService } from '../src/production-lines/production-lines.service';
import { StrategyEngineService } from '../src/strategies/strategy-engine.service';
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
    expect(response.audit).toEqual(expect.objectContaining({
      tenantId: 'tenant-demo',
      requestedBy: 'nanobot',
      arguments: {},
    }));
    expect((response.data as { lines: { total: number } }).lines.total).toBe(4);
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
});
