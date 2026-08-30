import { Module } from '@nestjs/common';
import { DevicesModule } from '../devices/devices.module';
import { ProductionLinesModule } from '../production-lines/production-lines.module';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceService } from './maintenance.service';

@Module({ imports: [DevicesModule, ProductionLinesModule], controllers: [MaintenanceController], providers: [MaintenanceService], exports: [MaintenanceService] })
export class MaintenanceModule {}
