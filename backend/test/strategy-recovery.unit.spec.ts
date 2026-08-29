import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { StrategiesController } from '../src/strategies/strategies.controller';
import { StrategyEngineService } from '../src/strategies/strategy-engine.service';
import { StrategySimulationDto } from '../src/strategies/strategy-simulation.dto';

describe('strategy recovery drill', () => {
  it('covers fault, transfer advice, and recovery advice without changing the source snapshot', () => {
    const source = JSON.parse(readFileSync(
      resolve(__dirname, 'fixtures/strategy-four-line-fault.json'),
      'utf8',
    )) as StrategySimulationDto;
    const sourceBefore = JSON.stringify(source);
    const controller = new StrategiesController(new StrategyEngineService());

    const faultResult = controller.simulate(source).data;
    const transfer = faultResult.candidates.find((candidate) => candidate.action === 'transfer_work_order');

    expect(faultResult.risks.some((risk) => risk.message.includes('延期风险'))).toBe(true);
    expect(transfer).toEqual(expect.objectContaining({
      action: 'transfer_work_order',
      affectedOrders: ['WO-WELD-001'],
      requiresApproval: true,
    }));

    const recovered = {
      ...source,
      devices: source.devices.map((device) =>
        device.lineId === 'LINE-03' ? { ...device, status: 'online' as const } : { ...device },
      ),
      workOrders: source.workOrders.map((order) =>
        order.id === 'WO-WELD-001' ? { ...order, status: 'paused' as const } : { ...order },
      ),
    };
    const recoveryResult = controller.simulate(recovered).data;
    const recovery = recoveryResult.candidates.find((candidate) => candidate.action === 'schedule_recovery');

    expect(recovery).toEqual(expect.objectContaining({
      affectedOrders: ['WO-WELD-001'],
      toLine: 'LINE-03',
      requiresApproval: true,
    }));
    expect(sourceBefore).toBe(JSON.stringify(source));
    expect(faultResult.candidates.every((candidate) => candidate.requiresApproval)).toBe(true);
    expect(recoveryResult.candidates.every((candidate) => candidate.requiresApproval)).toBe(true);
  });
});
