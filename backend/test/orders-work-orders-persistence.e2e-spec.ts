import type { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createTestApp } from './support/test-app';

describe('orders to work-orders production execution (e2e)', () => {
  let app: INestApplication;
  const headers = { 'x-tenant-id': 'tenant-demo', 'x-user-role': 'supervisor' };

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('keeps order progress, line binding and report idempotency consistent', async () => {
    const order = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set(headers)
      .send({
        orderNo: 'PO-E2E-PERSISTENCE-001', productCode: 'P-E2E', productName: '持久化闭环测试件',
        plannedQty: 2, dueAt: '2026-09-10T12:00:00.000Z', priority: 'normal',
      })
      .expect(201);

    const workOrder = await request(app.getHttpServer())
      .post('/api/v1/work-orders')
      .set(headers)
      .send({
        orderId: order.body.data.id, orderNo: 'WO-E2E-PERSISTENCE-001', productCode: 'P-E2E',
        productName: '持久化闭环测试件', lineId: 'line-cnc', plannedQty: 2, dueAt: '2026-09-10T12:00:00.000Z',
      })
      .expect(201);
    expect(order.body.data.id.length).toBeLessThanOrEqual(40);
    expect(workOrder.body.data.id.length).toBeLessThanOrEqual(40);
    const workOrderId = workOrder.body.data.id;

    await request(app.getHttpServer())
      .post('/api/v1/work-orders')
      .set(headers)
      .send({ orderNo: 'WO-E2E-PERSISTENCE-BAD-LINE', productCode: 'P-E2E', productName: '非法产线测试', lineId: 'line-missing', plannedQty: 1, dueAt: '2026-09-10T12:00:00.000Z' })
      .expect(404);

    await request(app.getHttpServer()).patch(`/api/v1/work-orders/${workOrderId}/status`).set(headers).send({ status: 'released' }).expect(200);
    await request(app.getHttpServer()).patch(`/api/v1/work-orders/${workOrderId}/status`).set(headers).send({ status: 'in_progress' }).expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/work-orders/${workOrderId}/report`)
      .set(headers)
      .send({ quantity: 1, goodQty: 1, defectQty: 0, sourceTraceId: 'trace-e2e-persistence-001' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/work-orders/${workOrderId}/report`)
      .set(headers)
      .send({ quantity: 1, sourceTraceId: 'trace-e2e-persistence-001' })
      .expect(409);

    await request(app.getHttpServer())
      .get(`/api/v1/work-orders/${workOrderId}`)
      .set(headers)
      .expect(200)
      .expect(({ body }) => expect(body.data).toEqual(expect.objectContaining({ completedQty: 1, status: 'in_progress', lineId: 'line-cnc' })));

    await request(app.getHttpServer())
      .post(`/api/v1/work-orders/${workOrderId}/report`)
      .set(headers)
      .send({ quantity: 1, sourceTraceId: 'trace-e2e-persistence-002' })
      .expect(201)
      .expect(({ body }) => expect(body.data.workOrder).toEqual(expect.objectContaining({ completedQty: 2, status: 'completed' })));

    await request(app.getHttpServer())
      .get(`/api/v1/orders/${order.body.data.id}`)
      .set(headers)
      .expect(200)
      .expect(({ body }) => expect(body.data).toEqual(expect.objectContaining({ completedQty: 2, status: 'completed' })));
  });
});
