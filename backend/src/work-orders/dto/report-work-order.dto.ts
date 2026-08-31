import { IsArray, IsInt, IsObject, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class ReportWorkOrderDto {
  @IsInt()
  @Min(1)
  @Max(1000000000)
  quantity!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  goodQty?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  defectQty?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  deviceId?: string;

  @IsOptional()
  @IsString()
  sourceTraceId?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  batchNo?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serialNumbers?: string[];

  @IsOptional()
  @IsString()
  @MinLength(2)
  operationCode?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  operatorId?: string;

  @IsOptional()
  @IsString()
  qualityRecordId?: string;

  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  materialConsumptions?: Array<{ materialCode: string; batchNo: string; quantity: number; unit?: string }>;
}
