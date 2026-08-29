import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DevicesModule } from './devices/devices.module';
import { FactoriesModule } from './factories/factories.module';
import { HealthController } from './health.controller';
import { ProductionLinesModule } from './production-lines/production-lines.module';
import { TenantsModule } from './tenants/tenants.module';
import { WorkOrdersModule } from './work-orders/work-orders.module';
import { FoundationModule } from './foundation/foundation.module';
import { AgvsModule } from './agvs/agvs.module';
import { AlarmsModule } from './alarms/alarms.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { MqttModule } from './mqtt/mqtt.module';
import { AgentApiModule } from './agent-api/agent-api.module';
import { StrategiesModule } from './strategies/strategies.module';

@Module({
  controllers: [HealthController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TenantsModule,
    FactoriesModule,
    ProductionLinesModule,
    DevicesModule,
    WorkOrdersModule,
    FoundationModule,
    AgvsModule,
    AlarmsModule,
    DashboardModule,
    MqttModule,
    AgentApiModule,
    StrategiesModule,
  ],
})
export class AppModule {}
