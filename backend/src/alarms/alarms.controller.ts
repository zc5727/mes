import { BadRequestException, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { TenantId } from '../common/tenant.decorator';
import { AlarmLevel, AlarmStatus, AlarmsService } from './alarms.service';

@Controller('alarms')
export class AlarmsController {
  constructor(private readonly alarmsService: AlarmsService) {}

  @Get()
  findAll(
    @TenantId() tenantId: string,
    @Query('level') level?: AlarmLevel,
    @Query('lineId') lineId?: string,
    @Query('deviceId') deviceId?: string,
    @Query('status') status?: AlarmStatus,
  ) {
    this.validateQuery(level, status);
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

  @Post(':id/maintenance-work-order')
  createMaintenance(@TenantId() tenantId: string, @Param('id') id: string) {
    return { data: this.alarmsService.createMaintenanceWorkOrder(tenantId, id), tenantId };
  }

  private validateQuery(level?: string, status?: string): void {
    if (level && !['info', 'warning', 'critical'].includes(level)) {
      throw new BadRequestException({ code: 'INVALID_ALARM_LEVEL', message: 'level must be info, warning, or critical' });
    }
    if (status && !['active', 'acknowledged', 'closed'].includes(status)) {
      throw new BadRequestException({ code: 'INVALID_ALARM_STATUS', message: 'status must be active, acknowledged, or closed' });
    }
  }
}
