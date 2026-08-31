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
    const headers = { 'x-tenant-id': 'tenant-demo', 'x-user-role': 'supervisor' };
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
    const plan = await request(app.getHttpServer())
      .post('/api/v1/maintenance/work-orders/preventive-plans')
      .set('x-tenant-id', 'tenant-demo')
      .set('x-user-role', 'supervisor')
      .send({ deviceId: 'device-cnc-01', title: '到期 PM E2E', nextDueAt: '2026-01-01T09:00:00.000Z' })
      .expect(201);
    const triggered = await request(app.getHttpServer())
      .post('/api/v1/maintenance/work-orders/preventive-plans/trigger-due')
      .set('x-tenant-id', 'tenant-demo')
      .set('x-user-role', 'supervisor')
      .expect(201);
    expect(triggered.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'preventive', description: `preventive-plan:${plan.body.data.id}` })]));
    const retriggered = await request(app.getHttpServer())
      .post('/api/v1/maintenance/work-orders/preventive-plans/trigger-due')
      .set('x-tenant-id', 'tenant-demo')
      .set('x-user-role', 'supervisor')
      .expect(201);
    expect(retriggered.body.data.find((item: { description: string }) => item.description === `preventive-plan:${plan.body.data.id}`).id)
      .toBe(triggered.body.data.find((item: { description: string }) => item.description === `preventive-plan:${plan.body.data.id}`).id);

    const created = await request(app.getHttpServer())
      .post('/api/v1/maintenance/work-orders')
      .set('x-tenant-id', 'tenant-demo')
      .set('x-user-role', 'supervisor')
      .send({
        lineId: 'line-cnc', deviceId: 'device-cnc-01', type: 'repair',
        title: '更换主轴润滑组件', plannedAt: '2026-09-01T09:00:00.000Z',
      })
      .expect(201);
    const orderId = created.body.data.id;

    await request(app.getHttpServer())
      .patch(`/api/v1/maintenance/work-orders/${orderId}/status`)
      .set('x-tenant-id', 'tenant-demo')
      .set('x-user-role', 'supervisor')
      .send({ status: 'assigned' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/maintenance/work-orders/${orderId}/status`)
      .set('x-tenant-id', 'tenant-demo')
      .set('x-user-role', 'supervisor')
      .send({ status: 'in_progress' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/maintenance/work-orders/${orderId}/status`)
      .set('x-tenant-id', 'tenant-demo')
      .set('x-user-role', 'supervisor')
      .send({ status: 'completed' })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/api/v1/maintenance/work-orders/${orderId}/status`)
      .set('x-tenant-id', 'tenant-demo')
      .set('x-user-role', 'supervisor')
      .send({ status: 'completed', reason: '维修完成并通过点检' })
      .expect(200)
      .expect(({ body }) => expect(body.data).toEqual(expect.objectContaining({ status: 'completed' })));
  });

  it('proves quality release, batch consumption/return and work-order completion change state together', async () => {
    const headers = { 'x-tenant-id': 'tenant-demo', 'x-user-role': 'supervisor' };
    const batch = await request(app.getHttpServer())
      .post('/api/v1/master-data/batches').set(headers)
      .send({ materialCode: 'RAW-E2E', batchNo: 'B-E2E-001', quantity: 10 }).expect(201);
    const quality = await request(app.getHttpServer())
      .post('/api/v1/foundation/quality-records').set(headers)
      .send({ batchNo: 'FG-E2E-001', lineId: 'line-cnc', workOrderId: 'wo-demo-001', operatorId: 'inspector-e2e', values: {}, traceId: 'report-e2e-release-001' }).expect(201);
    const qualityId = quality.body.data.id;
    await request(app.getHttpServer()).post('/api/v1/work-orders/wo-demo-001/report').set(headers)
      .send({ quantity: 420, qualityRecordId: qualityId, deviceId: 'device-cnc-02', batchNo: 'FG-E2E-001', serialNumbers: Array.from({ length: 420 }, (_, index) => `SN-E2E-${index}`), materialConsumptions: [{ materialCode: 'RAW-E2E', batchNo: 'B-E2E-001', quantity: 5 }], sourceTraceId: 'report-e2e-release-001' }).expect(409);
    expect((await request(app.getHttpServer()).get('/api/v1/master-data/batches').set(headers)).body.data.find((item: { batchNo: string }) => item.batchNo === 'B-E2E-001').quantity).toBe(10);

    await request(app.getHttpServer()).post(`/api/v1/foundation/quality-records/${qualityId}/submit`).set(headers).send({ actorId: 'inspector-e2e' }).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/foundation/quality-records/${qualityId}/confirm`).set(headers).send({ actorId: 'manager-e2e' }).expect(201);
    const completed = await request(app.getHttpServer()).post('/api/v1/work-orders/wo-demo-001/report').set(headers)
      .send({ quantity: 420, qualityRecordId: qualityId, deviceId: 'device-cnc-02', batchNo: 'FG-E2E-001', serialNumbers: Array.from({ length: 420 }, (_, index) => `SN-E2E-${index}`), materialConsumptions: [{ materialCode: 'RAW-E2E', batchNo: 'B-E2E-001', quantity: 5 }], sourceTraceId: 'report-e2e-release-001' }).expect(201);
    expect(completed.body.data.workOrder.status).toBe('completed');
    expect(completed.body.data.workOrder.completedQty).toBe(1200);
    expect(batch.body.data.quantity).toBe(10);
    expect((await request(app.getHttpServer()).get('/api/v1/master-data/batches').set(headers)).body.data.find((item: { batchNo: string }) => item.batchNo === 'B-E2E-001').quantity).toBe(5);
    const trace = await request(app.getHttpServer()).get('/api/v1/work-orders/traceability/search').set(headers).query({ sourceTraceId: 'report-e2e-release-001', serialNumber: 'SN-E2E-419', materialBatchNo: 'B-E2E-001' }).expect(200);
    expect(trace.body.data).toEqual(expect.objectContaining({ total: 1 }));
    await request(app.getHttpServer()).post('/api/v1/master-data/batches/return').set(headers).send({ materialCode: 'RAW-E2E', batchNo: 'B-E2E-001', quantity: 5, idempotencyKey: 'return-e2e-001' }).expect(201);
    await request(app.getHttpServer()).post('/api/v1/master-data/batches/return').set(headers).send({ materialCode: 'RAW-E2E', batchNo: 'B-E2E-001', quantity: 5, idempotencyKey: 'return-e2e-001' }).expect(201);
    expect((await request(app.getHttpServer()).get('/api/v1/master-data/batches').set(headers)).body.data.find((item: { batchNo: string }) => item.batchNo === 'B-E2E-001').quantity).toBe(10);
  });

  it('hard-blocks direct completion while a linked quality record is not released', async () => {
    const headers = { 'x-tenant-id': 'tenant-demo', 'x-user-role': 'supervisor' };
    const workOrder = await request(app.getHttpServer()).post('/api/v1/work-orders').set(headers).send({
      orderNo: 'WO-QUALITY-GATE-E2E', productCode: 'P-QUALITY', productName: '质量闸门测试件',
      lineId: 'line-cnc', plannedQty: 2, dueAt: '2026-09-05T12:00:00.000Z',
    }).expect(201);
    const workOrderId = workOrder.body.data.id;
    await request(app.getHttpServer()).patch(`/api/v1/work-orders/${workOrderId}/status`).set(headers).send({ status: 'released' }).expect(200);
    await request(app.getHttpServer()).patch(`/api/v1/work-orders/${workOrderId}/status`).set(headers).send({ status: 'in_progress' }).expect(200);
    await request(app.getHttpServer()).post('/api/v1/foundation/quality-records').set(headers).send({
      batchNo: 'FG-QUALITY-GATE-E2E', lineId: 'line-cnc', workOrderId,
      operatorId: 'inspector-e2e', values: {}, traceId: 'quality-gate-e2e',
    }).expect(201);
    await request(app.getHttpServer()).patch(`/api/v1/work-orders/${workOrderId}/status`).set(headers)
      .send({ status: 'completed' }).expect(409);
  });

  it('creates one repair work order per alarm and closes it only after point inspection', async () => {
    const headers = { 'x-tenant-id': 'tenant-demo', 'x-user-role': 'supervisor' };
    const alarms = await request(app.getHttpServer()).get('/api/v1/alarms?deviceId=device-welding-01').set(headers).expect(200);
    const alarm = alarms.body.data[0];
    expect(alarm).toEqual(expect.objectContaining({ sourceId: 'device-welding-01' }));
    const first = await request(app.getHttpServer()).post(`/api/v1/alarms/${alarm.id}/maintenance-work-order`).set(headers).expect(201);
    const second = await request(app.getHttpServer()).post(`/api/v1/alarms/${alarm.id}/maintenance-work-order`).set(headers).expect(201);
    expect(second.body.data.id).toBe(first.body.data.id);
    const maintenanceId = first.body.data.id;
    await request(app.getHttpServer()).patch(`/api/v1/maintenance/work-orders/${maintenanceId}/status`).set(headers).send({ status: 'assigned' }).expect(200);
    await request(app.getHttpServer()).patch(`/api/v1/maintenance/work-orders/${maintenanceId}/status`).set(headers).send({ status: 'in_progress' }).expect(200);
    await request(app.getHttpServer()).patch(`/api/v1/maintenance/work-orders/${maintenanceId}/status`).set(headers).send({ status: 'completed', reason: '维修完成' }).expect(409);
    await request(app.getHttpServer()).post(`/api/v1/maintenance/work-orders/${maintenanceId}/inspection`).set(headers).send({ result: 'passed', remark: '点检通过' }).expect(201);
    await request(app.getHttpServer()).patch(`/api/v1/maintenance/work-orders/${maintenanceId}/status`).set(headers).send({ status: 'completed', reason: '维修完成并放行' }).expect(200);
  });

  it('blocks production reports while the selected device is occupied by maintenance', async () => {
    const headers = { 'x-tenant-id': 'tenant-demo', 'x-user-role': 'supervisor' };
    const maintenance = await request(app.getHttpServer()).post('/api/v1/maintenance/work-orders').set(headers).send({
      lineId: 'line-cnc', deviceId: 'device-cnc-01', type: 'repair', title: '占用设备 E2E', plannedAt: '2026-09-01T09:00:00.000Z',
    }).expect(201);
    await request(app.getHttpServer()).patch(`/api/v1/maintenance/work-orders/${maintenance.body.data.id}/status`).set(headers).send({ status: 'assigned' }).expect(200);
    const workOrder = await request(app.getHttpServer()).post('/api/v1/work-orders').set(headers).send({
      orderNo: 'WO-MAINTENANCE-LOCK-E2E', productCode: 'P-LOCK', productName: '设备占用测试件', lineId: 'line-cnc', plannedQty: 1, dueAt: '2026-09-05T12:00:00.000Z',
    }).expect(201);
    await request(app.getHttpServer()).patch(`/api/v1/work-orders/${workOrder.body.data.id}/status`).set(headers).send({ status: 'released' }).expect(200);
    await request(app.getHttpServer()).patch(`/api/v1/work-orders/${workOrder.body.data.id}/status`).set(headers).send({ status: 'in_progress' }).expect(200);
    await request(app.getHttpServer()).post(`/api/v1/work-orders/${workOrder.body.data.id}/report`).set(headers).send({ quantity: 1, deviceId: 'device-cnc-01' }).expect(409);
  });
});
