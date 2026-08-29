import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { StrategyEngineService } from './strategy-engine.service';
import { StrategySimulationResult, StrategySnapshot } from './strategy.types';
import { StrategySimulationDto } from './strategy-simulation.dto';

@Controller('strategies')
export class StrategiesController {
  constructor(private readonly strategyEngine: StrategyEngineService) {}

  @Post('simulate')
  @HttpCode(HttpStatus.OK)
  simulate(@Body() dto: StrategySimulationDto): { data: StrategySimulationResult } {
    // The engine receives a snapshot copy. It can only calculate suggestions;
    // this endpoint never writes devices, work orders, or production state.
    const snapshot: StrategySnapshot = {
      timestamp: dto.timestamp,
      lines: dto.lines.map((line) => ({ ...line })),
      devices: dto.devices.map((device) => ({ ...device })),
      workOrders: dto.workOrders.map((order) => ({ ...order })),
      materialShortages: dto.materialShortages?.map((item) => ({
        materialCode: item.materialCode,
        affectedWorkOrderIds: [...item.affectedWorkOrderIds],
      })),
    };

    return { data: this.strategyEngine.simulate(snapshot) };
  }
}
