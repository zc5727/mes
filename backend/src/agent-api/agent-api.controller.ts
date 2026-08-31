import { RequireCapability } from '../common/route-capability.decorator';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { AgentApiService } from './agent-api.service';
import {
  AgentAuthorizationContext,
  AgentToolRequest,
  AgentToolRequestDto,
} from './tool-contract';

@Controller('agent-api')
export class AgentApiController {
  constructor(private readonly agentApiService: AgentApiService) {}

  @Get('tools')
  tools() {
    return { data: this.agentApiService.listTools() };
  }

  @Post('tools/execute')
  @RequireCapability('read')
  execute(
    @Body() request: AgentToolRequestDto,
    @Headers('x-tenant-id') tenantId?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-role') role?: string,
    @Headers('x-factory-id') factoryId?: string,
    @Headers('x-scope') scope?: string,
    @Headers('x-session-id') sessionId?: string,
    @Headers('x-trace-id') traceId?: string,
    @Headers('x-service-account-id') serviceAccountId?: string,
  ) {
    const trustedTenantId = this.requiredHeader(tenantId, 'x-tenant-id');
    const trustedAuthorization = this.trustedAuthorization({
      userId,
      role,
      factoryId,
      scope,
      sessionId,
      serviceAccountId,
    });
    this.assertServiceAccountRole(role, serviceAccountId);
    const trustedTraceId = this.requiredHeader(traceId, 'x-trace-id');

    if (request.tenantId !== trustedTenantId) {
      throw new ForbiddenException('TENANT_SCOPE_DENIED: request tenant differs from authenticated tenant');
    }
    this.assertIdentityConsistency(request, trustedAuthorization);
    return this.agentApiService.execute({
      ...request,
      tenantId: trustedTenantId,
      traceId: trustedTraceId,
      authorization: trustedAuthorization,
    } as AgentToolRequest & { tool: unknown });
  }

  private trustedAuthorization(headers: {
    userId?: string;
    role?: string;
    factoryId?: string;
    scope?: string;
    sessionId?: string;
    serviceAccountId?: string;
  }): AgentAuthorizationContext {
    return {
      userId: this.requiredHeader(headers.userId, 'x-user-id'),
      role: this.requiredHeader(headers.role, 'x-role'),
      factoryId: this.requiredHeader(headers.factoryId, 'x-factory-id'),
      scope: this.requiredHeader(headers.scope, 'x-scope'),
      sessionId: this.requiredHeader(headers.sessionId, 'x-session-id'),
      serviceAccountId: headers.serviceAccountId?.trim() || undefined,
    };
  }

  private requiredHeader(value: string | undefined, name: string): string {
    if (!value?.trim()) {
      throw new UnauthorizedException(`AUTH_REQUIRED: ${name} is required`);
    }
    return value.trim();
  }

  private assertServiceAccountRole(role: string | undefined, serviceAccountId: string | undefined): void {
    if (process.env.MES_AGENT_REQUIRE_SERVICE_ACCOUNT !== 'true') return;
    if (!serviceAccountId?.trim()) {
      throw new UnauthorizedException(
        'SERVICE_ACCOUNT_REQUIRED: Agent service account is required',
      );
    }
    const allowed = (process.env.MES_AGENT_ALLOWED_ROLES ?? 'auditor')
      .split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
    const normalizedRole = role?.trim().toLowerCase() ?? '';
    if (!allowed.includes(normalizedRole)) {
      throw new ForbiddenException('SERVICE_ACCOUNT_ROLE_DENIED: Agent service accounts are limited to read-only roles');
    }
  }

  private assertIdentityConsistency(
    request: AgentToolRequestDto,
    headers: AgentAuthorizationContext,
  ): void {
    const bodyAuthorization = request.authorization;
    if (bodyAuthorization) {
      const checks: Array<[string, string | string[], string | string[]]> = [
        ['userId', headers.userId, bodyAuthorization.userId],
        ['role', headers.role, bodyAuthorization.role],
        ['factoryId', headers.factoryId, bodyAuthorization.factoryId],
        ['scope', headers.scope, bodyAuthorization.scope],
        ['sessionId', headers.sessionId, bodyAuthorization.sessionId],
      ];
      for (const [field, headerValue, bodyValue] of checks) {
        if (headerValue !== bodyValue) {
          throw new ForbiddenException(
            `IDENTITY_MISMATCH: ${field} differs from authenticated header`,
          );
        }
      }
      if (bodyAuthorization.serviceAccountId !== headers.serviceAccountId) {
        throw new ForbiddenException(
          'IDENTITY_MISMATCH: serviceAccountId differs from authenticated header',
        );
      }
    }
  }
}
