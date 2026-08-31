import { Body, Controller, ForbiddenException, Get, Headers, Post } from '@nestjs/common';
import { AgentApiService } from './agent-api.service';
import { AgentToolRequest } from './tool-contract';

@Controller('agent-api')
export class AgentApiController {
  constructor(private readonly agentApiService: AgentApiService) {}

  @Get('tools')
  tools() {
    return { data: this.agentApiService.listTools() };
  }

  @Post('tools/execute')
  execute(
    @Body() request: AgentToolRequest,
    @Headers('x-tenant-id') tenantId?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-role') role?: string,
    @Headers('x-factory-id') factoryId?: string,
    @Headers('x-scope') scope?: string,
    @Headers('x-session-id') sessionId?: string,
    @Headers('x-trace-id') traceId?: string,
    @Headers('x-service-account-id') serviceAccountId?: string,
  ) {
    if (tenantId && request.tenantId !== tenantId) {
      throw new ForbiddenException('TENANT_SCOPE_DENIED: request tenant differs from authenticated tenant');
    }
    this.assertIdentityConsistency(request, { userId, role, factoryId, scope, sessionId });
    const authorization = request.authorization
      ? { ...request.authorization, serviceAccountId: request.authorization.serviceAccountId ?? serviceAccountId }
      : { userId, role, factoryId, scope, sessionId, serviceAccountId };
    return this.agentApiService.execute({
      ...request, traceId: request.traceId || traceId || '', authorization,
    } as AgentToolRequest & { tool: unknown });
  }

  private assertIdentityConsistency(
    request: AgentToolRequest,
    headers: { userId?: string; role?: string; factoryId?: string; scope?: string; sessionId?: string },
  ): void {
    if (!request.authorization) return;
    const checks: Array<[string, string | undefined, string | string[] | undefined]> = [
      ['userId', headers.userId, request.authorization.userId],
      ['role', headers.role, request.authorization.role],
      ['factoryId', headers.factoryId, request.authorization.factoryId],
      ['sessionId', headers.sessionId, request.authorization.sessionId],
    ];
    for (const [field, headerValue, bodyValue] of checks) {
      if (headerValue && headerValue !== bodyValue) {
        throw new ForbiddenException(`IDENTITY_MISMATCH: ${field} differs from authenticated header`);
      }
    }
    if (headers.scope && String(request.authorization.scope) !== headers.scope) {
      throw new ForbiddenException('IDENTITY_MISMATCH: scope differs from authenticated header');
    }
  }
}
