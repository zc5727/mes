import { BadRequestException, Controller, Get, Param, Patch, Post, Query, Sse } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { TenantId } from '../common/tenant.decorator';
import { AlarmRealtimeMessage, AlarmsService } from './alarms.service';
import { AlarmQueryDto } from './dto/alarm-query.dto';

@Controller('alarms')
export class AlarmsController {
  constructor(private readonly alarmsService: AlarmsService) {}

  @Get()
  findAll(@TenantId() tenantId: string, @Query() query: AlarmQueryDto) {
    this.validateQuery(query);
    return { data: this.alarmsService.findAll(tenantId, query), tenantId };
  }

  @Sse('stream')
  stream(@TenantId() tenantId: string): Observable<AlarmRealtimeMessage> {
    return this.alarmsService.stream(tenantId);
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

  private validateQuery(query: AlarmQueryDto): void {
    if (query.level && !['info', 'warning', 'critical'].includes(query.level)) {
      throw new BadRequestException({ code: 'INVALID_ALARM_LEVEL', message: 'level must be info, warning, or critical' });
    }
    if (query.status && !['active', 'acknowledged', 'closed'].includes(query.status)) {
      throw new BadRequestException({ code: 'INVALID_ALARM_STATUS', message: 'status must be active, acknowledged, or closed' });
    }
  }
}
