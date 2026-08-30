import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { TenantId } from '../common/tenant.decorator';
import { CreateMaintenanceDto, UpdateMaintenanceStatusDto } from './dto/maintenance.dto';
import { MaintenanceService } from './maintenance.service';

@Controller('maintenance/work-orders')
export class MaintenanceController {
  constructor(private readonly service: MaintenanceService) {}
  @Get() list(@TenantId() tenantId: string) { return { data: this.service.list(tenantId), tenantId }; }
  @Get(':id') findOne(@TenantId() tenantId: string, @Param('id') id: string) { return { data: this.service.findOne(tenantId, id), tenantId }; }
  @Post() create(@TenantId() tenantId: string, @Body() dto: CreateMaintenanceDto) { return { data: this.service.create(tenantId, dto), tenantId }; }
  @Patch(':id/status') updateStatus(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateMaintenanceStatusDto) { return { data: this.service.updateStatus(tenantId, id, dto), tenantId }; }
}
