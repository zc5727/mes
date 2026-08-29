import { Module } from '@nestjs/common';
import { DevicesModule } from '../devices/devices.module';
import { MqttModule } from '../mqtt/mqtt.module';
import { AlarmsController } from './alarms.controller';
import { AlarmsService } from './alarms.service';

@Module({
  imports: [DevicesModule, MqttModule],
  controllers: [AlarmsController],
  providers: [AlarmsService],
  exports: [AlarmsService],
})
export class AlarmsModule {}
