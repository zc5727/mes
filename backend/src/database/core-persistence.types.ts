export interface PersistedFactory { id: string; tenantId: string; code: string; name: string; createdAt: string; updatedAt: string }
export interface PersistedLine { id: string; tenantId: string; factoryId: string; code: string; name: string; type: string; active: boolean; targetOee: number; createdAt: string; updatedAt: string }
export interface PersistedDevice { id: string; tenantId: string; lineId: string; code: string; name: string; model: string | null; protocol: string | null; status: string; statusReason: string | null; lastSeenAt: string | null; metrics: unknown; metadata: unknown; createdAt: string; updatedAt: string }
export interface PersistedOrder { id: string; tenantId: string; orderNo: string; productCode: string; productName: string; plannedQty: number; completedQty: number; dueAt: string; priority: string; status: string; createdAt: string; updatedAt: string }
export interface PersistedWorkOrder { id: string; tenantId: string; orderId?: string | null; orderNo: string; productCode: string; productName: string; lineId: string; plannedQty: number; completedQty: number; dueAt: string; priority: string; status: string; statusReason: string; createdAt: string; updatedAt: string }
export interface PersistedReport {
  id: string;
  tenantId: string;
  workOrderId: string;
  deviceId: string | null;
  quantity: number;
  goodQty: number;
  defectQty: number;
  sourceTraceId: string;
  batchNo?: string | null;
  serialNumbers?: string[] | null;
  operationCode?: string | null;
  operatorId?: string | null;
  qualityRecordId?: string | null;
  materialConsumptions?: unknown[] | null;
  reportedAt: string;
}

export interface CorePersistenceSnapshot {
  factories: PersistedFactory[];
  lines: PersistedLine[];
  devices: PersistedDevice[];
  orders: PersistedOrder[];
  workOrders: PersistedWorkOrder[];
  reports: PersistedReport[];
}
