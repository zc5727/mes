import { Module } from '@nestjs/common';
import { ProductionLinesController } from './production-lines.controller';
import { ProductionLinesService } from './production-lines.service';

@Module({
  controllers: [ProductionLinesController],
  providers: [ProductionLinesService],
  exports: [ProductionLinesService],
})
export class ProductionLinesModule {}
