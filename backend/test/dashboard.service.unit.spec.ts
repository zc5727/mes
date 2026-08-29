import { AgvsService } from '../src/agvs/agvs.service';
import { DevicesService } from '../src/devices/devices.service';
import { AlarmsService } from '../src/alarms/alarms.service';
import { DashboardService } from '../src/dashboard/dashboard.service';
import { ProductionLinesService } from '../src/production-lines/production-lines.service';
import { WorkOrdersService } from '../src/work-orders/work-orders.service';

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
    });
  });
});
