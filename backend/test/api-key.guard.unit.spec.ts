import { ExecutionContext, HttpException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeyGuard } from '../src/common/api-key.guard';

function createContext(authorization?: string, tenantId?: string, ip = 'test-ip'): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class TestController {},
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization, 'x-tenant-id': tenantId }, ip, path: '/api/v1/agent-api/tools/execute' }),
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

describe('ApiKeyGuard', () => {
  const originalApiKey = process.env.MES_API_KEY;
  const originalTenants = process.env.MES_ALLOWED_TENANTS;
  const originalRateLimit = process.env.MES_RATE_LIMIT_PER_MINUTE;

  beforeEach(() => {
    process.env.MES_API_KEY = 'test-api-key';
    process.env.MES_ALLOWED_TENANTS = 'tenant-demo';
    process.env.MES_RATE_LIMIT_PER_MINUTE = '120';
  });

  afterAll(() => {
    process.env.MES_API_KEY = originalApiKey;
    process.env.MES_ALLOWED_TENANTS = originalTenants;
    process.env.MES_RATE_LIMIT_PER_MINUTE = originalRateLimit;
  });

  it('accepts the configured key and tenant', () => {
    const guard = new ApiKeyGuard(new Reflector());

    expect(guard.canActivate(createContext('Bearer test-api-key', 'tenant-demo'))).toBe(true);
  });

  it('rejects missing credentials and unapproved tenants', () => {
    const guard = new ApiKeyGuard(new Reflector());

    expect(() => guard.canActivate(createContext(undefined, 'tenant-demo')))
      .toThrow(UnauthorizedException);
    expect(() => guard.canActivate(createContext('Bearer test-api-key', 'tenant-other')))
      .toThrow(UnauthorizedException);
  });

  it('rejects requests over the configured rate limit', () => {
    process.env.MES_RATE_LIMIT_PER_MINUTE = '1';
    const guard = new ApiKeyGuard(new Reflector());
    const context = createContext('Bearer test-api-key', 'tenant-demo', 'rate-limit-ip');

    expect(guard.canActivate(context)).toBe(true);
    expect(() => guard.canActivate(context)).toThrow(HttpException);
  });
});
