import { Module } from '@nestjs/common';
import { DevicesModule } from '../devices/devices.module';
import { ProductionLinesModule } from '../production-lines/production-lines.module';
import { WorkOrdersModule } from '../work-orders/work-orders.module';
import { QualityController } from './quality.controller';
import { QualityService } from './quality.service';

@Module({
  imports: [WorkOrdersModule, ProductionLinesModule, DevicesModule],
  controllers: [QualityController],
  providers: [QualityService],
  exports: [QualityService],
})
export class QualityModule {}
