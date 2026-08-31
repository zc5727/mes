import 'reflect-metadata';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleCapabilityGuard } from '../src/common/role-capability.guard';
import { ROUTE_CAPABILITY_KEY, type RouteCapability } from '../src/common/route-capability.decorator';

function createContext(method: string, capability?: RouteCapability, role?: string): ExecutionContext {
  const handler = () => undefined;
  if (capability) Reflect.defineMetadata(ROUTE_CAPABILITY_KEY, capability, handler);
  return {
    getHandler: () => handler,
    getClass: () => class TestController {},
    switchToHttp: () => ({
      getRequest: () => ({ method, headers: { 'x-user-role': role } }),
    }),
  } as unknown as ExecutionContext;
}

describe('RoleCapabilityGuard', () => {
  const guard = new RoleCapabilityGuard(new Reflector());

  it('keeps health and read methods compatible without a role header', () => {
    expect(guard.canActivate(createContext('GET'))).toBe(true);
    expect(guard.canActivate(createContext('GET', 'admin'))).toBe(true);
    expect(guard.canActivate(createContext('HEAD'))).toBe(true);
    expect(guard.canActivate(createContext('OPTIONS', 'control'))).toBe(true);
  });

  it('requires an explicit capability on mutating routes', () => {
    expect(() => guard.canActivate(createContext('POST')))
      .toThrow(ForbiddenException);
  });

  it('enforces the least-privilege role matrix', () => {
    expect(() => guard.canActivate(createContext('POST', 'write')))
      .toThrow(UnauthorizedException);
    expect(() => guard.canActivate(createContext('POST', 'write', 'viewer')))
      .toThrow(ForbiddenException);
    expect(guard.canActivate(createContext('POST', 'write', 'operator'))).toBe(true);
    expect(() => guard.canActivate(createContext('POST', 'control', 'operator')))
      .toThrow(ForbiddenException);
    expect(guard.canActivate(createContext('POST', 'control', 'engineer'))).toBe(true);
    expect(guard.canActivate(createContext('POST', 'admin', 'admin'))).toBe(true);
    expect(() => guard.canActivate(createContext('POST', 'admin', 'supervisor')))
      .toThrow(ForbiddenException);
  });
});
