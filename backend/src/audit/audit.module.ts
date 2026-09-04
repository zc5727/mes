import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { StrategyAuthorizationModule } from '../strategies/strategy-authorization.module';
import { AuditPersistenceService } from './audit-persistence.service';
import { AuditPersistenceInterceptor } from './audit-persistence.interceptor';

@Module({
  imports: [StrategyAuthorizationModule],
  controllers: [AuditController],
  providers: [
    AuditService,
    AuditPersistenceService,
    { provide: APP_INTERCEPTOR, useClass: AuditPersistenceInterceptor },
  ],
  exports: [
    AuditService,
    AuditPersistenceService,
    StrategyAuthorizationModule,
  ],
})
export class AuditModule {}
