import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { AlarmsModule } from '../src/alarms/alarms.module';
import { DashboardModule } from '../src/dashboard/dashboard.module';
import { DatabaseModule } from '../src/database/database.module';
import { DeviceTelemetryCache } from '../src/mqtt/device-cache';
import { AlarmDeduplicator } from '../src/mqtt/alarm-deduplicator';

@Module({ imports: [DatabaseModule, AlarmsModule, DashboardModule] })
class AlarmsDashboardTestModule {}

describe('Alarms and dashboard API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await NestFactory.create(AlarmsDashboardTestModule, { logger: false });
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves tenant-scoped alarms', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/alarms')
      .set('x-tenant-id', 'tenant-demo')
      .expect(200);

    expect(response.body.tenantId).toBe('tenant-demo');
    expect(response.body.data).toEqual([
      expect.objectContaining({ source: 'WLD-001', level: 'warning' }),
    ]);
  });

  it('serves the dashboard overview route', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/dashboard/overview')
      .set('x-tenant-id', 'tenant-demo')
      .expect(200);

    expect(response.body.tenantId).toBe('tenant-demo');
    expect(response.body.data).toEqual(expect.objectContaining({
      lines: expect.objectContaining({ total: 4 }),
      devices: expect.objectContaining({ total: 5 }),
      alarms: expect.objectContaining({ total: 1 }),
      activeAlarmCount: 1,
      deviceOnlineRate: 80,
      lineSummaries: expect.arrayContaining([
        expect.objectContaining({ lineId: 'line-cnc' }),
        expect.objectContaining({ lineId: 'line-assembly' }),
        expect.objectContaining({ lineId: 'line-welding', status: 'maintenance' }),
        expect.objectContaining({ lineId: 'line-vision' }),
      ]),
      highestRiskLine: expect.objectContaining({ lineId: 'line-welding' }),
      productionMetrics: expect.objectContaining({ todayOutput: 780, oee: 86.8 }),
    }));
  });

  it('supports filtering and explicit alarm lifecycle actions without controlling devices', async () => {
    const alarmId = 'alarm-device-welding-01';
    const acknowledged = await request(app.getHttpServer())
      .patch(`/api/v1/alarms/${alarmId}/acknowledge`)
      .set('x-tenant-id', 'tenant-demo')
      .expect(200);
    expect(acknowledged.body.data).toEqual(expect.objectContaining({ id: alarmId, status: 'acknowledged' }));

    const acknowledgedList = await request(app.getHttpServer())
      .get('/api/v1/alarms?deviceId=device-welding-01&status=acknowledged')
      .set('x-tenant-id', 'tenant-demo')
      .expect(200);
    expect(acknowledgedList.body.data).toHaveLength(1);

    const closed = await request(app.getHttpServer())
      .patch(`/api/v1/alarms/${alarmId}/close`)
      .set('x-tenant-id', 'tenant-demo')
      .expect(200);
    expect(closed.body.data).toEqual(expect.objectContaining({ id: alarmId, status: 'closed' }));

    const activeList = await request(app.getHttpServer())
      .get('/api/v1/alarms?lineId=line-welding&status=active')
      .set('x-tenant-id', 'tenant-demo')
      .expect(200);
    expect(activeList.body.data).toHaveLength(0);

    const history = await request(app.getHttpServer())
      .get(`/api/v1/alarms/${alarmId}`)
      .set('x-tenant-id', 'tenant-demo')
      .expect(200);
    expect(history.body.data.status).toBe('closed');

    await request(app.getHttpServer())
      .get('/api/v1/alarms?level=unknown')
      .set('x-tenant-id', 'tenant-demo')
      .expect(400);
  });

  it('serves line detail and preserves tenant isolation', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/dashboard/lines/line-cnc')
      .set('x-tenant-id', 'tenant-demo')
      .expect(200);
    expect(response.body.data).toEqual(expect.objectContaining({
      line: expect.objectContaining({ id: 'line-cnc' }),
      productionMetrics: expect.objectContaining({ plannedQty: 1200, todayOutput: 780 }),
    }));

    await request(app.getHttpServer())
      .get('/api/v1/dashboard/lines/line-cnc')
      .set('x-tenant-id', 'other-tenant')
      .expect(404);

    await request(app.getHttpServer())
      .get('/api/v1/alarms/alarm-device-welding-01')
      .set('x-tenant-id', 'other-tenant')
      .expect(404);
  });

  it('serves tenant-scoped production history for the professional dashboard', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/dashboard/history?lineId=line-cnc')
      .set('x-tenant-id', 'tenant-demo')
      .expect(200);

    expect(response.body).toEqual({ tenantId: 'tenant-demo', data: [] });
    await request(app.getHttpServer())
      .get('/api/v1/dashboard/history?lineId=line-cnc')
      .set('x-tenant-id', 'other-tenant')
      .expect(200)
      .expect({ tenantId: 'other-tenant', data: [] });
  });

  it('projects an injected MQTT fault into alarms and dashboard state', async () => {
    const cache = app.get(DeviceTelemetryCache);
    const deduplicator = app.get(AlarmDeduplicator);
    const timestamp = '2026-08-28T09:30:00.000Z';
    cache.upsert('tenant-demo', {
      deviceId: 'cnc-01',
      deviceName: 'CNC-01',
      lineId: 'line-cnc',
      status: 'FAULT',
      temperatureCelsius: 96,
      cycleTimeSeconds: 42,
      totalCount: 10,
      goodCount: 8,
      defectCount: 2,
      activeFaults: ['OVERHEAT'],
      timestamp,
    }, 'mes/simulator/demo-tenant/lines/line-cnc/devices/cnc-01/telemetry');
    deduplicator.apply('tenant-demo', 'alarm.created', {
      id: 'line-cnc-cnc-01-OVERHEAT',
      lineId: 'line-cnc',
      deviceId: 'cnc-01',
      type: 'OVERHEAT',
      severity: 'CRITICAL',
      message: '设备温度超过安全阈值',
      startedAt: timestamp,
    });

    const alarms = await request(app.getHttpServer())
      .get('/api/v1/alarms?lineId=line-cnc&level=critical')
      .set('x-tenant-id', 'tenant-demo')
      .expect(200);
    expect(alarms.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: 'cnc-01', lineId: 'line-cnc', level: 'critical' }),
    ]));

    const dashboard = await request(app.getHttpServer())
      .get('/api/v1/dashboard/overview')
      .set('x-tenant-id', 'tenant-demo')
      .expect(200);
    expect(dashboard.body.data.devices).toEqual(expect.objectContaining({ alarm: 1 }));

    const duplicate = deduplicator.apply('tenant-demo', 'alarm.created', {
      id: 'line-cnc-cnc-01-OVERHEAT',
      lineId: 'line-cnc',
      deviceId: 'cnc-01',
      type: 'OVERHEAT',
      severity: 'CRITICAL',
      message: '设备温度超过安全阈值',
      startedAt: timestamp,
    });
    expect(duplicate.accepted).toBe(false);
    if (duplicate.accepted) throw new Error('duplicate alarm was unexpectedly accepted');
    expect(duplicate.reason).toBe('duplicate');

    deduplicator.apply('tenant-demo', 'alarm.cleared', {
      id: 'line-cnc-cnc-01-OVERHEAT',
      lineId: 'line-cnc',
      deviceId: 'cnc-01',
      type: 'OVERHEAT',
      severity: 'CRITICAL',
      message: '设备温度超过安全阈值',
      startedAt: timestamp,
      clearedAt: '2026-08-28T09:35:00.000Z',
    });
    const activeAfterClear = await request(app.getHttpServer())
      .get('/api/v1/alarms?lineId=line-cnc&status=active')
      .set('x-tenant-id', 'tenant-demo')
      .expect(200);
    expect(activeAfterClear.body.data).toHaveLength(0);
    const closedAfterClear = await request(app.getHttpServer())
      .get('/api/v1/alarms?lineId=line-cnc&status=closed')
      .set('x-tenant-id', 'tenant-demo')
      .expect(200);
    expect(closedAfterClear.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: 'cnc-01', status: 'closed' }),
    ]));
  });
});
