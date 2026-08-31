import { Module } from '@nestjs/common';
import { DeviceProfilesController } from './device-profiles.controller';
import { DeviceProfilePersistenceService } from './device-profile-persistence.service';
import { DeviceProfilesService } from './device-profiles.service';

@Module({
  controllers: [DeviceProfilesController],
  providers: [DeviceProfilePersistenceService, DeviceProfilesService],
  exports: [DeviceProfilesService],
})
export class DeviceProfilesModule {}
