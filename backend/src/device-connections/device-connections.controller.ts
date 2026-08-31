import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { TenantId } from '../common/tenant.decorator';
import { CreateDeviceConnectionDto, CreateUnifiedDeviceEventDto, UpdateDeviceConnectionDto } from './dto/device-connection.dto';
import { DeviceConnectionsService } from './device-connections.service';

@Controller('device-connections')
export class DeviceConnectionsController {
  constructor(private readonly service: DeviceConnectionsService) {}

  @Get()
  list(@TenantId() tenantId: string) { return { data: this.service.list(tenantId), tenantId }; }

  @Post()
  create(@TenantId() tenantId: string, @Body() dto: CreateDeviceConnectionDto) { return { data: this.service.create(tenantId, dto), tenantId }; }

  @Get(':id')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) { return { data: this.service.findOne(tenantId, id), tenantId }; }

  @Patch(':id')
  update(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateDeviceConnectionDto) { return { data: this.service.update(tenantId, id, dto), tenantId }; }

  @Post(':id/test')
  async test(@TenantId() tenantId: string, @Param('id') id: string) { return { data: await this.service.test(tenantId, id), tenantId }; }

  @Post(':id/start')
  async start(@TenantId() tenantId: string, @Param('id') id: string) { return { data: await this.service.start(tenantId, id), tenantId }; }

  @Post(':id/stop')
  stop(@TenantId() tenantId: string, @Param('id') id: string) { return { data: this.service.stop(tenantId, id), tenantId }; }

  @Get(':id/health')
  health(@TenantId() tenantId: string, @Param('id') id: string) { return { data: this.service.health(tenantId, id), tenantId }; }

  @Get(':id/profile')
  profile(@TenantId() tenantId: string, @Param('id') id: string) { return { data: this.service.profile(tenantId, id), tenantId }; }

  @Get(':id/events')
  events(@TenantId() tenantId: string, @Param('id') id: string) { return { data: this.service.listEvents(tenantId, id), tenantId }; }

  @Post(':id/events')
  ingestEvent(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: CreateUnifiedDeviceEventDto) { return { data: this.service.ingestEvent(tenantId, id, dto), tenantId }; }
}
