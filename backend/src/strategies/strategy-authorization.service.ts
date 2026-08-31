import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import {
  StrategyRequestContext,
  StrategyRole,
  StrategySnapshot,
} from './strategy.types';

const ROLE_ALIASES: Record<string, StrategyRole> = {
  system_admin: 'system_admin',
  'system-admin': 'system_admin',
  系统管理员: 'system_admin',
  admin: 'system_admin',
  plant_manager: 'plant_manager',
  'plant-manager': 'plant_manager',
  厂长: 'plant_manager',
  production_supervisor: 'production_supervisor',
  'production-supervisor': 'production_supervisor',
  生产主管: 'production_supervisor',
  supervisor: 'production_supervisor',
  equipment_supervisor: 'equipment_supervisor',
  'equipment-supervisor': 'equipment_supervisor',
  设备主管: 'equipment_supervisor',
  engineer: 'equipment_supervisor',
  quality_supervisor: 'quality_supervisor',
  'quality-supervisor': 'quality_supervisor',
  质量主管: 'quality_supervisor',
  team_leader: 'team_leader',
  'team-leader': 'team_leader',
  班组长: 'team_leader',
  operator: 'operator',
  操作员: 'operator',
  auditor: 'auditor',
  审计员: 'auditor',
  观察员: 'auditor',
  viewer: 'auditor',
};

const SIMULATION_ROLES = new Set<StrategyRole>([
  'system_admin',
  'plant_manager',
  'production_supervisor',
  'equipment_supervisor',
  'quality_supervisor',
]);

const READ_ROLES = new Set<StrategyRole>([
  ...SIMULATION_ROLES,
  'team_leader',
  'auditor',
]);

export const STRATEGY_ACTION_MATRIX: Readonly<Record<StrategyRole, ReadonlySet<'read' | 'simulate' | 'approve' | 'execute' | 'rollback'>>> = {
  system_admin: new Set(['read', 'simulate', 'approve', 'execute', 'rollback']),
  plant_manager: new Set(['read', 'simulate', 'approve', 'execute', 'rollback']),
  production_supervisor: new Set(['read', 'simulate', 'approve', 'execute', 'rollback']),
  equipment_supervisor: new Set(['read', 'simulate', 'approve']),
  quality_supervisor: new Set(['read', 'simulate']),
  team_leader: new Set(['read']),
  operator: new Set([]),
  auditor: new Set(['read']),
};

@Injectable()
export class StrategyAuthorizationService {
  /** Build a trusted request context from the identity headers supplied by the API gateway. */
  fromHeaders(input: {
    userId?: string;
    role?: string;
    factoryId?: string;
    scope?: string;
    sessionId?: string;
    traceId?: string;
  }): StrategyRequestContext {
    const userId = this.required(input.userId, 'userId');
    const factoryId = this.required(input.factoryId, 'factoryId');
    const sessionId = this.required(input.sessionId, 'sessionId');
    const traceId = this.required(input.traceId, 'traceId');
    const roleValue = this.required(input.role, 'role').toLowerCase();
    const role = ROLE_ALIASES[roleValue];
    if (!role) throw new ForbiddenException('ROLE_FORBIDDEN: unknown role');

    const scope = this.parseScope(input.scope);
    return { userId, role, factoryId, scope, sessionId, traceId };
  }

  /** Ensure a caller may submit a strategy simulation for every resource in a snapshot. */
  assertCanSimulate(context: StrategyRequestContext, snapshot: StrategySnapshot): void {
    this.assertAction(context, 'simulate', 'strategy simulation is not permitted');
    this.assertSnapshotAccess(context, snapshot);
  }

  /** Ensure a caller may read strategy results and audit records. */
  assertCanRead(context: StrategyRequestContext): void {
    if (!READ_ROLES.has(context.role)) throw new ForbiddenException('ROLE_FORBIDDEN: strategy result is not readable');
    this.assertAction(context, 'read', 'strategy result is not readable');
  }

  /** Discard a simulation result only; this never authorizes production execution. */
  assertCanRollback(context: StrategyRequestContext): void {
    this.assertAction(context, 'rollback', 'simulation rollback is not permitted');
  }

  assertCanApprove(context: StrategyRequestContext): void {
    this.assertAction(context, 'approve', 'strategy approval is not permitted');
  }

  assertCanExecute(context: StrategyRequestContext): void {
    this.assertAction(context, 'execute', 'simulated strategy execution is not permitted');
  }

  /** Restrict direct audit writes to roles responsible for audit integrity. */
  assertCanRecordAudit(context: StrategyRequestContext): void {
    if (!new Set<StrategyRole>(['system_admin', 'plant_manager']).has(context.role)) {
      throw new ForbiddenException('ROLE_FORBIDDEN: audit records are not writable by this role');
    }
  }

