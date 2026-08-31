import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { StrategiesController } from './strategies.controller';
import { StrategyGovernanceService } from './strategy-governance.service';
import { StrategyAuthorizationService } from './strategy-authorization.service';
import { StrategyEngineService } from './strategy-engine.service';
import { StrategyPersistenceService } from './strategy-persistence.service';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [AuditModule, DatabaseModule],
  controllers: [StrategiesController],
  providers: [StrategyEngineService, StrategyGovernanceService, StrategyAuthorizationService, StrategyPersistenceService],
  exports: [StrategyEngineService, StrategyGovernanceService, StrategyAuthorizationService],
})
export class StrategiesModule {}
