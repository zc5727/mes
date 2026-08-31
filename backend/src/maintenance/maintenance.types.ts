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

export interface SparePart { id: string; tenantId: string; code: string; name: string; stock: number; minimumStock: number; updatedAt: string }
export interface PreventivePlan { id: string; tenantId: string; deviceId: string; title: string; intervalHours: number; nextDueAt: string; active: boolean; createdAt: string }
