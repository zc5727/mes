import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  HttpException,
  HttpStatus,
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
  private readonly rateWindows = new Map<string, { startedAt: number; count: number }>();
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
    this.assertSession(request);
    this.assertRateLimit(request);
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

  private assertSession(request: Request): void {
    if (process.env.MES_REQUIRE_SESSION !== 'true') return;
    const protectedRoute = request.path.startsWith('/api/v1/agent-api') || request.path.startsWith('/api/v1/strategies');
    if (protectedRoute && !String(request.headers['x-session-id'] ?? '').trim()) {
      throw new UnauthorizedException('Session is required for Agent and strategy APIs');
    }
  }

  private assertRateLimit(request: Request): void {
    const limit = Number(process.env.MES_RATE_LIMIT_PER_MINUTE ?? 120);
    if (!Number.isFinite(limit) || limit <= 0) return;
    const now = Date.now();
    const key = `${request.ip}:${request.headers['x-tenant-id'] ?? ''}`;
    const current = this.rateWindows.get(key);
    const window = !current || now - current.startedAt >= 60_000
      ? { startedAt: now, count: 0 }
      : current;
    window.count += 1;
    this.rateWindows.set(key, window);
    if (window.count > limit) throw new HttpException('Rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
  }

  private secureEquals(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length
      && timingSafeEqual(leftBuffer, rightBuffer);
  }
}
