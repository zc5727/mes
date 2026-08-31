import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { RequireCapability } from '../../common/route-capability.decorator';
import { TenantId } from '../../common/tenant.decorator';
import { ErpNextReportDto } from './dto/erpnext-report.dto';
import { ErpNextService } from './erpnext.service';

@Controller('integrations/erpnext')
export class ErpNextController {
  constructor(private readonly service: ErpNextService) {}

  @Get('health')
  health() { return this.service.health(); }

  @Get('production-orders')
  productionOrders(@TenantId() tenantId: string) { return this.service.productionOrders(tenantId); }

  @Get('work-orders')
  workOrders(@TenantId() tenantId: string) { return this.service.workOrders(tenantId); }

  @Get('reports')
  reports(@TenantId() tenantId: string) { return this.service.reports(tenantId); }

  @Post('work-orders/:workOrderId/reports')
  @RequireCapability('write')
  report(@TenantId() tenantId: string, @Param('workOrderId') workOrderId: string, @Body() dto: ErpNextReportDto) {
    return this.service.bridgeReport(tenantId, workOrderId, { ...dto, ...(dto.details ?? {}) });
  }
}
