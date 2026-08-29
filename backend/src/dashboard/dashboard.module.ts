import { Module } from '@nestjs/common';
import { AgvsModule } from '../agvs/agvs.module';
import { DevicesModule } from '../devices/devices.module';
import { ProductionLinesModule } from '../production-lines/production-lines.module';
import { WorkOrdersModule } from '../work-orders/work-orders.module';
import { AlarmsModule } from '../alarms/alarms.module';
import { MqttModule } from '../mqtt/mqtt.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [AgvsModule, DevicesModule, ProductionLinesModule, WorkOrdersModule, AlarmsModule, MqttModule],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
