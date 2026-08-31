import { RequireCapability } from '../common/route-capability.decorator';
import { Body, Controller, Get, Param, Patch, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { TenantId } from '../common/tenant.decorator';
import { ConfirmDocumentAnalysisDto, SaveDocumentAnalysisDraftDto, UpdateDocumentStatusDto, UploadDocumentDto } from './dto/upload-document.dto';
import { DocumentsService } from './documents.service';
import type { UploadedDocumentFile } from './documents.types';

@Controller('foundation/documents')
@RequireCapability('write')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get()
  list(@TenantId() tenantId: string) {
    return { data: this.documentsService.list(tenantId), tenantId };
  }

  @Get(':id')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return { data: this.documentsService.findOne(tenantId, id), tenantId };
  }

  @Get(':id/content')
  async content(@TenantId() tenantId: string, @Param('id') id: string, @Res() response: Response) {
    const { record, content } = await this.documentsService.readContent(tenantId, id);
    response.type(record.contentType).set({
      'Content-Disposition': `inline; filename="${encodeURIComponent(record.fileName)}"`,
      'X-Document-Hash': record.fileHash,
      'X-Document-Version': String(record.version),
    }).send(content);
  }

  @Get(':id/preview')
  preview(@TenantId() tenantId: string, @Param('id') id: string) {
    return { data: this.documentsService.preview(tenantId, id), tenantId };
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  async upload(@TenantId() tenantId: string, @Body() dto: UploadDocumentDto, @UploadedFile() file?: UploadedDocumentFile) {
    return { data: await this.documentsService.uploadReliable(tenantId, dto, file), tenantId };
  }

  @Patch(':id/status')
  async updateStatus(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateDocumentStatusDto) {
    return { data: await this.documentsService.updateStatusReliable(tenantId, id, dto), tenantId };
  }

  @Post(':id/analysis-draft')
  async saveAnalysisDraft(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: SaveDocumentAnalysisDraftDto) {
    return { data: await this.documentsService.saveAnalysisDraftReliable(tenantId, id, dto.analysisDraft, dto.actorId), tenantId };
  }

  @Post(':id/analysis/confirm')
  async confirmAnalysis(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: ConfirmDocumentAnalysisDto) {
    return { data: await this.documentsService.confirmAnalysisReliable(tenantId, id, dto), tenantId };
  }
}
