import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { StrategiesController } from '../src/strategies/strategies.controller';
import { StrategyEngineService } from '../src/strategies/strategy-engine.service';
import { StrategySimulationDto } from '../src/strategies/strategy-simulation.dto';
import { AGENT_READ_ONLY_TOOLS } from '../src/agent-api/tool-contract';

describe('strategy fire drill fixture', () => {
  it('models four lines from device fault to delay risk and transfer advice', () => {
    const fixture = JSON.parse(readFileSync(
      resolve(__dirname, 'fixtures/strategy-four-line-fault.json'),
      'utf8',
    )) as StrategySimulationDto;
    const controller = new StrategiesController(new StrategyEngineService());

    const response = controller.simulate(fixture);
    const result = response.data;
    const transfer = result.candidates.find((candidate) => candidate.action === 'transfer_work_order');

    expect(fixture.lines).toHaveLength(4);
    expect(result.risks).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: 'high', message: expect.stringContaining('设备不可用') }),
      expect.objectContaining({ level: 'medium', message: expect.stringContaining('延期风险') }),
    ]));
    expect(transfer).toEqual(expect.objectContaining({
      affectedOrders: ['WO-WELD-001'],
      fromLine: 'LINE-03',
      requiresApproval: true,
    }));
    expect(transfer?.toLine).not.toBe('LINE-03');
    expect(result.recommended?.requiresApproval).toBe(true);
  });

  it('keeps the strategy API result shape compatible with the agent read-only result tool', () => {
    expect(AGENT_READ_ONLY_TOOLS).toContain('get_strategy_result');

    const fixture = JSON.parse(readFileSync(
      resolve(__dirname, 'fixtures/strategy-four-line-fault.json'),
      'utf8',
    )) as StrategySimulationDto;
    const result = new StrategiesController(new StrategyEngineService()).simulate(fixture).data;
    const agentResultFields = ['simulationId', 'generatedAt', 'risks', 'candidates', 'recommended'];
    const candidateFields = [
      'id', 'action', 'risk', 'affectedOrders', 'expectedFinishTime',
      'expectedImpact', 'reason', 'requiresApproval', 'score',
    ];

    expect(Object.keys(result).sort()).toEqual(agentResultFields.sort());
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(Object.keys(result.candidates[0]).sort()).toEqual([
      ...candidateFields,
      ...(result.candidates[0].fromLine ? ['fromLine'] : []),
      ...(result.candidates[0].toLine ? ['toLine'] : []),
    ].sort());
  });
});
