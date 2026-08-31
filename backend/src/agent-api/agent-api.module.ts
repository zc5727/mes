import { Module } from '@nestjs/common';
import { AlarmsModule } from '../alarms/alarms.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { DevicesModule } from '../devices/devices.module';
import { MqttModule } from '../mqtt/mqtt.module';
import { ProductionLinesModule } from '../production-lines/production-lines.module';
import { StrategyEngineService } from '../strategies/strategy-engine.service';
import { StrategiesModule } from '../strategies/strategies.module';
import { WorkOrdersModule } from '../work-orders/work-orders.module';
import { AgentApiController } from './agent-api.controller';
import { AgentApiService } from './agent-api.service';

@Module({
  imports: [DashboardModule, ProductionLinesModule, DevicesModule, AlarmsModule, WorkOrdersModule, MqttModule, StrategiesModule],
  controllers: [AgentApiController],
  providers: [AgentApiService, StrategyEngineService],
})
export class AgentApiModule {}
