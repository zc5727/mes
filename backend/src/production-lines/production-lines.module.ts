import { Module } from '@nestjs/common';
import { ProductionLinesController } from './production-lines.controller';
import { ProductionLinesService } from './production-lines.service';
import { FactoriesModule } from '../factories/factories.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  controllers: [ProductionLinesController],
  imports: [FactoriesModule, AuditModule],
  providers: [ProductionLinesService],
  exports: [ProductionLinesService],
})
export class ProductionLinesModule {}
