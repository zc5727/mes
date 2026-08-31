import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { TenantId } from '../common/tenant.decorator';
import { CreateWorkOrderDto } from './dto/create-work-order.dto';
import { UpdateWorkOrderStatusDto } from './dto/update-work-order-status.dto';
import { UpdateWorkOrderDto } from './dto/update-work-order.dto';
import { ReportWorkOrderDto } from './dto/report-work-order.dto';
import { WorkOrdersService } from './work-orders.service';

@Controller('work-orders')
export class WorkOrdersController {
  constructor(private readonly workOrdersService: WorkOrdersService) {}

  @Get('overview')
  overview(@TenantId() tenantId: string) {
    return { data: this.workOrdersService.findOverview(tenantId), tenantId };
  }

  @Get()
  findAll(@TenantId() tenantId: string, @Query('status') status?: UpdateWorkOrderStatusDto['status']) {
    return { data: this.workOrdersService.findAll(tenantId, status), tenantId };
  }

  @Get(':id')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return { data: this.workOrdersService.findOne(tenantId, id), tenantId };
  }

  @Post()
  create(@TenantId() tenantId: string, @Body() dto: CreateWorkOrderDto) {
    return { data: this.workOrdersService.create(tenantId, dto), tenantId };
  }

  @Patch(':id/status')
  updateStatus(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateWorkOrderStatusDto) {
    return { data: this.workOrdersService.updateStatus(tenantId, id, dto), tenantId };
  }

  @Post(':id/report')
  report(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: ReportWorkOrderDto) {
    return { data: this.workOrdersService.report(tenantId, id, dto), tenantId };
  }

  @Get(':id/reports')
  reports(@TenantId() tenantId: string, @Param('id') id: string) {
    return { data: this.workOrdersService.findReports(tenantId, id), tenantId };
  }

  @Get(':id/execution-summary')
  executionSummary(@TenantId() tenantId: string, @Param('id') id: string) {
    return { data: this.workOrdersService.executionSummary(tenantId, id), tenantId };
  }

  @Get(':id/traceability')
  traceability(@TenantId() tenantId: string, @Param('id') id: string) {
    return { data: this.workOrdersService.executionSummary(tenantId, id), tenantId };
  }

  @Patch(':id')
  update(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateWorkOrderDto) {
    return { data: this.workOrdersService.update(tenantId, id, dto), tenantId };
  }

  @Delete(':id')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return { data: this.workOrdersService.remove(tenantId, id), tenantId };
  }
}
