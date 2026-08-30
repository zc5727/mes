import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { LocalDocumentStorageAdapter } from './local-document-storage.adapter';
import { DOCUMENT_STORAGE } from './documents.constants';

@Module({
  controllers: [DocumentsController],
  providers: [
    LocalDocumentStorageAdapter,
    DocumentsService,
    { provide: DOCUMENT_STORAGE, useExisting: LocalDocumentStorageAdapter },
  ],
  exports: [DocumentsService],
})
export class DocumentsModule {}
