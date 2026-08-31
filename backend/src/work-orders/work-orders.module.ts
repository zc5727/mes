import { Module } from '@nestjs/common';
import { WorkOrdersController } from './work-orders.controller';
import { WorkOrdersService } from './work-orders.service';
import { OrdersModule } from '../orders/orders.module';
import { ProductionLinesModule } from '../production-lines/production-lines.module';
import { DevicesModule } from '../devices/devices.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  controllers: [WorkOrdersController],
  imports: [OrdersModule, ProductionLinesModule, DevicesModule, MasterDataModule, AuditModule],
  providers: [WorkOrdersService],
  exports: [WorkOrdersService],
})
export class WorkOrdersModule {}
