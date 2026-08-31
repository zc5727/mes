import { SetMetadata } from '@nestjs/common';

export type RouteCapability = 'read' | 'write' | 'control' | 'admin';

export const ROUTE_CAPABILITY_KEY = 'route-capability';

/** Declares the minimum capability required by an HTTP route. */
export const RequireCapability = (
  capability: RouteCapability,
): ClassDecorator & MethodDecorator =>
  SetMetadata(ROUTE_CAPABILITY_KEY, capability) as ClassDecorator & MethodDecorator;
