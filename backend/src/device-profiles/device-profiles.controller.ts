import { Controller, Get, Param, Query } from '@nestjs/common';
import { DeviceProfileQueryDto } from './dto/device-profile-query.dto';
import { DeviceProfilesService } from './device-profiles.service';

@Controller('device-profiles')
export class DeviceProfilesController {
  constructor(private readonly service: DeviceProfilesService) {}

  @Get()
  list(@Query() query: DeviceProfileQueryDto): { data: ReturnType<DeviceProfilesService['list']> } {
    return { data: this.service.list(query.protocol) };
  }

  @Get(':key')
  findOne(
    @Param('key') key: string,
  ): { data: ReturnType<DeviceProfilesService['findOne']> } {
    return { data: this.service.findOne(key) };
  }
}
