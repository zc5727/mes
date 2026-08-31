export type QualityRecordStatus = 'draft' | 'submitted' | 'confirmed' | 'rejected';
export type InspectionType = 'IQC' | 'IPQC' | 'OQC';

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
  inspectionType: InspectionType;
  ruleKey: string | null;
}

export interface QualityRule {
  id: string;
  tenantId: string;
  key: string;
  name: string;
  inspectionType: InspectionType;
  requiredFields: string[];
  createdAt: string;
}

export interface QualityIssue {
  id: string;
  tenantId: string;
  qualityRecordId: string;
  code: string;
  description: string;
  status: 'open' | 'contained' | 'closed';
  capa: string | null;
  createdAt: string;
  updatedAt: string;
}
