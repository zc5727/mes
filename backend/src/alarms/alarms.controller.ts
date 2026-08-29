import { Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { TenantId } from '../common/tenant.decorator';
import { AlarmLevel, AlarmsService } from './alarms.service';

@Controller('alarms')
export class AlarmsController {
  constructor(private readonly alarmsService: AlarmsService) {}

  @Get()
  findAll(
    @TenantId() tenantId: string,
    @Query('level') level?: AlarmLevel,
    @Query('lineId') lineId?: string,
    @Query('deviceId') deviceId?: string,
    @Query('status') status?: 'active' | 'acknowledged' | 'closed',
  ) {
    return { data: this.alarmsService.findAll(tenantId, { level, lineId, deviceId, status }), tenantId };
  }

  @Get(':id')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return { data: this.alarmsService.findOne(tenantId, id), tenantId };
  }

  @Patch(':id/acknowledge')
  acknowledge(@TenantId() tenantId: string, @Param('id') id: string) {
    return { data: this.alarmsService.acknowledge(tenantId, id), tenantId };
  }

  @Patch(':id/close')
  close(@TenantId() tenantId: string, @Param('id') id: string) {
    return { data: this.alarmsService.close(tenantId, id), tenantId };
  }
}
