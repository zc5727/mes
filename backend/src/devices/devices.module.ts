import { Module } from '@nestjs/common';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { ProductionLinesModule } from '../production-lines/production-lines.module';

@Module({
  controllers: [DevicesController],
  imports: [ProductionLinesModule],
  providers: [DevicesService],
  exports: [DevicesService],
})
export class DevicesModule {}
