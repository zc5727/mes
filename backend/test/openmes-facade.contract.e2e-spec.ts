import type { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createTestApp } from './support/test-app';

/**
 * Contract gate for the OpenMES-facing NestJS facade.
 *
 * The test app is the deterministic mock of the external OpenMES/IoT
 * services. It deliberately verifies the facade shape consumed by the
 * existing digital-twin UI without requiring an OpenMES deployment.
 */
describe('OpenMES facade compatibility contract (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('keeps the existing UI read endpoints available behind tenant auth', async () => {
    const server = app.getHttpServer();
    const endpoints = [
      '/production-lines',
      '/devices',
      '/work-orders/overview',
      '/agvs',
      '/alarms',
      '/dashboard/overview',
    ];

    for (const endpoint of endpoints) {
      await request(server)
        .get(`/api/v1${endpoint}`)
        .set('x-tenant-id', 'tenant-demo')
        .expect(200)
        .expect(({ body }) => {
          expect(body).toHaveProperty('data');
          expect(body.tenantId).toBe('tenant-demo');
        });
    }
  });

  it('preserves the four-line digital twin contract', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/digital-twin/snapshot')
      .set('x-tenant-id', 'tenant-demo')
      .expect(200)
      .expect(({ body }) => {
        const snapshot = body.data;
        expect(body.tenantId).toBe('tenant-demo');
        expect(snapshot).toEqual(expect.objectContaining({
          state: 'current',
          tenantId: 'tenant-demo',
          snapshotVersion: expect.any(String),
          lines: expect.any(Array),
          devices: expect.any(Array),
          alarms: expect.any(Array),
        }));
        expect(snapshot.lines).toHaveLength(4);
        expect(snapshot.lines).toEqual(expect.arrayContaining([
          expect.objectContaining({ lineId: 'line-cnc' }),
          expect.objectContaining({ lineId: 'line-assembly' }),
          expect.objectContaining({ lineId: 'line-welding' }),
          expect.objectContaining({ lineId: 'line-vision' }),
        ]));
      });
  });

  it('rejects a facade request without the gateway key', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/digital-twin/snapshot')
      .set('x-tenant-id', 'tenant-demo')
      .set('authorization', '')
      .expect(401);
  });
});
