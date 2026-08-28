import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { TenantId } from '../common/tenant.decorator';
import { CreateProductionLineDto } from './dto/create-production-line.dto';
import { UpdateLineStatusDto } from './dto/update-line-status.dto';
import { UpdateProductionLineDto } from './dto/update-production-line.dto';
import { ProductionLinesService } from './production-lines.service';

@Controller('production-lines')
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
  create(@TenantId() tenantId: string, @Body() dto: CreateProductionLineDto) {
    return { data: this.linesService.create(tenantId, dto), tenantId };
  }

  @Patch(':id/status')
  updateStatus(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateLineStatusDto) {
    return { data: this.linesService.updateStatus(tenantId, id, dto), tenantId };
  }

  @Patch(':id')
  update(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateProductionLineDto) {
    return { data: this.linesService.update(tenantId, id, dto), tenantId };
  }

  @Delete(':id')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return { data: this.linesService.remove(tenantId, id), tenantId };
  }
}
