import type { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createTestApp } from './support/test-app';

describe('production line create API contract (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a line in the tenant from x-tenant-id', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/production-lines')
      .set('x-tenant-id', 'tenant-demo')
      .send({ factoryId: 'factory-demo', code: 'L100', name: '包装线', type: '包装' })
      .expect(201)
      .expect(({ body }) => {
        expect(body.tenantId).toBe('tenant-demo');
        expect(body.data).toEqual(expect.objectContaining({
          tenantId: 'tenant-demo',
          factoryId: 'factory-demo',
          code: 'L100',
          targetOee: 85,
          status: 'active',
        }));
      });
  });

  it('rejects an invalid type and out-of-range target OEE', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/production-lines')
      .set('x-tenant-id', 'tenant-demo')
      .send({ factoryId: 'factory-demo', code: 'L101', name: '包装线', type: 'X', targetOee: 101 })
      .expect(400);
  });
});
