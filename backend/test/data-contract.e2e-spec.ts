import type { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createTestApp } from './support/test-app';

describe('MES API data contracts (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns tenant-scoped device data in the documented envelope', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/devices')
      .set('x-tenant-id', 'tenant-demo')
      .expect(200);

    expect(response.body).toEqual({
      tenantId: 'tenant-demo',
      data: expect.any(Array),
    });
    expect(response.body.data.length).toBeGreaterThan(0);
    expect(response.body.data[0]).toEqual(expect.objectContaining({
      id: expect.any(String),
      tenantId: 'tenant-demo',
      lineId: expect.any(String),
      status: expect.stringMatching(/^(online|offline|maintenance|alarm)$/),
      metrics: expect.any(Object),
    }));
  });

  it('returns an empty collection and hides records for another tenant', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/devices')
      .set('x-tenant-id', 'tenant-other')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({ tenantId: 'tenant-other', data: [] });
      });

    await request(app.getHttpServer())
      .get('/api/v1/devices/device-cnc-01')
      .set('x-tenant-id', 'tenant-other')
      .expect(404);
  });

  it('rejects malformed requests and duplicate device codes', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/devices')
      .set('x-tenant-id', 'tenant-demo')
      .send({ lineId: 'x', code: 'x', name: 'x' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/devices')
      .set('x-tenant-id', 'tenant-demo')
      .send({ lineId: 'line-cnc', code: 'CNC-001', name: '重复设备' })
      .expect(409);
  });

  it('recovers a device through the REST offline-to-telemetry flow', async () => {
    const deviceId = 'device-cnc-02';
    await request(app.getHttpServer())
      .patch(`/api/v1/devices/${deviceId}/status`)
      .set('x-tenant-id', 'tenant-demo')
      .send({ status: 'offline', reason: '网络中断' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.tenantId).toBe('tenant-demo');
        expect(body.data.status).toBe('offline');
      });

    await request(app.getHttpServer())
      .post(`/api/v1/devices/${deviceId}/telemetry`)
      .set('x-tenant-id', 'tenant-demo')
      .send({
        source: 'edge-gateway-01',
        timestamp: '2026-08-28T08:06:00.000Z',
        metrics: { temperature: 44.1, load: 66 },
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.data).toEqual(expect.objectContaining({
          status: 'online',
          statusReason: '',
          lastSeenAt: '2026-08-28T08:06:00.000Z',
          metrics: { temperature: 44.1, load: 66 },
        }));
      });
  });

  it('accepts an HTTP gateway telemetry event with idempotent replay', async () => {
    const event = {
      eventId: 'http-event-001', deviceId: 'cnc-01', lineId: 'line-cnc',
      eventType: 'telemetry', eventTime: '2026-08-28T09:10:00.000Z',
      traceId: 'trace-http-001', status: 'RUNNING', quality: 'GOOD',
      payload: { temp: 41.2, total_count: 12, good_count: 12, defect_count: 0 },
    };
    await request(app.getHttpServer())
      .post('/api/v1/ingestion/device-events')
      .set('x-tenant-id', 'tenant-demo')
      .send(event)
      .expect(202)
      .expect(({ body }) => expect(body.data).toEqual({ accepted: true, duplicate: false, eventId: 'http-event-001' }));

    await request(app.getHttpServer())
      .post('/api/v1/ingestion/device-events')
      .set('x-tenant-id', 'tenant-demo')
      .send(event)
      .expect(202)
      .expect(({ body }) => expect(body.data).toEqual({ accepted: false, duplicate: true, eventId: 'http-event-001' }));
  });
});
