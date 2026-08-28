import { Module } from '@nestjs/common';
import { WorkOrdersController } from './work-orders.controller';
import { WorkOrdersService } from './work-orders.service';
import { OrdersModule } from '../orders/orders.module';
import { ProductionLinesModule } from '../production-lines/production-lines.module';

@Module({
  controllers: [WorkOrdersController],
  imports: [OrdersModule, ProductionLinesModule],
  providers: [WorkOrdersService],
  exports: [WorkOrdersService],
})
export class WorkOrdersModule {}
