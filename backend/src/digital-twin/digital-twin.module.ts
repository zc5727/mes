import { Module } from '@nestjs/common';
import { AlarmsModule } from '../alarms/alarms.module';
import { AgvsModule } from '../agvs/agvs.module';
import { DevicesModule } from '../devices/devices.module';
import { MqttModule } from '../mqtt/mqtt.module';
import { ProductionLinesModule } from '../production-lines/production-lines.module';
import { DigitalTwinController } from './digital-twin.controller';
import { DigitalTwinService } from './digital-twin.service';
import { DigitalTwinRealtimeService } from './digital-twin-realtime.service';

@Module({
  imports: [ProductionLinesModule, DevicesModule, AgvsModule, AlarmsModule, MqttModule],
  controllers: [DigitalTwinController],
  providers: [DigitalTwinService, DigitalTwinRealtimeService],
  exports: [DigitalTwinService],
})
export class DigitalTwinModule {}
