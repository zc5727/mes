import { Controller, Get, Param } from '@nestjs/common';
import { TenantId } from '../common/tenant.decorator';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('overview')
  overview(@TenantId() tenantId: string) {
    return { data: this.dashboardService.getOverview(tenantId), tenantId };
  }

  @Get('lines/:lineId')
  line(@TenantId() tenantId: string, @Param('lineId') lineId: string) {
    return { data: this.dashboardService.getLineOverview(tenantId, lineId), tenantId };
  }
}
