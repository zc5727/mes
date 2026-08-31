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
});
