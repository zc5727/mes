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
import { DigitalTwinModule } from './digital-twin/digital-twin.module';
import { MasterDataModule } from './master-data/master-data.module';
import { AuditModule } from './audit/audit.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { DatabaseModule } from './database/database.module';
import { DocumentsModule } from './documents/documents.module';
import { QualityModule } from './quality/quality.module';
import { DeviceConnectionsModule } from './device-connections/device-connections.module';

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
    DigitalTwinModule,
    MasterDataModule,
    AuditModule,
    MaintenanceModule,
    DatabaseModule,
    DocumentsModule,
    QualityModule,
    DeviceConnectionsModule,
  ],
})
export class AppModule {}
