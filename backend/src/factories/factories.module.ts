import { Module } from '@nestjs/common';
import { FactoriesController } from './factories.controller';
import { FactoriesService } from './factories.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  controllers: [FactoriesController],
  imports: [AuditModule],
  providers: [FactoriesService],
  exports: [FactoriesService],
})
export class FactoriesModule {}
