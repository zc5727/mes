import { Controller, Get, Param, Query } from '@nestjs/common';
import { TenantId } from '../common/tenant.decorator';
import { AgvsService } from './agvs.service';

@Controller('agvs')
export class AgvsController {
  constructor(private readonly agvsService: AgvsService) {}

  @Get()
  findAll(@TenantId() tenantId: string, @Query('lineId') lineId?: string) {
    return { data: this.agvsService.findAll(tenantId, lineId), tenantId };
  }

  @Get(':id')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return { data: this.agvsService.findOne(tenantId, id), tenantId };
  }
}
