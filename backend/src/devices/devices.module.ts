import { Module } from '@nestjs/common';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { ProductionLinesModule } from '../production-lines/production-lines.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  controllers: [DevicesController],
  imports: [ProductionLinesModule, AuditModule],
  providers: [DevicesService],
  exports: [DevicesService],
})
export class DevicesModule {}
