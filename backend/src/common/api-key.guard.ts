import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from './public.decorator';

const EXAMPLE_API_KEY = 'replace-with-a-long-random-api-key';

export interface MesIdentity {
  subject: string;
  role?: string;
  tenantId?: string;
  factoryId?: string;
  scope?: string;
  sessionId?: string;
  traceId?: string;
  issuer?: string;
  audience?: string | string[];
}

export interface MesRequest extends Request {
  mesIdentity?: MesIdentity;
}

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

    const request = context.switchToHttp().getRequest<MesRequest>();
    const realtimeQuery = request.path === '/api/v1/digital-twin/stream' && process.env.MES_REALTIME_ALLOW_QUERY_KEY === 'true';
    request.mesIdentity = this.authenticate(request.headers.authorization, realtimeQuery ? this.queryValue(request.query.apiKey) : undefined);
    this.assertTenant(request.headers['x-tenant-id'], realtimeQuery ? this.queryValue(request.query.tenantId) : undefined, request.mesIdentity?.tenantId);
    this.bindTrustedClaims(request);
    this.assertSession(request);
    this.assertRateLimit(request);
    return true;
  }

  private authenticate(authorization: string | undefined, queryKey?: string): MesIdentity | undefined {
    const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    const jwt = bearer && bearer.split('.').length === 3 && process.env.MES_JWT_SECRET?.trim();
    if (jwt) return this.verifyJwt(bearer, process.env.MES_JWT_SECRET!.trim());

    const expected = process.env.MES_API_KEY?.trim();
    if (!expected || expected === EXAMPLE_API_KEY) {
      throw new UnauthorizedException('API authentication is not configured');
    }

    const supplied = bearer ?? queryKey;
    if (!supplied || !this.secureEquals(supplied, expected)) {
      throw new UnauthorizedException('Valid Bearer API key is required');
    }
    return undefined;
  }

  private assertTenant(value: string | string[] | undefined, queryTenant?: string, identityTenant?: string): void {
    const headerTenant = (Array.isArray(value) ? value[0] : value) ?? queryTenant;
    const tenantId = headerTenant ?? identityTenant;
    const allowedTenants = (process.env.MES_ALLOWED_TENANTS ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    if (!tenantId?.trim() || !allowedTenants.includes(tenantId.trim())) {
      throw new UnauthorizedException('Tenant is missing or not allowed');
    }
    if (identityTenant && headerTenant && identityTenant.trim() !== headerTenant.trim()) {
      throw new UnauthorizedException('JWT tenant does not match request tenant');
    }
  }

  private bindTrustedClaims(request: MesRequest): void {
    const identity = request.mesIdentity;
    if (!identity) return;
    this.setHeaderIfAbsent(request, 'x-user-id', identity.subject);
    if (identity.role) this.setHeaderIfAbsent(request, 'x-user-role', identity.role);
    if (identity.factoryId) this.setHeaderIfAbsent(request, 'x-factory-id', identity.factoryId);
    if (identity.scope) this.setHeaderIfAbsent(request, 'x-scope', identity.scope);
    if (identity.sessionId) this.setHeaderIfAbsent(request, 'x-session-id', identity.sessionId);
    if (identity.traceId) this.setHeaderIfAbsent(request, 'x-trace-id', identity.traceId);
    if (identity.tenantId) this.setHeaderIfAbsent(request, 'x-tenant-id', identity.tenantId);
  }

  private setHeaderIfAbsent(request: MesRequest, key: string, value: string): void {
    if (!request.headers[key]) request.headers[key] = value;
  }

  private verifyJwt(token: string, secret: string): MesIdentity {
    const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
    let header: { alg?: string; typ?: string };
    let payload: Record<string, unknown>;
    try {
      header = JSON.parse(this.decodeBase64Url(encodedHeader)) as { alg?: string; typ?: string };
      payload = JSON.parse(this.decodeBase64Url(encodedPayload)) as Record<string, unknown>;
    } catch {
      throw new UnauthorizedException('Invalid JWT encoding');
    }
    if (header.alg !== 'HS256' || header.typ !== 'JWT') throw new UnauthorizedException('Unsupported JWT algorithm');
    const expected = createHmac('sha256', secret).update(`${encodedHeader}.${encodedPayload}`).digest('base64url');
    if (!this.secureEquals(encodedSignature, expected)) throw new UnauthorizedException('Invalid JWT signature');
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp <= now) throw new UnauthorizedException('JWT has expired');
    if (typeof payload.nbf === 'number' && payload.nbf > now) throw new UnauthorizedException('JWT is not active');
    const issuer = process.env.MES_JWT_ISSUER?.trim();
    if (issuer && payload.iss !== issuer) throw new UnauthorizedException('JWT issuer is invalid');
    const audience = process.env.MES_JWT_AUDIENCE?.trim();
    if (audience && !this.hasAudience(payload.aud, audience)) throw new UnauthorizedException('JWT audience is invalid');
    if (typeof payload.sub !== 'string' || !payload.sub.trim()) throw new UnauthorizedException('JWT subject is required');
    return {
      subject: payload.sub.trim(),
      role: this.claimString(payload.role),
      tenantId: this.claimString(payload.tenantId ?? payload.tenant),
      factoryId: this.claimString(payload.factoryId),
      scope: this.claimString(payload.scope),
      sessionId: this.claimString(payload.sessionId),
      traceId: this.claimString(payload.traceId),
      issuer: this.claimString(payload.iss),
      audience: typeof payload.aud === 'string' || Array.isArray(payload.aud) ? payload.aud as string | string[] : undefined,
    };
  }

  private decodeBase64Url(value: string): string {
    return Buffer.from(value, 'base64url').toString('utf8');
  }

  private claimString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private hasAudience(value: unknown, expected: string): boolean {
    return value === expected || Array.isArray(value) && value.includes(expected);
  }

  private queryValue(value: unknown): string | undefined {
    return typeof value === 'string' ? value : Array.isArray(value) && typeof value[0] === 'string' ? value[0] : undefined;
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
