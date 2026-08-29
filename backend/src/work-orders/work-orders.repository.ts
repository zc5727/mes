import { CreateWorkOrderDto } from './dto/create-work-order.dto';
import { ReportWorkOrderDto } from './dto/report-work-order.dto';
import { UpdateWorkOrderDto } from './dto/update-work-order.dto';
import { UpdateWorkOrderStatusDto } from './dto/update-work-order-status.dto';
import { WorkOrder, WorkOrderReport } from './work-orders.service';

export interface WorkOrderReportResult {
  workOrder: WorkOrder;
  report: WorkOrderReport;
}

/**
 * Persistence port for work orders.
 *
 * It deliberately mirrors the existing service boundary. The memory MVP can
 * continue to serve requests while a Prisma implementation is introduced
 * behind this port in a later migration step.
 */
export interface WorkOrdersRepository {
  findAll(tenantId: string, status?: WorkOrder['status']): Promise<WorkOrder[]> | WorkOrder[];
  findOverview(tenantId: string): Promise<Record<string, number>> | Record<string, number>;
  findOne(tenantId: string, id: string): Promise<WorkOrder> | WorkOrder;
  create(tenantId: string, dto: CreateWorkOrderDto): Promise<WorkOrder> | WorkOrder;
  update(tenantId: string, id: string, dto: UpdateWorkOrderDto): Promise<WorkOrder> | WorkOrder;
  updateStatus(tenantId: string, id: string, dto: UpdateWorkOrderStatusDto): Promise<WorkOrder> | WorkOrder;
  report(tenantId: string, id: string, dto: ReportWorkOrderDto): Promise<WorkOrderReportResult> | WorkOrderReportResult;
  findReports(tenantId: string, workOrderId: string): Promise<WorkOrderReport[]> | WorkOrderReport[];
}
