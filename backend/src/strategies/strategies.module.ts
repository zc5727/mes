import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { StrategiesController } from './strategies.controller';
import { StrategyGovernanceService } from './strategy-governance.service';
import { StrategyAuthorizationService } from './strategy-authorization.service';
import { StrategyEngineService } from './strategy-engine.service';

@Module({
  imports: [AuditModule],
  controllers: [StrategiesController],
  providers: [StrategyEngineService, StrategyGovernanceService, StrategyAuthorizationService],
  exports: [StrategyEngineService, StrategyGovernanceService],
})
export class StrategiesModule {}
