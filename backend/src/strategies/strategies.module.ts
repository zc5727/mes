import { Module } from '@nestjs/common';
import { StrategiesController } from './strategies.controller';
import { StrategyEngineService } from './strategy-engine.service';

@Module({
  controllers: [StrategiesController],
  providers: [StrategyEngineService],
  exports: [StrategyEngineService],
})
export class StrategiesModule {}
