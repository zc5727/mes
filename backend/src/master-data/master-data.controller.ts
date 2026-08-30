import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { TenantId } from '../common/tenant.decorator';
import { CreateCalendarDto, CreateProcessDto, CreateProductDto, CreateShiftDto } from './dto/master-data.dto';
import { MasterDataService } from './master-data.service';

@Controller('master-data')
export class MasterDataController {
  constructor(private readonly service: MasterDataService) {}
  @Get('products') products(@TenantId() tenantId: string) { return { data: this.service.list(tenantId, 'product'), tenantId }; }
  @Post('products') createProduct(@TenantId() tenantId: string, @Body() dto: CreateProductDto) { return { data: this.service.create(tenantId, 'product', dto), tenantId }; }
  @Get('products/:id') product(@TenantId() tenantId: string, @Param('id') id: string) { return { data: this.service.findOne(tenantId, 'product', id), tenantId }; }
  @Get('processes') processes(@TenantId() tenantId: string) { return { data: this.service.list(tenantId, 'process'), tenantId }; }
  @Post('processes') createProcess(@TenantId() tenantId: string, @Body() dto: CreateProcessDto) { return { data: this.service.create(tenantId, 'process', dto), tenantId }; }
  @Get('processes/:id') process(@TenantId() tenantId: string, @Param('id') id: string) { return { data: this.service.findOne(tenantId, 'process', id), tenantId }; }
  @Get('shifts') shifts(@TenantId() tenantId: string) { return { data: this.service.list(tenantId, 'shift'), tenantId }; }
  @Post('shifts') createShift(@TenantId() tenantId: string, @Body() dto: CreateShiftDto) { return { data: this.service.create(tenantId, 'shift', dto), tenantId }; }
  @Get('shifts/:id') shift(@TenantId() tenantId: string, @Param('id') id: string) { return { data: this.service.findOne(tenantId, 'shift', id), tenantId }; }
  @Get('calendars') calendars(@TenantId() tenantId: string) { return { data: this.service.list(tenantId, 'calendar'), tenantId }; }
  @Post('calendars') createCalendar(@TenantId() tenantId: string, @Body() dto: CreateCalendarDto) { return { data: this.service.create(tenantId, 'calendar', dto), tenantId }; }
  @Get('calendars/:id') calendar(@TenantId() tenantId: string, @Param('id') id: string) { return { data: this.service.findOne(tenantId, 'calendar', id), tenantId }; }
}
