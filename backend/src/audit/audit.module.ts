import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { StrategyAuthorizationService } from '../strategies/strategy-authorization.service';

@Module({
  controllers: [AuditController],
  providers: [AuditService, StrategyAuthorizationService],
  exports: [AuditService],
})
export class AuditModule {}
