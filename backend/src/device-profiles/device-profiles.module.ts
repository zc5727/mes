import { Module } from '@nestjs/common';
import { DeviceProfilesController } from './device-profiles.controller';
import { DeviceProfilesService } from './device-profiles.service';

@Module({
  controllers: [DeviceProfilesController],
  providers: [DeviceProfilesService],
  exports: [DeviceProfilesService],
})
export class DeviceProfilesModule {}
