import { IsArray, IsIn, IsObject, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateQualityRecordDto {
  @IsOptional() @IsIn(['IQC', 'IPQC', 'OQC']) inspectionType?: 'IQC' | 'IPQC' | 'OQC';
  @IsOptional() @IsString() @MinLength(2) ruleKey?: string;
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

export class CreateQualityRuleDto {
  @IsString() @MinLength(2) key!: string;
  @IsString() @MinLength(2) name!: string;
  @IsIn(['IQC', 'IPQC', 'OQC']) inspectionType!: 'IQC' | 'IPQC' | 'OQC';
  @IsArray() @IsString({ each: true }) requiredFields!: string[];
}

export class CreateQualityIssueDto {
  @IsString() @MinLength(2) qualityRecordId!: string;
  @IsString() @MinLength(1) code!: string;
  @IsString() @MinLength(2) description!: string;
  @IsOptional() @IsString() capa?: string;
}

export class UpdateQualityIssueDto {
  @IsIn(['open', 'contained', 'closed']) status!: 'open' | 'contained' | 'closed';
  @IsOptional() @IsString() capa?: string;
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
