export type DocumentStatus = 'draft' | 'reviewing' | 'approved' | 'released' | 'rejected' | 'archived';

export type DocumentAnalysisStatus = 'not_started' | 'queued' | 'processing' | 'failed' | 'draft' | 'confirmed';

export interface DocumentTraceEvent {
  type: 'uploaded' | 'status_changed' | 'analysis_queued' | 'analysis_started' | 'analysis_failed' | 'analysis_draft_saved' | 'analysis_confirmed';
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
  storageProvider: 'local-disk' | 's3' | 'minio';
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
  securityScanStatus: 'not_scanned' | 'clean' | 'infected' | 'error';
  securityScanProvider: string;
  securityScanMessage: string | null;
  securityScannedAt: string | null;
}

export interface UploadedDocumentFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface DocumentStorage {
  readonly provider: 'local-disk' | 's3' | 'minio';
  readonly root: string;
  put(storageKey: string, content: Buffer): Promise<void>;
  read(storageKey: string, expectedSha256?: string): Promise<Buffer>;
  remove(storageKey: string): Promise<void>;
}

/** S3-compatible contract for a future S3/MinIO adapter; no binary is sent directly to clients. */
export interface DocumentScanInput {
  fileName: string;
  contentType: string;
  size: number;
  sha256: string;
  content: Buffer;
}

export interface DocumentScanResult {
  status: 'not_scanned' | 'clean' | 'infected' | 'error';
  provider: string;
  message?: string;
}

export interface DocumentSecurityScanner {
  scan(input: DocumentScanInput): Promise<DocumentScanResult>;
}

export interface DocumentPreviewDescriptor {
  supported: boolean;
  kind: 'pdf' | 'image' | 'cad' | 'unsupported';
  renderer: 'browser' | 'cad-viewer' | 'none';
  reason: string;
}
