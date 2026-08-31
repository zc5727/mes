import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import type { DocumentRecord } from '../documents/documents.types';
import type { QualityRecord } from '../quality/quality.types';
import type { MaintenanceWorkOrder } from '../maintenance/maintenance.types';

export interface FoundationPersistenceSnapshot {
  quality: QualityRecord[];
  maintenance: MaintenanceWorkOrder[];
  documents: DocumentRecord[];
}

/** Persists quality, maintenance and document metadata while binaries remain in the storage adapter. */
@Injectable()
export class FoundationPersistenceService {
  private readonly logger = new Logger(FoundationPersistenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async restore(): Promise<FoundationPersistenceSnapshot> {
    await this.prisma.ensureConnection();
    if (!this.prisma.isReady()) {
      this.failIfRequired('restore foundation entities');
      return { quality: [], maintenance: [], documents: [] };
    }
    try {
      const [quality, maintenance, documents] = await Promise.all([
        this.prisma.qualityRecord.findMany(), this.prisma.maintenanceWorkOrder.findMany(), this.prisma.documentRecord.findMany(),
      ]);
      return {
        quality: quality.map((item) => this.quality(item)),
        maintenance: maintenance.map((item) => this.maintenance(item)),
        documents: documents.map((item) => this.document(item)),
      };
    } catch (error: unknown) {
      this.failure('restore foundation entities', error);
      this.failIfRequired('restore foundation entities', error);
      return { quality: [], maintenance: [], documents: [] };
    }
  }

  async saveQuality(record: QualityRecord): Promise<void> {
    await this.write('quality record', () => this.prisma.qualityRecord.upsert({
      where: { id: record.id },
      create: { id: record.id, tenantId: record.tenantId, formKey: record.formKey, formVersion: record.formVersion, status: record.status, workOrderId: record.workOrderId, batchNo: record.batchNo, lineId: record.lineId, deviceId: record.deviceId, operatorId: record.operatorId, values: record.values as Prisma.InputJsonValue, traceId: record.traceId, trace: record.trace as unknown as Prisma.InputJsonValue, inspectionType: record.inspectionType, ruleKey: record.ruleKey, createdAt: new Date(record.createdAt), updatedAt: new Date(record.updatedAt) },
      update: { formKey: record.formKey, formVersion: record.formVersion, status: record.status, workOrderId: record.workOrderId, batchNo: record.batchNo, lineId: record.lineId, deviceId: record.deviceId, operatorId: record.operatorId, values: record.values as Prisma.InputJsonValue, traceId: record.traceId, trace: record.trace as unknown as Prisma.InputJsonValue, inspectionType: record.inspectionType, ruleKey: record.ruleKey, updatedAt: new Date(record.updatedAt) },
    }));
  }

  async saveMaintenance(item: MaintenanceWorkOrder): Promise<void> {
    await this.write('maintenance work order', () => this.prisma.maintenanceWorkOrder.upsert({
      where: { id: item.id },
      create: { id: item.id, tenantId: item.tenantId, lineId: item.lineId, deviceId: item.deviceId, alarmId: item.alarmId, type: item.type, title: item.title, description: item.description, status: item.status, plannedAt: new Date(item.plannedAt), completedAt: item.completedAt ? new Date(item.completedAt) : null, createdAt: new Date(item.createdAt), updatedAt: new Date(item.updatedAt) },
      update: { lineId: item.lineId, deviceId: item.deviceId, alarmId: item.alarmId, type: item.type, title: item.title, description: item.description, status: item.status, plannedAt: new Date(item.plannedAt), completedAt: item.completedAt ? new Date(item.completedAt) : null, updatedAt: new Date(item.updatedAt) },
    }));
  }

  async saveDocument(item: DocumentRecord): Promise<void> {
    await this.write('document metadata', () => this.prisma.documentRecord.upsert({
      where: { id: item.id },
      create: this.documentData(item),
      update: this.documentUpdateData(item),
    }));
  }

  private documentData(item: DocumentRecord): Prisma.DocumentRecordUncheckedCreateInput {
    return {
      id: item.id, tenantId: item.tenantId, createdAt: new Date(item.createdAt),
      documentKey: item.documentKey, fileName: item.fileName, contentType: item.contentType, extension: item.extension,
      size: item.size, fileHash: item.fileHash, version: item.version, supersedesId: item.supersedesId,
      storageKey: item.storageKey, storageProvider: item.storageProvider, status: item.status, lineId: item.lineId,
      workOrderId: item.workOrderId, productCode: item.productCode, uploadedBy: item.uploadedBy, uploadedAt: new Date(item.uploadedAt),
      analysisStatus: item.analysisStatus, analysisDraft: item.analysisDraft as Prisma.InputJsonValue,
      analysisConfirmedBy: item.analysisConfirmedBy, analysisConfirmedAt: item.analysisConfirmedAt ? new Date(item.analysisConfirmedAt) : null,
      trace: item.trace as unknown as Prisma.InputJsonValue,
      securityScanStatus: item.securityScanStatus, securityScanProvider: item.securityScanProvider,
      securityScanMessage: item.securityScanMessage, securityScannedAt: item.securityScannedAt ? new Date(item.securityScannedAt) : null,
      updatedAt: new Date(item.updatedAt),
    };
  }

  private documentUpdateData(item: DocumentRecord): Prisma.DocumentRecordUncheckedUpdateInput {
    const { id: _id, tenantId: _tenantId, createdAt: _createdAt, ...update } = this.documentData(item);
    return update;
  }

  private quality(item: any): QualityRecord {
    return { ...item, workOrderId: item.workOrderId ?? null, deviceId: item.deviceId ?? null, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() };
  }
  private maintenance(item: any): MaintenanceWorkOrder {
    return { ...item, completedAt: item.completedAt?.toISOString() ?? null, plannedAt: item.plannedAt.toISOString(), createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() };
  }
  private document(item: any): DocumentRecord {
    return { ...item, supersedesId: item.supersedesId ?? null, lineId: item.lineId ?? null, workOrderId: item.workOrderId ?? null, productCode: item.productCode ?? null, analysisConfirmedBy: item.analysisConfirmedBy ?? null, analysisConfirmedAt: item.analysisConfirmedAt?.toISOString() ?? null, securityScanStatus: item.securityScanStatus ?? 'not_scanned', securityScanProvider: item.securityScanProvider ?? 'none', securityScanMessage: item.securityScanMessage ?? null, securityScannedAt: item.securityScannedAt?.toISOString() ?? null, uploadedAt: item.uploadedAt.toISOString(), createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() };
  }

  private async write(label: string, operation: () => Promise<unknown>): Promise<void> {
    await this.prisma.ensureConnection();
    if (!this.prisma.isReady()) {
      this.failIfRequired(`persist ${label}`);
      return;
    }
    try {
      await operation();
    } catch (error: unknown) {
      this.failure(`persist ${label}`, error);
      this.failIfRequired(`persist ${label}`, error);
    }
  }

  private failIfRequired(operation: string, error?: unknown): void {
    if (!this.prisma.required) return;
    const detail = error instanceof Error ? `: ${error.message}` : error ? `: ${String(error)}` : '';
    throw new Error(`PostgreSQL is required; ${operation} cannot continue${detail}`);
  }

  private failure(operation: string, error: unknown): void { this.logger.error(`${operation} failed; memory/local adapter remains available: ${error instanceof Error ? error.message : String(error)}`); }
}
