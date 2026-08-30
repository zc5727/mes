import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { TenantId } from '../common/tenant.decorator';
import { FoundationService } from './foundation.service';

interface RecordBody { data?: Record<string, unknown>; status?: string }

@Controller('foundation')
export class FoundationController {
  constructor(private readonly service: FoundationService) {}

  @Get('strategies')
  listStrategies(@TenantId() tenantId: string) { return this.service.list(tenantId, 'strategy-decision'); }

  @Post('strategies')
  createStrategy(@TenantId() tenantId: string, @Body() body: RecordBody) { return this.service.create(tenantId, 'strategy-decision', body.data ?? {}); }

  @Patch('strategies/:id/status')
  updateStrategy(@TenantId() tenantId: string, @Param('id') id: string, @Body() body: RecordBody) { return this.service.updateStatus(tenantId, 'strategy-decision', id, body.status ?? 'approved'); }

  @Get('audit-logs')
  listAuditLogs(@TenantId() tenantId: string) { return this.service.list(tenantId, 'audit-log'); }

  @Post('audit-logs')
  createAuditLog(@TenantId() tenantId: string, @Body() body: RecordBody) { return this.service.create(tenantId, 'audit-log', body.data ?? {}); }
}
