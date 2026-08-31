import type { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createTestApp } from './support/test-app';

describe('inventory execution API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });

  it('receives stock, issues it to a work order, and exposes the ledger', async () => {
    const headers = { 'x-tenant-id': 'tenant-demo', 'x-user-role': 'operator' };
    await request(app.getHttpServer()).post('/api/v1/inventory/materials?factoryId=factory-demo').set(headers)
      .send({ code: 'MAT-E2E', name: '测试物料', unit: '件' }).expect(201);
    await request(app.getHttpServer()).post('/api/v1/inventory/locations?factoryId=factory-demo').set(headers)
      .send({ warehouseCode: 'WH-E2E', locationCode: 'E2E-01' }).expect(201);

    await request(app.getHttpServer()).post('/api/v1/inventory/receipts?factoryId=factory-demo').set(headers)
      .send({ materialCode: 'MAT-E2E', batchNo: 'B-E2E', locationCode: 'E2E-01', quantity: 12, idempotencyKey: 'receipt-e2e' }).expect(201);
    await request(app.getHttpServer()).post('/api/v1/inventory/issues?factoryId=factory-demo').set(headers)
      .send({ materialCode: 'MAT-E2E', batchNo: 'B-E2E', locationCode: 'E2E-01', quantity: 5, workOrderId: 'WO-E2E', idempotencyKey: 'issue-e2e' }).expect(201);

    await request(app.getHttpServer()).get('/api/v1/inventory/balances?factoryId=factory-demo&materialCode=MAT-E2E').set(headers)
      .expect(200).expect(({ body }) => expect(body.data).toEqual(expect.arrayContaining([
        expect.objectContaining({ materialCode: 'MAT-E2E', batchNo: 'B-E2E', quantity: 7 }),
      ])));
  });

  it('rejects an issue that would create a negative balance', async () => {
    await request(app.getHttpServer()).post('/api/v1/inventory/issues?factoryId=factory-demo').set('x-tenant-id', 'tenant-demo')
      .set('x-user-role', 'operator')
      .send({ materialCode: 'MAT-E2E', batchNo: 'B-E2E', locationCode: 'E2E-01', quantity: 100, idempotencyKey: 'issue-negative-e2e' })
      .expect(409);
  });
});
