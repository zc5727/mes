import { Module } from '@nestjs/common';
import { ProductionLinesController } from './production-lines.controller';
import { ProductionLinesService } from './production-lines.service';
import { FactoriesModule } from '../factories/factories.module';

@Module({
  controllers: [ProductionLinesController],
  imports: [FactoriesModule],
  providers: [ProductionLinesService],
  exports: [ProductionLinesService],
})
export class ProductionLinesModule {}
