import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';

/**
 * Reads the tenant from the request header used by the API.
 * Missing tenant identity is rejected instead of silently selecting a demo
 * tenant, which prevents accidental cross-tenant writes in unguarded paths.
 */
export const TenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<{ headers?: Record<string, string | string[] | undefined> }>();
    const value = request.headers?.['x-tenant-id'];
    const tenantId = Array.isArray(value) ? value[0] : value;

    if (!tenantId?.trim()) {
      throw new UnauthorizedException('Tenant is required');
    }
    return tenantId.trim();
  },
);
