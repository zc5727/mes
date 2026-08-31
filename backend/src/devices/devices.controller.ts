import { RequireCapability } from '../common/route-capability.decorator';
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { TenantId } from '../common/tenant.decorator';
import { CreateDeviceDto } from './dto/create-device.dto';
import { IngestTelemetryDto } from './dto/ingest-telemetry.dto';
import { UpdateDeviceStatusDto } from './dto/update-device-status.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { DevicesService } from './devices.service';

@Controller('devices')
@RequireCapability('control')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Get('overview')
  overview(@TenantId() tenantId: string) {
    return { data: this.devicesService.findOverview(tenantId), tenantId };
  }

  @Get()
  findAll(@TenantId() tenantId: string, @Query('lineId') lineId?: string) {
    return { data: this.devicesService.findAll(tenantId, lineId), tenantId };
  }

  @Get(':id')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return { data: this.devicesService.findOne(tenantId, id), tenantId };
  }

  @Post()
  @RequireCapability('write')
  async create(@TenantId() tenantId: string, @Body() dto: CreateDeviceDto) {
    return { data: await this.devicesService.createReliable(tenantId, dto), tenantId };
  }

  @Patch(':id/status')
  @RequireCapability('write')
  async updateStatus(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateDeviceStatusDto) {
    return { data: await this.devicesService.updateStatusReliable(tenantId, id, dto), tenantId };
  }

  @Post(':id/telemetry')
  @RequireCapability('write')
  ingestTelemetry(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: IngestTelemetryDto) {
    return { data: this.devicesService.ingestTelemetry(tenantId, id, dto), tenantId };
  }

  @Patch(':id')
  @RequireCapability('write')
  async update(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateDeviceDto) {
    return { data: await this.devicesService.updateReliable(tenantId, id, dto), tenantId };
  }

  @Delete(':id')
  async remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return { data: await this.devicesService.removeReliable(tenantId, id), tenantId };
  }
}
