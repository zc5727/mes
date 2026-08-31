import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeyGuard } from '../src/common/api-key.guard';

function createContext(authorization?: string, tenantId?: string): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class TestController {},
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization, 'x-tenant-id': tenantId } }),
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

describe('ApiKeyGuard', () => {
  const originalApiKey = process.env.MES_API_KEY;
  const originalTenants = process.env.MES_ALLOWED_TENANTS;

  beforeEach(() => {
    process.env.MES_API_KEY = 'test-api-key';
    process.env.MES_ALLOWED_TENANTS = 'tenant-demo';
  });

  afterAll(() => {
    process.env.MES_API_KEY = originalApiKey;
    process.env.MES_ALLOWED_TENANTS = originalTenants;
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
});
