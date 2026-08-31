import 'reflect-metadata';
import { AGENT_READ_ONLY_TOOLS, createToolError, isReadOnlyAgentTool } from '../src/agent-api/tool-contract';

describe('nanobot read-only tool contract', () => {
  it('exposes exactly the planned query tools', () => {
    expect(AGENT_READ_ONLY_TOOLS).toEqual([
      'get_production_overview',
      'get_line_status',
      'get_device_status',
      'get_active_alarms',
      'get_work_order_progress',
      'get_delay_risk',
      'get_quality_records',
      'get_quality_issues',
      'get_maintenance_work_orders',
      'get_maintenance_plans',
      'get_inventory_batches',
      'get_spare_parts',
      'get_simulation_snapshot',
      'get_strategy_result',
      'get_strategy_history',
      'get_strategy_approval_status',
    ]);
  });

  it('rejects mutation and unknown tool names', () => {
    expect(isReadOnlyAgentTool('get_line_status')).toBe(true);
    expect(isReadOnlyAgentTool('stop_line')).toBe(false);
    expect(isReadOnlyAgentTool('execute_strategy')).toBe(false);
    expect(isReadOnlyAgentTool(undefined)).toBe(false);
  });

  it('returns a traceable, structured error response', () => {
    expect(createToolError('get_device_status', 'trace-001', 'DEVICE_NOT_FOUND', '设备不存在')).toEqual({
      ok: false,
      tool: 'get_device_status',
      traceId: 'trace-001',
      error: { code: 'DEVICE_NOT_FOUND', message: '设备不存在' },
    });
  });
});
