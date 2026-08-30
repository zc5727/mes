export type MaintenanceStatus = 'draft' | 'assigned' | 'in_progress' | 'completed' | 'cancelled';

export interface MaintenanceWorkOrder {
  id: string;
  tenantId: string;
  lineId: string;
  deviceId: string;
  type: 'inspection' | 'preventive' | 'repair';
  title: string;
  description: string;
  status: MaintenanceStatus;
  plannedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
