import { Body, Controller, ForbiddenException, Get, Param, Patch, Post } from '@nestjs/common';
import { TenantId } from '../common/tenant.decorator';
import { CreateApprovalDto, CreateAuditDto } from './dto/audit.dto';
import { AuditService } from './audit.service';
@Controller('audit')
export class AuditController {
  constructor(private readonly service: AuditService) {}
  @Get('logs') logs(@TenantId() tenantId: string) { return { data: this.service.list(tenantId), tenantId }; }
  @Get('logs/verify') verify(@TenantId() tenantId: string) { return { data: this.service.verify(tenantId), tenantId }; }
  @Post('logs') createLog(@TenantId() tenantId: string, @Body() dto: CreateAuditDto) { return { data: this.service.record(tenantId, 'api-user', dto), tenantId }; }
  @Get('approvals') approvals(@TenantId() tenantId: string) { return { data: this.service.listApprovals(tenantId), tenantId }; }
  @Post('approvals') createApproval(@TenantId() tenantId: string, @Body() dto: CreateApprovalDto) {
    if (dto.resource === 'strategy-candidate') {
      throw new ForbiddenException('STRATEGY_APPROVAL_MUST_USE_GOVERNED_API: strategy approvals are created by simulation');
    }
    return { data: this.service.createApproval(tenantId, dto), tenantId };
  }
  @Patch('approvals/:id/approve') approve(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: Partial<CreateApprovalDto>) { this.assertStrategyApprovalUsesGovernedApi(tenantId, id); return { data: this.service.decide(tenantId, id, 'approved', dto.comment), tenantId }; }
  @Patch('approvals/:id/reject') reject(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: Partial<CreateApprovalDto>) { this.assertStrategyApprovalUsesGovernedApi(tenantId, id); return { data: this.service.decide(tenantId, id, 'rejected', dto.comment), tenantId }; }
  @Patch('approvals/:id/revoke') revoke(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: Partial<CreateApprovalDto>) { this.assertStrategyApprovalUsesGovernedApi(tenantId, id); return { data: this.service.revoke(tenantId, id, dto.comment), tenantId }; }

  private assertStrategyApprovalUsesGovernedApi(tenantId: string, id: string): void {
    if (this.service.findApproval(tenantId, id)?.resource === 'strategy-candidate') {
      throw new ForbiddenException('STRATEGY_APPROVAL_MUST_USE_GOVERNED_API: use /strategies/simulations/:simulationId/approvals/:approvalId');
    }
  }
}
