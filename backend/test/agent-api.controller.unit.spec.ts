import { UnauthorizedException } from '@nestjs/common';
import { AgentApiController } from '../src/agent-api/agent-api.controller';
import { AgentApiService } from '../src/agent-api/agent-api.service';

describe('AgentApiController identity boundary', () => {
  it('rejects a request that has only body-supplied identity', async () => {
    const service = { execute: jest.fn() } as unknown as AgentApiService;
    const controller = new AgentApiController(service);

    await expect(controller.execute(
      {
        tool: 'get_production_overview',
        arguments: {},
        tenantId: 'tenant-demo',
        traceId: 'trace-1',
      },
      'tenant-demo',
    )).rejects.toThrow(UnauthorizedException);
    expect(service.execute).not.toHaveBeenCalled();
  });

  it('uses gateway headers instead of allowing body identity to escalate access', async () => {
    const service = {
      execute: jest.fn((request) => request),
    } as unknown as AgentApiService;
    const controller = new AgentApiController(service);

    await controller.execute(
      {
        tool: 'get_production_overview',
        arguments: {},
        tenantId: 'tenant-demo',
        traceId: 'trace-1',
        authorization: {
          userId: 'user-1',
          role: 'auditor',
          factoryId: 'factory-demo',
          scope: 'line-1',
          sessionId: 'session-1',
        },
      },
      'tenant-demo',
      'user-1',
      'auditor',
      'factory-demo',
      'line-1',
      'session-1',
      'trace-1',
    );

    expect(service.execute).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-demo',
      traceId: 'trace-1',
      authorization: expect.objectContaining({
        userId: 'user-1',
        role: 'auditor',
        scope: 'line-1',
      }),
    }));
  });

  it('rejects mismatched body identity before dispatch', async () => {
    const service = { execute: jest.fn() } as unknown as AgentApiService;
    const controller = new AgentApiController(service);

    await expect(controller.execute(
      {
        tool: 'get_production_overview',
        arguments: {},
        tenantId: 'tenant-demo',
        traceId: 'trace-1',
        authorization: {
          userId: 'attacker',
          role: 'system_admin',
          factoryId: 'factory-demo',
          scope: '*',
          sessionId: 'session-1',
        },
      },
      'tenant-demo',
      'user-1',
      'auditor',
      'factory-demo',
      'line-1',
      'session-1',
      'trace-1',
    )).rejects.toThrow('IDENTITY_MISMATCH');
    expect(service.execute).not.toHaveBeenCalled();
  });

  it('requires a service account when the deployment enables that boundary', async () => {
    const previous = process.env.MES_AGENT_REQUIRE_SERVICE_ACCOUNT;
    process.env.MES_AGENT_REQUIRE_SERVICE_ACCOUNT = 'true';
    try {
      const service = { execute: jest.fn() } as unknown as AgentApiService;
      const controller = new AgentApiController(service);

      await expect(controller.execute(
        {
          tool: 'get_production_overview',
          arguments: {},
          tenantId: 'tenant-demo',
          traceId: 'trace-service-account',
        },
        'tenant-demo',
        'user-1',
        'auditor',
        'factory-demo',
        '*',
        'session-1',
        'trace-service-account',
      )).rejects.toThrow(UnauthorizedException);
      expect(service.execute).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.MES_AGENT_REQUIRE_SERVICE_ACCOUNT;
      else process.env.MES_AGENT_REQUIRE_SERVICE_ACCOUNT = previous;
    }
  });
});
