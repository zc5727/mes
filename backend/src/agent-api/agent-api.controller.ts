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
    const authorization = request.authorization
      ? { ...request.authorization, serviceAccountId: request.authorization.serviceAccountId ?? serviceAccountId }
      : { userId, role, factoryId, scope, sessionId, serviceAccountId };
    return this.agentApiService.execute({
      ...request, traceId: request.traceId || traceId || '', authorization,
    } as AgentToolRequest & { tool: unknown });
  }
}
