import { UnauthorizedException } from '@nestjs/common';
import { AgentApiController } from '../src/agent-api/agent-api.controller';
import { AgentApiService } from '../src/agent-api/agent-api.service';

describe('AgentApiController identity boundary', () => {
  it('rejects a request that has only body-supplied identity', () => {
    const service = { execute: jest.fn() } as unknown as AgentApiService;
    const controller = new AgentApiController(service);

    expect(() => controller.execute(
      {
        tool: 'get_production_overview',
        arguments: {},
        tenantId: 'tenant-demo',
        traceId: 'trace-1',
      },
      'tenant-demo',
    )).toThrow(UnauthorizedException);
    expect(service.execute).not.toHaveBeenCalled();
  });

  it('uses gateway headers instead of allowing body identity to escalate access', () => {
    const service = {
      execute: jest.fn((request) => request),
    } as unknown as AgentApiService;
    const controller = new AgentApiController(service);

    controller.execute(
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

  it('rejects mismatched body identity before dispatch', () => {
    const service = { execute: jest.fn() } as unknown as AgentApiService;
    const controller = new AgentApiController(service);

    expect(() => controller.execute(
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
    )).toThrow('IDENTITY_MISMATCH');
    expect(service.execute).not.toHaveBeenCalled();
  });
});
