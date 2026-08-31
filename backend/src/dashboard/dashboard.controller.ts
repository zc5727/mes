import { Controller, Get, Param, Sse } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { TenantId } from '../common/tenant.decorator';
import { DashboardRealtimeMessage, DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('overview')
  overview(@TenantId() tenantId: string) {
    return { data: this.dashboardService.getOverview(tenantId), tenantId };
  }

  @Sse('stream')
  stream(@TenantId() tenantId: string): Observable<DashboardRealtimeMessage> {
    return this.dashboardService.stream(tenantId);
  }

  @Get('production-metrics')
  productionMetrics(@TenantId() tenantId: string) {
    return { data: this.dashboardService.getProductionMetrics(tenantId), tenantId };
  }

  @Get('lines/:lineId')
  line(@TenantId() tenantId: string, @Param('lineId') lineId: string) {
    return { data: this.dashboardService.getLineOverview(tenantId, lineId), tenantId };
  }
}
