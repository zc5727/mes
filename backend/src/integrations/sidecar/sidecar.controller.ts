import { Body, Controller, Get, Post } from '@nestjs/common';
import { TenantId } from '../../common/tenant.decorator';
import { SidecarService } from './sidecar.service';
import type { ReconciliationDomain, ReconciliationItem } from './sidecar.types';

@Controller('integrations/sidecar')
export class SidecarController {
  constructor(private readonly service: SidecarService) {}
  @Get('health') health() { return this.service.health(); }
  @Post('reconcile') reconcile(@TenantId() tenantId: string, @Body() body: { domain: ReconciliationDomain; local: ReconciliationItem[]; fixture?: ReconciliationItem[] }) { return this.service.reconcile(tenantId, body.domain, body.local, body.fixture); }
}
