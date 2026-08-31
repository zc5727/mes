import { AgvsService } from '../src/agvs/agvs.service';
import { DevicesService } from '../src/devices/devices.service';
import { AlarmsService } from '../src/alarms/alarms.service';
import { DashboardService } from '../src/dashboard/dashboard.service';
import { ProductionLinesService } from '../src/production-lines/production-lines.service';
import { WorkOrdersService } from '../src/work-orders/work-orders.service';
import { MqttIngestionService } from '../src/mqtt/mqtt-ingestion.service';

describe('DashboardService', () => {
  it('aggregates the existing tenant-scoped MES services', () => {
    const devicesService = new DevicesService();
    const service = new DashboardService(
      new ProductionLinesService(),
      devicesService,
      new WorkOrdersService(),
      new AgvsService(),
      new AlarmsService(devicesService),
    );

    expect(service.getOverview('tenant-demo')).toMatchObject({
      lines: { total: 4, active: 3, maintenance: 1 },
      devices: { total: 5, online: 4, maintenance: 1, onlineRate: 80 },
      workOrders: { total: 1, inProgress: 1, plannedQty: 1200, completedQty: 780 },
      agvs: { total: 3, moving: 3, averageBattery: 73.3 },
      alarms: { total: 1, info: 0, warning: 1, critical: 0 },
      todayTasks: 1,
      powerConsumption: 272,
      temperatureTrend: [42, 42, 42, 42],
      productionMetrics: {
        plannedQty: 1200,
        completedQty: 780,
        completionRate: 65,
        todayOutput: 780,
        oee: 86.8,
        oeeAvailable: false,
      },
    });

    expect(service.getProductionMetrics('tenant-demo')).toMatchObject({
      remainingQty: 420,
      availabilityRate: 80,
      source: 'work_orders_and_device_snapshot',
    });
  });

  it('returns empty tenant aggregates without leaking demo data', () => {
    const devicesService = new DevicesService();
    const service = new DashboardService(
      new ProductionLinesService(),
      devicesService,
      new WorkOrdersService(),
      new AgvsService(),
      new AlarmsService(devicesService),
    );

    expect(service.getOverview('other-tenant')).toMatchObject({
      lines: { total: 0 },
      devices: { total: 0, onlineRate: 0 },
      workOrders: { total: 0 },
      agvs: { total: 0, averageBattery: 0 },
      alarms: { total: 0 },
      todayTasks: 0,
      powerConsumption: 0,
      temperatureTrend: [36, 37, 38],
      productionMetrics: { plannedQty: 0, completedQty: 0, completionRate: 0, oee: null },
    });
  });

  it('pushes overview snapshots when the tenant projection changes', () => {
    const devicesService = new DevicesService();
    const ingestion = new MqttIngestionService();
    const service = new DashboardService(
      new ProductionLinesService(),
      devicesService,
      new WorkOrdersService(),
      new AgvsService(),
      new AlarmsService(devicesService, ingestion),
      ingestion,
    );
    const eventTypes: string[] = [];
    const subscription = service.stream('tenant-demo').subscribe((event) => eventTypes.push(event.data.type));

    expect(eventTypes).toEqual(['snapshot']);
    ingestion.ingestHttpEvent('tenant-demo', {
      eventId: 'dashboard-telemetry-001',
      deviceId: 'cnc-01',
      lineId: 'line-cnc',
      eventType: 'telemetry',
      eventTime: '2026-08-31T10:00:00.000Z',
      status: 'FAULT',
      payload: { temperatureCelsius: 99, totalCount: 20, goodCount: 18 },
    });
    expect(eventTypes).toEqual(['snapshot', 'updated']);
    expect(service.getOverview('tenant-demo').devices.total).toBe(5);
    expect(service.getOverview('tenant-demo').lineSummaries.find((line) => line.lineId === 'line-cnc')?.deviceCount).toBe(2);
    subscription.unsubscribe();
  });
});
