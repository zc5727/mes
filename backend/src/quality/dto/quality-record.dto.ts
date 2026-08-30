import { IsObject, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateQualityRecordDto {
  @IsOptional()
  @IsString()
  formKey?: string;

  @IsOptional()
  @IsString()
  formVersion?: string;

  @IsOptional()
  @IsString()
  workOrderId?: string;

  @IsString()
  @MinLength(2)
  batchNo!: string;

  @IsString()
  @MinLength(2)
  lineId!: string;

  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsString()
  @MinLength(2)
  operatorId!: string;

  @IsObject()
  values!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  traceId?: string;
}

export class UpdateQualityDraftDto {
  @IsOptional()
  @IsObject()
  values?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  batchNo?: string;

  @IsOptional()
  @IsString()
  workOrderId?: string;

  @IsOptional()
  @IsString()
  deviceId?: string;
}

export class QualityTransitionDto {
  @IsString()
  @MinLength(2)
  actorId!: string;
}
