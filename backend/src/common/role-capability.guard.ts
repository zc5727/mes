import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from './public.decorator';
import {
  ROUTE_CAPABILITY_KEY,
  type RouteCapability,
} from './route-capability.decorator';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Enforces the small role matrix at the HTTP boundary.
 *
 * Read routes deliberately remain compatible with existing API consumers;
 * mutating routes must opt into an explicit capability annotation.
 */
@Injectable()
export class RoleCapabilityGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.isPublic(context)) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const capability = this.reflector.getAllAndOverride<RouteCapability>(
      ROUTE_CAPABILITY_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Read-only requests remain compatible even when their controller also
    // contains administrative write routes.
    if (READ_METHODS.has(request.method)) return true;

    if (!capability) {
      throw new ForbiddenException(
        'ROUTE_CAPABILITY_MISSING: mutating routes must declare a capability',
      );
    }

    if (capability === 'read') return true;

    const role = this.headerValue(request.headers['x-user-role']);
    if (!role) {
      throw new UnauthorizedException(
        'ROLE_REQUIRED: x-user-role is required for write and control routes',
      );
    }

    const normalizedRole = this.normalizeRole(role);
    if (!this.allowedRoles(capability).has(normalizedRole)) {
      throw new ForbiddenException(
        `ROLE_FORBIDDEN: ${role} cannot perform ${capability} operations`,
      );
    }
    return true;
  }

  private isPublic(context: ExecutionContext): boolean {
    return this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) === true;
  }

  private headerValue(value: string | string[] | undefined): string | undefined {
    const normalized = Array.isArray(value) ? value[0] : value;
    const trimmed = normalized?.trim();
    return trimmed || undefined;
  }

  private allowedRoles(
    capability: Exclude<RouteCapability, 'read'>,
  ): ReadonlySet<string> {
    switch (capability) {
      case 'write':
        return new Set(['operator', 'engineer', 'supervisor', 'admin']);
      case 'control':
        return new Set(['engineer', 'supervisor', 'admin']);
      case 'admin':
        return new Set(['admin']);
    }
  }

  private normalizeRole(role: string): string {
    const aliases: Record<string, string> = {
      'plant-manager': 'supervisor',
      plant_manager: 'supervisor',
      厂长: 'supervisor',
      production_supervisor: 'supervisor',
      'production-supervisor': 'supervisor',
      生产主管: 'supervisor',
      equipment_supervisor: 'engineer',
      'equipment-supervisor': 'engineer',
      设备主管: 'engineer',
      quality_supervisor: 'engineer',
      'quality-supervisor': 'engineer',
      质量主管: 'engineer',
      system_admin: 'admin',
    };
    const normalized = role.trim().toLowerCase();
    return aliases[normalized] ?? normalized;
  }
}
