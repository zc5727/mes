import type { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createTestApp } from './support/test-app';

describe('quality, maintenance and traceability contracts (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('keeps a quality record trace through draft, submission and confirmation', async () => {
    const headers = { 'x-tenant-id': 'tenant-demo' };
    const created = await request(app.getHttpServer())
      .post('/api/v1/foundation/quality-records')
      .set(headers)
      .send({
        batchNo: 'B-TRACE-001', lineId: 'line-cnc', deviceId: 'device-cnc-01',
        workOrderId: 'wo-demo-001', operatorId: 'operator-01', values: { diameter: 10.02 },
        traceId: 'quality-trace-001',
      })
      .expect(201);

    const recordId = created.body.data.id;
    expect(created.body.data).toEqual(expect.objectContaining({
      tenantId: 'tenant-demo', status: 'draft', traceId: 'quality-trace-001',
    }));

    await request(app.getHttpServer())
      .post(`/api/v1/foundation/quality-records/${recordId}/submit`)
      .set(headers)
      .send({ actorId: 'inspector-01' })
      .expect(201);

    const confirmed = await request(app.getHttpServer())
      .post(`/api/v1/foundation/quality-records/${recordId}/confirm`)
      .set(headers)
      .send({ actorId: 'quality-manager-01' })
      .expect(201);

    expect(confirmed.body.data.status).toBe('confirmed');
    expect(confirmed.body.data.trace.map((event: { type: string }) => event.type))
      .toEqual(['draft_created', 'submitted', 'confirmed']);
  });

  it('enforces maintenance transitions and requires a completion reason', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/maintenance/work-orders')
      .set('x-tenant-id', 'tenant-demo')
      .send({
        lineId: 'line-cnc', deviceId: 'device-cnc-01', type: 'repair',
        title: '更换主轴润滑组件', plannedAt: '2026-09-01T09:00:00.000Z',
      })
      .expect(201);
    const orderId = created.body.data.id;

    await request(app.getHttpServer())
      .patch(`/api/v1/maintenance/work-orders/${orderId}/status`)
      .set('x-tenant-id', 'tenant-demo')
      .send({ status: 'assigned' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/maintenance/work-orders/${orderId}/status`)
      .set('x-tenant-id', 'tenant-demo')
      .send({ status: 'in_progress' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/maintenance/work-orders/${orderId}/status`)
      .set('x-tenant-id', 'tenant-demo')
      .send({ status: 'completed' })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/api/v1/maintenance/work-orders/${orderId}/status`)
      .set('x-tenant-id', 'tenant-demo')
      .send({ status: 'completed', reason: '维修完成并通过点检' })
      .expect(200)
      .expect(({ body }) => expect(body.data).toEqual(expect.objectContaining({ status: 'completed' })));
  });

  it('proves quality release, batch consumption/return and work-order completion change state together', async () => {
    const headers = { 'x-tenant-id': 'tenant-demo' };
    const batch = await request(app.getHttpServer())
      .post('/api/v1/master-data/batches').set(headers)
      .send({ materialCode: 'RAW-E2E', batchNo: 'B-E2E-001', quantity: 10 }).expect(201);
    const quality = await request(app.getHttpServer())
      .post('/api/v1/foundation/quality-records').set(headers)
      .send({ batchNo: 'FG-E2E-001', lineId: 'line-cnc', workOrderId: 'wo-demo-001', operatorId: 'inspector-e2e', values: {}, traceId: 'quality-e2e-release-001' }).expect(201);
    const qualityId = quality.body.data.id;
    await request(app.getHttpServer()).post('/api/v1/work-orders/wo-demo-001/report').set(headers)
      .send({ quantity: 420, qualityRecordId: qualityId, materialConsumptions: [{ materialCode: 'RAW-E2E', batchNo: 'B-E2E-001', quantity: 5 }], sourceTraceId: 'report-e2e-release-001' }).expect(409);

    await request(app.getHttpServer()).post(`/api/v1/foundation/quality-records/${qualityId}/submit`).set(headers).send({ actorId: 'inspector-e2e' }).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/foundation/quality-records/${qualityId}/confirm`).set(headers).send({ actorId: 'manager-e2e' }).expect(201);
    const completed = await request(app.getHttpServer()).post('/api/v1/work-orders/wo-demo-001/report').set(headers)
      .send({ quantity: 420, qualityRecordId: qualityId, materialConsumptions: [{ materialCode: 'RAW-E2E', batchNo: 'B-E2E-001', quantity: 5 }], sourceTraceId: 'report-e2e-release-001' }).expect(201);
    expect(completed.body.data.workOrder.status).toBe('completed');
    expect(completed.body.data.workOrder.completedQty).toBe(1200);
    expect(batch.body.data.quantity).toBe(10);
    expect((await request(app.getHttpServer()).get('/api/v1/master-data/batches').set(headers)).body.data.find((item: { batchNo: string }) => item.batchNo === 'B-E2E-001').quantity).toBe(5);
    await request(app.getHttpServer()).post('/api/v1/master-data/batches/return').set(headers).send({ materialCode: 'RAW-E2E', batchNo: 'B-E2E-001', quantity: 5, idempotencyKey: 'return-e2e-001' }).expect(201);
    await request(app.getHttpServer()).post('/api/v1/master-data/batches/return').set(headers).send({ materialCode: 'RAW-E2E', batchNo: 'B-E2E-001', quantity: 5, idempotencyKey: 'return-e2e-001' }).expect(201);
    expect((await request(app.getHttpServer()).get('/api/v1/master-data/batches').set(headers)).body.data.find((item: { batchNo: string }) => item.batchNo === 'B-E2E-001').quantity).toBe(10);
  });
});
