import { forwardRef, Module } from '@nestjs/common';
import { DevicesModule } from '../devices/devices.module';
import { MqttModule } from '../mqtt/mqtt.module';
import { AlarmsController } from './alarms.controller';
import { AlarmsService } from './alarms.service';
import { MaintenanceModule } from '../maintenance/maintenance.module';

@Module({
  imports: [DevicesModule, MqttModule, forwardRef(() => MaintenanceModule)],
  controllers: [AlarmsController],
  providers: [AlarmsService],
  exports: [AlarmsService],
})
export class AlarmsModule {}
