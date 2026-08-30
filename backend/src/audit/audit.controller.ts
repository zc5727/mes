import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { TenantId } from '../common/tenant.decorator';
import { CreateApprovalDto, CreateAuditDto } from './dto/audit.dto';
import { AuditService } from './audit.service';
@Controller('audit')
export class AuditController {
  constructor(private readonly service: AuditService) {}
  @Get('logs') logs(@TenantId() tenantId: string) { return { data: this.service.list(tenantId), tenantId }; }
  @Post('logs') createLog(@TenantId() tenantId: string, @Body() dto: CreateAuditDto) { return { data: this.service.record(tenantId, 'api-user', dto), tenantId }; }
  @Get('approvals') approvals(@TenantId() tenantId: string) { return { data: this.service.listApprovals(tenantId), tenantId }; }
  @Post('approvals') createApproval(@TenantId() tenantId: string, @Body() dto: CreateApprovalDto) { return { data: this.service.createApproval(tenantId, dto), tenantId }; }
  @Patch('approvals/:id/approve') approve(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: Partial<CreateApprovalDto>) { return { data: this.service.decide(tenantId, id, 'approved', dto.comment), tenantId }; }
  @Patch('approvals/:id/reject') reject(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: Partial<CreateApprovalDto>) { return { data: this.service.decide(tenantId, id, 'rejected', dto.comment), tenantId }; }
}
