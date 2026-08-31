import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { StrategyAuthorizationService } from '../strategies/strategy-authorization.service';
import { AuditPersistenceService } from './audit-persistence.service';
import { AuditPersistenceInterceptor } from './audit-persistence.interceptor';

@Module({
  controllers: [AuditController],
  providers: [
    AuditService,
    StrategyAuthorizationService,
    AuditPersistenceService,
    { provide: APP_INTERCEPTOR, useClass: AuditPersistenceInterceptor },
  ],
  exports: [
    AuditService,
    StrategyAuthorizationService,
    AuditPersistenceService,
  ],
})
export class AuditModule {}
