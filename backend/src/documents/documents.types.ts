export type DocumentStatus = 'draft' | 'reviewing' | 'approved' | 'released' | 'rejected' | 'archived';

export type DocumentAnalysisStatus = 'not_started' | 'draft' | 'confirmed';

export interface DocumentTraceEvent {
  type: 'uploaded' | 'status_changed' | 'analysis_draft_saved' | 'analysis_confirmed';
  at: string;
  actorId: string;
  traceId: string;
  details?: Record<string, unknown>;
}

export interface DocumentRecord {
  id: string;
  tenantId: string;
  documentKey: string;
  fileName: string;
  contentType: string;
  extension: string;
  size: number;
  fileHash: string;
  version: number;
  supersedesId: string | null;
  storageKey: string;
  storageProvider: 'local-disk';
  status: DocumentStatus;
  lineId: string | null;
  workOrderId: string | null;
  productCode: string | null;
  uploadedBy: string;
  uploadedAt: string;
  createdAt: string;
  updatedAt: string;
  analysisStatus: DocumentAnalysisStatus;
  analysisDraft: Record<string, unknown> | null;
  analysisConfirmedBy: string | null;
  analysisConfirmedAt: string | null;
  trace: DocumentTraceEvent[];
}

export interface UploadedDocumentFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface DocumentStorage {
  readonly provider: 'local-disk';
  readonly root: string;
  put(storageKey: string, content: Buffer): Promise<void>;
  read(storageKey: string): Promise<Buffer>;
  remove(storageKey: string): Promise<void>;
}
