import { Controller, Get, Param } from '@nestjs/common';
import { DeviceProfilesService } from './device-profiles.service';

@Controller('device-profiles')
export class DeviceProfilesController {
  constructor(private readonly service: DeviceProfilesService) {}

  @Get()
  list(): { data: ReturnType<DeviceProfilesService['list']> } {
    return { data: this.service.list() };
  }

  @Get(':key')
  findOne(
    @Param('key') key: string,
  ): { data: ReturnType<DeviceProfilesService['findOne']> } {
    return { data: this.service.findOne(key) };
  }
}
