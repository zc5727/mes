import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { LocalDocumentStorageAdapter } from './local-document-storage.adapter';
import { DOCUMENT_STORAGE } from './documents.constants';
import { DOCUMENT_SCANNER } from './documents.constants';
import { NoopDocumentSecurityScanner } from './noop-document-security-scanner';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [DocumentsController],
  providers: [
    LocalDocumentStorageAdapter,
    NoopDocumentSecurityScanner,
    DocumentsService,
    { provide: DOCUMENT_STORAGE, useExisting: LocalDocumentStorageAdapter },
    { provide: DOCUMENT_SCANNER, useExisting: NoopDocumentSecurityScanner },
  ],
  exports: [DocumentsService],
})
export class DocumentsModule {}
