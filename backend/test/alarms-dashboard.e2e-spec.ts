import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { AlarmsModule } from '../src/alarms/alarms.module';
import { DashboardModule } from '../src/dashboard/dashboard.module';
import { DeviceTelemetryCache } from '../src/mqtt/device-cache';
import { AlarmDeduplicator } from '../src/mqtt/alarm-deduplicator';

@Module({ imports: [AlarmsModule, DashboardModule] })
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
    }));
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
  });
});
