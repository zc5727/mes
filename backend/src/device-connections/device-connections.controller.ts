import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { TenantId } from '../common/tenant.decorator';
import { CreateDeviceConnectionDto, CreateUnifiedDeviceEventDto, UpdateDeviceConnectionDto } from './dto/device-connection.dto';
import { DeviceConnectionsService } from './device-connections.service';

@Controller('device-connections')
export class DeviceConnectionsController {
  constructor(private readonly service: DeviceConnectionsService) {}

  @Get()
  list(@TenantId() tenantId: string) { return { data: this.service.list(tenantId), tenantId }; }

  @Post()
  async create(@TenantId() tenantId: string, @Body() dto: CreateDeviceConnectionDto) { return { data: await this.service.create(tenantId, dto), tenantId }; }

  @Get(':id')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) { return { data: this.service.findOne(tenantId, id), tenantId }; }

  @Patch(':id')
  async update(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateDeviceConnectionDto) { return { data: await this.service.update(tenantId, id, dto), tenantId }; }

  @Post(':id/test')
  async test(@TenantId() tenantId: string, @Param('id') id: string) { return { data: await this.service.test(tenantId, id), tenantId }; }

  @Post(':id/start')
  async start(@TenantId() tenantId: string, @Param('id') id: string) { return { data: await this.service.start(tenantId, id), tenantId }; }

  @Post(':id/stop')
  async stop(@TenantId() tenantId: string, @Param('id') id: string) { return { data: await this.service.stop(tenantId, id), tenantId }; }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@TenantId() tenantId: string, @Param('id') id: string): Promise<void> { await this.service.delete(tenantId, id); }

  @Get(':id/health')
  health(@TenantId() tenantId: string, @Param('id') id: string) { return { data: this.service.health(tenantId, id), tenantId }; }

  @Get(':id/capabilities')
  capabilities(@TenantId() tenantId: string, @Param('id') id: string) { return { data: this.service.capabilities(tenantId, id), tenantId }; }

  @Get(':id/profile')
  profile(@TenantId() tenantId: string, @Param('id') id: string) { return { data: this.service.profile(tenantId, id), tenantId }; }

  @Get(':id/status-events')
  statusEvents(@TenantId() tenantId: string, @Param('id') id: string) { return { data: this.service.listStatusEvents(tenantId, id), tenantId }; }

  @Get(':id/events')
  events(@TenantId() tenantId: string, @Param('id') id: string) { return { data: this.service.listEvents(tenantId, id), tenantId }; }

  @Post(':id/events')
  ingestEvent(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: CreateUnifiedDeviceEventDto) { return { data: this.service.ingestEvent(tenantId, id, dto), tenantId }; }
}
