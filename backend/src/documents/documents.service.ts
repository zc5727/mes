import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createId, timestamp } from '../common/mock.types';
import type { ConfirmDocumentAnalysisDto, UpdateDocumentStatusDto, UploadDocumentDto } from './dto/upload-document.dto';
import { DOCUMENT_STORAGE } from './documents.constants';
import type {
  DocumentRecord,
  DocumentStatus,
  DocumentStorage,
  DocumentTraceEvent,
  UploadedDocumentFile,
} from './documents.types';

const MAX_DOCUMENT_SIZE = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.dwg', '.dxf']);
const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'application/acad', 'application/dxf', 'text/plain', 'application/octet-stream']);
const STATUS_TRANSITIONS: Record<DocumentStatus, DocumentStatus[]> = {
  draft: ['reviewing', 'archived'],
  reviewing: ['approved', 'rejected', 'archived'],
  approved: ['released', 'archived'],
  released: ['archived'],
  rejected: ['draft', 'archived'],
  archived: [],
};

@Injectable()
export class DocumentsService {
  private readonly records = new Map<string, DocumentRecord[]>();

  constructor(@Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage) {}

  async upload(tenantId: string, dto: UploadDocumentDto, file?: UploadedDocumentFile): Promise<DocumentRecord> {
    this.validateFile(file);
    const uploadedFile = file as UploadedDocumentFile;
    const extension = this.extension(uploadedFile.originalname);
    const hash = createHash('sha256').update(uploadedFile.buffer).digest('hex');
    const current = this.listByKey(tenantId, dto.documentKey);
    const sameFingerprint = current.find((record) => record.fileHash === hash);
    if (sameFingerprint) return sameFingerprint;

    const now = timestamp();
    const id = createId('document');
    const storageKey = `${this.safeSegment(tenantId)}/${id}${extension}`;
    const previous = current.at(-1) ?? null;
    const traceId = createId('trace');
    try {
      await this.storage.put(storageKey, uploadedFile.buffer);
    } catch (error: unknown) {
      throw new ConflictException(`Document binary storage failed: ${this.errorMessage(error)}`);
    }

    const record: DocumentRecord = {
      id,
      tenantId,
      documentKey: dto.documentKey.trim(),
      fileName: uploadedFile.originalname,
      contentType: uploadedFile.mimetype,
      extension,
      size: uploadedFile.size,
      fileHash: hash,
      version: (previous?.version ?? 0) + 1,
      supersedesId: previous?.id ?? null,
      storageKey,
      storageProvider: this.storage.provider,
      status: 'draft',
      lineId: dto.lineId?.trim() || null,
      workOrderId: dto.workOrderId?.trim() || null,
      productCode: dto.productCode?.trim() || null,
      uploadedBy: dto.uploadedBy.trim(),
      uploadedAt: now,
      createdAt: now,
      updatedAt: now,
      analysisStatus: 'not_started',
      analysisDraft: null,
      analysisConfirmedBy: null,
      analysisConfirmedAt: null,
      trace: [this.trace('uploaded', now, dto.uploadedBy.trim(), traceId, {
        version: (previous?.version ?? 0) + 1,
        fileHash: hash,
        supersedesId: previous?.id ?? null,
      })],
    };
    this.records.set(tenantId, [...(this.records.get(tenantId) ?? []), record]);
    return record;
  }

