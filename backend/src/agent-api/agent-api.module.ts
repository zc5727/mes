import { Module } from '@nestjs/common';
import { AlarmsModule } from '../alarms/alarms.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { DevicesModule } from '../devices/devices.module';
import { MqttModule } from '../mqtt/mqtt.module';
import { ProductionLinesModule } from '../production-lines/production-lines.module';
import { StrategiesModule } from '../strategies/strategies.module';
import { AuditModule } from '../audit/audit.module';
import { WorkOrdersModule } from '../work-orders/work-orders.module';
import { QualityModule } from '../quality/quality.module';
import { MaintenanceModule } from '../maintenance/maintenance.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { AgentApiController } from './agent-api.controller';
import { AgentApiService } from './agent-api.service';

@Module({
  imports: [DashboardModule, ProductionLinesModule, DevicesModule, AlarmsModule, WorkOrdersModule, MqttModule, StrategiesModule, AuditModule, QualityModule, MaintenanceModule, MasterDataModule],
  controllers: [AgentApiController],
  // StrategyEngineService is owned and exported by StrategiesModule. Keeping
  // a second provider here would create two service instances and split the
  // strategy boundary between Agent API and the strategy controller.
  providers: [AgentApiService],
})
export class AgentApiModule {}
