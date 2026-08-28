import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const DEFAULT_TENANT_ID = 'tenant-demo';

/**
 * Reads the tenant from the request header used by the SaaS API.
 * The demo falls back to tenant-demo so the endpoints can be used without
 * authentication while the identity service is still under development.
 */
export const TenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<{ headers?: Record<string, string | string[] | undefined> }>();
    const value = request.headers?.['x-tenant-id'];
    const tenantId = Array.isArray(value) ? value[0] : value;

    return tenantId?.trim() || DEFAULT_TENANT_ID;
  },
);