  list(tenantId: string): DocumentRecord[] {
    return [...(this.records.get(tenantId) ?? [])].sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt));
  }

  findOne(tenantId: string, id: string): DocumentRecord {
    const record = this.list(tenantId).find((item) => item.id === id);
    if (!record) throw new NotFoundException(`Document ${id} not found`);
    return record;
  }

  async readContent(tenantId: string, id: string): Promise<{ record: DocumentRecord; content: Buffer }> {
    const record = this.findOne(tenantId, id);
    try {
      return { record, content: await this.storage.read(record.storageKey) };
    } catch (error: unknown) {
      throw new ConflictException(`Document binary read failed: ${this.errorMessage(error)}`);
    }
  }

  updateStatus(tenantId: string, id: string, dto: UpdateDocumentStatusDto): DocumentRecord {
    const current = this.findOne(tenantId, id);
    const status = dto.status as DocumentStatus;
    if (!Object.hasOwn(STATUS_TRANSITIONS, status) || !STATUS_TRANSITIONS[current.status].includes(status)) {
      throw new ConflictException(`Cannot change document from ${current.status} to ${dto.status}`);
    }
    const now = timestamp();
    return this.replace(current, {
      status,
      updatedAt: now,
      trace: [...current.trace, this.trace('status_changed', now, dto.actorId.trim(), createId('trace'), {
        from: current.status,
        to: status,
      })],
    });
  }

  saveAnalysisDraft(tenantId: string, id: string, analysisDraft: Record<string, unknown>, actorId: string): DocumentRecord {
    const current = this.findOne(tenantId, id);
    const now = timestamp();
    return this.replace(current, {
      analysisStatus: 'draft',
      analysisDraft,
      updatedAt: now,
      trace: [...current.trace, this.trace('analysis_draft_saved', now, actorId.trim(), createId('trace'))],
    });
  }

  confirmAnalysis(tenantId: string, id: string, dto: ConfirmDocumentAnalysisDto): DocumentRecord {
    const current = this.findOne(tenantId, id);
    if (current.analysisStatus !== 'draft') throw new ConflictException('Only an analysis draft can be confirmed');
    const now = timestamp();
    return this.replace(current, {
      analysisStatus: 'confirmed',
      analysisDraft: dto.analysis ?? current.analysisDraft,
      analysisConfirmedBy: dto.reviewerId.trim(),
      analysisConfirmedAt: now,
      updatedAt: now,
      trace: [...current.trace, this.trace('analysis_confirmed', now, dto.reviewerId.trim(), createId('trace'))],
    });
  }

  private listByKey(tenantId: string, documentKey: string): DocumentRecord[] {
    return (this.records.get(tenantId) ?? [])
      .filter((record) => record.documentKey === documentKey.trim())
      .sort((left, right) => left.version - right.version);
  }

  private replace(current: DocumentRecord, patch: Partial<DocumentRecord>): DocumentRecord {
    const updated = { ...current, ...patch };
    this.records.set(current.tenantId, (this.records.get(current.tenantId) ?? []).map((item) => item.id === current.id ? updated : item));
    return updated;
  }

  private validateFile(file?: UploadedDocumentFile): asserts file is UploadedDocumentFile {
    if (!file?.buffer?.length) throw new BadRequestException('Document file is required and cannot be empty');
    if (file.size > MAX_DOCUMENT_SIZE) throw new BadRequestException(`Document file exceeds ${MAX_DOCUMENT_SIZE} bytes`);
    const extension = this.extension(file.originalname);
    if (!ALLOWED_EXTENSIONS.has(extension)) throw new BadRequestException('Only PDF, PNG, JPG, DWG and DXF files are supported');
    if (!ALLOWED_MIME_TYPES.has(file.mimetype) && !(extension === '.dwg' || extension === '.dxf')) {
      throw new BadRequestException(`Unsupported document content type: ${file.mimetype}`);
    }
  }

  private extension(fileName: string): string {
    const match = /\.[^.]+$/.exec(fileName.trim().toLowerCase());
    if (!match) throw new BadRequestException('Document file extension is required');
    return match[0];
  }

  private safeSegment(value: string): string {
    const segment = value.trim();
    if (!segment || segment === '.' || segment === '..' || /[\\/]/.test(segment)) {
      throw new BadRequestException('Invalid tenant storage segment');
    }
    return segment;
  }

  private trace(type: DocumentTraceEvent['type'], at: string, actorId: string, traceId: string, details?: Record<string, unknown>): DocumentTraceEvent {
    return { type, at, actorId, traceId, ...(details ? { details } : {}) };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