  /** Restrict simulator control to operational roles; never infer identity. */
  assertCanControlSimulator(context: StrategyRequestContext): void {
    const allowedRoles = new Set<StrategyRole>([
      'system_admin',
      'plant_manager',
      'production_supervisor',
      'equipment_supervisor',
    ]);
    if (!allowedRoles.has(context.role)) {
      throw new ForbiddenException(
        'ROLE_FORBIDDEN: simulator control is not permitted for this role',
      );
    }
  }

  private assertAction(context: StrategyRequestContext, action: 'read' | 'simulate' | 'approve' | 'execute' | 'rollback', message: string): void {
    if (!STRATEGY_ACTION_MATRIX[context.role]?.has(action)) throw new ForbiddenException(`ROLE_FORBIDDEN: ${message}`);
  }

  /** Check factory and line/resource scope without trusting a client-selected role or scope. */
  assertSnapshotAccess(context: StrategyRequestContext, snapshot: StrategySnapshot): void {
    if (snapshot.factoryId && snapshot.factoryId !== context.factoryId) {
      throw new ForbiddenException('TENANT_SCOPE_DENIED: factory is outside the request context');
    }

    const fullScope = context.scope.includes('*') || context.scope.includes(`factory:${context.factoryId}`);
    if (fullScope && (context.role === 'system_admin' || context.role === 'plant_manager')) return;

    const scope = new Set(context.scope);
    const allowed = (kind: string, id: string, lineId?: string): boolean => (
      (scope.has('*') && (context.role === 'system_admin' || context.role === 'plant_manager'))
      || scope.has(id)
      || scope.has(`${kind}:${id}`)
      || (lineId !== undefined && (scope.has(lineId) || scope.has(`line:${lineId}`)))
    );

    const deniedLines = snapshot.lines.filter((line) => !allowed('line', line.id));
    if (deniedLines.length > 0) {
      throw new ForbiddenException(`RESOURCE_SCOPE_DENIED: line ${deniedLines[0].id} is outside the request scope`);
    }
    const deniedDevices = snapshot.devices.filter((device) => !allowed('device', device.id, device.lineId));
    if (deniedDevices.length > 0) {
      throw new ForbiddenException(`RESOURCE_SCOPE_DENIED: device ${deniedDevices[0].id} is outside the request scope`);
    }
    const deniedOrders = snapshot.workOrders.filter((order) => !allowed('workOrder', order.id, order.lineId));
    if (deniedOrders.length > 0) {
      throw new ForbiddenException(`RESOURCE_SCOPE_DENIED: work order ${deniedOrders[0].id} is outside the request scope`);
    }
  }

  /** Apply the same scope rules to a single Agent resource lookup. */
  assertResourceAccess(context: StrategyRequestContext, kind: string, id: string, lineId?: string): void {
    const fullScope = context.scope.includes('*') || context.scope.includes(`factory:${context.factoryId}`);
    if (fullScope && (context.role === 'system_admin' || context.role === 'plant_manager')) return;
    const scope = new Set(context.scope);
    const allowed = scope.has('*') && (context.role === 'system_admin' || context.role === 'plant_manager')
      || scope.has(id)
      || scope.has(`${kind}:${id}`)
      || (lineId !== undefined && (scope.has(lineId) || scope.has(`line:${lineId}`)));
    if (!allowed) throw new ForbiddenException(`RESOURCE_SCOPE_DENIED: ${kind} ${id} is outside the request scope`);
  }

  private required(value: string | undefined, field: string): string {
    if (!value?.trim()) throw new UnauthorizedException(`AUTH_REQUIRED: ${field} is required`);
    return value.trim();
  }

  private parseScope(value: string | undefined): string[] {
    const raw = value?.trim();
    if (!raw) throw new UnauthorizedException('AUTH_REQUIRED: scope is required');
    const entries = raw.startsWith('[')
      ? this.parseJsonScope(raw)
      : raw.split(',').map((item) => item.trim()).filter(Boolean);
    if (entries.length === 0) throw new UnauthorizedException('AUTH_REQUIRED: scope is required');
    return [...new Set(entries)];
  }

  private parseJsonScope(value: string): string[] {
    try {
      const parsed: unknown = JSON.parse(value);
      if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string' || !item.trim())) {
        throw new Error('scope must be a string array');
      }
      return parsed.map((item) => item.trim());
    } catch (error: unknown) {
      throw new UnauthorizedException(`AUTH_REQUIRED: invalid scope (${error instanceof Error ? error.message : 'parse error'})`);
    }
  }
}
