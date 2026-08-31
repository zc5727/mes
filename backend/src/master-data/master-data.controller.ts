import { RequireCapability } from '../common/route-capability.decorator';
import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { TenantId } from '../common/tenant.decorator';
import { BatchInventoryMovementDto, CreateBatchInventoryDto, CreateBomDto, CreateCalendarDto, CreateOperationDto, CreateProcessDto, CreateProductDto, CreateRoutingDto, CreateShiftDto } from './dto/master-data.dto';
import { MasterDataService } from './master-data.service';

@Controller('master-data')
@RequireCapability('admin')
export class MasterDataController {
  constructor(private readonly service: MasterDataService) {}
  @Get('products') products(@TenantId() tenantId: string) { return { data: this.service.list(tenantId, 'product'), tenantId }; }
  @Post('products') async createProduct(@TenantId() tenantId: string, @Body() dto: CreateProductDto, @Headers('x-user-id') actorId?: string) { return { data: await this.service.createReliable(tenantId, 'product', dto, actorId), tenantId }; }
  @Get('products/:id') product(@TenantId() tenantId: string, @Param('id') id: string) { return { data: this.service.findOne(tenantId, 'product', id), tenantId }; }
  @Get('processes') processes(@TenantId() tenantId: string) { return { data: this.service.list(tenantId, 'process'), tenantId }; }
  @Post('processes') async createProcess(@TenantId() tenantId: string, @Body() dto: CreateProcessDto, @Headers('x-user-id') actorId?: string) { return { data: await this.service.createReliable(tenantId, 'process', dto, actorId), tenantId }; }
  @Get('processes/:id') process(@TenantId() tenantId: string, @Param('id') id: string) { return { data: this.service.findOne(tenantId, 'process', id), tenantId }; }
  @Get('shifts') shifts(@TenantId() tenantId: string) { return { data: this.service.list(tenantId, 'shift'), tenantId }; }
  @Post('shifts') async createShift(@TenantId() tenantId: string, @Body() dto: CreateShiftDto, @Headers('x-user-id') actorId?: string) { return { data: await this.service.createReliable(tenantId, 'shift', dto, actorId), tenantId }; }
  @Get('shifts/:id') shift(@TenantId() tenantId: string, @Param('id') id: string) { return { data: this.service.findOne(tenantId, 'shift', id), tenantId }; }
  @Get('calendars') calendars(@TenantId() tenantId: string) { return { data: this.service.list(tenantId, 'calendar'), tenantId }; }
  @Post('calendars') async createCalendar(@TenantId() tenantId: string, @Body() dto: CreateCalendarDto, @Headers('x-user-id') actorId?: string) { return { data: await this.service.createReliable(tenantId, 'calendar', dto, actorId), tenantId }; }
  @Get('calendars/:id') calendar(@TenantId() tenantId: string, @Param('id') id: string) { return { data: this.service.findOne(tenantId, 'calendar', id), tenantId }; }
  @Get('operations') operations(@TenantId() tenantId: string) { return { data: this.service.list(tenantId, 'operation'), tenantId }; }
  @Post('operations') async createOperation(@TenantId() tenantId: string, @Body() dto: CreateOperationDto, @Headers('x-user-id') actorId?: string) { return { data: await this.service.createReliable(tenantId, 'operation', dto, actorId), tenantId }; }
  @Get('operations/:id') operation(@TenantId() tenantId: string, @Param('id') id: string) { return { data: this.service.findOne(tenantId, 'operation', id), tenantId }; }
  @Get('boms') boms(@TenantId() tenantId: string) { return { data: this.service.list(tenantId, 'bom'), tenantId }; }
  @Post('boms') async createBom(@TenantId() tenantId: string, @Body() dto: CreateBomDto, @Headers('x-user-id') actorId?: string) { return { data: await this.service.createReliable(tenantId, 'bom', dto, actorId), tenantId }; }
  @Get('boms/:id') bom(@TenantId() tenantId: string, @Param('id') id: string) { return { data: this.service.findOne(tenantId, 'bom', id), tenantId }; }
  @Get('routings') routings(@TenantId() tenantId: string) { return { data: this.service.list(tenantId, 'routing'), tenantId }; }
  @Post('routings') async createRouting(@TenantId() tenantId: string, @Body() dto: CreateRoutingDto, @Headers('x-user-id') actorId?: string) { return { data: await this.service.createReliable(tenantId, 'routing', dto, actorId), tenantId }; }
  @Get('routings/:id') routing(@TenantId() tenantId: string, @Param('id') id: string) { return { data: this.service.findOne(tenantId, 'routing', id), tenantId }; }
  @Get('batches') batches(@TenantId() tenantId: string) { return { data: this.service.listBatches(tenantId), tenantId }; }
  @Post('batches')
  @RequireCapability('write')
  async createBatch(@TenantId() tenantId: string, @Body() dto: CreateBatchInventoryDto, @Headers('x-user-id') actorId?: string) { return { data: await this.service.createBatchReliable(tenantId, dto, actorId), tenantId }; }
  @Post('batches/return')
  @RequireCapability('write')
  async returnBatch(@TenantId() tenantId: string, @Body() dto: BatchInventoryMovementDto, @Headers('x-user-id') actorId?: string) { return { data: await this.service.returnBatchReliable(tenantId, dto, actorId), tenantId }; }
}
