import { ExecutionContext, HttpException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHmac } from 'node:crypto';
import { ApiKeyGuard } from '../src/common/api-key.guard';

function createContext(authorization?: string, tenantId?: string, ip = 'test-ip'): ExecutionContext {
  const request = { headers: { authorization, 'x-tenant-id': tenantId }, ip, path: '/api/v1/agent-api/tools/execute', query: {} };
  return {
    getHandler: () => function handler() {},
    getClass: () => class TestController {},
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

describe('ApiKeyGuard', () => {
  const originalApiKey = process.env.MES_API_KEY;
  const originalTenants = process.env.MES_ALLOWED_TENANTS;
  const originalRateLimit = process.env.MES_RATE_LIMIT_PER_MINUTE;
  const originalJwtSecret = process.env.MES_JWT_SECRET;

  beforeEach(() => {
    process.env.MES_API_KEY = 'test-api-key';
    process.env.MES_ALLOWED_TENANTS = 'tenant-demo';
    process.env.MES_RATE_LIMIT_PER_MINUTE = '120';
  });

  afterAll(() => {
    process.env.MES_API_KEY = originalApiKey;
    process.env.MES_ALLOWED_TENANTS = originalTenants;
    process.env.MES_RATE_LIMIT_PER_MINUTE = originalRateLimit;
    process.env.MES_JWT_SECRET = originalJwtSecret;
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

  it('rejects the example API key instead of treating it as deployment credentials', () => {
    process.env.MES_API_KEY = 'replace-with-a-long-random-api-key';
    try {
      const guard = new ApiKeyGuard(new Reflector());

      expect(() => guard.canActivate(createContext(
        'Bearer replace-with-a-long-random-api-key',
        'tenant-demo',
      ))).toThrow(UnauthorizedException);
    } finally {
      process.env.MES_API_KEY = 'test-api-key';
    }
  });

  it('rejects requests over the configured rate limit', () => {
    process.env.MES_RATE_LIMIT_PER_MINUTE = '1';
    const guard = new ApiKeyGuard(new Reflector());
    const context = createContext('Bearer test-api-key', 'tenant-demo', 'rate-limit-ip');

    expect(guard.canActivate(context)).toBe(true);
    expect(() => guard.canActivate(context)).toThrow(HttpException);
  });

  it('verifies an HS256 user token and derives trusted identity headers', () => {
    process.env.MES_JWT_SECRET = 'jwt-test-secret';
    const token = createJwt('jwt-test-secret', {
      sub: 'operator-01', role: 'operator', tenantId: 'tenant-demo',
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const context = createContext(`Bearer ${token}`, undefined);
    const request = context.switchToHttp().getRequest() as { headers: Record<string, string>; mesIdentity?: { subject: string } };

    expect(new ApiKeyGuard(new Reflector()).canActivate(context)).toBe(true);
    expect(request.mesIdentity?.subject).toBe('operator-01');
    expect(request.headers['x-user-id']).toBe('operator-01');
    expect(request.headers['x-user-role']).toBe('operator');
    expect(request.headers['x-role']).toBe('operator');
    expect(request.headers['x-tenant-id']).toBe('tenant-demo');
  });

  it('rejects expired or tampered JWTs', () => {
    process.env.MES_JWT_SECRET = 'jwt-test-secret';
    const expired = createJwt('jwt-test-secret', { sub: 'operator-01', tenantId: 'tenant-demo', exp: Math.floor(Date.now() / 1000) - 1 });
    expect(() => new ApiKeyGuard(new Reflector()).canActivate(createContext(`Bearer ${expired}`, undefined))).toThrow(UnauthorizedException);
    const valid = createJwt('jwt-test-secret', { sub: 'operator-01', tenantId: 'tenant-demo', exp: Math.floor(Date.now() / 1000) + 300 });
    expect(() => new ApiKeyGuard(new Reflector()).canActivate(createContext(`Bearer ${valid.slice(0, -1)}x`, undefined))).toThrow(UnauthorizedException);
  });

  it('applies the JWT factory scope to query defaults and rejects mismatches', () => {
    process.env.MES_JWT_SECRET = 'jwt-test-secret';
    const token = createJwt('jwt-test-secret', {
      sub: 'supervisor-01', role: 'supervisor', tenantId: 'tenant-demo', factoryId: 'factory-01',
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const context = createContext(`Bearer ${token}`, undefined);
    expect(new ApiKeyGuard(new Reflector()).canActivate(context)).toBe(true);
    const request = context.switchToHttp().getRequest() as { query: { factoryId?: string } };
    expect(request.query.factoryId).toBe('factory-01');

    const mismatch = createContext(`Bearer ${token}`, 'tenant-demo');
    const mismatchedRequest = mismatch.switchToHttp().getRequest() as { query: { factoryId: string } };
    mismatchedRequest.query.factoryId = 'factory-02';
    expect(() => new ApiKeyGuard(new Reflector()).canActivate(mismatch)).toThrow(/factory scope/);
  });
});

function createJwt(secret: string, payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const body = encode(payload);
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}
