import { IsOptional, IsString, MinLength } from 'class-validator';

export class UploadDocumentDto {
  @IsString()
  @MinLength(2)
  documentKey!: string;

  @IsString()
  @MinLength(2)
  uploadedBy!: string;

  @IsOptional()
  @IsString()
  lineId?: string;

  @IsOptional()
  @IsString()
  workOrderId?: string;

  @IsOptional()
  @IsString()
  productCode?: string;
}

export class UpdateDocumentStatusDto {
  @IsString()
  status!: string;

  @IsString()
  @MinLength(2)
  actorId!: string;
}

export class ConfirmDocumentAnalysisDto {
  @IsString()
  @MinLength(2)
  reviewerId!: string;

  @IsOptional()
  analysis?: Record<string, unknown>;
}
