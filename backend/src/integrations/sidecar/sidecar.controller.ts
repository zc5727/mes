import { Body, Controller, Get, Post } from '@nestjs/common';
import { RequireCapability } from '../../common/route-capability.decorator';
import { TenantId } from '../../common/tenant.decorator';
import { SidecarReconcileDto } from './dto/sidecar-reconcile.dto';
import { SidecarService } from './sidecar.service';

@Controller('integrations/sidecar')
export class SidecarController {
  constructor(private readonly service: SidecarService) {}
  @Get('health') health() { return this.service.health(); }
  @Post('reconcile')
  @RequireCapability('write')
  reconcile(@TenantId() tenantId: string, @Body() body: SidecarReconcileDto) { return this.service.reconcile(tenantId, body.domain, body.local, body.fixture); }
}
