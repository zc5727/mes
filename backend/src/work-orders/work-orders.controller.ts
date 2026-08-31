import { RequireCapability } from '../common/route-capability.decorator';
import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { TenantId } from '../common/tenant.decorator';
import { CreateWorkOrderDto } from './dto/create-work-order.dto';
import { UpdateWorkOrderStatusDto } from './dto/update-work-order-status.dto';
import { UpdateWorkOrderDto } from './dto/update-work-order.dto';
import { ReportWorkOrderDto } from './dto/report-work-order.dto';
import { TraceabilityQuery, WorkOrdersService } from './work-orders.service';

@Controller('work-orders')
@RequireCapability('write')
export class WorkOrdersController {
  constructor(private readonly workOrdersService: WorkOrdersService) {}

  @Get('overview')
  overview(@TenantId() tenantId: string) {
    return { data: this.workOrdersService.findOverview(tenantId), tenantId };
  }

  @Get('traceability/search')
  searchTraceability(@TenantId() tenantId: string, @Query() query: TraceabilityQuery) {
    return { data: this.workOrdersService.searchTraceability(tenantId, query), tenantId };
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
  async create(@TenantId() tenantId: string, @Body() dto: CreateWorkOrderDto, @Headers('x-user-id') userId?: string) {
    return { data: await this.workOrdersService.createReliable(tenantId, dto, userId), tenantId };
  }

  @Patch(':id/status')
  async updateStatus(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateWorkOrderStatusDto, @Headers('x-user-id') userId?: string) {
    return { data: await this.workOrdersService.updateStatusReliable(tenantId, id, dto, userId), tenantId };
  }

  @Post(':id/report')
  async report(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: ReportWorkOrderDto, @Headers('x-user-id') userId?: string) {
    return { data: await this.workOrdersService.recordReport(tenantId, id, dto, userId), tenantId };
  }

  @Post(':id/complete-report')
  async completeReport(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: ReportWorkOrderDto, @Headers('x-user-id') userId?: string) {
    return { data: await this.workOrdersService.completeReport(tenantId, id, dto, userId), tenantId };
  }

  @Post(':id/traceability/report')
  async traceabilityReport(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: ReportWorkOrderDto, @Headers('x-user-id') userId?: string) {
    return { data: await this.workOrdersService.recordTraceableReport(tenantId, id, dto, userId), tenantId };
  }

  @Post(':id/operations/:operationCode/report')
  async operationReport(@TenantId() tenantId: string, @Param('id') id: string, @Param('operationCode') operationCode: string, @Body() dto: ReportWorkOrderDto, @Headers('x-user-id') userId?: string) {
    return { data: await this.workOrdersService.recordReport(tenantId, id, { ...dto, operationCode }, userId), tenantId };
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
  update(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateWorkOrderDto, @Headers('x-user-id') userId?: string) {
    return { data: this.workOrdersService.update(tenantId, id, dto, userId), tenantId };
  }

  @Delete(':id')
  remove(@TenantId() tenantId: string, @Param('id') id: string, @Headers('x-user-id') userId?: string) {
    return { data: this.workOrdersService.remove(tenantId, id, userId), tenantId };
  }
}
