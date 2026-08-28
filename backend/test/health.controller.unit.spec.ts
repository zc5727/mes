import { HealthController } from '../src/health.controller';

describe('HealthController', () => {
  it('returns a healthy service payload without external dependencies', () => {
    const payload = new HealthController().check();

    expect(payload.status).toBe('ok');
    expect(payload.service).toBe('mes-saas-backend');
    expect(payload.timestamp).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(payload.timestamp))).toBe(false);
  });
});
