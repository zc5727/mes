import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { TenantId } from '../common/tenant.decorator';
import { CreateMaintenanceDto, CreatePreventivePlanDto, CreateSparePartDto, ConsumeSparePartDto, MaintenanceInspectionDto, UpdateMaintenanceStatusDto } from './dto/maintenance.dto';
import { MaintenanceService } from './maintenance.service';

@Controller('maintenance/work-orders')
export class MaintenanceController {
  constructor(private readonly service: MaintenanceService) {}
  @Get() list(@TenantId() tenantId: string) { return { data: this.service.list(tenantId), tenantId }; }
  @Get('preventive-plans') listPlans(@TenantId() tenantId: string) { return { data: this.service.listPreventivePlans(tenantId), tenantId }; }
  @Get('preventive-plans/due') duePlans(@TenantId() tenantId: string) { return { data: this.service.duePreventivePlans(tenantId), tenantId }; }
  @Post('preventive-plans') createPlan(@TenantId() tenantId: string, @Body() dto: CreatePreventivePlanDto) { return { data: this.service.createPreventivePlan(tenantId, dto), tenantId }; }
  @Get('spare-parts') listParts(@TenantId() tenantId: string) { return { data: this.service.listSpareParts(tenantId), tenantId }; }
  @Post('spare-parts') createPart(@TenantId() tenantId: string, @Body() dto: CreateSparePartDto) { return { data: this.service.createSparePart(tenantId, dto), tenantId }; }
  @Post('spare-parts/consume') consumePart(@TenantId() tenantId: string, @Body() dto: ConsumeSparePartDto) { return { data: this.service.consumeSparePart(tenantId, dto), tenantId }; }
  @Post('spare-parts/return') returnPart(@TenantId() tenantId: string, @Body() dto: ConsumeSparePartDto) { return { data: this.service.returnSparePart(tenantId, dto), tenantId }; }
  @Get('metrics') metrics(@TenantId() tenantId: string) { return { data: this.service.metrics(tenantId), tenantId }; }
  @Get(':id') findOne(@TenantId() tenantId: string, @Param('id') id: string) { return { data: this.service.findOne(tenantId, id), tenantId }; }
  @Post() create(@TenantId() tenantId: string, @Body() dto: CreateMaintenanceDto) { return { data: this.service.create(tenantId, dto), tenantId }; }
  @Patch(':id/status') updateStatus(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateMaintenanceStatusDto) { return { data: this.service.updateStatus(tenantId, id, dto), tenantId }; }
  @Post(':id/inspection') inspection(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: MaintenanceInspectionDto) { return { data: this.service.recordInspection(tenantId, id, dto), tenantId }; }
}
