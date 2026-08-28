import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { TenantId } from '../common/tenant.decorator';
import { FoundationService } from './foundation.service';

interface RecordBody { data?: Record<string, unknown>; status?: string }

@Controller('foundation')
export class FoundationController {
  constructor(private readonly service: FoundationService) {}

  @Get('quality-records')
  listQuality(@TenantId() tenantId: string) { return this.service.list(tenantId, 'quality-record'); }

  @Post('quality-records')
  createQuality(@TenantId() tenantId: string, @Body() body: RecordBody) { return this.service.create(tenantId, 'quality-record', body.data ?? {}); }

  @Patch('quality-records/:id/status')
  updateQuality(@TenantId() tenantId: string, @Param('id') id: string, @Body() body: RecordBody) { return this.service.updateStatus(tenantId, 'quality-record', id, body.status ?? 'confirmed'); }

  @Get('documents')
  listDocuments(@TenantId() tenantId: string) { return this.service.list(tenantId, 'document'); }

  @Post('documents')
  createDocument(@TenantId() tenantId: string, @Body() body: RecordBody) { return this.service.create(tenantId, 'document', body.data ?? {}); }

  @Patch('documents/:id/status')
  updateDocument(@TenantId() tenantId: string, @Param('id') id: string, @Body() body: RecordBody) { return this.service.updateStatus(tenantId, 'document', id, body.status ?? 'confirmed'); }

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
