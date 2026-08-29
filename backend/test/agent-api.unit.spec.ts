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
      'get_simulation_snapshot',
      'get_strategy_result',
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
