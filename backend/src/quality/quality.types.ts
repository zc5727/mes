export type QualityRecordStatus = 'draft' | 'submitted' | 'confirmed' | 'rejected';

export interface QualityTraceEvent {
  type: 'draft_created' | 'draft_updated' | 'submitted' | 'confirmed' | 'rejected';
  at: string;
  actorId: string;
  traceId: string;
}

export interface QualityRecord {
  id: string;
  tenantId: string;
  formKey: string;
  formVersion: string;
  status: QualityRecordStatus;
  workOrderId: string | null;
  batchNo: string;
  lineId: string;
  deviceId: string | null;
  operatorId: string;
  values: Record<string, unknown>;
  traceId: string;
  createdAt: string;
  updatedAt: string;
  trace: QualityTraceEvent[];
}
