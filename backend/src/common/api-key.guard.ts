import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Protects the HTTP API behind the configured gateway key.
 *
 * This is a deployment baseline, not a substitute for user JWT/SSO. The
 * tenant allow-list prevents a valid gateway key from selecting arbitrary
 * tenant data until the identity provider is connected.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    this.assertApiKey(request.headers.authorization);
    this.assertTenant(request.headers['x-tenant-id']);
    return true;
  }

  private assertApiKey(authorization: string | undefined): void {
    const expected = process.env.MES_API_KEY?.trim();
    if (!expected) {
      throw new UnauthorizedException('API authentication is not configured');
    }

    const supplied = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!supplied || !this.secureEquals(supplied, expected)) {
      throw new UnauthorizedException('Valid Bearer API key is required');
    }
  }

  private assertTenant(value: string | string[] | undefined): void {
    const tenantId = Array.isArray(value) ? value[0] : value;
    const allowedTenants = (process.env.MES_ALLOWED_TENANTS ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    if (!tenantId?.trim() || !allowedTenants.includes(tenantId.trim())) {
      throw new UnauthorizedException('Tenant is missing or not allowed');
    }
  }

  private secureEquals(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length
      && timingSafeEqual(leftBuffer, rightBuffer);
  }
}
