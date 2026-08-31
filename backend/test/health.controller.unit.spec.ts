import { HealthController } from '../src/health.controller';

describe('HealthController', () => {
  it('returns a healthy service payload without external dependencies', () => {
    const payload = new HealthController().check();

    expect(payload.status).toBe('ok');
    expect(payload.service).toBe('mes-saas-backend');
    expect(payload.timestamp).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(payload.timestamp))).toBe(false);
  });

  it('reports degraded readiness when PostgreSQL is disabled', async () => {
    await expect(new HealthController().readiness()).resolves.toEqual({
      status: 'degraded', service: 'mes-saas-backend', database: { enabled: false, status: 'disabled' },
    });
  });

  it('exposes a degraded readiness result when the database is unavailable', async () => {
    const prisma = { readiness: jest.fn().mockResolvedValue({ enabled: true, status: 'unavailable' }) };
    await expect(new HealthController(prisma as never).readiness()).resolves.toEqual({
      status: 'degraded', service: 'mes-saas-backend', database: { enabled: true, status: 'unavailable' },
    });
  });

  it('reports ready only after PostgreSQL readiness succeeds', async () => {
    const prisma = { readiness: jest.fn().mockResolvedValue({ enabled: true, status: 'ready' }) };
    await expect(new HealthController(prisma as never).readiness()).resolves.toEqual({
      status: 'ready', service: 'mes-saas-backend', database: { enabled: true, status: 'ready' },
    });
  });

  it('returns dependency diagnostics without exposing broker credentials', async () => {
    const prisma = { readiness: jest.fn().mockResolvedValue({ enabled: true, status: 'ready' }) };
    const mqtt = {
      getStatus: jest.fn().mockReturnValue({
        enabled: true,
        connected: true,
        state: 'connected',
        brokerUrl: 'mqtt://secret-user:secret-password@localhost:1883',
        telemetryTopic: 'mes/+/telemetry',
        alarmsTopic: 'mes/+/alarms',
        lastHeartbeatAt: '2026-09-01T00:00:00.000Z',
        lastError: null,
        lastErrorCode: null,
        reconnectAttempts: 0,
        messages: { received: 1, telemetry: 1, alarms: 0, http: 0, accepted: 1, duplicate: 0, stale: 0, malformed: 0, rejected: 0 },
      }),
    };

    const payload = await new HealthController(prisma as never, mqtt as never).components();

    expect(payload).toEqual({
      service: 'mes-saas-backend',
      timestamp: expect.any(String),
      database: { enabled: true, status: 'ready' },
      mqtt: {
        enabled: true,
        connected: true,
        state: 'connected',
        lastHeartbeatAt: '2026-09-01T00:00:00.000Z',
        lastError: null,
        lastErrorCode: null,
      },
    });
    expect(JSON.stringify(payload)).not.toContain('secret-password');
  });
});
