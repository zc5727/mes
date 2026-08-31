import { RequireCapability } from '../common/route-capability.decorator';
import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { TenantId } from '../common/tenant.decorator';
import { CreateProductionLineDto } from './dto/create-production-line.dto';
import { UpdateLineStatusDto } from './dto/update-line-status.dto';
import { UpdateProductionLineDto } from './dto/update-production-line.dto';
import { ProductionLinesService } from './production-lines.service';

@Controller('production-lines')
@RequireCapability('control')
export class ProductionLinesController {
  constructor(private readonly linesService: ProductionLinesService) {}

  @Get('overview')
  overview(@TenantId() tenantId: string) {
    return { data: this.linesService.findOverview(tenantId), tenantId };
  }

  @Get()
  findAll(@TenantId() tenantId: string, @Query('factoryId') factoryId?: string) {
    return { data: this.linesService.findAll(tenantId, factoryId), tenantId };
  }

  @Get(':id')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return { data: this.linesService.findOne(tenantId, id), tenantId };
  }

  @Post()
  async create(@TenantId() tenantId: string, @Body() dto: CreateProductionLineDto, @Headers('x-user-id') userId?: string) {
    return { data: await this.linesService.createReliable(tenantId, dto, userId), tenantId };
  }

  @Patch(':id/status')
  updateStatus(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateLineStatusDto, @Headers('x-user-id') userId?: string) {
    return { data: this.linesService.updateStatus(tenantId, id, dto, userId), tenantId };
  }

  @Patch(':id')
  update(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateProductionLineDto, @Headers('x-user-id') userId?: string) {
    return { data: this.linesService.update(tenantId, id, dto, userId), tenantId };
  }

  @Delete(':id')
  remove(@TenantId() tenantId: string, @Param('id') id: string, @Headers('x-user-id') userId?: string) {
    return { data: this.linesService.remove(tenantId, id, userId), tenantId };
  }
}
