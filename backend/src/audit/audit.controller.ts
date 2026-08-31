import { RequireCapability } from '../common/route-capability.decorator';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { TenantId } from '../common/tenant.decorator';
import { StrategyAuthorizationService } from '../strategies/strategy-authorization.service';
import { StrategyRequestContext } from '../strategies/strategy.types';
import {
  ApprovalDecisionDto,
  CreateApprovalDto,
  CreateAuditDto,
} from './dto/audit.dto';
import { AuditService } from './audit.service';

@Controller('audit')
@RequireCapability('admin')
export class AuditController {
  constructor(
    private readonly service: AuditService,
    private readonly authorization: StrategyAuthorizationService,
  ) {}

  @Get('logs')
  logs(
    @TenantId() tenantId: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-role') role?: string,
    @Headers('x-factory-id') factoryId?: string,
    @Headers('x-scope') scope?: string,
    @Headers('x-session-id') sessionId?: string,
    @Headers('x-trace-id') traceId?: string,
  ) {
    this.authorization.assertCanRead(
      this.context(userId, role, factoryId, scope, sessionId, traceId),
    );
    return { data: this.service.list(tenantId), tenantId };
  }

  @Get('logs/verify')
  verify(
    @TenantId() tenantId: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-role') role?: string,
    @Headers('x-factory-id') factoryId?: string,
    @Headers('x-scope') scope?: string,
    @Headers('x-session-id') sessionId?: string,
    @Headers('x-trace-id') traceId?: string,
  ) {
    this.authorization.assertCanRead(
      this.context(userId, role, factoryId, scope, sessionId, traceId),
    );
    return { data: this.service.verify(tenantId), tenantId };
  }

  @Post('logs')
  createLog(
    @TenantId() tenantId: string,
    @Body() dto: CreateAuditDto,
    @Headers('x-user-id') userId?: string,
    @Headers('x-role') role?: string,
    @Headers('x-factory-id') factoryId?: string,
    @Headers('x-scope') scope?: string,
    @Headers('x-session-id') sessionId?: string,
    @Headers('x-trace-id') traceId?: string,
  ) {
    const context = this.context(
      userId,
      role,
      factoryId,
      scope,
      sessionId,
      traceId,
    );
    this.authorization.assertCanRecordAudit(context);
    return {
      data: this.service.record(tenantId, context.userId, {
        ...dto,
        operator: context.userId,
      }),
      tenantId,
    };
  }

  @Get('approvals')
  approvals(
    @TenantId() tenantId: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-role') role?: string,
    @Headers('x-factory-id') factoryId?: string,
    @Headers('x-scope') scope?: string,
    @Headers('x-session-id') sessionId?: string,
    @Headers('x-trace-id') traceId?: string,
  ) {
    this.authorization.assertCanRead(
      this.context(userId, role, factoryId, scope, sessionId, traceId),
    );
    return { data: this.service.listApprovals(tenantId), tenantId };
  }

  @Post('approvals')
  createApproval(
    @TenantId() tenantId: string,
    @Body() dto: CreateApprovalDto,
    @Headers('x-user-id') userId?: string,
    @Headers('x-role') role?: string,
    @Headers('x-factory-id') factoryId?: string,
    @Headers('x-scope') scope?: string,
    @Headers('x-session-id') sessionId?: string,
    @Headers('x-trace-id') traceId?: string,
  ) {
    const context = this.context(
      userId,
      role,
      factoryId,
      scope,
      sessionId,
      traceId,
    );
    this.authorization.assertCanApprove(context);
    if (dto.resource === 'strategy-candidate') {
      throw new ForbiddenException(
        'STRATEGY_APPROVAL_MUST_USE_GOVERNED_API: strategy approvals are created by simulation',
      );
    }
    return {
      data: this.service.createApproval(
        tenantId,
        dto,
        context.userId,
        context.traceId,
      ),
      tenantId,
    };
  }

  @Patch('approvals/:id/approve')
  approve(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: ApprovalDecisionDto = new ApprovalDecisionDto(),
    @Headers('x-user-id') userId?: string,
    @Headers('x-role') role?: string,
    @Headers('x-factory-id') factoryId?: string,
    @Headers('x-scope') scope?: string,
    @Headers('x-session-id') sessionId?: string,
    @Headers('x-trace-id') traceId?: string,
  ) {
    return this.decide(
      tenantId,
      id,
      'approved',
      dto,
      userId,
      role,
      factoryId,
      scope,
      sessionId,
      traceId,
    );
  }

  @Patch('approvals/:id/reject')
  reject(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: ApprovalDecisionDto = new ApprovalDecisionDto(),
    @Headers('x-user-id') userId?: string,
    @Headers('x-role') role?: string,
    @Headers('x-factory-id') factoryId?: string,
    @Headers('x-scope') scope?: string,
    @Headers('x-session-id') sessionId?: string,
    @Headers('x-trace-id') traceId?: string,
  ) {
    return this.decide(
      tenantId,
      id,
      'rejected',
      dto,
      userId,
      role,
      factoryId,
      scope,
      sessionId,
      traceId,
    );
  }

  @Patch('approvals/:id/revoke')
  revoke(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: ApprovalDecisionDto = new ApprovalDecisionDto(),
    @Headers('x-user-id') userId?: string,
    @Headers('x-role') role?: string,
    @Headers('x-factory-id') factoryId?: string,
    @Headers('x-scope') scope?: string,
    @Headers('x-session-id') sessionId?: string,
    @Headers('x-trace-id') traceId?: string,
  ) {
    const context = this.context(
      userId,
      role,
      factoryId,
      scope,
      sessionId,
      traceId,
    );
    this.assertStrategyApprovalUsesGovernedApi(tenantId, id);
    this.authorization.assertCanApprove(context);
    return {
      data: this.service.revoke(
        tenantId,
        id,
        dto.comment,
        context.userId,
        context.traceId,
      ),
      tenantId,
    };
  }

  private decide(
    tenantId: string,
    id: string,
    status: 'approved' | 'rejected',
    dto: ApprovalDecisionDto,
    userId?: string,
    role?: string,
    factoryId?: string,
    scope?: string,
    sessionId?: string,
    traceId?: string,
  ) {
    const context = this.context(
      userId,
      role,
      factoryId,
      scope,
      sessionId,
      traceId,
    );
    this.assertStrategyApprovalUsesGovernedApi(tenantId, id);
    this.authorization.assertCanApprove(context);
    return {
      data: this.service.decide(
        tenantId,
        id,
        status,
        dto.comment,
        context.userId,
        context.traceId,
      ),
      tenantId,
    };
  }

  private context(
    userId?: string,
    role?: string,
    factoryId?: string,
    scope?: string,
    sessionId?: string,
    traceId?: string,
  ): StrategyRequestContext {
    return this.authorization.fromHeaders({
      userId,
      role,
      factoryId,
      scope,
      sessionId,
      traceId,
    });
  }

  private assertStrategyApprovalUsesGovernedApi(
    tenantId: string,
    id: string,
  ): void {
    if (this.service.findApproval(tenantId, id)?.resource === 'strategy-candidate') {
      throw new ForbiddenException(
        'STRATEGY_APPROVAL_MUST_USE_GOVERNED_API: use /strategies/simulations/:simulationId/approvals/:approvalId',
      );
    }
  }
}
