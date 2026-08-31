import { RequireCapability } from '../common/route-capability.decorator';
import { Body, Controller, Get, Headers, Param, Patch, Post } from '@nestjs/common';
import { TenantId } from '../common/tenant.decorator';
import { CreateMaintenanceDto, CreatePreventivePlanDto, CreateSparePartDto, ConsumeSparePartDto, MaintenanceInspectionDto, UpdateMaintenanceStatusDto } from './dto/maintenance.dto';
import { MaintenanceService } from './maintenance.service';

@Controller('maintenance/work-orders')
@RequireCapability('control')
export class MaintenanceController {
  constructor(private readonly service: MaintenanceService) {}
  @Get() list(@TenantId() tenantId: string) { return { data: this.service.list(tenantId), tenantId }; }
  @Get('preventive-plans') listPlans(@TenantId() tenantId: string) { return { data: this.service.listPreventivePlans(tenantId), tenantId }; }
  @Get('preventive-plans/due') duePlans(@TenantId() tenantId: string) { return { data: this.service.duePreventivePlans(tenantId), tenantId }; }
  @Post('preventive-plans/trigger-due') triggerDuePlans(@TenantId() tenantId: string, @Headers('x-user-id') actorId?: string) { return { data: this.service.triggerDuePreventivePlans(tenantId, new Date(), actorId), tenantId }; }
  @Post('preventive-plans') createPlan(@TenantId() tenantId: string, @Body() dto: CreatePreventivePlanDto, @Headers('x-user-id') actorId?: string) { return { data: this.service.createPreventivePlan(tenantId, dto, actorId), tenantId }; }
  @Get('spare-parts') listParts(@TenantId() tenantId: string) { return { data: this.service.listSpareParts(tenantId), tenantId }; }
  @Post('spare-parts') createPart(@TenantId() tenantId: string, @Body() dto: CreateSparePartDto, @Headers('x-user-id') actorId?: string) { return { data: this.service.createSparePart(tenantId, dto, actorId), tenantId }; }
  @Post('spare-parts/consume') consumePart(@TenantId() tenantId: string, @Body() dto: ConsumeSparePartDto, @Headers('x-user-id') actorId?: string) { return { data: this.service.consumeSparePart(tenantId, dto, actorId), tenantId }; }
  @Post('spare-parts/return') returnPart(@TenantId() tenantId: string, @Body() dto: ConsumeSparePartDto, @Headers('x-user-id') actorId?: string) { return { data: this.service.returnSparePart(tenantId, dto, actorId), tenantId }; }
  @Get('metrics') metrics(@TenantId() tenantId: string) { return { data: this.service.metrics(tenantId), tenantId }; }
  @Get(':id') findOne(@TenantId() tenantId: string, @Param('id') id: string) { return { data: this.service.findOne(tenantId, id), tenantId }; }
  @Post() async create(@TenantId() tenantId: string, @Body() dto: CreateMaintenanceDto, @Headers('x-user-id') actorId?: string) { return { data: await this.service.createReliable(tenantId, dto, actorId), tenantId }; }
  @Patch(':id/status') async updateStatus(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateMaintenanceStatusDto, @Headers('x-user-id') actorId?: string) { return { data: await this.service.updateStatusReliable(tenantId, id, dto, actorId), tenantId }; }
  @Post(':id/inspection') async inspection(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: MaintenanceInspectionDto, @Headers('x-user-id') actorId?: string) { return { data: await this.service.recordInspectionReliable(tenantId, id, dto, actorId), tenantId }; }
}
