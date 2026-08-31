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
});
