import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { StrategyAuthorizationService } from '../src/strategies/strategy-authorization.service';
import { StrategySnapshot } from '../src/strategies/strategy.types';

const snapshot: StrategySnapshot = {
  timestamp: '2026-08-30T08:00:00.000Z',
  factoryId: 'factory-demo',
  lines: [
    { id: 'LINE-01', name: '一线', capacityPerHour: 20, active: true },
    { id: 'LINE-02', name: '二线', capacityPerHour: 20, active: true },
  ],
  devices: [{ id: 'DEV-01', lineId: 'LINE-01', status: 'online', capacityPerHour: 20 }],
  workOrders: [{ id: 'WO-01', lineId: 'LINE-01', remainingQty: 10, dueAt: '2026-08-30T12:00:00.000Z', priority: 1, status: 'running' }],
};

const headers = (overrides: Record<string, string> = {}) => ({
  userId: 'user-001',
  role: 'production_supervisor',
  factoryId: 'factory-demo',
  scope: 'LINE-01',
  sessionId: 'session-001',
  traceId: 'trace-001',
  ...overrides,
});

describe('StrategyAuthorizationService', () => {
  it('requires a complete identity context and normalizes role aliases', () => {
    const service = new StrategyAuthorizationService();
    expect(service.fromHeaders(headers({ role: '生产主管', scope: '["LINE-01"]' })).role).toBe('production_supervisor');
    expect(() => service.fromHeaders(headers({ traceId: '' }))).toThrow(UnauthorizedException);
  });

  it('rejects forbidden roles and resources outside the caller scope', () => {
    const service = new StrategyAuthorizationService();
    const operator = service.fromHeaders(headers({ role: 'operator' }));
    expect(() => service.assertCanSimulate(operator, snapshot)).toThrow(ForbiddenException);

    const scoped = service.fromHeaders(headers());
    expect(() => service.assertCanSimulate(scoped, snapshot)).toThrow(/RESOURCE_SCOPE_DENIED/);
  });

  it('allows only full-scope governance roles to use wildcard scope', () => {
    const service = new StrategyAuthorizationService();
    const manager = service.fromHeaders(headers({ role: 'plant_manager', scope: '*' }));
    expect(() => service.assertCanSimulate(manager, snapshot)).not.toThrow();

    const supervisor = service.fromHeaders(headers({ role: 'production_supervisor', scope: '*' }));
    expect(() => service.assertCanSimulate(supervisor, snapshot)).toThrow(/RESOURCE_SCOPE_DENIED/);
  });
});
