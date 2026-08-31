import { RequireCapability } from '../common/route-capability.decorator';
import { Body, Controller, Delete, Get, Headers, Param, Patch, Post } from '@nestjs/common';
import { TenantId } from '../common/tenant.decorator';
import { CreateFactoryDto } from './dto/create-factory.dto';
import { UpdateFactoryDto } from './dto/update-factory.dto';
import { FactoriesService } from './factories.service';

@Controller('factories')
@RequireCapability('admin')
export class FactoriesController {
  constructor(private readonly factoriesService: FactoriesService) {}

  @Get()
  findAll(@TenantId() tenantId: string) {
    return { data: this.factoriesService.findAll(tenantId), tenantId };
  }

  @Get(':id')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return { data: this.factoriesService.findOne(tenantId, id), tenantId };
  }

  @Post()
  async create(@TenantId() tenantId: string, @Body() dto: CreateFactoryDto, @Headers('x-user-id') userId?: string) {
    return { data: await this.factoriesService.createReliable(tenantId, dto, userId), tenantId };
  }

  @Patch(':id')
  update(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateFactoryDto) {
    return { data: this.factoriesService.update(tenantId, id, dto), tenantId };
  }

  @Delete(':id')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return { data: this.factoriesService.remove(tenantId, id), tenantId };
  }
}
