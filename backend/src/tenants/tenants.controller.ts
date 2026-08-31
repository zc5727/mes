import { RequireCapability } from '../common/route-capability.decorator';
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { TenantsService } from './tenants.service';

@Controller('tenants')
@RequireCapability('admin')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get()
  findAll() {
    return { data: this.tenantsService.findAll() };
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return { data: this.tenantsService.findOne(id) };
  }

  @Post()
  create(@Body() dto: CreateTenantDto) {
    return { data: this.tenantsService.create(dto) };
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    return { data: this.tenantsService.update(id, dto) };
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return { data: this.tenantsService.remove(id) };
  }
}
