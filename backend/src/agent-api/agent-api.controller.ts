import { Body, Controller, Get, Post } from '@nestjs/common';
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
  execute(@Body() request: AgentToolRequest) {
    return this.agentApiService.execute(request as AgentToolRequest & { tool: unknown });
  }
}
