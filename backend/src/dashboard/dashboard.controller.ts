import { Controller, Get, Param, Query, Sse } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { TenantId } from '../common/tenant.decorator';
import { DashboardRealtimeMessage, DashboardService } from './dashboard.service';
import { DashboardHistoryQueryDto } from './dto/dashboard-history-query.dto';

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

  @Get('history')
  history(@TenantId() tenantId: string, @Query() query: DashboardHistoryQueryDto) {
    const lineId = query.lineId?.trim();
    if (query.page === undefined && query.pageSize === undefined) {
      return { data: this.dashboardService.getProductionHistory(tenantId, lineId), tenantId };
    }
    const result = this.dashboardService.getProductionHistoryPage(
      tenantId,
      lineId,
      query.page,
      query.pageSize,
    );
    return { data: result.items, pagination: result.pagination, tenantId };
  }

  @Get('lines/:lineId')
  line(@TenantId() tenantId: string, @Param('lineId') lineId: string) {
    return { data: this.dashboardService.getLineOverview(tenantId, lineId), tenantId };
  }
}
